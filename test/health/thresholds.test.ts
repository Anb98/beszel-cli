/**
 * thresholds.test.ts — Tests for src/health/thresholds.ts
 *
 * REQ-8 / design R2: threshold resolution precedence (flag > env > default)
 * and INVALID_THRESHOLD validation.
 */

import { describe, it, expect } from "vitest";
import { resolveThresholds } from "../../src/health/thresholds.js";
import { CliError } from "../../src/types/errors.js";

describe("resolveThresholds — defaults", () => {
  it("returns default diskWarn=90, diskCrit=95 when no flags or env", () => {
    const t = resolveThresholds({}, {});
    expect(t.diskWarn).toBe(90);
    expect(t.diskCrit).toBe(95);
  });

  it("returns default tempWarn=80, tempCrit=90", () => {
    const t = resolveThresholds({}, {});
    expect(t.tempWarn).toBe(80);
    expect(t.tempCrit).toBe(90);
  });

  it("returns default diskTempWarn=55, diskTempCrit=65", () => {
    const t = resolveThresholds({}, {});
    expect(t.diskTempWarn).toBe(55);
    expect(t.diskTempCrit).toBe(65);
  });

  it("strict defaults to false", () => {
    const t = resolveThresholds({}, {});
    expect(t.strict).toBe(false);
  });
});

describe("resolveThresholds — flag > env > default", () => {
  it("flag overrides env for diskWarn", () => {
    const t = resolveThresholds(
      { diskWarn: 75 },
      { BESZEL_DISK_WARN: "85" },
    );
    expect(t.diskWarn).toBe(75);
  });

  it("env overrides default for diskWarn", () => {
    const t = resolveThresholds({}, { BESZEL_DISK_WARN: "85" });
    expect(t.diskWarn).toBe(85);
  });

  it("flag overrides env for diskCrit", () => {
    const t = resolveThresholds(
      { diskCrit: 98 },
      { BESZEL_DISK_CRIT: "99" },
    );
    expect(t.diskCrit).toBe(98);
  });

  it("env overrides default for tempWarn", () => {
    const t = resolveThresholds({}, { BESZEL_TEMP_WARN: "70" });
    expect(t.tempWarn).toBe(70);
  });

  it("flag overrides env for tempCrit", () => {
    const t = resolveThresholds(
      { tempCrit: 85 },
      { BESZEL_TEMP_CRIT: "95" },
    );
    expect(t.tempCrit).toBe(85);
  });

  it("env overrides default for diskTempWarn", () => {
    const t = resolveThresholds({}, { BESZEL_DISK_TEMP_WARN: "50" });
    expect(t.diskTempWarn).toBe(50);
  });

  it("flag overrides env for diskTempCrit", () => {
    const t = resolveThresholds(
      { diskTempCrit: 60 },
      { BESZEL_DISK_TEMP_CRIT: "70" },
    );
    expect(t.diskTempCrit).toBe(60);
  });
});

describe("resolveThresholds — strict", () => {
  it("strict=true when flag is set", () => {
    const t = resolveThresholds({ strict: true }, {});
    expect(t.strict).toBe(true);
  });

  it("strict=true when BESZEL_STRICT=1", () => {
    const t = resolveThresholds({}, { BESZEL_STRICT: "1" });
    expect(t.strict).toBe(true);
  });

  it("strict=true when BESZEL_STRICT=true", () => {
    const t = resolveThresholds({}, { BESZEL_STRICT: "true" });
    expect(t.strict).toBe(true);
  });

  it("strict=false when BESZEL_STRICT=0", () => {
    const t = resolveThresholds({}, { BESZEL_STRICT: "0" });
    expect(t.strict).toBe(false);
  });

  it("flag wins over env: strict=true flag + no env → true", () => {
    const t = resolveThresholds({ strict: true }, { BESZEL_STRICT: "0" });
    expect(t.strict).toBe(true);
  });

  it("flag wins: strict=false flag + BESZEL_STRICT=1 → false", () => {
    const t = resolveThresholds({ strict: false }, { BESZEL_STRICT: "1" });
    expect(t.strict).toBe(false);
  });
});

describe("resolveThresholds — validation", () => {
  it("throws INVALID_THRESHOLD when diskCrit < diskWarn", () => {
    expect(() => resolveThresholds({ diskWarn: 95, diskCrit: 90 }, {})).toThrow(CliError);
    try {
      resolveThresholds({ diskWarn: 95, diskCrit: 90 }, {});
    } catch (err) {
      expect((err as CliError).code).toBe("INVALID_THRESHOLD");
      expect((err as CliError).exitCode).toBe(1);
    }
  });

  it("throws INVALID_THRESHOLD when tempCrit < tempWarn", () => {
    expect(() => resolveThresholds({ tempWarn: 90, tempCrit: 80 }, {})).toThrow(CliError);
  });

  it("throws INVALID_THRESHOLD when diskTempCrit < diskTempWarn", () => {
    expect(() =>
      resolveThresholds({ diskTempWarn: 70, diskTempCrit: 60 }, {}),
    ).toThrow(CliError);
  });

  it("accepts crit == warn (boundary: equal is valid)", () => {
    // Equal is valid per design: "crit >= warn"
    expect(() => resolveThresholds({ diskWarn: 90, diskCrit: 90 }, {})).not.toThrow();
  });

  it("accepts crit > warn (normal)", () => {
    expect(() => resolveThresholds({ diskWarn: 80, diskCrit: 95 }, {})).not.toThrow();
  });

  it("error message mentions the threshold name", () => {
    try {
      resolveThresholds({ tempWarn: 90, tempCrit: 80 }, {});
    } catch (err) {
      expect((err as CliError).message).toContain("temp-crit");
    }
  });
});
