const RETRY_DELAYS_MS = [10_000, 30_000] as const;

/** Return a bounded delay only for transient Discord REST/network failures. */
export function commandSyncRetryDelay(errorCode: string, status: number | null, attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0) return null;
  const code = errorCode.trim().toLowerCase();
  const transientNetwork = /^(und_err_|econnreset$|econnrefused$|eai_again$|etimedout$|fetch_failed$|network_error$)/i.test(code);
  const transientHttp = status === 429 || (status !== null && status >= 500 && status < 600);
  if (!transientNetwork && !transientHttp) return null;
  return RETRY_DELAYS_MS[attempt] ?? null;
}
