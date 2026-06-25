import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { BeszelClient } from "../../src/client/beszelClient.js";
import { fetchSystem } from "../../src/queries/system.js";
import { CliError } from "../../src/types/errors.js";
import type { BeszelConfig } from "../../src/client/config.js";

import systemsFixture from "../fixtures/systems.json" with { type: "json" };
import systemDetailsFixture from "../fixtures/system_details.json" with { type: "json" };

const BASE_URL = "http://beszel-system.test";
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
const VALID_TOKEN = buildJwt(Math.floor(Date.now() / 1000) + 7 * 86400);

const defaultHandlers = [
  http.post(`${BASE_URL}${AUTH_PATH}`, () =>
    HttpResponse.json({ token: VALID_TOKEN, record: { id: "admin" } }),
  ),
  http.get(`${BASE_URL}/api/collections/systems/records`, () =>
    HttpResponse.json(systemsFixture),
  ),
  http.get(`${BASE_URL}/api/collections/system_details/records`, () =>
    HttpResponse.json(systemDetailsFixture),
  ),
];

const server = setupServer(...defaultHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

async function makeClient(): Promise<BeszelClient> {
  const client = new BeszelClient(VALID_CONFIG, true);
  await client.authenticate();
  return client;
}

describe("fetchSystem", () => {
  describe("happy path — name match (case-insensitive)", () => {
    it("resolves 'Home Lab' by exact name", async () => {
      const client = await makeClient();
      const result = await fetchSystem(client, "Home Lab");
      expect(result.system.id).toBe("sys001homela");
      expect(result.system.name).toBe("Home Lab");
      expect(result.system.status).toBe("up");
    });

    it("resolves 'home lab' (lowercase) via case-insensitive match", async () => {
      const client = await makeClient();
      const result = await fetchSystem(client, "home lab");
      expect(result.system.id).toBe("sys001homela");
    });

    it("resolves 'HOME LAB' (uppercase)", async () => {
      const client = await makeClient();
      const result = await fetchSystem(client, "HOME LAB");
      expect(result.system.id).toBe("sys001homela");
    });

    it("stable-mandatory fields are present and non-null for 'Home Lab'", async () => {
      const client = await makeClient();
      const result = await fetchSystem(client, "Home Lab");
      const s = result.system;
      expect(typeof s.cpu).toBe("number");
      expect(typeof s.memPct).toBe("number");
      expect(typeof s.diskPct).toBe("number");
      expect(typeof s.uptimeS).toBe("number");
      expect(typeof s.agentVersion).toBe("string");
    });
  });

  describe("id fallback", () => {
    it("resolves by exact id when no name matches", async () => {
      // "sys002orangpi" is not a recognizable name — triggers id fallback.
      const client = await makeClient();
      const result = await fetchSystem(client, "sys002orangpi");
      expect(result.system.name).toBe("OrangePi");
    });
  });

  describe("system_details merge", () => {
    it("includes details when system_details record exists for the system", async () => {
      const client = await makeClient();
      const result = await fetchSystem(client, "Home Lab");
      expect(result.details).not.toBeNull();
      expect(result.details?.hostname).toBe("homelab");
      expect(result.details?.os).toContain("Debian");
      expect(result.details?.cores).toBe(6);
    });

    it("returns details: null when system_details returns empty list", async () => {
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
      await expect(fetchSystem(client, "Nonexistent")).rejects.toThrow(CliError);
      try {
        await fetchSystem(client, "Nonexistent");
      } catch (err) {
        expect((err as CliError).code).toBe("NOT_FOUND");
        expect((err as CliError).exitCode).toBe(3);
      }
    });

    it("throws AMBIGUOUS_SYSTEM (exit 3) when multiple name matches", async () => {
      // Both systems have EXACTLY the name "Lab" (same case-insensitive spelling).
      // The lookup arg is "lab" which matches both case-insensitively.
      const ambiguousFixture = {
        page: 1, perPage: 500, totalItems: 2, totalPages: 1,
        items: [
          { id: "id001", name: "Lab", host: "host1.local", status: "up", info: {} },
          { id: "id002", name: "Lab", host: "host2.local", status: "up", info: {} },
        ],
      };

      server.use(
        http.get(`${BASE_URL}/api/collections/systems/records`, () =>
          HttpResponse.json(ambiguousFixture),
        ),
      );

      const client = await makeClient();
      await expect(fetchSystem(client, "lab")).rejects.toThrow(CliError);
      try {
        await fetchSystem(client, "lab");
      } catch (err) {
        expect((err as CliError).code).toBe("AMBIGUOUS_SYSTEM");
        expect((err as CliError).exitCode).toBe(3);
        // hint should contain the ids
        expect((err as CliError).hint).toContain("id001");
        expect((err as CliError).hint).toContain("id002");
      }
    });
  });
});
