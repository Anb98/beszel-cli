import { describe, it, expect, vi, afterEach } from "vitest";
import { parseDuration, selectInterval, resolveSince, toPocketBaseDateTime } from "../../src/queries/since.js";
import { CliError } from "../../src/types/errors.js";

describe("parseDuration", () => {
  it("parses seconds: 90s → 90000ms", () => {
    expect(parseDuration("90s")).toBe(90_000);
  });

  it("parses minutes: 30m → 1800000ms", () => {
    expect(parseDuration("30m")).toBe(30 * 60 * 1000);
  });

  it("parses hours: 12h → 43200000ms", () => {
    expect(parseDuration("12h")).toBe(12 * 60 * 60 * 1000);
  });

  it("parses days: 2d → 172800000ms", () => {
    expect(parseDuration("2d")).toBe(2 * 24 * 60 * 60 * 1000);
  });

  it("trims whitespace from input", () => {
    expect(parseDuration("  5m  ")).toBe(5 * 60 * 1000);
  });

  it("throws INVALID_DURATION for empty string", () => {
    expect(() => parseDuration("")).toThrow(CliError);
    try {
      parseDuration("");
    } catch (err) {
      expect((err as CliError).code).toBe("INVALID_DURATION");
      expect((err as CliError).exitCode).toBe(1);
    }
  });

  it("throws INVALID_DURATION for 'abc'", () => {
    expect(() => parseDuration("abc")).toThrow(CliError);
    try {
      parseDuration("abc");
    } catch (err) {
      expect((err as CliError).code).toBe("INVALID_DURATION");
    }
  });

  it("throws INVALID_DURATION for unsupported unit 'w'", () => {
    expect(() => parseDuration("2w")).toThrow(CliError);
    try {
      parseDuration("2w");
    } catch (err) {
      expect((err as CliError).code).toBe("INVALID_DURATION");
    }
  });

  it("throws INVALID_DURATION for plain number with no unit", () => {
    expect(() => parseDuration("100")).toThrow(CliError);
  });
});

describe("selectInterval", () => {
  const MS = {
    min: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
  };

  it("window = 1h → bucket '1m' (≤1.5h)", () => {
    expect(selectInterval(1 * MS.hour)).toBe("1m");
  });

  it("window = 1.5h exactly → bucket '1m' (edge inclusive)", () => {
    expect(selectInterval(1.5 * MS.hour)).toBe("1m");
  });

  it("window = 2h → bucket '10m' (>1.5h, ≤12h)", () => {
    expect(selectInterval(2 * MS.hour)).toBe("10m");
  });

  it("window = 12h exactly → bucket '10m' (edge inclusive)", () => {
    expect(selectInterval(12 * MS.hour)).toBe("10m");
  });

  it("window = 13h → bucket '20m' (>12h, ≤24h)", () => {
    expect(selectInterval(13 * MS.hour)).toBe("20m");
  });

  it("window = 24h exactly → bucket '20m' (edge inclusive)", () => {
    expect(selectInterval(24 * MS.hour)).toBe("20m");
  });

  it("window = 2d → bucket '120m' (>24h, ≤7d)", () => {
    expect(selectInterval(2 * MS.day)).toBe("120m");
  });

  it("window = 7d exactly → bucket '120m' (edge inclusive)", () => {
    expect(selectInterval(7 * MS.day)).toBe("120m");
  });

  it("window = 8d → bucket '480m' (>7d, ≤30d)", () => {
    expect(selectInterval(8 * MS.day)).toBe("480m");
  });

  it("window = 30d exactly → bucket '480m' (edge inclusive)", () => {
    expect(selectInterval(30 * MS.day)).toBe("480m");
  });

  it("window = 31d (>30d) → clamps to '480m' and warns on stderr", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = selectInterval(31 * MS.day);
    expect(result).toBe("480m");
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("WARNING"));
    stderrSpy.mockRestore();
  });
});

describe("resolveSince", () => {
  const FIXED_NOW = new Date("2026-06-24T14:00:00.000Z");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("12h → interval 10m, correct from/to", () => {
    const result = resolveSince("12h", FIXED_NOW);
    expect(result.interval).toBe("10m");
    expect(result.to).toBe("2026-06-24T14:00:00.000Z");
    expect(result.from).toBe("2026-06-24T02:00:00.000Z");
  });

  it("24h → interval 20m", () => {
    const result = resolveSince("24h", FIXED_NOW);
    expect(result.interval).toBe("20m");
    expect(result.to).toBe("2026-06-24T14:00:00.000Z");
    expect(result.from).toBe("2026-06-23T14:00:00.000Z");
  });

  it("30m → interval 1m", () => {
    const result = resolveSince("30m", FIXED_NOW);
    expect(result.interval).toBe("1m");
  });

  it("2d → interval 120m", () => {
    const result = resolveSince("2d", FIXED_NOW);
    expect(result.interval).toBe("120m");
  });

  it("45d → interval 480m + stderr warning", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const result = resolveSince("45d", FIXED_NOW);
    expect(result.interval).toBe("480m");
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("WARNING"));
    stderrSpy.mockRestore();
  });

  it("throws INVALID_DURATION for 'abc'", () => {
    expect(() => resolveSince("abc", FIXED_NOW)).toThrow(CliError);
    try {
      resolveSince("abc", FIXED_NOW);
    } catch (err) {
      expect((err as CliError).code).toBe("INVALID_DURATION");
      expect((err as CliError).exitCode).toBe(1);
    }
  });

  it("from and to are valid ISO strings", () => {
    const result = resolveSince("1h", FIXED_NOW);
    expect(() => new Date(result.from)).not.toThrow();
    expect(() => new Date(result.to)).not.toThrow();
    expect(new Date(result.from).toISOString()).toBe(result.from);
    expect(new Date(result.to).toISOString()).toBe(result.to);
  });
});

// ---------------------------------------------------------------------------
// toPocketBaseDateTime — regression test
// PocketBase datetime filter requires space separator, not ISO "T".
// PROVEN via live smoke test 2026-06-24: T-format → 0 rows; space → 37 rows.
// ---------------------------------------------------------------------------

describe("toPocketBaseDateTime", () => {
  it("replaces T separator with a space, keeping millis and Z", () => {
    expect(toPocketBaseDateTime("2026-06-24T17:00:00.000Z"))
      .toBe("2026-06-24 17:00:00.000Z");
  });

  it("does not produce a T character in the output", () => {
    const result = toPocketBaseDateTime("2026-06-24T17:00:00.000Z");
    expect(result).not.toContain("T");
  });

  it("preserves the trailing Z", () => {
    const result = toPocketBaseDateTime("2026-06-24T17:00:00.000Z");
    expect(result.endsWith("Z")).toBe(true);
  });

  it("preserves milliseconds", () => {
    expect(toPocketBaseDateTime("2026-01-01T00:00:00.123Z"))
      .toBe("2026-01-01 00:00:00.123Z");
  });

  it("midnight boundary: 2026-06-24T00:00:00.000Z → 2026-06-24 00:00:00.000Z", () => {
    expect(toPocketBaseDateTime("2026-06-24T00:00:00.000Z"))
      .toBe("2026-06-24 00:00:00.000Z");
  });
});
