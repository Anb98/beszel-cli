import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { BeszelClient } from "../../src/client/beszelClient.js";
import { fetchSystem } from "../../src/queries/system.js";
import { fetchStats } from "../../src/queries/stats.js";
import { CliError } from "../../src/types/errors.js";
import type { BeszelConfig } from "../../src/client/config.js";

import systemsFixture from "../fixtures/systems.json" with { type: "json" };
import systemDetailsFixture from "../fixtures/system_details.json" with { type: "json" };
import systemStatsFixture from "../fixtures/system_stats.json" with { type: "json" };

const BASE_URL = "http://beszel-system-cmd.test";
const VALID_CONFIG: BeszelConfig = {
  url: BASE_URL,
  email: "admin@test.com",
  password: "pass",
  authCollection: "_superusers",
};
const AUTH_PATH = "/api/collections/_superusers/auth-with-password";

function buildJwt(exp: number): string {
  const h = Buffer.from('{"alg":"HS256"}').toString("base64url");
  const p = Buffer.from(JSON.stringify({ sub: "u", exp })).toString("base64url");
  return `${h}.${p}.sig`;
}
const TOKEN = buildJwt(Math.floor(Date.now() / 1000) + 7 * 86400);

const server = setupServer(
  http.post(`${BASE_URL}${AUTH_PATH}`, () =>
    HttpResponse.json({ token: TOKEN }),
  ),
  http.get(`${BASE_URL}/api/collections/systems/records`, () =>
    HttpResponse.json(systemsFixture),
  ),
  http.get(`${BASE_URL}/api/collections/system_details/records`, () =>
    HttpResponse.json(systemDetailsFixture),
  ),
  http.get(`${BASE_URL}/api/collections/system_stats/records`, () =>
    HttpResponse.json(systemStatsFixture),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

async function makeClient(): Promise<BeszelClient> {
  const client = new BeszelClient(VALID_CONFIG, true);
  await client.authenticate();
  return client;
}

describe("beszel system — REQ-4", () => {
  describe("happy path — case-insensitive name resolution", () => {
    it("resolves 'Home Lab' by exact name", async () => {
      const client = await makeClient();
      const result = await fetchSystem(client, "Home Lab");
      expect(result.system.name).toBe("Home Lab");
      expect(result.system.id).toBe("sys001homela");
    });

    it("resolves 'home lab' (lowercase) case-insensitively", async () => {
      const client = await makeClient();
      const result = await fetchSystem(client, "home lab");
      expect(result.system.id).toBe("sys001homela");
    });

    it("resolves 'HOME LAB' (uppercase) case-insensitively", async () => {
      const client = await makeClient();
      const result = await fetchSystem(client, "HOME LAB");
      expect(result.system.id).toBe("sys001homela");
    });

    it("returned system has all stable-mandatory fields", async () => {
      const client = await makeClient();
      const result = await fetchSystem(client, "Home Lab");
      const s = result.system;
      expect(typeof s.id).toBe("string");
      expect(typeof s.name).toBe("string");
      expect(typeof s.status).toBe("string");
      expect("cpu" in s).toBe(true);
      expect("memPct" in s).toBe(true);
      expect("diskPct" in s).toBe(true);
    });
  });

  describe("id fallback", () => {
    it("resolves by exact id when name yields no match", async () => {
      const client = await makeClient();
      // "sys002orangpi" is the actual id — no system named "sys002orangpi"
      const result = await fetchSystem(client, "sys002orangpi");
      expect(result.system.name).toBe("OrangePi");
    });
  });

  describe("system_details merge", () => {
    it("includes details when system_details record exists", async () => {
      const client = await makeClient();
      const result = await fetchSystem(client, "Home Lab");
      expect(result.details).not.toBeNull();
      expect(result.details?.hostname).toBe("homelab");
      expect(typeof result.details?.cores).toBe("number");
    });

    it("returns details: null when system_details list is empty", async () => {
      server.use(
        http.get(`${BASE_URL}/api/collections/system_details/records`, () =>
          HttpResponse.json({ page: 1, perPage: 1, totalItems: 0, totalPages: 0, items: [] }),
        ),
      );
      const client = await makeClient();
      const result = await fetchSystem(client, "Home Lab");
      expect(result.details).toBeNull();
    });
  });

  describe("error cases", () => {
    it("throws NOT_FOUND (exit 3) when name and id both miss", async () => {
      const client = await makeClient();
      await expect(fetchSystem(client, "Nonexistent")).rejects.toSatisfy(
        (e: unknown) =>
          e instanceof CliError && e.code === "NOT_FOUND" && e.exitCode === 3,
      );
    });

    it("throws AMBIGUOUS_SYSTEM (exit 3) when multiple systems share the same name", async () => {
      server.use(
        http.get(`${BASE_URL}/api/collections/systems/records`, () =>
          HttpResponse.json({
            page: 1,
            perPage: 500,
            totalItems: 2,
            totalPages: 1,
            items: [
              { id: "id001", name: "Lab", host: "a.local", status: "up", info: {} },
              { id: "id002", name: "Lab", host: "b.local", status: "up", info: {} },
            ],
          }),
        ),
      );
      const client = await makeClient();
      await expect(fetchSystem(client, "lab")).rejects.toSatisfy(
        (e: unknown) =>
          e instanceof CliError &&
          e.code === "AMBIGUOUS_SYSTEM" &&
          e.exitCode === 3 &&
          e.hint.includes("id001") &&
          e.hint.includes("id002"),
      );
    });
  });
});

describe("beszel system --since — REQ-9", () => {
  it("returns HistoricalEnvelope with interval, from, to, points", async () => {
    const client = await makeClient();
    const now = new Date("2026-06-24T15:00:00.000Z");
    const envelope = await fetchStats(client, {
      since: "1h",
      systemId: "sys001homela",
      now,
    });

    expect(typeof envelope.interval).toBe("string");
    expect(typeof envelope.from).toBe("string");
    expect(typeof envelope.to).toBe("string");
    expect(Array.isArray(envelope.points)).toBe(true);
  });

  it("selects the correct interval bucket for 12h", async () => {
    // For 12h → interval should be "10m" (≤12h bucket).
    // We need to mock stats with type "10m".
    server.use(
      http.get(`${BASE_URL}/api/collections/system_stats/records`, () =>
        HttpResponse.json({
          page: 1,
          perPage: 500,
          totalItems: 0,
          totalPages: 0,
          items: [],
        }),
      ),
    );

    const client = await makeClient();
    const now = new Date("2026-06-24T15:00:00.000Z");
    const envelope = await fetchStats(client, {
      since: "12h",
      systemId: "sys001homela",
      now,
    });

    expect(envelope.interval).toBe("10m");
  });

  it("selects 20m bucket for 24h window", async () => {
    server.use(
      http.get(`${BASE_URL}/api/collections/system_stats/records`, () =>
        HttpResponse.json({ page: 1, perPage: 500, totalItems: 0, totalPages: 0, items: [] }),
      ),
    );

    const client = await makeClient();
    const now = new Date("2026-06-24T15:00:00.000Z");
    const envelope = await fetchStats(client, {
      since: "24h",
      systemId: "sys001homela",
      now,
    });

    expect(envelope.interval).toBe("20m");
  });

  it("clamps to 480m and warns on stderr when since > 30d", async () => {
    server.use(
      http.get(`${BASE_URL}/api/collections/system_stats/records`, () =>
        HttpResponse.json({ page: 1, perPage: 500, totalItems: 0, totalPages: 0, items: [] }),
      ),
    );

    const stderrMessages: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    const stderrSpy = (process.stderr.write = (...args: Parameters<typeof origWrite>) => {
      stderrMessages.push(String(args[0]));
      return origWrite(...args);
    }) as typeof process.stderr.write;

    const client = await makeClient();
    const envelope = await fetchStats(client, {
      since: "45d",
      systemId: "sys001homela",
    });

    process.stderr.write = origWrite;
    void stderrSpy; // suppress unused warning

    expect(envelope.interval).toBe("480m");
    expect(stderrMessages.some((m) => m.includes("clamp") || m.includes("warn") || m.includes("30d") || m.includes("45d"))).toBe(true);
    expect(envelope.interval).toBe("480m");
  });
});
