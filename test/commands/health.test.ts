/**
 * commands/health.test.ts — Integration tests for src/commands/health.ts
 *
 * REQ-8 — all 9 scenarios covered end-to-end via evaluateHealth + healthExitCode:
 *
 *   S1: healthy fleet → healthy:true, issues:[], exit 0
 *   S2: system down → severity:crit, kind:down, exit 1
 *   S3: SMART failure → severity:crit, kind:smart, exit 1
 *   S4: RAID degraded → severity:crit, kind:raid, exit 1
 *   S5: RAID syncing → severity:warn, kind:raid, healthy:false, exit 0
 *   S6: disk usage WARNING → severity:warn, kind:disk, healthy:false, exit 0
 *   S7: temperature CRITICAL → severity:crit, kind:temp, exit 1
 *   S8: --strict promotes warning to critical → exit 1
 *   S9: custom threshold via flag → custom disk warn fires
 *
 * We test through the pure evaluateHealth() function (which is what the health
 * command wires together via fetchSystems + fetchDisks + fetchTemps). Each
 * scenario supplies the exact HealthSystem/HealthDevice arrays needed to trigger
 * the relevant rule, using the same fixtures the command would receive.
 *
 * For the full pipeline integration (fetchSystems + fetchDisks + fetchTemps →
 * evaluateHealth), additional tests use MSW to mock the HTTP layer.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { BeszelClient } from "../../src/client/beszelClient.js";
import { fetchSystems } from "../../src/queries/systems.js";
import { fetchDisks } from "../../src/queries/disks.js";
import { fetchTemps } from "../../src/queries/temps.js";
import { evaluateHealth, healthExitCode } from "../../src/health/severity.js";
import { resolveThresholds } from "../../src/health/thresholds.js";
import type { HealthSystem, HealthDevice } from "../../src/health/severity.js";
import type { BeszelConfig } from "../../src/client/config.js";

import systemsFixture from "../fixtures/systems.json" with { type: "json" };
import smartDevicesFixture from "../fixtures/smart_devices.json" with { type: "json" };
import smartDevicesDegradedFixture from "../fixtures/smart_devices_degraded.json" with { type: "json" };
import systemStatsFixture from "../fixtures/system_stats.json" with { type: "json" };

const BASE_URL = "http://beszel-health-cmd.test";
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

const DEFAULT_THRESHOLDS = resolveThresholds({}, {});

/**
 * Build a healthy system for use in unit-style tests.
 */
function healthySystem(overrides: Partial<HealthSystem> = {}): HealthSystem {
  return {
    name: "Test System",
    status: "up",
    diskPct: 50,
    displayTempC: 40,
    sensors: {},
    ...overrides,
  };
}

/**
 * Build a healthy physical disk.
 */
function healthyDisk(overrides: Partial<HealthDevice> = {}): HealthDevice {
  return {
    system: "Test System",
    kind: "disk",
    state: "PASSED",
    tempC: 30,
    ...overrides,
  };
}

/**
 * Build a healthy RAID device.
 */
function healthyRaid(overrides: Partial<HealthDevice> = {}): HealthDevice {
  return {
    system: "Test System",
    kind: "raid",
    state: "PASSED",
    arrayState: "clean",
    syncAction: "idle",
    ...overrides,
  };
}

const server = setupServer(
  http.post(`${BASE_URL}${AUTH_PATH}`, () =>
    HttpResponse.json({ token: TOKEN }),
  ),
  http.get(`${BASE_URL}/api/collections/systems/records`, () =>
    HttpResponse.json(systemsFixture),
  ),
  http.get(`${BASE_URL}/api/collections/smart_devices/records`, () =>
    HttpResponse.json(smartDevicesFixture),
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

describe("REQ-8 S1 — healthy fleet", () => {
  it("returns healthy:true when all conditions are within thresholds", () => {
    const systems = [healthySystem()];
    const devices = [healthyDisk(), healthyRaid()];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);

    expect(report.healthy).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.checked).toBe(1);
  });

  it("healthExitCode returns 0 for a healthy report", () => {
    const systems = [healthySystem()];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);
    expect(healthExitCode(report)).toBe(0);
  });
});

describe("REQ-8 S2 — system down", () => {
  it("reports severity:crit kind:down when system status != 'up'", () => {
    const systems = [healthySystem({ status: "down" })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);

    expect(report.healthy).toBe(false);
    const issue = report.issues.find((i) => i.kind === "down");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("crit");
  });

  it("healthExitCode returns 1 when system is down", () => {
    const systems = [healthySystem({ status: "down" })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);
    expect(healthExitCode(report)).toBe(1);
  });
});

describe("REQ-8 S3 — SMART disk failure", () => {
  it("reports severity:crit kind:smart when disk state != PASSED", () => {
    const systems = [healthySystem()];
    const devices = [healthyDisk({ state: "FAILED" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);

    const issue = report.issues.find((i) => i.kind === "smart");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("crit");
    expect(healthExitCode(report)).toBe(1);
  });

  it("reports SMART issue even when disk state is null/unknown", () => {
    const systems = [healthySystem()];
    const devices = [healthyDisk({ state: null })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);

    const issue = report.issues.find((i) => i.kind === "smart");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("crit");
  });
});

describe("REQ-8 S4 — RAID degraded (CRITICAL)", () => {
  it("reports severity:crit kind:raid when arrayState=degraded", () => {
    const systems = [healthySystem()];
    const devices = [healthyRaid({ arrayState: "degraded" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);

    const issue = report.issues.find((i) => i.kind === "raid");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("crit");
    expect(healthExitCode(report)).toBe(1);
  });

  it("reports severity:crit kind:raid when arrayState=failed", () => {
    const systems = [healthySystem()];
    const devices = [healthyRaid({ arrayState: "failed" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);

    const issue = report.issues.find((i) => i.kind === "raid");
    expect(issue!.severity).toBe("crit");
  });

  it("reports severity:crit kind:raid when arrayState=inactive", () => {
    const systems = [healthySystem()];
    const devices = [healthyRaid({ arrayState: "inactive" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);

    const issue = report.issues.find((i) => i.kind === "raid");
    expect(issue!.severity).toBe("crit");
  });
});

describe("REQ-8 S5 — RAID syncing (WARNING, exit 0)", () => {
  it("reports severity:warn kind:raid when syncAction=resync and arrayState=clean", () => {
    const systems = [healthySystem()];
    const devices = [healthyRaid({ arrayState: "clean", syncAction: "resync" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);

    const issue = report.issues.find((i) => i.kind === "raid");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warn");
    expect(report.healthy).toBe(false);
  });

  it("exits 0 for warning-only RAID sync issue (design R5)", () => {
    const systems = [healthySystem()];
    const devices = [healthyRaid({ arrayState: "clean", syncAction: "recover" })];
    const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);

    expect(healthExitCode(report)).toBe(0);
  });

  it("reports warn for all non-idle syncActions (check, repair, reshape)", () => {
    const syncActions = ["check", "repair", "reshape", "recovery"];
    for (const syncAction of syncActions) {
      const systems = [healthySystem()];
      const devices = [healthyRaid({ arrayState: "clean", syncAction })];
      const report = evaluateHealth(systems, devices, DEFAULT_THRESHOLDS);
      const issue = report.issues.find((i) => i.kind === "raid");
      expect(issue?.severity).toBe("warn");
    }
  });
});

describe("REQ-8 S6 — disk usage warning (exits 0)", () => {
  it("reports severity:warn kind:disk when diskPct > 90 (default warn)", () => {
    const systems = [healthySystem({ diskPct: 92 })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);

    const issue = report.issues.find((i) => i.kind === "disk");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warn");
    expect(report.healthy).toBe(false);
  });

  it("exits 0 for warning-only disk usage (design R5)", () => {
    const systems = [healthySystem({ diskPct: 92 })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);
    expect(healthExitCode(report)).toBe(0);
  });

  it("reports severity:crit when diskPct > 95 (default crit)", () => {
    const systems = [healthySystem({ diskPct: 96 })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);

    const issue = report.issues.find((i) => i.kind === "disk");
    expect(issue!.severity).toBe("crit");
    expect(healthExitCode(report)).toBe(1);
  });
});

describe("REQ-8 S7 — temperature critical", () => {
  it("reports severity:crit kind:temp when displayTempC > 90°C", () => {
    const systems = [healthySystem({ displayTempC: 91 })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);

    const issue = report.issues.find((i) => i.kind === "temp");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("crit");
    expect(healthExitCode(report)).toBe(1);
  });

  it("reports severity:warn kind:temp when displayTempC > 80°C but ≤ 90°C", () => {
    const systems = [healthySystem({ displayTempC: 85 })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);

    const issue = report.issues.find((i) => i.kind === "temp");
    expect(issue!.severity).toBe("warn");
    expect(healthExitCode(report)).toBe(0);
  });

  it("reports crit from sensor temp > 90°C", () => {
    const systems = [healthySystem({ displayTempC: 40, sensors: { cpu_thermal: 95 } })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);

    const issue = report.issues.find((i) => i.kind === "temp");
    expect(issue!.severity).toBe("crit");
  });
});

describe("REQ-8 S8 — --strict promotes warning to critical", () => {
  it("promotes disk warn to crit under --strict", () => {
    const strictThresholds = resolveThresholds({ strict: true }, {});
    const systems = [healthySystem({ diskPct: 92 })];
    const report = evaluateHealth(systems, [], strictThresholds);

    // All issues should be crit after promotion
    for (const issue of report.issues) {
      expect(issue.severity).toBe("crit");
    }
  });

  it("exits 1 under --strict when only disk-warn triggered (no crits without --strict)", () => {
    const strictThresholds = resolveThresholds({ strict: true }, {});
    const systems = [healthySystem({ diskPct: 92 })];
    const report = evaluateHealth(systems, [], strictThresholds);
    expect(healthExitCode(report)).toBe(1);
  });

  it("promotes RAID sync warn to crit under --strict", () => {
    const strictThresholds = resolveThresholds({ strict: true }, {});
    const systems = [healthySystem()];
    const devices = [healthyRaid({ arrayState: "clean", syncAction: "resync" })];
    const report = evaluateHealth(systems, devices, strictThresholds);

    for (const issue of report.issues) {
      expect(issue.severity).toBe("crit");
    }
    expect(healthExitCode(report)).toBe(1);
  });
});

describe("REQ-8 S9 — custom threshold via flag", () => {
  it("reports warning when diskPct > custom diskWarn=85", () => {
    const customThresholds = resolveThresholds({ diskWarn: 85, diskCrit: 95 }, {});
    const systems = [healthySystem({ diskPct: 87 })];
    const report = evaluateHealth(systems, [], customThresholds);

    const issue = report.issues.find((i) => i.kind === "disk");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warn");
  });

  it("does NOT report a disk issue when diskPct = 87 with default threshold (90)", () => {
    const systems = [healthySystem({ diskPct: 87 })];
    const report = evaluateHealth(systems, [], DEFAULT_THRESHOLDS);

    const issue = report.issues.find((i) => i.kind === "disk");
    expect(issue).toBeUndefined();
    expect(report.healthy).toBe(true);
  });

  it("reports crit when diskPct exceeds custom diskCrit=88", () => {
    const customThresholds = resolveThresholds({ diskWarn: 80, diskCrit: 88 }, {});
    const systems = [healthySystem({ diskPct: 90 })];
    const report = evaluateHealth(systems, [], customThresholds);

    const issue = report.issues.find((i) => i.kind === "disk");
    expect(issue!.severity).toBe("crit");
  });
});

describe("beszel health — full pipeline (MSW)", () => {
  it("returns healthy:true for the clean fixture fleet", async () => {
    const client = await makeClient();

    const [systemsResult, disksResult, tempsResult] = await Promise.all([
      fetchSystems(client),
      fetchDisks(client),
      fetchTemps(client),
    ]);

    const sensorsBySystem = new Map<string, Record<string, number>>();
    for (const t of tempsResult.systems) {
      sensorsBySystem.set(t.system, t.sensors);
    }

    const healthSystems = systemsResult.systems.map((s) => ({
      name: s.name,
      status: s.status,
      diskPct: s.diskPct,
      displayTempC: s.tempC ?? null,
      sensors: sensorsBySystem.get(s.name) ?? {},
    }));

    const healthDevices = disksResult.devices.map((d) => ({
      system: d.system,
      kind: d.kind,
      state: "state" in d ? d.state : undefined,
      tempC: "tempC" in d ? d.tempC : undefined,
      arrayState: "arrayState" in d ? d.arrayState : undefined,
      syncAction: "syncAction" in d ? d.syncAction : undefined,
    }));

    const report = evaluateHealth(healthSystems, healthDevices, DEFAULT_THRESHOLDS);

    // The clean fixture has:
    // - All systems up
    // - All disks PASSED
    // - RAID clean+idle
    // - disk% well below 90
    // - temps below 80°C
    expect(report.healthy).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.checked).toBe(3);
    expect(healthExitCode(report)).toBe(0);
  });

  it("reports CRITICAL issues for degraded fixture fleet", async () => {
    server.use(
      http.get(`${BASE_URL}/api/collections/smart_devices/records`, () =>
        HttpResponse.json(smartDevicesDegradedFixture),
      ),
    );

    const client = await makeClient();

    const [systemsResult, disksResult, tempsResult] = await Promise.all([
      fetchSystems(client),
      fetchDisks(client),
      fetchTemps(client),
    ]);

    const sensorsBySystem = new Map<string, Record<string, number>>();
    for (const t of tempsResult.systems) {
      sensorsBySystem.set(t.system, t.sensors);
    }

    const healthSystems = systemsResult.systems.map((s) => ({
      name: s.name,
      status: s.status,
      diskPct: s.diskPct,
      displayTempC: s.tempC ?? null,
      sensors: sensorsBySystem.get(s.name) ?? {},
    }));

    const healthDevices = disksResult.devices.map((d) => ({
      system: d.system,
      kind: d.kind,
      state: "state" in d ? d.state : undefined,
      tempC: "tempC" in d ? d.tempC : undefined,
      arrayState: "arrayState" in d ? d.arrayState : undefined,
      syncAction: "syncAction" in d ? d.syncAction : undefined,
    }));

    const report = evaluateHealth(healthSystems, healthDevices, DEFAULT_THRESHOLDS);

    // Degraded fixture has: degraded RAID and FAILED disk
    expect(report.healthy).toBe(false);
    expect(report.issues.some((i) => i.severity === "crit")).toBe(true);
    expect(healthExitCode(report)).toBe(1);
  });
});
