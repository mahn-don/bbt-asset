/**
 * Structured logging.
 *
 * Every log line is a single JSON object so it can be ingested by any log
 * pipeline. A redaction pass runs over every field: credential material,
 * Authorization headers and API keys must never reach the log stream, so
 * sensitive-looking keys are dropped even if a caller passes them by accident.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function activeLevel(): number {
  const configured = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return LEVEL_ORDER[configured as LogLevel] ?? LEVEL_ORDER.info;
}

/**
 * Field names that must never be logged. Matching is substring-based and
 * case-insensitive so `apiToken`, `x-api-key` and `encryptedCredentials` are
 * all caught.
 */
const REDACTED_KEY_PATTERNS = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "auth",
  "credential",
  "cookie",
  "session",
  "clientsecret",
  "client_secret",
  "privatekey",
  "private_key",
];

function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[-_\s]/g, "");
  return REDACTED_KEY_PATTERNS.some((pattern) =>
    normalised.includes(pattern.replace(/[-_]/g, "")),
  );
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redact(entry, depth + 1));
  }

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveKey(key) ? "[redacted]" : redact(entry, depth + 1);
    }
    return output;
  }

  return value;
}

function emit(level: LogLevel, message: string, fields: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < activeLevel()) return;

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(redact(fields) as Record<string, unknown>),
  });

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  return {
    debug: (message, fields) => emit("debug", message, { ...bindings, ...fields }),
    info: (message, fields) => emit("info", message, { ...bindings, ...fields }),
    warn: (message, fields) => emit("warn", message, { ...bindings, ...fields }),
    error: (message, fields) => emit("error", message, { ...bindings, ...fields }),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger();

/**
 * Converts an unknown thrown value into a message safe to persist and show.
 * Provider errors can embed request context, so this never returns a stack.
 */
export function sanitizeErrorMessage(error: unknown, max = 500): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unexpected error";

  // Strip anything that looks like an inline credential or bearer token.
  const scrubbed = raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/Basic\s+[A-Za-z0-9+/]+=*/gi, "Basic [redacted]")
    .replace(/(api[_-]?key|token|password|secret)["'\s:=]+[^\s"',}]+/gi, "$1=[redacted]");

  return scrubbed.length > max ? `${scrubbed.slice(0, max)}...` : scrubbed;
}
