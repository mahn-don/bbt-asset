import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyPassword, hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { ApiError, jsonError, jsonOk, parseJsonBody, withApi } from "@/lib/api/http";
import { loginSchema } from "@/lib/api/schemas";
import { logger } from "@/lib/logger";
import { syncPreferenceCookies } from "@/lib/preferences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login
 *
 * Failures return an identical message and take a comparable amount of work
 * whether the account exists or not, so the endpoint does not disclose which
 * emails are registered.
 */
export const POST = withApi(async (request: Request): Promise<NextResponse> => {
  const body = await parseJsonBody(request, loginSchema);

  const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });

  if (!user) {
    // Burn a comparable amount of CPU so timing does not reveal existence.
    await hashPassword(body.password);
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }

  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid || user.disabled) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }

  await createSession(user.id, request.headers.get("user-agent") ?? undefined);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  // The account's stored theme/language take effect on the next render.
  await syncPreferenceCookies(user.id);

  logger.info("user logged in", { userId: user.id });

  return jsonOk({ user: { id: user.id, email: user.email, role: user.role } });
});

export async function GET(): Promise<NextResponse> {
  return jsonError(405, "METHOD_NOT_ALLOWED", "Use POST to sign in.");
}
