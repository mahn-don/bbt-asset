import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDatabase, seedProvider } from "./helpers";

/**
 * Authentication and CSRF posture of the route handlers.
 *
 * `next/headers` is mocked so handlers can be invoked directly, which keeps
 * the assertions about the guard itself rather than about Next's plumbing.
 */

const cookieStore = { value: undefined as string | undefined };
const headerStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "bbi_session" && cookieStore.value ? { name, value: cookieStore.value } : undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => ({
    get: (name: string) => headerStore.get(name.toLowerCase()) ?? null,
  }),
}));

const { prisma } = await import("@/lib/db");
const { GET: getIntegrations } = await import("@/app/api/integrations/route");
const { POST: postSync } = await import("@/app/api/integrations/[provider]/sync/route");
const { POST: postTest } = await import("@/app/api/integrations/[provider]/test/route");
const { PUT: putCredentials } = await import("@/app/api/integrations/[provider]/route");
const { POST: postEvaluate } = await import("@/app/api/assets/[id]/ai-evaluations/route");
const { GET: getAssets } = await import("@/app/api/assets/route");
const { createHmac } = await import("node:crypto");

function params(values: Record<string, string>) {
  return { params: Promise.resolve(values) };
}

async function signIn(): Promise<void> {
  const user = await prisma.user.create({
    data: { email: "researcher@example.com", passwordHash: "scrypt$x$y", role: "ADMIN" },
  });

  const token = "test-session-token";
  const tokenHash = createHmac("sha256", process.env.SESSION_SECRET as string)
    .update(token)
    .digest("hex");

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  cookieStore.value = token;
}

beforeEach(async () => {
  await resetDatabase();
  cookieStore.value = undefined;
  headerStore.clear();
  headerStore.set("host", "localhost:3000");
});

describe("unauthenticated access is rejected", () => {
  it("rejects GET /api/integrations", async () => {
    const response = await getIntegrations(
      new Request("http://localhost:3000/api/integrations"),
      params({}),
    );

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects GET /api/assets", async () => {
    const response = await getAssets(new Request("http://localhost:3000/api/assets"), params({}));
    expect(response.status).toBe(401);
  });

  it("rejects Sync Now", async () => {
    await seedProvider("HACKERONE");

    const response = await postSync(
      new Request("http://localhost:3000/api/integrations/hackerone/sync", { method: "POST" }),
      params({ provider: "hackerone" }),
    );

    expect(response.status).toBe(401);
    // Nothing was synced.
    expect(await prisma.syncRun.count()).toBe(0);
  });

  it("rejects Test Connection", async () => {
    await seedProvider("HACKERONE");

    const response = await postTest(
      new Request("http://localhost:3000/api/integrations/hackerone/test", { method: "POST" }),
      params({ provider: "hackerone" }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects credential writes", async () => {
    await seedProvider("HACKERONE");

    const response = await putCredentials(
      new Request("http://localhost:3000/api/integrations/hackerone", {
        method: "PUT",
        body: JSON.stringify({ credentials: { apiUsername: "x", apiToken: "y".repeat(40) } }),
      }),
      params({ provider: "hackerone" }),
    );

    expect(response.status).toBe(401);
    const row = await prisma.providerIntegration.findFirst();
    expect(row?.encryptedCredentials ?? null).toBeNull();
  });

  it("rejects AI re-evaluation", async () => {
    const response = await postEvaluate(
      new Request("http://localhost:3000/api/assets/abc/ai-evaluations", { method: "POST" }),
      params({ id: "abc" }),
    );

    expect(response.status).toBe(401);
    expect(await prisma.scopeAiEvaluation.count()).toBe(0);
  });
});

describe("authenticated access is permitted", () => {
  it("allows GET /api/integrations once signed in", async () => {
    await signIn();
    await seedProvider("HACKERONE");

    const response = await getIntegrations(
      new Request("http://localhost:3000/api/integrations"),
      params({}),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { integrations: unknown[] };
    expect(Array.isArray(body.integrations)).toBe(true);
  });

  it("never returns credential material in the integrations payload", async () => {
    await signIn();
    await seedProvider("HACKERONE");

    const secret = "top-secret-api-token-value-1234567890";
    const { saveCredentials } = await import("@/lib/credentials/store");
    await saveCredentials("HACKERONE", { apiUsername: "researcher", apiToken: secret });

    const response = await getIntegrations(
      new Request("http://localhost:3000/api/integrations"),
      params({}),
    );

    const text = await response.text();

    expect(text).not.toContain(secret);
    expect(text).not.toContain("encryptedCredentials");
    expect(text).toContain("****");
  });

  it("rejects an expired session", async () => {
    await signIn();
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await getIntegrations(
      new Request("http://localhost:3000/api/integrations"),
      params({}),
    );

    expect(response.status).toBe(401);
  });

  it("rejects a disabled user", async () => {
    await signIn();
    await prisma.user.updateMany({ data: { disabled: true } });

    const response = await getIntegrations(
      new Request("http://localhost:3000/api/integrations"),
      params({}),
    );

    expect(response.status).toBe(401);
  });
});

describe("cross-origin state changes are rejected", () => {
  it("rejects a POST whose Origin does not match Host", async () => {
    await signIn();
    await seedProvider("HACKERONE");

    headerStore.set("origin", "https://evil.example.com");

    const response = await postSync(
      new Request("http://localhost:3000/api/integrations/hackerone/sync", { method: "POST" }),
      params({ provider: "hackerone" }),
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CROSS_ORIGIN");
    expect(await prisma.syncRun.count()).toBe(0);
  });

  it("permits a same-origin POST", async () => {
    await signIn();
    await seedProvider("HACKERONE");

    headerStore.set("origin", "http://localhost:3000");

    const response = await postTest(
      new Request("http://localhost:3000/api/integrations/hackerone/test", { method: "POST" }),
      params({ provider: "hackerone" }),
    );

    // No credentials stored, so the honest answer is NOT_CONFIGURED - not a 403.
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { status: string } };
    expect(body.result.status).toBe("NOT_CONFIGURED");
  });

  it("does not require an Origin header for GET", async () => {
    await signIn();
    await seedProvider("HACKERONE");
    headerStore.set("origin", "https://evil.example.com");

    const response = await getIntegrations(
      new Request("http://localhost:3000/api/integrations"),
      params({}),
    );

    expect(response.status).toBe(200);
  });
});

describe("input validation", () => {
  it("rejects an unknown provider slug", async () => {
    await signIn();

    const response = await postTest(
      new Request("http://localhost:3000/api/integrations/notaprovider/test", { method: "POST" }),
      params({ provider: "notaprovider" }),
    );

    expect(response.status).toBe(404);
  });

  it("rejects credentials that fail adapter validation", async () => {
    await signIn();
    await seedProvider("HACKERONE");

    const response = await putCredentials(
      new Request("http://localhost:3000/api/integrations/hackerone", {
        method: "PUT",
        body: JSON.stringify({ credentials: { apiUsername: "", apiToken: "short" } }),
      }),
      params({ provider: "hackerone" }),
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: { code: string; fieldErrors: Record<string, string> };
    };
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
    expect(body.error.fieldErrors.apiToken).toBeDefined();
  });

  it("rejects a malformed query", async () => {
    await signIn();

    const response = await getAssets(
      new Request("http://localhost:3000/api/assets?minScore=notanumber"),
      params({}),
    );

    expect(response.status).toBe(422);
  });
});
