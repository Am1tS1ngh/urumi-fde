import type { AppConfig } from '../config.js';

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface LlmTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export class LlmError extends Error {}

/** Some providers reject `$schema` at the top of a tool's parameters. */
export function toParameters(schema: unknown): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = (schema ?? {}) as Record<string, unknown>;
  return { type: 'object', properties: {}, ...rest };
}

const RATE_LIMIT_RETRIES = 2;
const MAX_RATE_LIMIT_WAIT_MS = 30_000;

/** The wait a 429 response asks for, or null if it gives none or asks for too long. */
function retryDelayMs(response: Response): number | null {
  const seconds = Number(response.headers.get('retry-after'));
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const ms = Math.ceil(seconds * 1000);
  return ms <= MAX_RATE_LIMIT_WAIT_MS ? ms : null;
}

/** One call to any OpenAI-compatible chat completions API (Groq, Gemini, OpenAI, Ollama). */
export async function complete(llm: NonNullable<AppConfig['llm']>, messages: LlmMessage[], tools: LlmTool[]) {
  const body = JSON.stringify({ model: llm.model, messages, temperature: 0.2, ...(tools.length ? { tools, tool_choice: 'auto' } : {}) });
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch(`${llm.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
        body,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      throw new LlmError(error instanceof Error && error.name === 'TimeoutError' ? 'The model provider timed out.' : 'The model provider is unreachable.');
    }
    // Free tiers often limit tokens per minute, and a tool loop makes several calls in a row.
    const delay = response.status === 429 && attempt < RATE_LIMIT_RETRIES ? retryDelayMs(response) : null;
    if (delay === null) break;
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new LlmError(`The model provider returned ${response.status}: ${text.slice(0, 300)}`);
  }
  const data = await response.json() as { choices?: { message?: { content?: string | null; tool_calls?: LlmToolCall[] } }[] };
  const message = data.choices?.[0]?.message;
  if (!message) throw new LlmError('The model provider returned no answer.');
  return { content: message.content ?? null, toolCalls: message.tool_calls ?? [] };
}
