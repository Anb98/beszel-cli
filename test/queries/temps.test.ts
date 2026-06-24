/**
 * temps.test.ts — Tests for src/queries/temps.ts
 *
 * REQ-7: displayTempC, sensors map, --disks merges smart device temps,
 * no sensors → sensors={}.
 * Uses msw to mock PocketBase API.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { BeszelClient } from "../../src/client/beszelClient.js";
import { fetchTemps } from "../../src/queries/temps.js";
import type { BeszelConfig } from "../../src/client/config.js";

import systemsFixture from "../fixtures/systems.json" with { type: "json" };
import systemStatsFixture from "../fixtures/system_stats.json" with { type: "json" };
import smartFixture from "../fixtures/smart_devices.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "http://beszel-temps.test";
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

// Fixture for system_stats: the stats record only covers sys001homela.
// OrangePi and Zima blade will have no matching stats → sensors: {}.
const statsWithAllSystems = {
  page: 1, perPage: 500, totalItems: 1, totalPages: 1,
  items: systemStatsFixture.items,
};

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const defaultHandlers = [
  http.post(`${BASE_URL}${AUTH_PATH}`, () =>
    HttpResponse.json({ token: VALID_TOKEN, record: { id: "admin" } }),
  ),
  http.get(`${BASE_URL}/api/collections/systems/records`, () =>
    HttpResponse.json(systemsFixture),
  ),
  http.get(`${BASE_URL}/api/collections/system_stats/records`, () =>
    HttpResponse.json(statsWithAllSystems),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fetchTemps", () => {
  describe("basic — without --disks", () => {
    it("returns TempsOutput with systems array", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client);
      expect(Array.isArray(result.systems)).toBe(true);
    });

    it("includes one TempInfo per system", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client);
      expect(result.systems).toHaveLength(3);
    });

    it("each TempInfo has system name, displayTempC, sensors", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client);
      for (const t of result.systems) {
        expect(typeof t.system).toBe("string");
        // displayTempC is number or null
        expect(t.displayTempC === null || typeof t.displayTempC === "number").toBe(true);
        expect(typeof t.sensors).toBe("object");
      }
    });

    it("Home Lab has displayTempC=52 from systems.info.dt", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client);
      const homelab = result.systems.find((t) => t.system === "Home Lab");
      expect(homelab).toBeDefined();
      expect(homelab?.displayTempC).toBe(52);
    });

    it("Home Lab has sensors populated from system_stats.stats.t", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client);
      const homelab = result.systems.find((t) => t.system === "Home Lab");
      expect(homelab?.sensors).toMatchObject({
        cpu_thermal: 52,
        ddr_thermal: 40,
        gpu_thermal: 38,
        ve_thermal: 41,
      });
    });

    it("system with no matching 1m stats record has sensors={}", async () => {
      // system_stats fixture only has stats for sys001homela.
      // OrangePi (sys002orangpi) has no matching stats → sensors should be {}.
      const client = await makeClient();
      const result = await fetchTemps(client);
      const orangepi = result.systems.find((t) => t.system === "OrangePi");
      expect(orangepi?.sensors).toEqual({});
    });

    it("Zima blade (no dt, no stats) has displayTempC=null and sensors={}", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client);
      const zima = result.systems.find((t) => t.system === "Zima blade");
      expect(zima?.displayTempC).toBeNull();
      expect(zima?.sensors).toEqual({});
    });

    it("disk temps are NOT included when --disks is false", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client);
      const homelab = result.systems.find((t) => t.system === "Home Lab");
      const hasDiskTempKey = Object.keys(homelab?.sensors ?? {}).some((k) =>
        k.endsWith("_temp"),
      );
      expect(hasDiskTempKey).toBe(false);
    });

    it("sorts systems_stats by -created (valid; system_stats has created field)", async () => {
      let capturedSort: string | null = null;
      server.use(
        http.get(`${BASE_URL}/api/collections/system_stats/records`, ({ request }) => {
          capturedSort = new URL(request.url).searchParams.get("sort");
          return HttpResponse.json(statsWithAllSystems);
        }),
      );
      const client = await makeClient();
      await fetchTemps(client);
      expect(capturedSort).toBe("-created");
    });
  });

  describe("--disks merges smart_devices temps", () => {
    it("--disks fetches smart_devices sorted by -updated (not -created)", async () => {
      let capturedSort: string | null = null;
      server.use(
        http.get(`${BASE_URL}/api/collections/smart_devices/records`, ({ request }) => {
          capturedSort = new URL(request.url).searchParams.get("sort");
          return HttpResponse.json(smartFixture);
        }),
      );
      const client = await makeClient();
      await fetchTemps(client, { disks: true });
      expect(capturedSort).toBe("-updated");
      expect(capturedSort).not.toContain("created");
    });

    it("--disks merges sda_temp and nvme0n1_temp into Home Lab sensors", async () => {
      server.use(
        http.get(`${BASE_URL}/api/collections/smart_devices/records`, () =>
          HttpResponse.json(smartFixture),
        ),
      );
      const client = await makeClient();
      const result = await fetchTemps(client, { disks: true });
      const homelab = result.systems.find((t) => t.system === "Home Lab");
      expect(homelab?.sensors).toHaveProperty("sda_temp", 32);
      expect(homelab?.sensors).toHaveProperty("nvme0n1_temp", 38);
    });

    it("--disks does NOT add mdraid devices to sensors (no temp on raid)", async () => {
      server.use(
        http.get(`${BASE_URL}/api/collections/smart_devices/records`, () =>
          HttpResponse.json(smartFixture),
        ),
      );
      const client = await makeClient();
      const result = await fetchTemps(client, { disks: true });
      const homelab = result.systems.find((t) => t.system === "Home Lab");
      // The mdraid device (/dev/md5) has no temp in the fixture.
      // Ensure no md5_temp key appears.
      expect(homelab?.sensors).not.toHaveProperty("md5_temp");
    });
  });
});
