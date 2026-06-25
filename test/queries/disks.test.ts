/**
 * disks.test.ts — Tests for src/queries/disks.ts
 *
 * REQ-6: unified DiskInfo/RaidInfo discriminated union; --failing filter;
 * no devices → empty array (never error); RAID attribute parsing.
 * Uses msw to mock PocketBase API.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { BeszelClient } from "../../src/client/beszelClient.js";
import { fetchDisks } from "../../src/queries/disks.js";
import { CliError } from "../../src/types/errors.js";
import type { BeszelConfig } from "../../src/client/config.js";
import type { DiskInfo, RaidInfo } from "../../src/types/output.js";

import smartFixture from "../fixtures/smart_devices.json" with { type: "json" };
import smartDegradedFixture from "../fixtures/smart_devices_degraded.json" with { type: "json" };
import systemsFixture from "../fixtures/systems.json" with { type: "json" };

const BASE_URL = "http://beszel-disks.test";
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
  http.get(`${BASE_URL}/api/collections/smart_devices/records`, () =>
    HttpResponse.json(smartFixture),
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

describe("fetchDisks", () => {
  describe("basic listing", () => {
    it("returns DisksOutput with devices array", async () => {
      const client = await makeClient();
      const result = await fetchDisks(client);
      expect(Array.isArray(result.devices)).toBe(true);
    });

    it("maps 3 devices from healthy fixture (1 raid + 2 physical)", async () => {
      const client = await makeClient();
      const result = await fetchDisks(client);
      expect(result.devices).toHaveLength(3);
    });

    it("RAID device has kind='raid'", async () => {
      const client = await makeClient();
      const result = await fetchDisks(client);
      const raidDevices = result.devices.filter((d) => d.kind === "raid");
      expect(raidDevices.length).toBeGreaterThan(0);
    });

    it("physical disk has kind='disk'", async () => {
      const client = await makeClient();
      const result = await fetchDisks(client);
      const diskDevices = result.devices.filter((d) => d.kind === "disk");
      expect(diskDevices.length).toBeGreaterThan(0);
    });
  });

  describe("RAID device mapping (kind='raid')", () => {
    it("RAID item includes raidLevel, arrayState, raidDisks, syncAction", async () => {
      const client = await makeClient();
      const result = await fetchDisks(client);
      const raidDevice = result.devices.find((d) => d.kind === "raid") as RaidInfo;

      expect(raidDevice).toBeDefined();
      expect(raidDevice.raidLevel).toBe("raid5");
      expect(raidDevice.arrayState).toBe("clean");
      expect(raidDevice.raidDisks).toBe(4);
      expect(raidDevice.syncAction).toBe("idle");
    });

    it("RAID item has name, system, state", async () => {
      const client = await makeClient();
      const result = await fetchDisks(client);
      const raidDevice = result.devices.find((d) => d.kind === "raid") as RaidInfo;
      expect(raidDevice.name).toBe("/dev/md5");
      expect(typeof raidDevice.system).toBe("string");
      expect(raidDevice.state).toBe("PASSED");
    });
  });

  describe("physical disk mapping (kind='disk')", () => {
    it("disk item includes tempC, capacityBytes, model, type", async () => {
      const client = await makeClient();
      const result = await fetchDisks(client);
      const disk = result.devices.find(
        (d) => d.kind === "disk" && (d as DiskInfo).name === "/dev/sda",
      ) as DiskInfo;

      expect(disk).toBeDefined();
      expect(disk.tempC).toBe(32);
      expect(typeof disk.capacityBytes).toBe("number");
      expect(disk.model).toContain("Samsung");
      expect(disk.type).toBe("sat");
    });

    it("disk item includes optional fields when present (serial, hours, cycles)", async () => {
      const client = await makeClient();
      const result = await fetchDisks(client);
      const disk = result.devices.find(
        (d) => d.kind === "disk" && (d as DiskInfo).name === "/dev/sda",
      ) as DiskInfo;

      expect(disk.serial).toBeDefined();
      expect(disk.hours).toBe(12480);
      expect(disk.cycles).toBe(312);
    });
  });

  describe("sorts by -updated (never by -created)", () => {
    it("sends sort=-updated for smart_devices (no created field)", async () => {
      let capturedSort: string | null = null;
      server.use(
        http.get(`${BASE_URL}/api/collections/smart_devices/records`, ({ request }) => {
          capturedSort = new URL(request.url).searchParams.get("sort");
          return HttpResponse.json(smartFixture);
        }),
      );
      const client = await makeClient();
      await fetchDisks(client);
      expect(capturedSort).toBe("-updated");
      expect(capturedSort).not.toContain("created");
    });
  });

  describe("empty result", () => {
    it("returns empty devices array when no smart_devices exist", async () => {
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
    it("filters to failing devices: FAILED disk and degraded RAID", async () => {
      server.use(
        http.get(`${BASE_URL}/api/collections/smart_devices/records`, () =>
          HttpResponse.json(smartDegradedFixture),
        ),
      );
      const client = await makeClient();
      const result = await fetchDisks(client, { failing: true });

      // Both devices in degraded fixture should be "failing":
      // /dev/md127 has arrayState=degraded (failing RAID)
      // /dev/sdb has state=FAILED (failing disk)
      expect(result.devices.length).toBeGreaterThan(0);
      for (const device of result.devices) {
        if (device.kind === "disk") {
          const d = device as DiskInfo;
          expect(d.state).not.toBe("PASSED");
        } else {
          const r = device as RaidInfo;
          const isFailing = r.arrayState !== "clean" || r.syncAction !== "idle";
          expect(isFailing).toBe(true);
        }
      }
    });

    it("healthy devices are excluded when --failing is set", async () => {
      // Healthy fixture: all devices are PASSED/clean+idle
      const client = await makeClient();
      const result = await fetchDisks(client, { failing: true });
      // All devices in healthy fixture are PASSED/clean — should be empty
      expect(result.devices).toHaveLength(0);
    });

    it("degraded RAID is included in --failing results", async () => {
      server.use(
        http.get(`${BASE_URL}/api/collections/smart_devices/records`, () =>
          HttpResponse.json(smartDegradedFixture),
        ),
      );
      const client = await makeClient();
      const result = await fetchDisks(client, { failing: true });
      const raidDevices = result.devices.filter((d) => d.kind === "raid") as RaidInfo[];
      expect(raidDevices.length).toBeGreaterThan(0);
      const degraded = raidDevices.find((r) => r.arrayState === "degraded");
      expect(degraded).toBeDefined();
    });
  });

  describe("--system filter", () => {
    it("sends system filter to smart_devices query", async () => {
      let capturedFilter: string | null = null;
      server.use(
        http.get(`${BASE_URL}/api/collections/smart_devices/records`, ({ request }) => {
          capturedFilter = new URL(request.url).searchParams.get("filter");
          return HttpResponse.json(smartFixture);
        }),
      );
      const client = await makeClient();
      await fetchDisks(client, { system: "Home Lab" });
      expect(capturedFilter).toContain("sys001homela");
    });

    it("throws NOT_FOUND for unknown system name", async () => {
      const client = await makeClient();
      await expect(fetchDisks(client, { system: "Ghost System" })).rejects.toThrow(CliError);
      try {
        await fetchDisks(client, { system: "Ghost System" });
      } catch (err) {
        expect((err as CliError).code).toBe("NOT_FOUND");
      }
    });
  });
});
