/**
 * stats.test.ts — Regression tests for src/queries/stats.ts
 *
 * Regression: BUG 2 — PocketBase datetime filter format.
 * PocketBase `created >=` comparisons require the SPACE format
 * "YYYY-MM-DD HH:MM:SS.sssZ", NOT the ISO 8601 "T" format.
 *
 * PROVEN via live smoke test 2026-06-24: T-format → 0 rows returned;
 * space-format → 37 rows returned on identical system/type/window.
 *
 * These tests assert that fetchStats() builds filter strings with the
 * space-format datetime (not the T-format), ensuring the bug cannot recur.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { BeszelClient } from "../../src/client/beszelClient.js";
import { fetchStats } from "../../src/queries/stats.js";
import type { BeszelConfig } from "../../src/client/config.js";

import systemStatsFixture from "../fixtures/system_stats.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "http://beszel-stats.test";
const VALID_CONFIG: BeszelConfig = {
  url: BASE_URL,
  email: "admin@test.com",
  password: "pass",
  authCollection: "_superusers",
};
const AUTH_PATH = "/api/collections/_superusers/auth-with-password";

function buildJwt(exp: number): string {
  const h = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");
  const p = Buffer.from(JSON.stringify({ sub: "u", exp })).toString("base64url");
  return `${h}.${p}.sig`;
}
const TOKEN = buildJwt(Math.floor(Date.now() / 1000) + 7 * 86400);

// Fixed "now" for deterministic datetime assertions
const FIXED_NOW = new Date("2026-06-24T17:00:00.000Z");
// Expected "from" for a 12h window: 2026-06-24T05:00:00.000Z
// In PocketBase space format:       "2026-06-24 05:00:00.000Z"
const EXPECTED_FROM_PB = "2026-06-24 05:00:00.000Z";
const EXPECTED_FROM_ISO = "2026-06-24T05:00:00.000Z";

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

let capturedFilter: string | null = null;

const server = setupServer(
  http.post(`${BASE_URL}${AUTH_PATH}`, () =>
    HttpResponse.json({ token: TOKEN, record: { id: "admin" } }),
  ),
  http.get(`${BASE_URL}/api/collections/system_stats/records`, ({ request }) => {
    const url = new URL(request.url);
    capturedFilter = url.searchParams.get("filter");
    return HttpResponse.json(systemStatsFixture);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  capturedFilter = null;
  server.resetHandlers();
});

async function makeClient(): Promise<BeszelClient> {
  const client = new BeszelClient(VALID_CONFIG, true);
  await client.authenticate();
  return client;
}

// ---------------------------------------------------------------------------
// Tests — BUG 2 regression: PocketBase filter datetime format
// ---------------------------------------------------------------------------

describe("fetchStats — PocketBase datetime filter format (BUG 2 regression)", () => {
  it("sends filter with space-format datetime (not ISO T format)", async () => {
    const client = await makeClient();
    await fetchStats(client, {
      systemId: "sys001homela",
      since: "12h",
      now: FIXED_NOW,
    });

    expect(capturedFilter).not.toBeNull();
    // Must NOT contain the T-format date separator
    expect(capturedFilter).not.toMatch(/created>="[^"]+T[^"]+"/);
    // Must contain the space-format datetime
    expect(capturedFilter).toContain(EXPECTED_FROM_PB);
  });

  it("filter string contains no ISO T separator in the datetime boundary", async () => {
    const client = await makeClient();
    await fetchStats(client, {
      systemId: "sys001homela",
      since: "12h",
      now: FIXED_NOW,
    });

    // The filter value for created>= must use the space format
    const createdMatch = capturedFilter?.match(/created>="([^"]+)"/);
    expect(createdMatch).not.toBeNull();
    const datetimeValue = createdMatch![1]!;
    expect(datetimeValue).not.toContain("T");
    expect(datetimeValue).toContain(" "); // space separator present
    expect(datetimeValue).toBe(EXPECTED_FROM_PB);
  });

  it("output envelope from/to fields are ISO 8601 (not PocketBase format)", async () => {
    const client = await makeClient();
    const result = await fetchStats(client, {
      systemId: "sys001homela",
      since: "12h",
      now: FIXED_NOW,
    });

    // Output envelope keeps ISO format for human/agent consumption
    expect(result.from).toBe(EXPECTED_FROM_ISO);
    expect(result.to).toBe("2026-06-24T17:00:00.000Z");
    // Sanity check: ISO format contains T
    expect(result.from).toContain("T");
    expect(result.to).toContain("T");
  });

  it("returns points from the fixture", async () => {
    const client = await makeClient();
    const result = await fetchStats(client, {
      systemId: "sys001homela",
      since: "12h",
      now: FIXED_NOW,
    });

    expect(Array.isArray(result.points)).toBe(true);
    expect(result.points.length).toBe(1);
    expect(result.interval).toBe("10m");
  });
});
