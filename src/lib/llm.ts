import "server-only";
import OpenAI from "openai";
import type { AiFeature } from "./types";
import { assertAiAllowed, recordUsage } from "./usage";

export const MODEL = process.env.OPENAI_MODEL || "gpt-5.5";

export function aiEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

let client: OpenAI | undefined;
function getClient() {
  if (!aiEnabled()) throw new Error("OPENAI_API_KEY is not set. Add it to .env.local and restart the app.");
  return (client ??= new OpenAI());
}

export interface StructuredResult<T> {
  data: T;
  sources: { title: string; url: string }[];
  usedWebSearch: boolean;
  model: string;
}

/**
 * Ask the model for JSON matching `schema` (OpenAI Structured Outputs).
 * With `webSearch`, the model can search the live web for news first; if the tool
 * isn't available for this key/model we transparently retry without it.
 */
export async function structured<T>(opts: {
  name: string;
  instructions: string;
  input: string;
  schema: Record<string, unknown>;
  webSearch?: boolean;
  /** which feature is spending — for the cost breakdown */
  feature: AiFeature;
}): Promise<StructuredResult<T>> {
  assertAiAllowed(); // global pause / daily budget gate — applies to every AI feature
  const c = getClient();
  const call = (withSearch: boolean) =>
    c.responses.create({
      model: MODEL,
      instructions: opts.instructions,
      input: opts.input,
      ...(withSearch ? { tools: [{ type: "web_search" as const }] } : {}),
      text: { format: { type: "json_schema", name: opts.name, schema: opts.schema, strict: true } },
    });

  let used = Boolean(opts.webSearch);
  let res;
  try {
    res = await call(used);
  } catch (e) {
    if (!used) throw e;
    console.warn("[llm] web search failed, retrying without it:", (e as Error).message);
    used = false;
    res = await call(false);
  }

  recordUsage(opts.feature, {
    inputTokens: res.usage?.input_tokens ?? 0,
    outputTokens: res.usage?.output_tokens ?? 0,
    webSearches: (res.output ?? []).filter((i) => i.type === "web_search_call").length,
  });

  const sources: { title: string; url: string }[] = [];
  for (const item of res.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type !== "output_text") continue;
      for (const a of part.annotations ?? []) {
        if (a.type === "url_citation" && !sources.some((s) => s.url === a.url)) sources.push({ title: a.title, url: a.url });
      }
    }
  }

  const text = res.output_text?.trim();
  if (!text) throw new Error("Empty response from the model");
  const data = stripCitations(JSON.parse(text), sources) as T;
  return { data, sources, usedWebSearch: used, model: MODEL };
}

/** Web search leaves inline markdown citations like "([site](url))" in strings; move them to `sources`. */
function stripCitations(v: unknown, sources: { title: string; url: string }[]): unknown {
  if (typeof v === "string") {
    const clean = (url: string) => url.replace(/[?&]utm_source=openai$/, "");
    const add = (title: string, url: string) => {
      const u = clean(url);
      if (!sources.some((s) => clean(s.url) === u)) sources.push({ title, url: u });
    };
    return v
      .replace(/\s*\(\[([^\]]*)\]\((https?:[^)\s]+)\)\)/g, (_, t, u) => (add(t, u), ""))
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, t, u) => (add(t, u), t))
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  if (Array.isArray(v)) return v.map((x) => stripCitations(x, sources));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stripCitations(x, sources)]));
  return v;
}

// ---- tiny JSON-schema builders (Structured Outputs strict mode: every field required, no extras) ----
type S = Record<string, unknown>;
export const str = (description?: string): S => ({ type: "string", ...(description && { description }) });
export const num = (description?: string): S => ({ type: "number", ...(description && { description }) });
export const nullableNum = (description?: string): S => ({ type: ["number", "null"], ...(description && { description }) });
export const nullableStr = (description?: string): S => ({ type: ["string", "null"], ...(description && { description }) });
export const enumOf = (values: string[], description?: string): S => ({ type: "string", enum: values, ...(description && { description }) });
export const arr = (items: S, description?: string): S => ({ type: "array", items, ...(description && { description }) });
export const obj = (properties: Record<string, S>, description?: string): S => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
  ...(description && { description }),
});
