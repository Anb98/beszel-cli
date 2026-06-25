/**
 * commands/disks.test.ts — Integration tests for src/commands/disks.ts
 *
 * REQ-6 scenarios tested:
 *   - Mixed disk and RAID items returned with correct kind
 *   - RAID items include raidLevel, arrayState, raidDisks, syncAction
 *   - Host with no smart_devices → {devices:[]}
 *   - --failing filter: only failing items returned
 *   - RAID degraded detection (arrayState != "clean")
 *   - --system filter applies server-side
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { BeszelClient } from "../../src/client/beszelClient.js";
import { fetchDisks } from "../../src/queries/disks.js";
import type { BeszelConfig } from "../../src/client/config.js";
import type { RaidInfo, DiskInfo } from "../../src/types/output.js";

import smartDevicesFixture from "../fixtures/smart_devices.json" with { type: "json" };
import smartDevicesDegradedFixture from "../fixtures/smart_devices_degraded.json" with { type: "json" };
import systemsFixture from "../fixtures/systems.json" with { type: "json" };

const BASE_URL = "http://beszel-disks-cmd.test";
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
  http.get(`${BASE_URL}/api/collections/smart_devices/records`, () =>
    HttpResponse.json(smartDevicesFixture),
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

describe("beszel disks — REQ-6", () => {
  describe("mixed disk and RAID", () => {
    it("returns both kind:disk and kind:raid items", async () => {
      const client = await makeClient();
      const result = await fetchDisks(client);

      const diskItems = result.devices.filter((d) => d.kind === "disk");
      const raidItems = result.devices.filter((d) => d.kind === "raid");

      expect(diskItems.length).toBeGreaterThan(0);
      expect(raidItems.length).toBeGreaterThan(0);
    });

    it("RAID items include raidLevel, arrayState, raidDisks, syncAction", async () => {
      const client = await makeClient();
      const result = await fetchDisks(client);

      const raid = result.devices.find((d) => d.kind === "raid") as RaidInfo | undefined;
      expect(raid).toBeDefined();
      expect("raidLevel" in raid!).toBe(true);
      expect("arrayState" in raid!).toBe(true);
      expect("raidDisks" in raid!).toBe(true);
      expect("syncAction" in raid!).toBe(true);
    });

    it("disk items include state, model, tempC, capacityBytes, type", async () => {
      const client = await makeClient();
      const result = await fetchDisks(client);

      const disk = result.devices.find((d) => d.kind === "disk") as DiskInfo | undefined;
      expect(disk).toBeDefined();
      expect("state" in disk!).toBe(true);
      expect("model" in disk!).toBe(true);
      expect("tempC" in disk!).toBe(true);
      expect("capacityBytes" in disk!).toBe(true);
      expect("type" in disk!).toBe(true);
    });

    it("disk items include optional fields when present (serial, firmware, hours, cycles)", async () => {
      const client = await makeClient();
      const result = await fetchDisks(client);

      // The /dev/sda fixture has serial, firmware, hours, cycles
      const sda = result.devices.find(
        (d) => d.kind === "disk" && d.name === "/dev/sda",
      ) as DiskInfo | undefined;
      expect(sda).toBeDefined();
      expect(sda!.serial).toBeDefined();
      expect(sda!.firmware).toBeDefined();
      expect(typeof sda!.hours).toBe("number");
      expect(typeof sda!.cycles).toBe("number");
    });
  });

  describe("host with no smart_devices", () => {
    it("returns {devices:[]} when smart_devices collection is empty", async () => {
      server.use(
        http.get(`${BASE_URL}/api/collections/smart_devices/records`, () =>
          HttpResponse.json({ page: 1, perPage: 500, totalItems: 0, totalPages: 0, items: [] }),
        ),
      );

      const client = await makeClient();
      const result = await fetchDisks(client);
      expect(result.devices).toEqual([]);
    });
  });

  describe("--failing filter", () => {
    it("returns only failing devices from degraded fixture", async () => {
      server.use(
        http.get(`${BASE_URL}/api/collections/smart_devices/records`, () =>
          HttpResponse.json(smartDevicesDegradedFixture),
        ),
      );

      const client = await makeClient();
      const result = await fetchDisks(client, { failing: true });

      // Both items in degraded fixture are failing:
      // - /dev/md127: arrayState=degraded (failing raid)
      // - /dev/sdb: state=FAILED (failing disk)
      expect(result.devices.length).toBeGreaterThan(0);
      for (const d of result.devices) {
        if (d.kind === "disk") {
          expect((d as DiskInfo).state).not.toBe("PASSED");
        } else {
          const r = d as RaidInfo;
          const isFailing = r.arrayState !== "clean" || r.syncAction !== "idle";
          expect(isFailing).toBe(true);
        }
      }
    });

    it("filters out PASSED disks and clean+idle RAID from normal fixture", async () => {
      const client = await makeClient();
      const result = await fetchDisks(client, { failing: true });

      // Normal fixture has all PASSED disks and clean+idle RAID
      expect(result.devices).toHaveLength(0);
    });
  });

  describe("RAID degraded detection", () => {
    it("includes RAID device with degraded arrayState", async () => {
      server.use(
        http.get(`${BASE_URL}/api/collections/smart_devices/records`, () =>
          HttpResponse.json(smartDevicesDegradedFixture),
        ),
      );

      const client = await makeClient();
      const result = await fetchDisks(client);

      const degradedRaid = result.devices.find(
        (d) => d.kind === "raid" && (d as RaidInfo).arrayState === "degraded",
      ) as RaidInfo | undefined;

      expect(degradedRaid).toBeDefined();
      expect(degradedRaid!.arrayState).toBe("degraded");
    });
  });

  describe("--system filter", () => {
    it("applies system id filter server-side", async () => {
      let capturedFilter: string | null = null;

      server.use(
        http.get(`${BASE_URL}/api/collections/smart_devices/records`, ({ request }) => {
          const url = new URL(request.url);
          capturedFilter = url.searchParams.get("filter");
          return HttpResponse.json(smartDevicesFixture);
        }),
      );

      const client = await makeClient();
      await fetchDisks(client, { system: "Home Lab" });

      expect(capturedFilter).toContain("sys001homela");
    });

    it("never sorts by -created (smart_devices has no created field)", async () => {
      let capturedSort: string | null = null;

      server.use(
        http.get(`${BASE_URL}/api/collections/smart_devices/records`, ({ request }) => {
          const url = new URL(request.url);
          capturedSort = url.searchParams.get("sort");
          return HttpResponse.json(smartDevicesFixture);
        }),
      );

      const client = await makeClient();
      await fetchDisks(client);

      expect(capturedSort).not.toBe("-created");
      expect(capturedSort).toBe("-updated");
    });
  });
});
