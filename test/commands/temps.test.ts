/**
 * commands/temps.test.ts — Integration tests for src/commands/temps.ts
 *
 * REQ-7 scenarios tested:
 *   - Happy path: displayTempC and sensors map present
 *   - --disks merges disk temps into the sensors map
 *   - System with no sensors (no t in system_stats) → sensors: {}
 *   - System without dt → displayTempC: null
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { BeszelClient } from "../../src/client/beszelClient.js";
import { fetchTemps } from "../../src/queries/temps.js";
import type { BeszelConfig } from "../../src/client/config.js";

import systemsFixture from "../fixtures/systems.json" with { type: "json" };
import systemStatsFixture from "../fixtures/system_stats.json" with { type: "json" };
import smartDevicesFixture from "../fixtures/smart_devices.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "http://beszel-temps-cmd.test";
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

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer(
  http.post(`${BASE_URL}${AUTH_PATH}`, () =>
    HttpResponse.json({ token: TOKEN }),
  ),
  http.get(`${BASE_URL}/api/collections/systems/records`, () =>
    HttpResponse.json(systemsFixture),
  ),
  http.get(`${BASE_URL}/api/collections/system_stats/records`, () =>
    HttpResponse.json(systemStatsFixture),
  ),
  http.get(`${BASE_URL}/api/collections/smart_devices/records`, () =>
    HttpResponse.json(smartDevicesFixture),
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

// ---------------------------------------------------------------------------
// Tests — REQ-7
// ---------------------------------------------------------------------------

describe("beszel temps — REQ-7", () => {
  describe("summary without --disks", () => {
    it("returns a systems array with required fields", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client);

      expect(Array.isArray(result.systems)).toBe(true);
      for (const item of result.systems) {
        expect("system" in item).toBe(true);
        expect("displayTempC" in item).toBe(true);
        expect("sensors" in item).toBe(true);
        expect(typeof item.sensors).toBe("object");
      }
    });

    it("returns displayTempC for 'Home Lab' (has dt=52.0 in fixture)", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client);
      const homeLab = result.systems.find((s) => s.system === "Home Lab");
      expect(homeLab).toBeDefined();
      expect(homeLab!.displayTempC).toBe(52.0);
    });

    it("returns sensors map for system with system_stats (1m bucket)", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client);
      const homeLab = result.systems.find((s) => s.system === "Home Lab");
      // system_stats fixture has t: {cpu_thermal:52,ddr_thermal:40,...}
      expect(Object.keys(homeLab!.sensors).length).toBeGreaterThan(0);
      expect(typeof homeLab!.sensors["cpu_thermal"]).toBe("number");
    });

    it("returns sensors:{} for a system with no 1m stats record", async () => {
      // Override stats to return empty
      server.use(
        http.get(`${BASE_URL}/api/collections/system_stats/records`, () =>
          HttpResponse.json({ page: 1, perPage: 500, totalItems: 0, totalPages: 0, items: [] }),
        ),
      );

      const client = await makeClient();
      const result = await fetchTemps(client);
      for (const item of result.systems) {
        expect(item.sensors).toEqual({});
      }
    });

    it("returns displayTempC: null for system without dt (Zima blade)", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client);
      const zimablade = result.systems.find((s) => s.system === "Zima blade");
      expect(zimablade).toBeDefined();
      expect(zimablade!.displayTempC).toBeNull();
    });

    it("does NOT include disk temps in sensors without --disks", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client);
      for (const item of result.systems) {
        // Disk temp keys end in "_temp" and are prefixed with device name
        const diskTempKeys = Object.keys(item.sensors).filter((k) => k.endsWith("_temp"));
        expect(diskTempKeys).toHaveLength(0);
      }
    });
  });

  describe("--disks merges disk temps", () => {
    it("adds disk temp entries to sensors map when --disks is set", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client, { disks: true });

      const homeLab = result.systems.find((s) => s.system === "Home Lab");
      expect(homeLab).toBeDefined();

      // smart_devices fixture has /dev/sda (temp=32) and /dev/nvme0n1 (temp=38)
      // They should appear as sda_temp and nvme0n1_temp
      const diskKeys = Object.keys(homeLab!.sensors).filter((k) => k.endsWith("_temp"));
      expect(diskKeys.length).toBeGreaterThan(0);
    });

    it("disk temps appear under correct keys (e.g. sda_temp)", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client, { disks: true });

      const homeLab = result.systems.find((s) => s.system === "Home Lab");
      expect(typeof homeLab!.sensors["sda_temp"]).toBe("number");
      expect(homeLab!.sensors["sda_temp"]).toBe(32);
    });

    it("does NOT include mdraid devices in disk temps (no temp field on mdraid)", async () => {
      const client = await makeClient();
      const result = await fetchTemps(client, { disks: true });

      const homeLab = result.systems.find((s) => s.system === "Home Lab");
      // /dev/md5 is mdraid — should NOT appear as a temp key
      const md5Key = Object.keys(homeLab!.sensors).find((k) => k.includes("md5"));
      expect(md5Key).toBeUndefined();
    });
  });
});
