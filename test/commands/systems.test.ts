import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { BeszelClient } from "../../src/client/beszelClient.js";
import { fetchSystems } from "../../src/queries/systems.js";
import type { BeszelConfig } from "../../src/client/config.js";

import systemsFixture from "../fixtures/systems.json" with { type: "json" };

const BASE_URL = "http://beszel-systems-cmd.test";
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
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

async function makeClient(): Promise<BeszelClient> {
  const client = new BeszelClient(VALID_CONFIG, true);
  await client.authenticate();
  return client;
}

describe("beszel systems — REQ-3", () => {
  describe("happy path — fleet with systems", () => {
    it("returns a systems array with 3 items", async () => {
      const client = await makeClient();
      const result = await fetchSystems(client);
      expect(result.systems).toHaveLength(3);
    });

    it("items are sorted by name ascending", async () => {
      const client = await makeClient();
      const result = await fetchSystems(client);
      const names = result.systems.map((s) => s.name);
      expect(names).toEqual([...names].sort());
    });

    it("each item has stable-mandatory fields", async () => {
      const client = await makeClient();
      const result = await fetchSystems(client);
      for (const s of result.systems) {
        expect(typeof s.id).toBe("string");
        expect(typeof s.name).toBe("string");
        expect(typeof s.status).toBe("string");
        // cpu, memPct, diskPct, uptimeS can be null but must exist
        expect("cpu" in s).toBe(true);
        expect("memPct" in s).toBe(true);
        expect("diskPct" in s).toBe(true);
        expect("uptimeS" in s).toBe(true);
        expect("agentVersion" in s).toBe(true);
      }
    });
  });

  describe("optional fields", () => {
    it("includes tempC when dt is present", async () => {
      const client = await makeClient();
      const result = await fetchSystems(client);
      // "Home Lab" fixture has dt: 52.0
      const homeLab = result.systems.find((s) => s.name === "Home Lab");
      expect(homeLab).toBeDefined();
      expect(homeLab!.tempC).toBe(52.0);
    });

    it("includes containerCount when ct is present", async () => {
      const client = await makeClient();
      const result = await fetchSystems(client);
      const homeLab = result.systems.find((s) => s.name === "Home Lab");
      expect(homeLab!.containerCount).toBe(12);
    });

    it("omits tempC when dt is absent in fixture", async () => {
      const client = await makeClient();
      const result = await fetchSystems(client);
      // "Zima blade" fixture has no dt
      const zimablade = result.systems.find((s) => s.name === "Zima blade");
      expect(zimablade).toBeDefined();
      expect("tempC" in zimablade!).toBe(false);
    });

    it("omits containerCount when ct is absent", async () => {
      const client = await makeClient();
      const result = await fetchSystems(client);
      const zimablade = result.systems.find((s) => s.name === "Zima blade");
      expect("containerCount" in zimablade!).toBe(false);
    });

    it("includes loadAvg and extraFs when present", async () => {
      const client = await makeClient();
      const result = await fetchSystems(client);
      const homeLab = result.systems.find((s) => s.name === "Home Lab");
      expect(Array.isArray(homeLab!.loadAvg)).toBe(true);
      expect(homeLab!.loadAvg).toHaveLength(3);
      expect(typeof homeLab!.extraFs).toBe("object");
    });
  });

  describe("empty fleet", () => {
    it("returns {systems:[]} and does not error", async () => {
      server.use(
        http.get(`${BASE_URL}/api/collections/systems/records`, () =>
          HttpResponse.json({ page: 1, perPage: 500, totalItems: 0, totalPages: 0, items: [] }),
        ),
      );

      const client = await makeClient();
      const result = await fetchSystems(client);
      expect(result.systems).toEqual([]);
    });
  });

  describe("--status filter", () => {
    it("filters to systems with status='up'", async () => {
      const client = await makeClient();
      const result = await fetchSystems(client, "up");
      // All 3 fixture systems have status "up"
      expect(result.systems.length).toBe(3);
      expect(result.systems.every((s) => s.status === "up")).toBe(true);
    });

    it("filters to systems with status='down' (returns empty from fixture)", async () => {
      const client = await makeClient();
      const result = await fetchSystems(client, "down");
      // No "down" systems in fixture
      expect(result.systems).toEqual([]);
    });

    it("filters correctly when fixture has a down system", async () => {
      server.use(
        http.get(`${BASE_URL}/api/collections/systems/records`, () =>
          HttpResponse.json({
            page: 1,
            perPage: 500,
            totalItems: 2,
            totalPages: 1,
            items: [
              { id: "s1", name: "Alpha", host: "a.local", status: "up", info: { cpu: 1 } },
              { id: "s2", name: "Beta", host: "b.local", status: "down", info: {} },
            ],
          }),
        ),
      );

      const client = await makeClient();
      const result = await fetchSystems(client, "down");
      expect(result.systems).toHaveLength(1);
      expect(result.systems[0]!.name).toBe("Beta");
    });
  });
});
