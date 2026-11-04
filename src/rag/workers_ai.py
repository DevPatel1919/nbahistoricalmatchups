"""
workers_ai.py

The one way F13's Python code calls a model: Cloudflare Workers AI's REST API
(docs/product/features/F13-ask-the-court.md, "Cloudflare-only development").

Every call goes through WorkersAI, which:
- caches each response on disk, keyed by model and request, so a rerun of an
  unchanged configuration costs nothing and works without credentials;
- estimates each uncached call's neurons from the token count and the
  pricing table below, keeps a ledger per UTC day, and refuses a call that
  would pass the daily development cap (RAG_DEV_NEURON_CAP, default 6,000 of
  the account's free 10,000, which staging and production share);
- retries rate-limit and server errors with backoff.

Chat calls (the generator and the judge, Session 4) are charged from the
token counts Workers AI reports, once the reply arrives, and keep their
request latency in the cache, so a cached rerun still reports it.

Credentials come from the gitignored .env: CLOUDFLARE_ACCOUNT_ID and
CLOUDFLARE_API_TOKEN (a Workers AI token the owner creates in the dashboard).
They are read only when a call is not in the cache.
"""

import hashlib
import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests
from dotenv import load_dotenv

REPO_ROOT  = Path(__file__).resolve().parents[2]
ENV_PATH   = REPO_ROOT / ".env"
CACHE_PATH = REPO_ROOT / "data" / "processed" / "rag" / "workers_ai_cache.sqlite"
API_URL    = "https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{model}"

DEFAULT_DAILY_CAP = 6000
EMBED_BATCH       = 50
MAX_ATTEMPTS      = 5
TIMEOUT_SECONDS   = 120

EMBED_SMALL = "@cf/baai/bge-small-en-v1.5"
EMBED_BASE  = "@cf/baai/bge-base-en-v1.5"
RERANKER    = "@cf/baai/bge-reranker-base"

# Generator candidates (Session 4) and the judge.
LLAMA_8B   = "@cf/meta/llama-3.1-8b-instruct-fp8-fast"
LLAMA_3B   = "@cf/meta/llama-3.2-3b-instruct"
QWEN3_30B  = "@cf/qwen/qwen3-30b-a3b-fp8"
GEMMA4_26B = "@cf/google/gemma-4-26b-a4b-it"
GPT_OSS    = "@cf/openai/gpt-oss-120b"

# Models with a thinking mode, switched off with chat_template_kwargs.
THINKING_MODELS = {QWEN3_30B, GEMMA4_26B}

# Neurons per million (input, output) tokens, from developers.cloudflare.com/
# workers-ai/platform/pricing/ on 2026-10-26 (gpt-oss-120b and llama-4-scout
# added from the same page on 2026-10-27). Used to estimate spend before a
# call and to charge chat calls from their reported tokens; Cloudflare's
# dashboard is the real meter.
NEURONS_PER_M = {
    EMBED_SMALL:                                (1841, 0),
    EMBED_BASE:                                 (6058, 0),
    RERANKER:                                   (283, 0),
    "@cf/meta/llama-3.1-8b-instruct-fp8-fast":  (4119, 34868),
    "@cf/meta/llama-3.1-8b-instruct":           (25608, 75147),
    "@cf/meta/llama-3.2-3b-instruct":           (4625, 30475),
    "@cf/qwen/qwen3-30b-a3b-fp8":               (4625, 30475),
    "@cf/google/gemma-4-26b-a4b-it":            (9091, 27273),
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast": (26668, 204805),
    "@cf/meta/llama-4-scout-17b-16e-instruct":  (24545, 77273),
    GPT_OSS:                                    (31818, 68182),
}

# Rough tokens per character for the estimate (bge's WordPiece and Llama's
# tokenizer both run near 4 characters per token on this English text).
CHARS_PER_TOKEN = 4


class MissingCredentials(RuntimeError):
    pass


class BudgetExceeded(RuntimeError):
    pass


class WorkersAIError(RuntimeError):
    pass


def reply_text(result: dict) -> str:
    """The text of a chat reply in any of the shapes Workers AI returns."""
    if isinstance(result.get("response"), str):                     # Workers AI native (Llama)
        return result["response"]
    if result.get("choices"):                                        # OpenAI chat completions (Qwen, Gemma, gpt-oss)
        message = result["choices"][0]["message"]
        # Qwen3 with thinking switched off returns its answer as reasoning_content and no content
        # (seen 2026-10-27). With thinking off there is no other reasoning, so that text is the answer.
        return message.get("content") or message.get("reasoning_content") or ""
    if isinstance(result.get("output_text"), str):                   # Responses API (gpt-oss)
        return result["output_text"]
    parts = []
    for item in result.get("output") or []:
        if item.get("type") == "message":
            parts += [c.get("text", "") for c in item.get("content") or [] if c.get("type") == "output_text"]
    if parts:
        return "".join(parts)
    raise WorkersAIError("Unrecognised reply shape: " + json.dumps(result)[:300])


def reply_usage(result: dict) -> tuple[int, int] | None:
    """(input tokens, output tokens) as reported, or None. Reasoning tokens count as output."""
    usage = result.get("usage") or {}
    tokens_in = usage.get("prompt_tokens", usage.get("input_tokens"))
    tokens_out = usage.get("completion_tokens", usage.get("output_tokens"))
    if tokens_in is None or tokens_out is None:
        return None
    return int(tokens_in), int(tokens_out)


def estimate_tokens(text: str) -> int:
    return max(1, round(len(text) / CHARS_PER_TOKEN))


def estimate_neurons(model: str, input_tokens: int, output_tokens: int = 0) -> float:
    if model not in NEURONS_PER_M:
        raise ValueError("No neuron rate for " + model + "; add it to NEURONS_PER_M from the pricing page.")
    rate_in, rate_out = NEURONS_PER_M[model]
    return (input_tokens * rate_in + output_tokens * rate_out) / 1_000_000


def cache_key(model: str, payload: dict) -> str:
    blob = model + "\n" + json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def utc_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class WorkersAI:
    def __init__(self, cache_path: Path = CACHE_PATH, daily_cap: float | None = None,
                 session=None, today=utc_day, sleep=time.sleep):
        load_dotenv(ENV_PATH)
        self.daily_cap = float(daily_cap if daily_cap is not None
                               else os.environ.get("RAG_DEV_NEURON_CAP", DEFAULT_DAILY_CAP))
        self.session = session or requests.Session()
        self.today = today
        self.sleep = sleep
        self.latencies = []   # (model, seconds) for every uncached request this run
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(cache_path)
        self.db.execute("CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, model TEXT, response TEXT)")
        self.db.execute("CREATE TABLE IF NOT EXISTS ledger (day TEXT, model TEXT, neurons REAL, calls INTEGER,"
                        " PRIMARY KEY (day, model))")
        self.db.commit()

    # -- cache and ledger --------------------------------------------------

    def cached(self, key: str):
        row = self.db.execute("SELECT response FROM cache WHERE key = ?", (key,)).fetchone()
        return None if row is None else json.loads(row[0])

    def store(self, key: str, model: str, result) -> None:
        self.db.execute("INSERT OR REPLACE INTO cache VALUES (?, ?, ?)",
                        (key, model, json.dumps(result, ensure_ascii=False, separators=(",", ":"))))
        self.db.commit()

    def spent_today(self) -> float:
        row = self.db.execute("SELECT COALESCE(SUM(neurons), 0) FROM ledger WHERE day = ?", (self.today(),)).fetchone()
        return float(row[0])

    def charge(self, model: str, neurons: float) -> None:
        self.db.execute("INSERT INTO ledger VALUES (?, ?, ?, 1) ON CONFLICT (day, model) DO UPDATE SET"
                        " neurons = neurons + excluded.neurons, calls = calls + 1", (self.today(), model, neurons))
        self.db.commit()

    def check_budget(self, neurons: float) -> None:
        spent = self.spent_today()
        if spent + neurons > self.daily_cap:
            raise BudgetExceeded("This call needs about " + format(neurons, ".1f") + " neurons, but "
                                 + format(spent, ".0f") + " of today's development cap of "
                                 + format(self.daily_cap, ".0f") + " are spent (UTC day " + self.today()
                                 + "). Cached results are kept; rerun tomorrow or raise RAG_DEV_NEURON_CAP.")

    # -- HTTP --------------------------------------------------------------

    def credentials(self) -> tuple[str, str]:
        account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
        token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
        if not account or not token:
            raise MissingCredentials("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in " + str(ENV_PATH)
                                     + " (a Workers AI API token from the Cloudflare dashboard).")
        return account, token

    def post(self, model: str, payload: dict):
        account, token = self.credentials()
        url = API_URL.format(account=account, model=model)
        for attempt in range(1, MAX_ATTEMPTS + 1):
            started = time.perf_counter()
            response = self.session.post(url, json=payload, timeout=TIMEOUT_SECONDS,
                                         headers={"Authorization": "Bearer " + token})
            self.latencies.append((model, time.perf_counter() - started))
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == MAX_ATTEMPTS:
                    break
                self.sleep(2 ** attempt)
                continue
            body = response.json()
            if response.status_code != 200 or not body.get("success", False):
                raise WorkersAIError(model + " returned HTTP " + str(response.status_code) + ": "
                                     + json.dumps(body.get("errors", body))[:500])
            return body["result"]
        raise WorkersAIError(model + " kept failing after " + str(MAX_ATTEMPTS) + " attempts (HTTP "
                             + str(response.status_code) + ").")

    def run(self, model: str, payload: dict, input_tokens: int, output_tokens: int = 0):
        """One cached, budgeted call. Returns the response's `result`."""
        key = cache_key(model, payload)
        hit = self.cached(key)
        if hit is not None:
            return hit
        neurons = estimate_neurons(model, input_tokens, output_tokens)
        self.check_budget(neurons)
        result = self.post(model, payload)
        self.charge(model, neurons)
        self.store(key, model, result)
        return result

    # -- models ------------------------------------------------------------

    def embed(self, texts: list[str], model: str = EMBED_BASE, pooling: str = "cls") -> np.ndarray:
        """
        Embeddings for texts, as a float32 array of shape (len(texts), dims).
        Each text is cached on its own, so adding texts never re-embeds old ones.
        """
        keys = [cache_key(model, {"text": [t], "pooling": pooling}) for t in texts]
        vectors = {k: self.cached(k) for k in set(keys)}
        missing = [t for t, k in dict(zip(texts, keys)).items() if vectors[k] is None]
        for start in range(0, len(missing), EMBED_BATCH):
            batch = missing[start:start + EMBED_BATCH]
            neurons = estimate_neurons(model, sum(estimate_tokens(t) for t in batch))
            self.check_budget(neurons)
            result = self.post(model, {"text": batch, "pooling": pooling})
            data = result["data"]
            if len(data) != len(batch):
                raise WorkersAIError(model + " returned " + str(len(data)) + " vectors for " + str(len(batch)) + " texts.")
            self.charge(model, neurons)
            for text, vector in zip(batch, data):
                key = cache_key(model, {"text": [text], "pooling": pooling})
                self.store(key, model, vector)
                vectors[key] = vector
        return np.array([vectors[k] for k in keys], dtype=np.float32)

    def chat(self, model: str, messages: list[dict], max_tokens: int = 400, temperature: float = 0.0,
             reasoning_effort: str | None = None) -> dict:
        """
        One cached, budgeted chat call. Returns {text, input_tokens,
        output_tokens, neurons, latency_ms, cached}. Tokens and neurons are
        Workers AI's reported counts (the estimate if it reports none); the
        latency is the original request's, also on a cache hit.
        """
        payload = {"messages": messages, "max_tokens": max_tokens, "temperature": temperature}
        if model in THINKING_MODELS:
            payload["chat_template_kwargs"] = {"enable_thinking": False}
        if reasoning_effort:
            payload["reasoning"] = {"effort": reasoning_effort}
        key = cache_key(model, payload)
        result = self.cached(key)
        cached = result is not None
        estimate_in = sum(estimate_tokens(m["content"]) for m in messages)
        if not cached:
            self.check_budget(estimate_neurons(model, estimate_in, max_tokens))
            started = time.perf_counter()
            result = self.post(model, payload)
            result["_latency_ms"] = round(1000 * (time.perf_counter() - started))
        tokens_in, tokens_out = reply_usage(result) or (estimate_in, estimate_tokens(reply_text(result)))
        # Workers AI reports the neurons it charged in usage; the rate table is the fallback.
        neurons = (result.get("usage") or {}).get("neurons")
        neurons = float(neurons) if neurons is not None else estimate_neurons(model, tokens_in, tokens_out)
        if not cached:
            self.charge(model, neurons)
            self.store(key, model, result)
        return {"text": reply_text(result).strip(), "input_tokens": tokens_in, "output_tokens": tokens_out,
                "neurons": neurons, "latency_ms": result.get("_latency_ms"), "cached": cached}

    def rerank(self, query: str, texts: list[str], model: str = RERANKER) -> list[float]:
        """Relevance scores for texts against query, in the order given."""
        payload = {"query": query, "contexts": [{"text": t} for t in texts]}
        tokens = sum(estimate_tokens(query) + estimate_tokens(t) for t in texts)
        result = self.run(model, payload, tokens)
        scores = [None] * len(texts)
        for item in result["response"]:
            scores[item["id"]] = float(item["score"])
        if any(s is None for s in scores):
            raise WorkersAIError(model + " did not score every context.")
        return scores
