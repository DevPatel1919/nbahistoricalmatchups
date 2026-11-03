// POST /v1/ask: Ask the Court (F13, docs/product/features/F13-ask-the-court.md).
//
//   { question, context?: { a, b } }                free text: the model pipeline
//   { context: { a, b }, suggested }                a suggested question: a template, no model
//
// The response is text/event-stream, with events in this order:
//   meta   { askId, linked, sources: [{ label, id, title, kind, text }] }
//   token  { text }
//   done   { grounded, removed, citations, fallback, neurons }
//   error  { code }  instead of what's left, if something fails mid-answer
//
// The answer is checked before any of it is sent, so nothing a visitor reads can
// fail the grounding check; "token" carries the checked text, not model tokens.
// Guards answer as plain JSON errors, like every other route.
//
// Free text stops at ASK_ENABLED (the kill switch) and at ASK_DAILY_NEURON_BUDGET,
// which keeps the feature inside Workers AI's free allowance. Suggested questions
// use no model, so they keep working past both.

import type { Env } from "../env";
import { ApiError, readJson } from "../http";
import { enforce, LIMITS } from "../ratelimit";
import { Linker, type IndexTeam } from "./linker";
import {
  askingToBet,
  BETTING_REFUSAL,
  generate,
  promptText,
  retrieve,
  type AskDeps,
  type AskModels,
  type ChatMessage,
  type Chunk,
  type PageContext,
} from "./pipeline";
import { SUGGESTED, templateAnswer, Tools, type Facts, type ModelInputs, type Opponents, type Suggested } from "./tools";

const MAX_QUESTION = 300;
const KEY = /^\d{4}-[a-z0-9-]{1,40}$/;
// A free-text answer rarely costs more than this; the check is before the call.
const ANSWER_ESTIMATE = 60;
const LOG_RETENTION_MS = 30 * 86_400_000;
const BUDGET_RETENTION_MS = 90 * 86_400_000;

const EMBED = "@cf/baai/bge-small-en-v1.5";
const RERANK = "@cf/baai/bge-reranker-base";
const GENERATOR = "@cf/google/gemma-4-26b-a4b-it";
// Neurons per million tokens (Cloudflare's pricing page, 2026-10-26), used when a
// reply doesn't report what it cost.
const EMBED_RATE = 1841;
const RERANK_RATE = 283;
const GENERATOR_RATES = [9091, 27273];
const CHARS_PER_TOKEN = 4;

/** What the route needs from outside; tests pass doubles. */
export interface AskBackends {
  models: AskModels;
  opponents(key: string): Promise<Opponents>;
}

type AskData = { release: string; teams: IndexTeam[]; chunks: Chunk[]; facts: Facts; modelInputs: ModelInputs };
type Loaded = { chunks: Map<string, Chunk>; titles: Map<string, string>; linker: Linker; facts: Facts; modelInputs: ModelInputs };

// One isolate parses the corpus once; a new release has a new key.
const loaded = new Map<string, Loaded>();

export function askDataKey(release: string): string {
  return "ask:" + release + ":data";
}

async function loadData(env: Env): Promise<Loaded | null> {
  const release = env.ASK_RELEASE ?? "";
  const hit = loaded.get(release);
  if (hit) return hit;
  const data = await env.POOL.get<AskData>(askDataKey(release), { type: "json", cacheTtl: 3600 });
  if (!data) return null;
  const titles = new Map<string, string>();
  for (const c of data.chunks) if (c.type === "team_card") titles.set(c.keys[0], c.title);
  const value: Loaded = {
    chunks: new Map(data.chunks.map((c) => [c.id, c])),
    titles,
    linker: new Linker(data.teams),
    facts: data.facts,
    modelInputs: data.modelInputs,
  };
  loaded.set(release, value);
  return value;
}

/** Tests load a different corpus between runs. */
export function resetAskData(): void {
  loaded.clear();
}

// ---------------------------------------------------------------------------
// The real backends
// ---------------------------------------------------------------------------

function tokens(text: string): number {
  return Math.max(1, Math.round(text.length / CHARS_PER_TOKEN));
}

type ChatReply = {
  response?: string;
  choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
  usage?: { neurons?: number; prompt_tokens?: number; completion_tokens?: number };
};

export function replyText(reply: ChatReply): string {
  if (typeof reply.response === "string") return reply.response;
  const message = reply.choices?.[0]?.message;
  if (message) return message.content || message.reasoning_content || "";
  throw new Error("unrecognised model reply");
}

/** BM25 over titles and text, titles weighted 5:1: the query src/rag/index_local.py runs. */
export async function ftsSearch(db: D1Database, match: string, limit: number): Promise<string[]> {
  const rows = await db
    .prepare(
      "SELECT c.id AS id, bm25(ask_chunks_fts, 5.0, 1.0) AS score FROM ask_chunks_fts" +
        " JOIN ask_chunks c ON c.rowid = ask_chunks_fts.rowid" +
        " WHERE ask_chunks_fts MATCH ? ORDER BY score, c.id LIMIT ?",
    )
    .bind(match, limit)
    .all<{ id: string }>();
  return rows.results.map((r) => r.id);
}

function realBackends(env: Env): AskBackends {
  const ai = env.AI as unknown as { run(model: string, input: unknown): Promise<unknown> };
  const db = env.ASK_DB as D1Database;
  const index = env.ASK_INDEX as VectorizeIndex;
  return {
    models: {
      keywordSearch: (match, limit) => ftsSearch(db, match, limit),
      async embed(text) {
        const reply = (await ai.run(EMBED, { text: [text], pooling: "cls" })) as { data: number[][] };
        return { vector: reply.data[0], neurons: (tokens(text) * EMBED_RATE) / 1e6 };
      },
      async denseSearch(vector, limit) {
        const reply = await index.query(vector, { topK: limit, returnValues: false, returnMetadata: "none" });
        return reply.matches.map((m) => m.id);
      },
      async rerank(query, texts) {
        const reply = (await ai.run(RERANK, { query, contexts: texts.map((text) => ({ text })) })) as {
          response: { id: number; score: number }[];
        };
        const scores = new Array<number>(texts.length).fill(-Infinity);
        for (const item of reply.response) scores[item.id] = item.score;
        const used = texts.reduce((sum, t) => sum + tokens(query) + tokens(t), 0);
        return { scores, neurons: (used * RERANK_RATE) / 1e6 };
      },
      async chat(messages: ChatMessage[], maxTokens: number) {
        const reply = (await ai.run(GENERATOR, {
          messages,
          max_tokens: maxTokens,
          temperature: 0,
          chat_template_kwargs: { enable_thinking: false },
        })) as ChatReply;
        const text = replyText(reply).trim();
        const inTokens = reply.usage?.prompt_tokens ?? messages.reduce((sum, m) => sum + tokens(m.content), 0);
        const outTokens = reply.usage?.completion_tokens ?? tokens(text);
        const neurons = reply.usage?.neurons ?? (inTokens * GENERATOR_RATES[0] + outTokens * GENERATOR_RATES[1]) / 1e6;
        return { text, neurons };
      },
    },
    // The static site publishes every pair's exported p and m; the cache keeps this cheap.
    async opponents(key) {
      const response = await fetch(env.APP_ORIGIN.replace(/\/+$/, "") + "/data/teams/" + key + ".json", {
        cf: { cacheEverything: true, cacheTtl: 3600 },
      });
      if (!response.ok) throw new Error("team file " + response.status);
      return ((await response.json()) as { opponents: Opponents }).opponents;
    },
  };
}

// ---------------------------------------------------------------------------
// Budget and log
// ---------------------------------------------------------------------------

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

async function spentToday(db: D1Database, now: number): Promise<number> {
  const row = await db.prepare("SELECT neurons FROM ask_budget WHERE day = ?").bind(utcDay(now)).first<{ neurons: number }>();
  return row?.neurons ?? 0;
}

async function charge(db: D1Database, now: number, neurons: number): Promise<void> {
  await db
    .prepare("INSERT INTO ask_budget (day, neurons) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET neurons = neurons + excluded.neurons")
    .bind(utcDay(now), neurons)
    .run();
}

type LogRow = { id: string; question: string; linked: string[]; sources: string[]; grounded: boolean; fallback: boolean; latencyMs: number };

async function writeLog(env: Env, db: D1Database, now: number, row: LogRow): Promise<void> {
  if (env.ASK_LOG_QUESTIONS !== "1") return;
  await db
    .prepare("INSERT INTO ask_log (id, created_at, question, linked, sources, grounded, fallback, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(row.id, now, row.question, JSON.stringify(row.linked), JSON.stringify(row.sources), row.grounded ? 1 : 0, row.fallback ? 1 : 0, row.latencyMs)
    .run();
}

/** Scheduled: asked questions are kept for 30 days (the About page says so). */
export async function purgeAskLog(env: Env, now: number): Promise<void> {
  if (!env.ASK_DB) return;
  await env.ASK_DB.batch([
    env.ASK_DB.prepare("DELETE FROM ask_log WHERE created_at < ?").bind(now - LOG_RETENTION_MS),
    env.ASK_DB.prepare("DELETE FROM ask_budget WHERE day < ?").bind(utcDay(now - BUDGET_RETENTION_MS)),
  ]);
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

type Parsed = { question: string; context: PageContext | null; suggested: Suggested | null };

function parseBody(body: unknown): Parsed {
  if (typeof body !== "object" || body === null) throw new ApiError("bad_request");
  const { question, context, suggested } = body as { question?: unknown; context?: unknown; suggested?: unknown };
  let page: PageContext | null = null;
  if (context !== undefined && context !== null) {
    const { a, b } = context as { a?: unknown; b?: unknown };
    if (typeof a !== "string" || typeof b !== "string" || !KEY.test(a) || !KEY.test(b) || a === b) throw new ApiError("bad_request");
    page = { a, b };
  }
  if (suggested !== undefined && suggested !== null) {
    if (!SUGGESTED.includes(suggested as Suggested) || !page) throw new ApiError("bad_request");
    return { question: "", context: page, suggested: suggested as Suggested };
  }
  if (typeof question !== "string") throw new ApiError("bad_request");
  const text = question.trim();
  if (!text || text.length > MAX_QUESTION) throw new ApiError("bad_request");
  return { question: text, context: page, suggested: null };
}

type Send = (event: string, data: unknown) => Promise<void>;

function eventStream(run: (send: Send) => Promise<void>): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send: Send = (event, data) => writer.write(encoder.encode("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n"));
  void (async () => {
    try {
      await run(send);
    } catch (error) {
      console.error("ask failed", error instanceof Error ? error.name : typeof error);
      await send("error", { code: "internal" }).catch(() => undefined);
    } finally {
      await writer.close().catch(() => undefined);
    }
  })();
  return new Response(readable, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

function factSources(facts: string[]) {
  return facts.map((text, i) => ({ label: "F" + (i + 1), id: null, title: "From the site's data", kind: "fact", text }));
}

export async function askResponse(request: Request, env: Env, ipKey: string, backends?: AskBackends, now = Date.now()): Promise<Response> {
  const scale = Number(env.RATE_LIMIT_SCALE);
  await enforce(env.RATE_LIMITS, LIMITS.askPerIpMinute, ipKey, scale, now);
  await enforce(env.RATE_LIMITS, LIMITS.askPerIpDay, ipKey, scale, now);
  const { question, context, suggested } = parseBody(await readJson(request, 2048));

  const db = env.ASK_DB;
  const data = db ? await loadData(env) : null;
  if (!db || !data) throw new ApiError("ask_unavailable");
  if (context && (!data.facts.teams[context.a] || !data.facts.teams[context.b])) throw new ApiError("bad_request");

  if (!backends && (!env.AI || !env.ASK_INDEX)) throw new ApiError("ask_unavailable");
  const { models, opponents } = backends ?? realBackends(env);
  const tools = new Tools(data.facts, data.modelInputs, opponents);
  const askId = crypto.randomUUID();
  const started = Date.now();

  if (suggested) {
    const pair = context as PageContext;
    return eventStream(async (send) => {
      const answer = await templateAnswer(tools, suggested, pair.a, pair.b);
      await send("meta", { askId, linked: [pair.a, pair.b], sources: factSources(answer.facts) });
      await send("token", { text: answer.text });
      await send("done", { grounded: true, removed: 0, citations: [], fallback: true, neurons: 0 });
    });
  }

  if (env.ASK_ENABLED !== "1") throw new ApiError("ask_disabled");

  if (askingToBet(question)) {
    return eventStream(async (send) => {
      await send("meta", { askId, linked: [], sources: [] });
      await send("token", { text: BETTING_REFUSAL });
      await send("done", { grounded: true, removed: 0, citations: [], fallback: false, neurons: 0 });
      await writeLog(env, db, now, { id: askId, question, linked: [], sources: [], grounded: true, fallback: false, latencyMs: Date.now() - started });
    });
  }

  const budget = Number(env.ASK_DAILY_NEURON_BUDGET);
  if (!Number.isFinite(budget) || (await spentToday(db, now)) + ANSWER_ESTIMATE > budget) throw new ApiError("ask_budget");

  const deps: AskDeps = { chunks: data.chunks, titles: data.titles, linker: data.linker, tools, models };
  return eventStream(async (send) => {
    const got = await retrieve(deps, question, context);
    const sources = [
      ...factSources(got.facts),
      ...got.chunkIds.map((id, i) => {
        const chunk = data.chunks.get(id) as Chunk;
        return { label: "C" + (i + 1), id, title: chunk.title, kind: chunk.type, text: promptText(chunk) };
      }),
    ];
    await send("meta", { askId, linked: got.link.keys, sources });
    const answer = await generate(deps, question, got);
    const neurons = got.neurons + answer.neurons;
    await charge(db, now, neurons);
    await send("token", { text: answer.text });
    await send("done", {
      grounded: answer.grounded,
      removed: answer.removed,
      citations: answer.citations,
      fallback: false,
      firstPass: answer.firstPass,
      regenerated: answer.regenerated,
      neurons,
    });
    await writeLog(env, db, now, {
      id: askId,
      question,
      linked: got.link.keys,
      sources: got.chunkIds,
      grounded: answer.grounded,
      fallback: false,
      latencyMs: Date.now() - started,
    });
  });
}
