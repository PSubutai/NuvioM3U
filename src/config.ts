export interface AppConfig {
  port: number;
  dbPath: string;
  publicUrl: string | null;
  trustProxy: boolean;
  adminPassword: string | null;
  healthcheckIntervalMinutes: number;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const publicUrl = env.PUBLIC_URL?.trim();
  const adminPassword = env.ADMIN_PASSWORD?.trim();

  return {
    port: parseInteger(env.PORT, 7000),
    dbPath: env.DB_PATH?.trim() || "/config/nuviom3u.db",
    publicUrl: publicUrl ? publicUrl.replace(/\/+$/, "") : null,
    trustProxy: parseBool(env.TRUST_PROXY, true),
    adminPassword: adminPassword ? adminPassword : null,
    healthcheckIntervalMinutes: parseInteger(env.HEALTHCHECK_INTERVAL_MINUTES, 0),
  };
}

/**
 * Headers a proxy may send as a comma-separated chain; the first entry is the
 * original client-facing value.
 */
function firstHeaderValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(",")[0]?.trim();
  return first ? first : undefined;
}

export interface BaseUrlSource {
  protocol: string;
  headers: Record<string, string | string[] | undefined>;
}

function header(source: BaseUrlSource, name: string): string | undefined {
  const value = source.headers[name] ?? source.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Absolute origin for generated links (manifest URLs, install buttons, QR codes).
 *
 * PUBLIC_URL always wins. Otherwise we read X-Forwarded-* directly rather than
 * relying on framework helpers, so behaviour behind Pangolin/Traefik does not
 * depend on Express version semantics. Getting this wrong is the classic
 * "addon installs but shows nothing" bug.
 */
export function resolveBaseUrl(source: BaseUrlSource, config: AppConfig): string {
  if (config.publicUrl) return config.publicUrl;

  const forwardedProto = config.trustProxy
    ? firstHeaderValue(header(source, "x-forwarded-proto"))
    : undefined;
  const forwardedHost = config.trustProxy
    ? firstHeaderValue(header(source, "x-forwarded-host"))
    : undefined;

  const protocol = forwardedProto ?? source.protocol ?? "http";
  const host = forwardedHost ?? firstHeaderValue(header(source, "host")) ?? "localhost";

  return `${protocol}://${host}`;
}
