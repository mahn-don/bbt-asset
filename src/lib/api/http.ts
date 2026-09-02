import "server-only";
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { ZodError, type ZodType } from "zod";
import { getCurrentUser, type AuthenticatedUser } from "@/lib/auth/session";
import { logger, sanitizeErrorMessage } from "@/lib/logger";

/**
 * Shared helpers for route handlers: authentication, CSRF-safe method
 * handling, input validation and uniform error shapes.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, init);
}

export function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Requires an authenticated user.
 *
 * For state-changing verbs it also enforces a same-origin check. The session
 * cookie is SameSite=Lax, which already blocks cross-site form posts; the
 * Origin check closes the remaining gap for same-site subdomain attackers and
 * makes the intent explicit.
 */
export async function requireApiUser(request: Request): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
  }

  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    await assertSameOrigin();
  }

  return user;
}

export async function requireAdmin(request: Request): Promise<AuthenticatedUser> {
  const user = await requireApiUser(request);
  if (user.role !== "ADMIN") {
    throw new ApiError(403, "FORBIDDEN", "Administrator role required.");
  }
  return user;
}

async function assertSameOrigin(): Promise<void> {
  const headerList = await headers();
  const origin = headerList.get("origin");
  if (!origin) return; // non-browser client (curl, worker); cookie auth still required

  const host = headerList.get("host");
  if (!host) {
    throw new ApiError(400, "BAD_REQUEST", "Missing Host header.");
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "CROSS_ORIGIN", "Invalid Origin header.");
  }

  if (originHost !== host) {
    throw new ApiError(403, "CROSS_ORIGIN", "Cross-origin request rejected.");
  }
}

export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(422, "VALIDATION_FAILED", formatZodError(result.error));
  }
  return result.data;
}

export function parseQuery<T>(request: Request, schema: ZodType<T>): T {
  const url = new URL(request.url);
  const params: Record<string, string | string[]> = {};

  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    params[key] = values.length > 1 ? values : (values[0] as string);
  }

  const result = schema.safeParse(params);
  if (!result.success) {
    throw new ApiError(422, "VALIDATION_FAILED", formatZodError(result.error));
  }
  return result.data;
}

function formatZodError(error: ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}

/**
 * Wraps a route handler so every thrown error becomes a sanitised JSON
 * response and unexpected failures never leak internals to the client.
 */
export function withApi(
  handler: (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<NextResponse>,
) {
  return async (
    request: Request,
    context: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonError(error.status, error.code, error.message);
      }

      logger.error("Unhandled API error", {
        path: new URL(request.url).pathname,
        method: request.method,
        error: sanitizeErrorMessage(error),
      });

      return jsonError(500, "INTERNAL_ERROR", "An unexpected error occurred.");
    }
  };
}
