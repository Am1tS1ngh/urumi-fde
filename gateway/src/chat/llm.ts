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

/** One call to any OpenAI-compatible chat completions API (Groq, Gemini, OpenAI, Ollama). */
export async function complete(llm: NonNullable<AppConfig['llm']>, messages: LlmMessage[], tools: LlmTool[]) {
  let response: Response;
  try {
    response = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llm.apiKey}` },
      body: JSON.stringify({ model: llm.model, messages, temperature: 0.2, ...(tools.length ? { tools, tool_choice: 'auto' } : {}) }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw new LlmError(error instanceof Error && error.name === 'TimeoutError' ? 'The model provider timed out.' : 'The model provider is unreachable.');
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
