import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import type { UserRole } from "@/lib/enums";

/**
 * Session management.
 *
 * The cookie carries an opaque random token. Only the HMAC of that token is
 * stored, so a database read alone does not yield a usable session credential.
 * The cookie is HttpOnly + SameSite=Lax + Secure (in production), which also
 * gives baseline CSRF protection for the state-changing API routes; those
 * routes additionally require a same-origin check (see requireApiUser).
 */

export const SESSION_COOKIE = "bbi_session";

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

function hashToken(token: string): string {
  return createHmac("sha256", serverEnv.sessionSecret).update(token).digest("hex");
}

export async function createSession(userId: string, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + serverEnv.sessionTtlHours * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: userAgent?.slice(0, 300),
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: serverEnv.isProduction,
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function destroyCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  cookieStore.delete(SESSION_COOKIE);
}

/** Resolves the current user, or null when unauthenticated/expired. */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  if (session.user.disabled) return null;

  // Cheap liveness tracking; avoids a write on every single request.
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  return {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role as UserRole,
  };
}

/** Deletes expired sessions. Called opportunistically by the worker. */
export async function pruneExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count;
}
