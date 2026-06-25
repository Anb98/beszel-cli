import { describe, it, expect } from "vitest";
import {
  SystemRecordSchema,
  SystemStatsRecordSchema,
  ContainerRecordSchema,
  SmartDeviceRecordSchema,
  SystemDetailsRecordSchema,
} from "../../src/types/upstream.js";
import {
  mapSystem,
  mapSystemStats,
  mapContainer,
  mapSmartDevice,
  mapSystemDetailsInfo,
  mapTempInfo,
} from "../../src/mapping/key-map.js";

function parseOrThrow<T>(schema: { parse: (v: unknown) => T }, data: unknown): T {
  return schema.parse(data);
}

describe("SystemRecord schema resilience", () => {
  it("passes with extra unknown keys at top level", () => {
    const input = {
      id: "sys001",
      name: "Test System",
      status: "up",
      // extra unknown key
      unknownFutureField: "some_value",
      anotherNewField: 42,
    };

    expect(() => parseOrThrow(SystemRecordSchema, input)).not.toThrow();
    const result = parseOrThrow(SystemRecordSchema, input);
    expect(result.id).toBe("sys001");
    expect(result.name).toBe("Test System");
  });

  it("passes with extra unknown keys inside info object", () => {
    const input = {
      id: "sys002",
      name: "Test System 2",
      status: "up",
      info: {
        cpu: 15.5,
        mp: 60,
        dp: 45,
        u: 86400,
        v: "0.18.7",
        // unknown future fields in info
        newMetric: 999,
        futureSensorField: [1, 2, 3],
      },
    };

    expect(() => parseOrThrow(SystemRecordSchema, input)).not.toThrow();
    const result = parseOrThrow(SystemRecordSchema, input);
    expect(result.info?.cpu).toBe(15.5);
    expect(result.info?.mp).toBe(60);
  });

  it("maps correctly when all OPTIONAL fields are absent", () => {
    const input = {
      id: "sys003",
      name: "Minimal System",
      status: "down",
      // No info at all — all optional fields absent
    };

    const parsed = parseOrThrow(SystemRecordSchema, input);
    expect(() => mapSystem(parsed)).not.toThrow();

    const mapped = mapSystem(parsed);
    // Stable-mandatory fields → null when absent
    expect(mapped.id).toBe("sys003");
    expect(mapped.name).toBe("Minimal System");
    expect(mapped.status).toBe("down");
    expect(mapped.cpu).toBeNull();
    expect(mapped.memPct).toBeNull();
    expect(mapped.diskPct).toBeNull();
    expect(mapped.uptimeS).toBeNull();
    expect(mapped.agentVersion).toBeNull();
    expect(mapped.host).toBeNull();
    // Optional fields → omitted (not null)
    expect("tempC" in mapped).toBe(false);
    expect("containerCount" in mapped).toBe(false);
    expect("loadAvg" in mapped).toBe(false);
    expect("extraFs" in mapped).toBe(false);
  });

  it("maps correctly when ALL optional info fields are present", () => {
    const input = {
      id: "sys004",
      name: "Full System",
      host: "full.local",
      status: "up",
      info: {
        cpu: 8.3,
        mp: 62.4,
        dp: 45.1,
        u: 1209600,
        v: "0.18.7",
        dt: 52.0,
        la: [0.82, 0.74, 0.68],
        ct: 12,
        efs: { md127: 32.05, md5: 7.89 },
      },
    };

    const parsed = parseOrThrow(SystemRecordSchema, input);
    const mapped = mapSystem(parsed);

    expect(mapped.cpu).toBe(8.3);
    expect(mapped.memPct).toBe(62.4);
    expect(mapped.diskPct).toBe(45.1);
    expect(mapped.uptimeS).toBe(1209600);
    expect(mapped.agentVersion).toBe("0.18.7");
    expect(mapped.tempC).toBe(52.0);
    expect(mapped.loadAvg).toEqual([0.82, 0.74, 0.68]);
    expect(mapped.containerCount).toBe(12);
    expect(mapped.extraFs).toEqual({ md127: 32.05, md5: 7.89 });
  });
});

describe("SystemStatsRecord schema resilience", () => {
  it("passes with extra unknown fields in stats", () => {
    const input = {
      id: "stat001",
      system: "sys001",
      type: "1m",
      stats: {
        cpu: 10,
        mp: 50,
        // future fields
        newNetMetric: [1, 2, 3, 4],
        futureGpuField: 65.5,
      },
    };

    expect(() => parseOrThrow(SystemStatsRecordSchema, input)).not.toThrow();
    const result = parseOrThrow(SystemStatsRecordSchema, input);
    expect(result.stats?.cpu).toBe(10);
    expect(result.stats?.mp).toBe(50);
  });

  it("maps to null/empty when stats fields are absent", () => {
    const input = {
      id: "stat002",
      system: "sys002",
      type: "10m",
      // stats entirely absent
    };

    const parsed = parseOrThrow(SystemStatsRecordSchema, input);
    expect(() => mapSystemStats(parsed)).not.toThrow();

    const mapped = mapSystemStats(parsed);
    expect(mapped.cpu).toBeNull();
    expect(mapped.memPct).toBeNull();
    expect(mapped.diskPct).toBeNull();
    // sensors defaults to empty object (never null)
    expect(mapped.sensors).toEqual({});
    expect(mapped.net).toBeNull();
    expect(mapped.loadAvg).toBeNull();
  });

  it("produces correct sensor map from stats.t", () => {
    const input = {
      id: "stat003",
      system: "sys003",
      type: "1m",
      stats: {
        t: { cpu_thermal: 52, ddr_thermal: 40, gpu_thermal: 38 },
        cpu: 22.5,
        mp: 35,
      },
    };

    const parsed = parseOrThrow(SystemStatsRecordSchema, input);
    const mapped = mapSystemStats(parsed);

    expect(mapped.sensors).toEqual({ cpu_thermal: 52, ddr_thermal: 40, gpu_thermal: 38 });
    expect(mapped.cpu).toBe(22.5);
  });
});

describe("ContainerRecord schema resilience", () => {
  it("passes with extra unknown fields", () => {
    const input = {
      id: "con001",
      name: "nginx",
      status: "Up 2 days",
      health: 0,
      cpu: 0.4,
      memory: 48.2,
      image: "nginx:latest",
      system: "sys001",
      updated: 1750771200000,
      // future fields
      unknownMetric: "future_value",
      newContainerField: 42,
    };

    expect(() => parseOrThrow(ContainerRecordSchema, input)).not.toThrow();
    const result = parseOrThrow(ContainerRecordSchema, input);
    expect(result.name).toBe("nginx");
    expect(result.health).toBe(0);
  });

  it("maps correctly when optional fields are absent", () => {
    const input = {
      id: "con002",
      name: "minimal-container",
      // All optional fields absent: status, health, cpu, memory, image, ports, system
    };

    const parsed = parseOrThrow(ContainerRecordSchema, input);
    expect(() => mapContainer(parsed, "TestSystem")).not.toThrow();

    const mapped = mapContainer(parsed, "TestSystem");
    expect(mapped.name).toBe("minimal-container");
    expect(mapped.system).toBe("TestSystem");
    expect(mapped.status).toBeNull();
    expect(mapped.health).toBeNull();
    expect(mapped.cpuPct).toBeNull();
    expect(mapped.memMB).toBeNull();
    expect(mapped.image).toBeNull();
    // Optional: ports not present → key omitted
    expect("ports" in mapped).toBe(false);
  });

  it("health field accepts numeric value (not string)", () => {
    const input = { id: "con003", name: "test", health: 1 };
    const parsed = parseOrThrow(ContainerRecordSchema, input);
    expect(parsed.health).toBe(1);
    const mapped = mapContainer(parsed, "sys");
    expect(mapped.health).toBe(1);
  });
});

describe("SmartDeviceRecord schema resilience", () => {
  it("passes with extra unknown fields on a disk record", () => {
    const input = {
      id: "disk001",
      name: "/dev/sda",
      type: "sat",
      state: "PASSED",
      temp: 38,
      capacity: 500107862016,
      // future fields
      unknownSmartField: "future_value",
      predictiveFailureCount: 0,
    };

    expect(() => parseOrThrow(SmartDeviceRecordSchema, input)).not.toThrow();
    const result = parseOrThrow(SmartDeviceRecordSchema, input);
    expect(result.name).toBe("/dev/sda");
    expect(result.temp).toBe(38);
  });

  it("maps disk record correctly when optional fields are absent", () => {
    const input = {
      id: "disk002",
      name: "/dev/nvme0n1",
      type: "nvme",
      // state, temp, capacity, serial, firmware, hours, cycles all absent
    };

    const parsed = parseOrThrow(SmartDeviceRecordSchema, input);
    expect(() => mapSmartDevice(parsed, "TestSystem")).not.toThrow();

    const mapped = mapSmartDevice(parsed, "TestSystem");
    expect(mapped.kind).toBe("disk");
    if (mapped.kind === "disk") {
      expect(mapped.state).toBeNull();
      expect(mapped.tempC).toBeNull();
      expect(mapped.capacityBytes).toBeNull();
      expect(mapped.model).toBeNull();
      expect("serial" in mapped).toBe(false);
      expect("firmware" in mapped).toBe(false);
      expect("hours" in mapped).toBe(false);
      expect("cycles" in mapped).toBe(false);
    }
  });

  it("maps RAID record correctly when attributes array has extra unknown n-values", () => {
    const input = {
      id: "raid001",
      name: "/dev/md5",
      type: "mdraid",
      state: "PASSED",
      attributes: [
        { n: "ArrayState", rs: "clean" },
        { n: "RaidLevel", rs: "raid5" },
        { n: "RaidDisks", rv: 4 },
        { n: "SyncAction", rs: "idle" },
        // Unknown future attributes
        { n: "FutureAttribute", rs: "some_value" },
        { n: "SyncCompleted" },
        { n: "SyncSpeed" },
        // Extra keys on attribute objects
        { n: "AnotherAttr", rs: "val", extraField: 99 },
      ],
    };

    const parsed = parseOrThrow(SmartDeviceRecordSchema, input);
    expect(() => mapSmartDevice(parsed, "TestSystem")).not.toThrow();

    const mapped = mapSmartDevice(parsed, "TestSystem");
    expect(mapped.kind).toBe("raid");
    if (mapped.kind === "raid") {
      expect(mapped.arrayState).toBe("clean");
      expect(mapped.raidLevel).toBe("raid5");
      expect(mapped.raidDisks).toBe(4);
      expect(mapped.syncAction).toBe("idle");
    }
  });

  it("maps RAID record with all RAID attributes absent (returns null fields)", () => {
    const input = {
      id: "raid002",
      name: "/dev/md0",
      type: "mdraid",
      // attributes absent entirely
    };

    const parsed = parseOrThrow(SmartDeviceRecordSchema, input);
    expect(() => mapSmartDevice(parsed, "TestSystem")).not.toThrow();

    const mapped = mapSmartDevice(parsed, "TestSystem");
    expect(mapped.kind).toBe("raid");
    if (mapped.kind === "raid") {
      expect(mapped.arrayState).toBeNull();
      expect(mapped.raidLevel).toBeNull();
      expect(mapped.raidDisks).toBeNull();
      expect(mapped.syncAction).toBeNull();
    }
  });
});

describe("SystemDetailsRecord schema resilience", () => {
  it("passes with extra unknown fields", () => {
    const input = {
      id: "detail001",
      hostname: "homelab",
      os_name: "Alpine Linux",
      kernel: "6.1.0",
      cpu: "Intel Core i5",
      arch: "x86_64",
      cores: 4,
      threads: 8,
      memory: 8589934592,
      podman: false,
      // future fields
      gpuModel: "NVIDIA RTX 3060",
      biosVersion: "3.2",
    };

    expect(() => parseOrThrow(SystemDetailsRecordSchema, input)).not.toThrow();
    const result = parseOrThrow(SystemDetailsRecordSchema, input);
    expect(result.hostname).toBe("homelab");
  });

  it("maps correctly when all fields are absent", () => {
    const input = { id: "detail002" };

    const parsed = parseOrThrow(SystemDetailsRecordSchema, input);
    expect(() => mapSystemDetailsInfo(parsed)).not.toThrow();

    const mapped = mapSystemDetailsInfo(parsed);
    expect(mapped.hostname).toBeNull();
    expect(mapped.os).toBeNull();
    expect(mapped.kernel).toBeNull();
    expect(mapped.cpuModel).toBeNull();
    expect(mapped.arch).toBeNull();
    expect(mapped.cores).toBeNull();
    expect(mapped.threads).toBeNull();
    expect(mapped.memoryBytes).toBeNull();
    expect("podman" in mapped).toBe(false);
  });
});

describe("mapTempInfo schema resilience", () => {
  it("returns empty sensors and null displayTempC when info and stats are absent", () => {
    const minimalSystem = parseOrThrow(SystemRecordSchema, {
      id: "sys001",
      name: "Minimal",
      status: "up",
      // No info, no stats
    });

    expect(() => mapTempInfo("Minimal", minimalSystem, null)).not.toThrow();
    const result = mapTempInfo("Minimal", minimalSystem, null);

    expect(result.system).toBe("Minimal");
    expect(result.displayTempC).toBeNull();
    expect(result.sensors).toEqual({});
  });

  it("merges disk temps from smart devices when --disks flag is used", () => {
    const system = parseOrThrow(SystemRecordSchema, {
      id: "sys002",
      name: "DiskSystem",
      status: "up",
      info: { dt: 45.0 },
    });

    const stats = parseOrThrow(SystemStatsRecordSchema, {
      id: "stat001",
      system: "sys002",
      type: "1m",
      stats: { t: { cpu_thermal: 40 } },
    });

    const diskRecord = parseOrThrow(SmartDeviceRecordSchema, {
      id: "smart001",
      name: "/dev/sda",
      type: "sat",
      temp: 38,
    });

    const result = mapTempInfo("DiskSystem", system, stats, [diskRecord]);

    expect(result.displayTempC).toBe(45.0);
    expect(result.sensors["cpu_thermal"]).toBe(40);
    expect(result.sensors["sda_temp"]).toBe(38);
  });
});
