/**
 * beszelClient.test.ts — Integration tests for src/client/beszelClient.ts
 *
 * Uses MSW (Mock Service Worker) node server to intercept fetch calls so
 * tests NEVER hit a real Beszel instance.
 *
 * Covers all REQ-1 scenarios:
 * - Successful auth + token returned and cached
 * - Cached-token reuse (no second auth call)
 * - Expired / --no-cache → fresh auth
 * - Auth failure (bad creds) → CliError AUTH_FAILED exit 2
 * - Network failure → CliError NETWORK_ERROR exit 4
 * - 401 mid-session → clears cache + re-auths once + retries
 * - 404 resource → CliError NOT_FOUND exit 3
 * - Custom auth collection used in URL
 * - checkVersion warns on stderr for out-of-range versions
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { BeszelClient, checkVersion, SUPPORTED_BESZEL } from "../../src/client/beszelClient.js";
import { CliError } from "../../src/types/errors.js";
import type { BeszelConfig } from "../../src/client/config.js";
import { getCachePath, writeCache } from "../../src/client/tokenCache.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "http://beszel.test";
const AUTH_PATH = "/api/collections/_superusers/auth-with-password";
const RECORDS_PATH = "/api/collections/systems/records";

const VALID_CONFIG: BeszelConfig = {
  url: BASE_URL,
  email: "admin@example.com",
  password: "s3cr3t",
  authCollection: "_superusers",
};

// ---------------------------------------------------------------------------
// Helper: build a minimal JWT with a given exp
// ---------------------------------------------------------------------------

function buildJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "user", exp })).toString("base64url");
  return `${header}.${payload}.fakesig`;
}

const FUTURE_EXP = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // 7 days
const VALID_TOKEN = buildJwt(FUTURE_EXP);

// ---------------------------------------------------------------------------
// MSW server setup
// ---------------------------------------------------------------------------

// Default handlers — can be overridden per-test via server.use()
const defaultHandlers = [
  http.post(`${BASE_URL}${AUTH_PATH}`, () => {
    return HttpResponse.json({ token: VALID_TOKEN, record: { id: "usr1", email: "admin@example.com" } });
  }),
  http.get(`${BASE_URL}${RECORDS_PATH}`, () => {
    return HttpResponse.json({ page: 1, perPage: 20, totalItems: 1, totalPages: 1, items: [{ id: "sys1" }] });
  }),
];

const server = setupServer(...defaultHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Temp home dir so tests never touch the real ~/.cache
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beszel-client-test-"));
  vi.spyOn(os, "homedir").mockReturnValue(tmpDir);
  server.resetHandlers();
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BeszelClient.authenticate()", () => {
  it("calls auth endpoint and returns a token on success (cold cache)", async () => {
    const client = new BeszelClient(VALID_CONFIG, false);
    const token = await client.authenticate();
    expect(token).toBe(VALID_TOKEN);
  });

  it("writes the token to the cache file after a successful auth", async () => {
    const client = new BeszelClient(VALID_CONFIG, false);
    await client.authenticate();
    expect(fs.existsSync(getCachePath())).toBe(true);
  });

  it("reuses a cached valid token without making an auth network call", async () => {
    // Pre-populate cache. Note: CachedToken uses `collection` not `authCollection`.
    writeCache({
      token: VALID_TOKEN,
      exp: FUTURE_EXP,
      url: VALID_CONFIG.url,
      collection: VALID_CONFIG.authCollection,
      email: VALID_CONFIG.email,
    }, false);

    // Override the auth handler to fail — it should NOT be called.
    let authCalled = false;
    server.use(
      http.post(`${BASE_URL}${AUTH_PATH}`, () => {
        authCalled = true;
        return HttpResponse.json({ error: "should not be called" }, { status: 500 });
      }),
    );

    const client = new BeszelClient(VALID_CONFIG, false);
    const token = await client.authenticate();

    expect(token).toBe(VALID_TOKEN);
    expect(authCalled).toBe(false);
  });

  it("performs fresh auth when the cached token is expired", async () => {
    const pastExp = Math.floor(Date.now() / 1000) - 10;
    writeCache({ token: "old.expired.token", exp: pastExp, ...VALID_CONFIG, authCollection: "_superusers" }, false);

    const client = new BeszelClient(VALID_CONFIG, false);
    const token = await client.authenticate();

    // Should have used the fresh token from the mock server.
    expect(token).toBe(VALID_TOKEN);
  });

  it("bypasses cache entirely when noCache=true (neither reads nor writes)", async () => {
    const client = new BeszelClient(VALID_CONFIG, true);
    await client.authenticate();
    // With noCache=true the file must NOT be written.
    expect(fs.existsSync(getCachePath())).toBe(false);
  });

  it("throws CliError AUTH_FAILED (exit 2) on 400 bad credentials", async () => {
    server.use(
      http.post(`${BASE_URL}${AUTH_PATH}`, () => {
        return HttpResponse.json({ message: "Wrong credentials" }, { status: 400 });
      }),
    );

    const client = new BeszelClient(VALID_CONFIG, true);
    await expect(client.authenticate()).rejects.toSatisfy((err: unknown) => {
      const cliErr = err as CliError;
      return cliErr instanceof CliError && cliErr.code === "AUTH_FAILED" && cliErr.exitCode === 2;
    });
  });

  it("throws CliError AUTH_FAILED (exit 2) on 401 from auth endpoint", async () => {
    server.use(
      http.post(`${BASE_URL}${AUTH_PATH}`, () => {
        return HttpResponse.json({ message: "Unauthorized" }, { status: 401 });
      }),
    );

    const client = new BeszelClient(VALID_CONFIG, true);
    await expect(client.authenticate()).rejects.toSatisfy((err: unknown) => {
      const cliErr = err as CliError;
      return cliErr instanceof CliError && cliErr.code === "AUTH_FAILED" && cliErr.exitCode === 2;
    });
  });

  it("throws CliError NETWORK_ERROR (exit 4) when the server is unreachable", async () => {
    server.use(
      http.post(`${BASE_URL}${AUTH_PATH}`, () => {
        return HttpResponse.error();
      }),
    );

    const client = new BeszelClient(VALID_CONFIG, true);
    await expect(client.authenticate()).rejects.toSatisfy((err: unknown) => {
      const cliErr = err as CliError;
      return cliErr instanceof CliError && cliErr.code === "NETWORK_ERROR" && cliErr.exitCode === 4;
    });
  });

  it("uses a custom BESZEL_AUTH_COLLECTION in the auth URL", async () => {
    const customConfig: BeszelConfig = { ...VALID_CONFIG, authCollection: "users" };
    const customPath = "/api/collections/users/auth-with-password";

    let customAuthCalled = false;
    server.use(
      http.post(`${BASE_URL}${customPath}`, () => {
        customAuthCalled = true;
        return HttpResponse.json({ token: VALID_TOKEN });
      }),
    );

    const client = new BeszelClient(customConfig, true);
    await client.authenticate();

    expect(customAuthCalled).toBe(true);
  });
});

describe("BeszelClient.request() — 401 mid-session retry", () => {
  it("clears cache, re-auths once, and retries on 401 from a data endpoint", async () => {
    let recordsCallCount = 0;
    let authCallCount = 0;

    server.use(
      http.post(`${BASE_URL}${AUTH_PATH}`, () => {
        authCallCount++;
        return HttpResponse.json({ token: VALID_TOKEN });
      }),
      http.get(`${BASE_URL}${RECORDS_PATH}`, () => {
        recordsCallCount++;
        if (recordsCallCount === 1) {
          // First call returns 401 to trigger re-auth.
          return HttpResponse.json({ message: "token expired" }, { status: 401 });
        }
        // Second call succeeds.
        return HttpResponse.json({ page: 1, perPage: 20, totalItems: 0, totalPages: 0, items: [] });
      }),
    );

    const client = new BeszelClient(VALID_CONFIG, true);
    await client.authenticate(); // initial auth

    const result = await client.listRecords("systems");
    expect(result).toBeDefined();
    // Auth was called once initially + once on 401.
    expect(authCallCount).toBe(2);
    // Records was called twice (first → 401, second → 200).
    expect(recordsCallCount).toBe(2);
  });

  it("throws CliError AUTH_FAILED after second consecutive 401", async () => {
    server.use(
      http.post(`${BASE_URL}${AUTH_PATH}`, () => {
        return HttpResponse.json({ token: VALID_TOKEN });
      }),
      http.get(`${BASE_URL}${RECORDS_PATH}`, () => {
        return HttpResponse.json({ message: "still unauthorized" }, { status: 401 });
      }),
    );

    const client = new BeszelClient(VALID_CONFIG, true);
    await client.authenticate();

    await expect(client.listRecords("systems")).rejects.toSatisfy((err: unknown) => {
      const cliErr = err as CliError;
      return cliErr instanceof CliError && cliErr.code === "AUTH_FAILED" && cliErr.exitCode === 2;
    });
  });
});

describe("BeszelClient.request() — other HTTP errors", () => {
  it("throws CliError NOT_FOUND (exit 3) on 404", async () => {
    server.use(
      http.post(`${BASE_URL}${AUTH_PATH}`, () => {
        return HttpResponse.json({ token: VALID_TOKEN });
      }),
      http.get(`${BASE_URL}/api/collections/nonexistent/records`, () => {
        return HttpResponse.json({ message: "Not Found" }, { status: 404 });
      }),
    );

    const client = new BeszelClient(VALID_CONFIG, true);
    await client.authenticate();

    await expect(client.listRecords("nonexistent")).rejects.toSatisfy((err: unknown) => {
      const cliErr = err as CliError;
      return cliErr instanceof CliError && cliErr.code === "NOT_FOUND" && cliErr.exitCode === 3;
    });
  });

  it("throws CliError NETWORK_ERROR (exit 4) on 5xx response", async () => {
    server.use(
      http.post(`${BASE_URL}${AUTH_PATH}`, () => {
        return HttpResponse.json({ token: VALID_TOKEN });
      }),
      http.get(`${BASE_URL}${RECORDS_PATH}`, () => {
        return HttpResponse.json({ message: "Internal Server Error" }, { status: 500 });
      }),
    );

    const client = new BeszelClient(VALID_CONFIG, true);
    await client.authenticate();

    await expect(client.listRecords("systems")).rejects.toSatisfy((err: unknown) => {
      const cliErr = err as CliError;
      return cliErr instanceof CliError && cliErr.code === "NETWORK_ERROR" && cliErr.exitCode === 4;
    });
  });

  it("throws CliError NETWORK_ERROR (exit 4) on a network-level error (fetch throws)", async () => {
    server.use(
      http.post(`${BASE_URL}${AUTH_PATH}`, () => {
        return HttpResponse.json({ token: VALID_TOKEN });
      }),
      http.get(`${BASE_URL}${RECORDS_PATH}`, () => {
        return HttpResponse.error();
      }),
    );

    const client = new BeszelClient(VALID_CONFIG, true);
    await client.authenticate();

    await expect(client.listRecords("systems")).rejects.toSatisfy((err: unknown) => {
      const cliErr = err as CliError;
      return cliErr instanceof CliError && cliErr.code === "NETWORK_ERROR" && cliErr.exitCode === 4;
    });
  });
});

describe("BeszelClient.listRecords()", () => {
  it("builds the correct query string from ListOptions", async () => {
    let capturedUrl: string | undefined;

    server.use(
      http.post(`${BASE_URL}${AUTH_PATH}`, () => {
        return HttpResponse.json({ token: VALID_TOKEN });
      }),
      http.get(`${BASE_URL}/api/collections/systems/records`, ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json({ page: 1, perPage: 5, totalItems: 0, totalPages: 0, items: [] });
      }),
    );

    const client = new BeszelClient(VALID_CONFIG, true);
    await client.authenticate();
    await client.listRecords("systems", {
      filter: `status="up"`,
      sort: "-created",
      perPage: 5,
      skipTotal: true,
    });

    expect(capturedUrl).toBeDefined();
    const url = new URL(capturedUrl!);
    expect(url.searchParams.get("filter")).toBe(`status="up"`);
    expect(url.searchParams.get("sort")).toBe("-created");
    expect(url.searchParams.get("perPage")).toBe("5");
    expect(url.searchParams.get("skipTotal")).toBe("1");
  });

  it("sends Authorization header without Bearer prefix", async () => {
    let capturedAuthHeader: string | undefined;

    server.use(
      http.post(`${BASE_URL}${AUTH_PATH}`, () => {
        return HttpResponse.json({ token: VALID_TOKEN });
      }),
      http.get(`${BASE_URL}${RECORDS_PATH}`, ({ request }) => {
        capturedAuthHeader = request.headers.get("Authorization") ?? undefined;
        return HttpResponse.json({ page: 1, perPage: 20, totalItems: 0, totalPages: 0, items: [] });
      }),
    );

    const client = new BeszelClient(VALID_CONFIG, true);
    await client.authenticate();
    await client.listRecords("systems");

    expect(capturedAuthHeader).toBe(VALID_TOKEN);
    expect(capturedAuthHeader).not.toMatch(/^Bearer /i);
  });
});

describe("checkVersion()", () => {
  it("does not write to stderr for a supported version (0.18.x)", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    checkVersion("0.18.7");
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("writes a warning to stderr for a version outside the supported range", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    checkVersion("0.19.0");
    expect(stderrSpy).toHaveBeenCalledOnce();
    const msg = stderrSpy.mock.calls[0]![0] as string;
    expect(msg).toMatch(/WARNING/);
    expect(msg).toMatch(SUPPORTED_BESZEL);
    stderrSpy.mockRestore();
  });

  it("does nothing when observedVersion is undefined", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    checkVersion(undefined);
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("does nothing when observedVersion is not parseable semver", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    checkVersion("unknown");
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
  });
});
