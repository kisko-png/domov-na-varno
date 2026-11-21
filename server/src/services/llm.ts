import { LlmError } from "../errors.js";

/** One message of a conversation with a language model. */
export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** A candidate answer of a classification: its id and the phrases that name it. */
export interface LlmCandidate {
  id: string;
  phrases: string[];
}

/** Options of one completion. */
export interface LlmOptions {
  /** What the completion is for. */
  task: "red-flag-classifier" | "topic-matcher";
  /** The ids the answer may be, with their phrases; the answer is one id or `none`. */
  candidates: LlmCandidate[];
  maxTokens?: number;
}

/** The only way to a language model. */
export interface LlmClient {
  /** Completes the conversation and returns the model's text. */
  complete(messages: LlmMessage[], options: LlmOptions): Promise<string>;
}

/** The answer of a classification with no candidate. */
export const NO_MATCH = "none";

/** The deterministic client of tests: the first candidate one of whose phrases the last user message contains. */
export function fakeLlmClient(): LlmClient {
  return {
    complete(messages, options) {
      const text = (
        messages.filter((m) => m.role === "user").at(-1)?.content ?? ""
      ).toLowerCase();
      const hit = options.candidates.find((c) =>
        c.phrases.some((p) => p !== "" && text.includes(p.toLowerCase())),
      );
      return Promise.resolve(hit ? hit.id : NO_MATCH);
    },
  };
}

/** The prompt that asks a model to classify a message among candidates. */
export function classificationPrompt(options: LlmOptions): string {
  const what =
    options.task === "red-flag-classifier"
      ? "Ali sporočilo pacienta opisuje katerega od teh opozorilnih znakov?"
      : "O kateri od teh tem sprašuje sporočilo pacienta?";
  const list = options.candidates
    .map((c) => `- ${c.id}: ${c.phrases.join(", ")}`)
    .join("\n");
  return `${what}\n${list}\nOdgovori samo z enim id-jem ali z "${NO_MATCH}".`;
}

/** Picks the candidate id an answer names, or undefined. */
export function parseChoice(
  answer: string,
  candidates: LlmCandidate[],
): string | undefined {
  const a = answer.trim().toLowerCase();
  return candidates.find((c) => c.id.toLowerCase() === a)?.id;
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** The default model when `LLM_MODEL` is not set. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";

/** A client of the Anthropic Messages API. */
export function anthropicLlmClient(
  apiKey: string,
  model: string = DEFAULT_ANTHROPIC_MODEL,
  fetchFn: typeof fetch = fetch,
): LlmClient {
  return {
    async complete(messages, options) {
      const system = [
        ...messages.filter((m) => m.role === "system").map((m) => m.content),
        classificationPrompt(options),
      ].join("\n\n");
      const payload = {
        model,
        max_tokens: options.maxTokens ?? 50,
        system,
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
      };
      let res: Response;
      try {
        res = await fetchFn(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        throw new LlmError(`POST ${ANTHROPIC_URL} failed to connect`, {
          cause: err,
        });
      }
      const body = await res.text();
      if (!res.ok)
        throw new LlmError(
          `POST ${ANTHROPIC_URL} returned ${res.status}: ${body}`,
        );
      let data: unknown;
      try {
        data = JSON.parse(body);
      } catch (err) {
        throw new LlmError(
          `POST ${ANTHROPIC_URL} returned invalid JSON: ${body}`,
          { cause: err },
        );
      }
      const content =
        typeof data === "object" && data !== null && "content" in data
          ? data.content
          : undefined;
      if (!Array.isArray(content))
        throw new LlmError(
          `POST ${ANTHROPIC_URL} returned no content: ${body}`,
        );
      return content
        .map((b: unknown) =>
          typeof b === "object" &&
          b !== null &&
          "text" in b &&
          typeof b.text === "string"
            ? b.text
            : "",
        )
        .join("");
    },
  };
}
