import { SdkError, SdkErrorCode, SdkHttpError, UnauthorizedError } from '@modelcontextprotocol/client';

const NETWORK_CODES = /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|UND_ERR_\w+)$/;

function causeCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && NETWORK_CODES.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Turns transport errors into one short sentence that is safe to show users. */
export function describeUpstreamError(name: string, error: unknown, timeoutMs: number): string {
  if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) {
    return `${name} did not respond within ${Math.round(timeoutMs / 1000)}s.`;
  }
  if (error instanceof UnauthorizedError || (error instanceof SdkHttpError && (error.status === 401 || error.status === 403))) {
    return `${name} rejected the gateway's credentials.`;
  }
  const code = causeCode(error);
  if (code) return `${name} is unreachable (${code}).`;
  if (error instanceof SdkHttpError) return `${name} returned HTTP ${error.status}.`;
  if (error instanceof Error && /fetch failed|redirect/i.test(error.message)) return `${name} is unreachable.`;
  return `${name} failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}`;
}
