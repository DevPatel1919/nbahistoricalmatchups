// Ask the Court (F13): the browser side of POST /v1/ask on the Worker. The answer
// arrives as an event stream: meta (the sources), token (the checked text), done.
// Guards answer as plain JSON errors. Nothing else on the page depends on this:
// without the API, or if it fails, the panel says so and the page carries on.

import { DUEL_API } from "./duelApi";

export type AskSource = { label: string; id: string | null; title: string; kind: string; text: string };
export type AskMeta = { askId: string; linked: string[]; sources: AskSource[] };
export type AskDone = { grounded: boolean; removed: number; citations: string[]; fallback: boolean };
export type Suggested = "why" | "defence" | "limits";
export type AskRequest = { question?: string; context?: { a: string; b: string }; suggested?: Suggested };
export type AskHandlers = { onMeta(meta: AskMeta): void; onText(text: string): void; onDone(done: AskDone): void };

export class AskError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

/** What a visitor reads for each failure. */
export function askErrorMessage(code: string): string {
  switch (code) {
    case "rate_limited":
      return "That's a lot of questions. Give it a minute and try again.";
    case "ask_budget":
      return "Ask the Court is resting until tomorrow. The suggested questions on a matchup page still work.";
    case "ask_disabled":
      return "Ask the Court is taking a break. The suggested questions on a matchup page still work.";
    case "bad_request":
      return "Try asking that a different way, in 300 characters or fewer.";
    default:
      return "Ask the Court isn't available right now. Everything else on the site still works.";
  }
}

export type SseEvent = { event: string; data: unknown };

/** The complete events in a buffer, and what's left over for the next read. */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let event = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data += line.slice(6);
    }
    if (event && data) events.push({ event, data: JSON.parse(data) });
  }
  return { events, rest };
}

export type AnswerPart = { text: string } | { labels: string[] };

const CITATION = /\[((?:[FC]\d+)(?:\s*[,;]\s*[FC]?\d+)*)\]/g;

/** An answer split into text and citations: "[F1, C2]" and "[F1, 2]" both name two sources. */
export function splitCitations(answer: string): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let at = 0;
  for (const m of answer.matchAll(CITATION)) {
    if (m.index > at) parts.push({ text: answer.slice(at, m.index) });
    let letter = "F";
    const labels: string[] = [];
    for (const item of m[1].matchAll(/([FC]?)(\d+)/g)) {
      letter = item[1] || letter;
      labels.push(letter + item[2]);
    }
    parts.push({ labels });
    at = m.index + m[0].length;
  }
  if (at < answer.length) parts.push({ text: answer.slice(at) });
  return parts;
}

export async function askCourt(body: AskRequest, handlers: AskHandlers, signal?: AbortSignal): Promise<void> {
  if (!DUEL_API) throw new AskError("ask_unavailable");
  let response: Response;
  try {
    response = await fetch(DUEL_API + "/v1/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AskError("network");
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new AskError(failure?.error ?? "internal");
  }
  if (!response.body) throw new AskError("internal");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const parsed = parseSse(buffer);
    buffer = parsed.rest;
    for (const { event, data } of parsed.events) {
      if (event === "meta") handlers.onMeta(data as AskMeta);
      else if (event === "token") handlers.onText((data as { text: string }).text);
      else if (event === "error") throw new AskError((data as { code?: string }).code ?? "internal");
      else if (event === "done") {
        finished = true;
        handlers.onDone(data as AskDone);
      }
    }
    if (done) break;
  }
  if (!finished) throw new AskError("internal");
}
