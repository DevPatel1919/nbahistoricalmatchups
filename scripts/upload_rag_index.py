"""
upload_rag_index.py

Uploads the Ask the Court corpus (F13 Session 5) for one Worker environment,
through Wrangler:

    Vectorize  every chunk's bge-small-en-v1.5 embedding (CLS pooling), upserted
               by chunk id. Embeddings come from the Workers AI cache
               (src/rag/workers_ai.py), so a repeat costs no neurons.
    D1         the migrations, then the chunks and their FTS5 index, replaced
               in one file (ASK_DB)
    KV         ask:<release>:data on POOL: the chunks, facts, model inputs and
               team list the Worker loads once per isolate

It is idempotent. A new release gets a new KV key, and the Worker's ASK_RELEASE
says which one it reads.

Run from repo root. The Vectorize index and D1 database must exist first:
    npx wrangler vectorize create court-ask-v1-staging --dimensions=384 --metric=cosine
    npx wrangler d1 create court-ask-staging          # paste the id into worker/wrangler.jsonc
    python scripts/upload_rag_index.py --env staging --dry-run     # writes the files only
    python scripts/upload_rag_index.py --env staging
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

_REPO_ROOT_FOR_IMPORTS = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT_FOR_IMPORTS) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT_FOR_IMPORTS))

from src.rag.config import RETRIEVAL
from src.rag.index_local import load_corpus
from src.rag.workers_ai import WorkersAI

REPO_ROOT    = Path(__file__).resolve().parent.parent
WORKER_DIR   = REPO_ROOT / "worker"
INDEX_PATH   = REPO_ROOT / "frontend" / "public" / "data" / "index.json"
FACTS_PATH   = REPO_ROOT / "data" / "rag" / "facts.json"
INPUTS_PATH  = REPO_ROOT / "data" / "rag" / "model_inputs.json"
OUTPUT_DIR   = REPO_ROOT / "data" / "processed" / "rag" / "upload"

ENVIRONMENTS = {
    "staging":    {"index": "court-ask-v1-staging", "db": "court-ask-staging", "wrangler_env": ["--env", "staging"]},
    "production": {"index": "court-ask-v1",         "db": "court-ask",         "wrangler_env": []},
}

CHUNK_FIELDS = ["id", "type", "title", "keys", "seasons", "text"]
# Wrangler's upload fails intermittently on large bodies (seen at 300 and 1,000 vectors), and each
# of its runs starts over, so each batch here is its own run with its own retries.
VECTORIZE_BATCH = 100
WRANGLER_ATTEMPTS = 4
WRANGLER_BACKOFF_SECONDS = 20


def sql_text(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def seed_sql(chunks: list[dict]) -> str:
    """Replaces every chunk and rebuilds the FTS5 index. The schema is worker/migrations-ask/0001_ask.sql."""
    lines = ["DELETE FROM ask_chunks_fts;", "DELETE FROM ask_chunks;"]
    for c in chunks:
        values = [c["id"], c["type"], c["title"], c["text"], json.dumps(c["keys"]), json.dumps(c["seasons"]), c["release"]]
        lines.append("INSERT INTO ask_chunks (id, type, title, text, keys, seasons, release) VALUES ("
                     + ", ".join(sql_text(v) for v in values) + ");")
    lines.append("INSERT INTO ask_chunks_fts (rowid, title, text) SELECT rowid, title, text FROM ask_chunks;")
    return "\n".join(lines) + "\n"


def data_bundle(chunks: list[dict]) -> dict:
    with open(INDEX_PATH, encoding="utf-8") as f:
        teams = [{k: t[k] for k in ("key", "season", "city", "name")} for t in json.load(f)["teams"]]
    with open(FACTS_PATH, encoding="utf-8") as f:
        facts = json.load(f)
    with open(INPUTS_PATH, encoding="utf-8") as f:
        inputs = json.load(f)
    return {"release": facts["release"], "teams": teams, "chunks": [{k: c[k] for k in CHUNK_FIELDS} for c in chunks],
            "facts": facts, "modelInputs": inputs}


def vectors_ndjson(chunks: list[dict]) -> list[str]:
    client = WorkersAI()
    vectors = client.embed([c["text"] for c in chunks], model=RETRIEVAL.dense_model, pooling="cls")
    return [json.dumps({"id": c["id"], "values": [round(float(x), 7) for x in v]}) for c, v in zip(chunks, vectors)]


def wrangler(args: list[str]) -> None:
    npx = shutil.which("npx") or "npx"
    print("wrangler " + " ".join(args))
    # .env's token is limited to Workers AI (src/rag/workers_ai.py). Wrangler must use its own login.
    clean = {k: v for k, v in os.environ.items() if k != "CLOUDFLARE_API_TOKEN"}
    # Every step is idempotent, so a dropped connection just repeats the step.
    for attempt in range(1, WRANGLER_ATTEMPTS + 1):
        if subprocess.run([npx, "wrangler", *args], cwd=WORKER_DIR, env=clean).returncode == 0:
            return
        print("Attempt " + str(attempt) + " of " + str(WRANGLER_ATTEMPTS) + " failed.")
        if attempt < WRANGLER_ATTEMPTS:
            time.sleep(WRANGLER_BACKOFF_SECONDS * attempt)
    raise RuntimeError("wrangler " + " ".join(args[:3]) + " kept failing; check the connection and rerun.")


def main():
    parser = argparse.ArgumentParser(description="Upload the Ask the Court corpus through Wrangler.")
    parser.add_argument("--env", required=True, choices=sorted(ENVIRONMENTS))
    parser.add_argument("--dry-run", action="store_true", help="write the files, upload nothing")
    args = parser.parse_args()
    target = ENVIRONMENTS[args.env]

    chunks = load_corpus()
    bundle = data_bundle(chunks)
    release = bundle["release"]
    too_long = [c["id"] for c in chunks if len(c["id"].encode("utf-8")) > 64]
    if too_long:
        raise ValueError("Vectorize ids are limited to 64 bytes: " + str(too_long))

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    data_path = OUTPUT_DIR / "ask_data.json"
    seed_path = OUTPUT_DIR / "ask_seed.sql"
    vectors_path = OUTPUT_DIR / "ask_vectors.ndjson"
    data_path.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8", newline="\n")
    seed_path.write_text(seed_sql(chunks), encoding="utf-8", newline="\n")
    lines = vectors_ndjson(chunks)
    vectors_path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print("Chunks: " + str(len(chunks)) + "  Release: " + release)
    print("Saved " + str(data_path) + ", " + str(seed_path) + ", " + str(vectors_path))
    if args.dry_run:
        return

    env_args = target["wrangler_env"]
    wrangler(["d1", "migrations", "apply", "ASK_DB", "--remote", *env_args])
    wrangler(["d1", "execute", "ASK_DB", "--remote", "--yes", "--file", str(seed_path), *env_args])
    batch_path = OUTPUT_DIR / "ask_vectors_batch.ndjson"
    for start in range(0, len(lines), VECTORIZE_BATCH):
        batch = lines[start:start + VECTORIZE_BATCH]
        batch_path.write_text("\n".join(batch) + "\n", encoding="utf-8", newline="\n")
        wrangler(["vectorize", "upsert", target["index"], "--file", str(batch_path), "--batch-size", str(len(batch))])
    wrangler(["kv", "key", "put", "ask:" + release + ":data", "--binding", "POOL", "--remote", "--path", str(data_path), *env_args])
    print("Uploaded the " + release + " corpus to " + args.env + ".")


if __name__ == "__main__":
    main()
