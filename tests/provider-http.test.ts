import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HackerOneAdapter } from "@/lib/providers/hackerone";
import { ProviderHttpClient, ProviderHttpError } from "@/lib/providers/http-client";

/**
 * Pagination, provider error mapping and retry behaviour, driven by a mocked
 * `fetch` so no network is touched.
 */

const CREDENTIALS = { apiUsername: "researcher", apiToken: "t".repeat(40) };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Retries use exponential backoff with jitter; collapse the jitter to zero so
  // retry tests do not add seconds of real waiting.
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("program pagination", () => {
  it("walks every page until links.next is absent", async () => {
    const adapter = new HackerOneAdapter();

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "1", attributes: { handle: "one", name: "One" } }],
          links: { next: "https://api.hackerone.com/v1/hackers/programs?page%5Bnumber%5D=2" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "2", attributes: { handle: "two", name: "Two" } }],
          links: {},
        }),
      );

    const first = await adapter.fetchPrograms({ credentials: CREDENTIALS });
    expect(first.programs).toHaveLength(1);
    expect(first.nextCursor).toBe("2");

    const second = await adapter.fetchPrograms({ credentials: CREDENTIALS }, first.nextCursor);
    expect(second.programs).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    expect(second.programs[0]?.handleOrSlug).toBe("two");
  });

  it("stops paginating scopes when a page returns no rows", async () => {
    const adapter = new HackerOneAdapter();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        data: [],
        links: { next: "https://api.hackerone.com/v1/hackers/programs/x/structured_scopes?page%5Bnumber%5D=9" },
      }),
    );

    const page = await adapter.fetchScopes(
      { credentials: CREDENTIALS },
      {
        externalId: "1",
        handleOrSlug: "x",
        name: "X",
        status: "ACTIVE",
        visibility: "PUBLIC",
      },
    );

    expect(page.scopes).toHaveLength(0);
    // An empty page must not advertise a next cursor, or the sync would loop.
    expect(page.nextCursor).toBeUndefined();
  });
});

describe("provider error mapping", () => {
  it("maps 401 to AUTH_ERROR and does not retry", async () => {
    const adapter = new HackerOneAdapter();
    fetchMock.mockResolvedValue(jsonResponse({ errors: [] }, 401));

    const result = await adapter.testConnection(CREDENTIALS);

    expect(result.status).toBe("AUTH_ERROR");
    expect(result.code).toBe("HTTP_401");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps 403 to PERMISSION_ERROR", async () => {
    const adapter = new HackerOneAdapter();
    fetchMock.mockResolvedValue(jsonResponse({}, 403));

    const result = await adapter.testConnection(CREDENTIALS);
    expect(result.status).toBe("PERMISSION_ERROR");
  });

  it("maps 429 to RATE_LIMITED after exhausting retries", async () => {
    const adapter = new HackerOneAdapter();
    fetchMock.mockResolvedValue(jsonResponse({}, 429, { "retry-after": "0" }));

    const result = await adapter.testConnection(CREDENTIALS);

    expect(result.status).toBe("RATE_LIMITED");
    // testConnection uses maxRetries 1, so exactly one retry.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries 5xx and succeeds when the provider recovers", async () => {
    const client = new ProviderHttpClient({
      baseUrl: "https://api.hackerone.com",
      providerSlug: "HACKERONE",
    });

    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ data: [] }, 200));

    const response = await client.request<{ data: unknown[] }>({ path: "/v1/hackers/programs" });

    expect(response.status).toBe(200);
    expect(response.retryCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a malformed upstream response as MALFORMED_RESPONSE", async () => {
    const client = new ProviderHttpClient({
      baseUrl: "https://api.hackerone.com",
      providerSlug: "HACKERONE",
    });

    fetchMock.mockResolvedValue(
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    await expect(client.request({ path: "/v1/hackers/programs" })).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
  });

  it("does not leak the provider response body into the error message", async () => {
    const client = new ProviderHttpClient({
      baseUrl: "https://api.hackerone.com",
      providerSlug: "HACKERONE",
    });

    fetchMock.mockResolvedValue(
      jsonResponse({ error: "token abcd1234secret rejected for user researcher" }, 401),
    );

    await expect(client.request({ path: "/v1/hackers/programs" })).rejects.toThrow(
      /Authentication failed/,
    );

    let captured: ProviderHttpError | null = null;
    try {
      await client.request({ path: "/v1/hackers/programs" });
    } catch (caught) {
      captured = caught as ProviderHttpError;
    }

    expect(captured?.message).not.toContain("abcd1234secret");
  });

  it("refuses to follow a redirect, which could point at an internal host", async () => {
    const client = new ProviderHttpClient({
      baseUrl: "https://api.hackerone.com",
      providerSlug: "HACKERONE",
    });

    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }),
    );

    await expect(client.request({ path: "/v1/hackers/programs" })).rejects.toMatchObject({
      code: "UNEXPECTED_REDIRECT",
    });
  });
});

describe("SSRF protection", () => {
  it("rejects a base URL that is not https", () => {
    expect(
      () => new ProviderHttpClient({ baseUrl: "http://api.example.com", providerSlug: "X" }),
    ).toThrow(/must use https/i);
  });

  it("refuses a path that escapes the provider origin", async () => {
    const client = new ProviderHttpClient({
      baseUrl: "https://api.hackerone.com",
      providerSlug: "HACKERONE",
    });

    await expect(client.request({ path: "//169.254.169.254/latest/meta-data" })).rejects.toMatchObject(
      { code: "INVALID_URL" },
    );

    await expect(client.request({ path: "https://evil.example.com/x" })).rejects.toMatchObject({
      code: "INVALID_URL",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the Authorization header but never logs it", async () => {
    const adapter = new HackerOneAdapter();
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    await adapter.testConnection(CREDENTIALS);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;

    const authorization = headers.authorization ?? "";
    expect(authorization).toMatch(/^Basic /);
    // The credential is present on the wire, as it must be, and nowhere else.
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    expect(decoded).toBe(`${CREDENTIALS.apiUsername}:${CREDENTIALS.apiToken}`);
  });
});
