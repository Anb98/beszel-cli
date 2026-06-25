import { describe, it, expect } from "vitest";
import {
  mapSystem,
  mapSystemDetail,
  mapSystemDetailsInfo,
  mapContainer,
  mapSystemStats,
  mapContainerStatsItem,
  mapSmartDevice,
  mapTempInfo,
} from "../../src/mapping/key-map.js";

import {
  SystemRecordSchema,
  SystemStatsRecordSchema,
  ContainerStatsRecordSchema,
  ContainerRecordSchema,
  SmartDeviceRecordSchema,
  SystemDetailsRecordSchema,
  SystemdServiceRecordSchema,
} from "../../src/types/upstream.js";

import systemsFixture from "../fixtures/systems.json" with { type: "json" };
import systemStatsFixture from "../fixtures/system_stats.json" with { type: "json" };
import containerStatsFixture from "../fixtures/container_stats.json" with { type: "json" };
import containersFixture from "../fixtures/containers.json" with { type: "json" };
import smartDevicesFixture from "../fixtures/smart_devices.json" with { type: "json" };
import smartDevicesDegradedFixture from "../fixtures/smart_devices_degraded.json" with { type: "json" };
import systemDetailsFixture from "../fixtures/system_details.json" with { type: "json" };
import emptySysServicesFixture from "../fixtures/empty_systemd_services.json" with { type: "json" };

describe("REQ-10: Zod schema resilience — unknown key passthrough", () => {
  it("SystemRecordSchema parses a record with extra unknown upstream fields", () => {
    const withUnknown = {
      ...systemsFixture.items[0],
      totally_new_undocumented_field: "some-future-value",
      another_field: 42,
    };

    const result = SystemRecordSchema.safeParse(withUnknown);
    expect(result.success).toBe(true);
    if (result.success) {
      // The extra keys are present in parsed data (looseObject keeps them)
      expect(
        (result.data as Record<string, unknown>)
          .totally_new_undocumented_field
      ).toBe("some-future-value");
    }
  });

  it("SystemStatsRecordSchema parses stats with extra unknown keys", () => {
    const withUnknown = {
      ...systemStatsFixture.items[0],
      future_metric: { nested: true },
    };
    const result = SystemStatsRecordSchema.safeParse(withUnknown);
    expect(result.success).toBe(true);
  });

  it("SystemRecordSchema parses a record missing optional info fields without error", () => {
    const minimal = {
      id: "minid001",
      name: "Minimal Host",
      status: "up",
    };
    const result = SystemRecordSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("SystemStatsRecordSchema.stats parses with extra sensor keys in t map", () => {
    const extendedStats = {
      ...systemStatsFixture.items[0],
      stats: {
        ...systemStatsFixture.items[0].stats,
        brand_new_future_key: "ignored",
      },
    };
    const result = SystemStatsRecordSchema.safeParse(extendedStats);
    expect(result.success).toBe(true);
  });

  it("SmartDeviceRecordSchema parses a disk record with extra attributes", () => {
    const withExtra = {
      ...smartDevicesFixture.items[1],
      extra_smart_attribute: "power_loss_count",
    };
    const result = SmartDeviceRecordSchema.safeParse(withExtra);
    expect(result.success).toBe(true);
  });

  it("SystemdServiceRecordSchema handles empty list gracefully", () => {
    // Empty list = totalItems 0; schema must parse 0 items without error
    expect(emptySysServicesFixture.totalItems).toBe(0);
    expect(emptySysServicesFixture.items).toHaveLength(0);
  });
});

describe("mapSystem — round-trip mapping", () => {
  const homeLabRaw = systemsFixture.items[0];
  const parsedHomeLab = SystemRecordSchema.parse(homeLabRaw);

  it("maps stable-mandatory fields correctly", () => {
    const result = mapSystem(parsedHomeLab);
    expect(result.id).toBe("sys001homela");
    expect(result.name).toBe("Home Lab");
    expect(result.status).toBe("up");
    expect(result.cpu).toBe(8.3);        // info.cpu
    expect(result.memPct).toBe(62.4);    // info.mp
    expect(result.diskPct).toBe(45.1);   // info.dp
    expect(result.uptimeS).toBe(1209600); // info.u
    expect(result.agentVersion).toBe("0.18.7"); // info.v
  });

  it("maps optional fields present in snapshot", () => {
    const result = mapSystem(parsedHomeLab);
    expect(result.tempC).toBe(52.0);       // info.dt
    expect(result.containerCount).toBe(12); // info.ct
    expect(result.loadAvg).toEqual([0.82, 0.74, 0.68]); // info.la
    expect(result.extraFs).toEqual({ md127: 32.05, md5: 7.89 }); // info.efs
  });

  it("stable-mandatory fields are null when info is absent", () => {
    const noInfo = SystemRecordSchema.parse({
      id: "noid",
      name: "No Info",
      status: "down",
    });
    const result = mapSystem(noInfo);
    expect(result.cpu).toBeNull();
    expect(result.memPct).toBeNull();
    expect(result.diskPct).toBeNull();
    expect(result.uptimeS).toBeNull();
    expect(result.agentVersion).toBeNull();
  });

  it("optional fields are omitted when absent in snapshot", () => {
    // Zima blade fixture has no dt, la, ct, efs
    const zimaBlade = SystemRecordSchema.parse(systemsFixture.items[2]);
    const result = mapSystem(zimaBlade);
    expect("tempC" in result).toBe(false);
    expect("containerCount" in result).toBe(false);
    expect("loadAvg" in result).toBe(false);
    expect("extraFs" in result).toBe(false);
  });

  it("output does NOT include raw abbreviated keys", () => {
    const result = mapSystem(parsedHomeLab) as Record<string, unknown>;
    // Abbreviated keys must not leak into output
    expect("mp" in result).toBe(false);
    expect("dp" in result).toBe(false);
    expect("dt" in result).toBe(false);
    expect("u" in result).toBe(false);
    expect("la" in result).toBe(false);
    expect("ct" in result).toBe(false);
    expect("efs" in result).toBe(false);
  });
});

describe("mapSystemDetailsInfo — round-trip", () => {
  const raw = systemDetailsFixture.items[0];
  const parsed = SystemDetailsRecordSchema.parse(raw);

  it("maps all hardware detail fields correctly", () => {
    const result = mapSystemDetailsInfo(parsed);
    expect(result.hostname).toBe("homelab");
    expect(result.os).toBe("Debian GNU/Linux 12 (bookworm)");
    expect(result.kernel).toBe("6.1.0-22-amd64");
    expect(result.cpuModel).toBe("Intel(R) Core(TM) i5-8400 CPU @ 2.80GHz");
    expect(result.arch).toBe("x86_64");
    expect(result.cores).toBe(6);
    expect(result.threads).toBe(6);
    expect(result.memoryBytes).toBe(34359738368);
    expect(result.podman).toBe(false);
  });
});

describe("mapContainer — round-trip", () => {
  const raw = containersFixture.items[0]; // nginx
  const parsed = ContainerRecordSchema.parse(raw);

  it("maps container fields with system name provided", () => {
    const result = mapContainer(parsed, "Home Lab");
    expect(result.name).toBe("nginx");
    expect(result.system).toBe("Home Lab");
    expect(result.status).toBe("Up 2 days");
    // health is a NUMBER in real Beszel API (e.g. 0), not a string.
    // Fixture was updated 2026-06-24 to use numeric health values.
    expect(result.health).toBe(0);
    expect(result.cpuPct).toBe(0.4);
    expect(result.memMB).toBe(48.2);
    expect(result.image).toBe("nginx:latest");
    expect(result.ports).toBe("80/tcp, 443/tcp");
  });

  it("optional ports omitted when not present", () => {
    const noPort = ContainerRecordSchema.parse({
      id: "cnid001",
      name: "myapp",
      status: "Up 1 hour",
    });
    const result = mapContainer(noPort, "Test System");
    expect("ports" in result).toBe(false);
  });
});

describe("mapSystemStats — round-trip", () => {
  const raw = systemStatsFixture.items[0];
  const parsed = SystemStatsRecordSchema.parse(raw);

  it("maps all abbreviated stats keys to canonical names", () => {
    const result = mapSystemStats(parsed);
    expect(result.cpu).toBe(8.3);          // stats.cpu
    expect(result.memTotalGB).toBe(31.9);  // stats.m
    expect(result.memUsedGB).toBe(19.9);   // stats.mu
    expect(result.memPct).toBe(62.4);      // stats.mp
    expect(result.memBufCacheGB).toBe(4.1); // stats.mb
    expect(result.diskTotalGB).toBe(1863.0); // stats.d
    expect(result.diskUsedGB).toBe(840.3);  // stats.du
    expect(result.diskPct).toBe(45.1);     // stats.dp
    expect(result.diskWrite).toBe(0.02);   // stats.dw
    expect(result.swap).toBe(0.0);         // stats.s
    expect(result.net).toEqual([1024000, 512000]); // stats.b
    expect(result.loadAvg).toEqual([0.82, 0.74, 0.68]); // stats.la
  });

  it("maps sensors as a MAP (not array) from stats.t", () => {
    const result = mapSystemStats(parsed);
    expect(result.sensors).toEqual({
      cpu_thermal: 52,
      ddr_thermal: 40,
      gpu_thermal: 38,
      ve_thermal: 41,
    });
    expect(Array.isArray(result.sensors)).toBe(false);
    expect(typeof result.sensors).toBe("object");
  });

  it("returns empty sensors object when t is absent", () => {
    const noSensors = SystemStatsRecordSchema.parse({
      id: "s2",
      system: "sys001",
      type: "1m",
      stats: { cpu: 5.0 },
    });
    const result = mapSystemStats(noSensors);
    expect(result.sensors).toEqual({});
  });

  it("returns nulls for all fields when stats is absent", () => {
    const noStats = SystemStatsRecordSchema.parse({
      id: "s3",
      system: "sys001",
      type: "1m",
    });
    const result = mapSystemStats(noStats);
    expect(result.cpu).toBeNull();
    expect(result.memTotalGB).toBeNull();
    expect(result.sensors).toEqual({});
  });
});

describe("mapContainerStatsItem — round-trip", () => {
  it("maps abbreviated container stats keys n/c/m/b to canonical names", () => {
    const rawItem = containerStatsFixture.items[0].stats[0]; // nginx
    const result = mapContainerStatsItem(rawItem);
    expect(result.name).toBe("nginx");  // n
    expect(result.cpuPct).toBe(0.4);   // c
    expect(result.memMB).toBe(48.2);   // m
    expect(result.net).toEqual([204800, 102400]); // b
  });

  it("returns nulls for absent fields", () => {
    const empty = {};
    const result = mapContainerStatsItem(empty);
    expect(result.name).toBeNull();
    expect(result.cpuPct).toBeNull();
    expect(result.memMB).toBeNull();
    expect(result.net).toBeNull();
  });
});

describe("mapSmartDevice — physical disk", () => {
  const rawSda = smartDevicesFixture.items[1]; // /dev/sda
  const parsed = SmartDeviceRecordSchema.parse(rawSda);

  it("maps a SAT disk to DiskInfo with kind:disk", () => {
    const result = mapSmartDevice(parsed, "Home Lab");
    expect(result.kind).toBe("disk");
    if (result.kind === "disk") {
      expect(result.name).toBe("/dev/sda");
      expect(result.system).toBe("Home Lab");
      expect(result.state).toBe("PASSED");
      expect(result.model).toBe("Samsung SSD 870 EVO");
      expect(result.tempC).toBe(32);        // smart_devices.temp
      expect(result.capacityBytes).toBe(2000398934016); // smart_devices.capacity
      expect(result.type).toBe("sat");
      expect(result.serial).toBe("S5GGNF0M123456");
      expect(result.firmware).toBe("SVT01B6Q");
      expect(result.hours).toBe(12480);
      expect(result.cycles).toBe(312);
    }
  });

  it("maps an NVMe disk correctly", () => {
    const rawNvme = SmartDeviceRecordSchema.parse(smartDevicesFixture.items[2]);
    const result = mapSmartDevice(rawNvme, "Home Lab");
    expect(result.kind).toBe("disk");
    if (result.kind === "disk") {
      expect(result.type).toBe("nvme");
      expect(result.tempC).toBe(38);
    }
  });
});

describe("mapSmartDevice — mdraid array", () => {
  it("maps a clean mdraid array to RaidInfo with kind:raid", () => {
    const rawMd5 = SmartDeviceRecordSchema.parse(smartDevicesFixture.items[0]);
    const result = mapSmartDevice(rawMd5, "Home Lab");
    expect(result.kind).toBe("raid");
    if (result.kind === "raid") {
      expect(result.name).toBe("/dev/md5");
      expect(result.system).toBe("Home Lab");
      expect(result.state).toBe("PASSED");
      expect(result.raidLevel).toBe("raid5");
      expect(result.arrayState).toBe("clean");
      expect(result.raidDisks).toBe(4);
      expect(result.syncAction).toBe("idle");
    }
  });

  it("maps a degraded mdraid array with recover syncAction", () => {
    const rawDegraded = SmartDeviceRecordSchema.parse(
      smartDevicesDegradedFixture.items[0]
    );
    const result = mapSmartDevice(rawDegraded, "Home Lab");
    expect(result.kind).toBe("raid");
    if (result.kind === "raid") {
      expect(result.arrayState).toBe("degraded");
      expect(result.syncAction).toBe("recover");
      expect(result.raidLevel).toBe("raid5");
      expect(result.raidDisks).toBe(4);
    }
  });

  it("RAID items do NOT include tempC (kind:raid has no tempC field)", () => {
    const rawMd5 = SmartDeviceRecordSchema.parse(smartDevicesFixture.items[0]);
    const result = mapSmartDevice(rawMd5, "Home Lab");
    expect(result.kind).toBe("raid");
    expect("tempC" in result).toBe(false);
  });
});

describe("mapTempInfo — temperature mapping", () => {
  const homeLabSystem = SystemRecordSchema.parse(systemsFixture.items[0]);
  const statsRecord = SystemStatsRecordSchema.parse(systemStatsFixture.items[0]);

  it("maps displayTempC from info.dt and sensors from stats.t", () => {
    const result = mapTempInfo("Home Lab", homeLabSystem, statsRecord);
    expect(result.system).toBe("Home Lab");
    expect(result.displayTempC).toBe(52.0); // info.dt
    expect(result.sensors).toEqual({
      cpu_thermal: 52,
      ddr_thermal: 40,
      gpu_thermal: 38,
      ve_thermal: 41,
    }); // stats.t
  });

  it("merges disk temps under {deviceBase}_temp when diskRecords provided", () => {
    const disks = smartDevicesFixture.items
      .map((d) => SmartDeviceRecordSchema.parse(d))
      .filter((d) => d.type !== "mdraid"); // only physical disks

    const result = mapTempInfo("Home Lab", homeLabSystem, statsRecord, disks);
    expect(result.sensors["sda_temp"]).toBe(32);       // /dev/sda → 32°C
    expect(result.sensors["nvme0n1_temp"]).toBe(38);    // /dev/nvme0n1 → 38°C
    // RAID arrays must NOT add temp (no temp field on mdraid)
    expect("md5_temp" in result.sensors).toBe(false);
  });

  it("returns empty sensors when no stats record", () => {
    const result = mapTempInfo("Home Lab", homeLabSystem, null);
    expect(result.sensors).toEqual({});
    expect(result.displayTempC).toBe(52.0); // still from info.dt
  });

  it("returns null displayTempC when info.dt absent", () => {
    const zimaBlade = SystemRecordSchema.parse(systemsFixture.items[2]);
    const result = mapTempInfo("Zima blade", zimaBlade, null);
    expect(result.displayTempC).toBeNull();
    expect(result.sensors).toEqual({});
  });
});

describe("Fixture schema validation — real shapes parse without error", () => {
  it("systems.json items all parse through SystemRecordSchema", () => {
    for (const item of systemsFixture.items) {
      const result = SystemRecordSchema.safeParse(item);
      expect(result.success).toBe(true);
    }
  });

  it("system_stats.json items parse through SystemStatsRecordSchema", () => {
    for (const item of systemStatsFixture.items) {
      const result = SystemStatsRecordSchema.safeParse(item);
      expect(result.success).toBe(true);
    }
  });

  it("container_stats.json items parse through ContainerStatsRecordSchema", () => {
    for (const item of containerStatsFixture.items) {
      const result = ContainerStatsRecordSchema.safeParse(item);
      expect(result.success).toBe(true);
    }
  });

  it("containers.json items parse through ContainerRecordSchema", () => {
    for (const item of containersFixture.items) {
      const result = ContainerRecordSchema.safeParse(item);
      expect(result.success).toBe(true);
    }
  });

  it("smart_devices.json items parse through SmartDeviceRecordSchema", () => {
    for (const item of smartDevicesFixture.items) {
      const result = SmartDeviceRecordSchema.safeParse(item);
      expect(result.success).toBe(true);
    }
  });

  it("smart_devices_degraded.json items parse through SmartDeviceRecordSchema", () => {
    for (const item of smartDevicesDegradedFixture.items) {
      const result = SmartDeviceRecordSchema.safeParse(item);
      expect(result.success).toBe(true);
    }
  });

  it("system_details.json items parse through SystemDetailsRecordSchema", () => {
    for (const item of systemDetailsFixture.items) {
      const result = SystemDetailsRecordSchema.safeParse(item);
      expect(result.success).toBe(true);
    }
  });

  it("empty_systemd_services.json has 0 items and parses as empty list", () => {
    expect(emptySysServicesFixture.totalItems).toBe(0);
    expect(emptySysServicesFixture.items).toHaveLength(0);
    for (const item of emptySysServicesFixture.items) {
      const result = SystemdServiceRecordSchema.safeParse(item);
      expect(result.success).toBe(true);
    }
  });
});
