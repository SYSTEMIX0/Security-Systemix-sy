// Normalizes common MySQL TLS hints into the option mysql2 understands.
// mysql2 reads URL query values as JSON, so `ssl={"rejectUnauthorized":true}`
// enables TLS with certificate verification against the system CA store.
const TLS_HINT_KEYS = ["sslaccept", "ssl-mode", "sslmode"] as const;
const TLS_HINT_VALUES = new Set(["strict", "required", "require", "verify_ca", "verify_identity", "verify-full", "verify-ca"]);

export function normalizeDatabaseUrl(raw: string, caCertificate?: string): string {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }
  if (url.protocol !== "mysql:" || url.searchParams.has("ssl")) return value;

  let wantsTls = url.hostname.endsWith(".tidbcloud.com");
  for (const key of TLS_HINT_KEYS) {
    const hint = url.searchParams.get(key);
    if (hint === null) continue;
    if (TLS_HINT_VALUES.has(hint.toLowerCase())) wantsTls = true;
    url.searchParams.delete(key);
  }
  if (!wantsTls) return url.toString();
  const ca = caCertificate?.replace(/\\n/g, "\n").trim();
  const sslOptions: { rejectUnauthorized: boolean; ca?: string } = { rejectUnauthorized: true };
  if (ca) sslOptions.ca = ca;
  url.searchParams.set("ssl", JSON.stringify(sslOptions));
  return url.toString();
}
