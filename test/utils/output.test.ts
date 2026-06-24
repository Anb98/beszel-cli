/**
 * output.test.ts — Tests for src/utils/output.ts
 *
 * REQ-2: dual-mode routing.
 * Tests do NOT import Ink. All coverage is pure Node.js.
 *
 * Covers:
 *   - resolveMode: --json forces JSON; piped (non-TTY) → JSON; CI env → JSON; TTY → tty
 *   - emit: JSON mode writes serialized JSON to stdout; sets exitCode
 *   - emit: TTY without renderer falls back to JSON (no crash)
 *   - emit: TTY with renderer calls renderer callback
 *   - emit: --no-color sets NO_COLOR env; correct exit codes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveMode, emit } from "../../src/utils/output.js";

// ---------------------------------------------------------------------------
// Helpers — capture process.stdout.write calls
// ---------------------------------------------------------------------------

function captureStdout(): { chunks: string[]; restore: () => void } {
  const chunks: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    });
  return {
    chunks,
    restore: () => spy.mockRestore(),
  };
}

// ---------------------------------------------------------------------------
// resolveMode
// ---------------------------------------------------------------------------

describe("resolveMode", () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalCI = process.env["CI"];
  const originalNO_COLOR = process.env["NO_COLOR"];

  afterEach(() => {
    // Restore TTY and env state after each test.
    Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
    if (originalCI === undefined) {
      delete process.env["CI"];
    } else {
      process.env["CI"] = originalCI;
    }
    if (originalNO_COLOR === undefined) {
      delete process.env["NO_COLOR"];
    } else {
      process.env["NO_COLOR"] = originalNO_COLOR;
    }
  });

  it("returns 'json' when opts.json is true (TTY present)", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    expect(resolveMode({ json: true })).toBe("json");
  });

  it("returns 'json' when stdout is not a TTY (piped)", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    expect(resolveMode({})).toBe("json");
  });

  it("returns 'json' when stdout.isTTY is undefined (piped)", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: undefined, configurable: true });
    expect(resolveMode({})).toBe("json");
  });

  it("returns 'json' when CI env var is set", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    delete process.env["CI"];
    process.env["CI"] = "true";
    expect(resolveMode({})).toBe("json");
  });

  it("returns 'tty' when TTY and no --json and no CI", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    delete process.env["CI"];
    expect(resolveMode({})).toBe("tty");
  });

  it("returns 'json' when opts.json overrides TTY even if tty=true and no CI", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    delete process.env["CI"];
    expect(resolveMode({ json: true })).toBe("json");
  });
});

// ---------------------------------------------------------------------------
// emit — JSON mode
// ---------------------------------------------------------------------------

describe("emit — JSON mode", () => {
  let captured: ReturnType<typeof captureStdout>;
  const originalExitCode = process.exitCode;
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    captured = captureStdout();
    process.exitCode = 0;
    // Ensure non-TTY so json mode is default (unless overridden in test)
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
  });

  afterEach(() => {
    captured.restore();
    process.exitCode = originalExitCode;
    Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
  });

  it("writes JSON to stdout when non-TTY (piped mode)", async () => {
    const data = { systems: [{ id: "1", name: "test" }] };
    await emit(data, {});
    expect(captured.chunks.join("")).toContain('"systems"');
    const parsed = JSON.parse(captured.chunks.join(""));
    expect(parsed).toEqual(data);
  });

  it("writes JSON to stdout when --json flag is set (even if TTY)", async () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const data = { healthy: true, issues: [], checked: 3 };
    await emit(data, { json: true });
    const parsed = JSON.parse(captured.chunks.join(""));
    expect(parsed).toEqual(data);
  });

  it("sets process.exitCode to 0 by default", async () => {
    await emit({ ok: true }, { json: true });
    expect(process.exitCode).toBe(0);
  });

  it("sets process.exitCode to provided exitCode", async () => {
    await emit({ healthy: false, issues: [{ severity: "crit" }], checked: 1 }, {
      json: true,
      exitCode: 1,
    });
    expect(process.exitCode).toBe(1);
  });

  it("output is valid JSON (parseable)", async () => {
    await emit({ systems: [] }, { json: true });
    expect(() => JSON.parse(captured.chunks.join(""))).not.toThrow();
  });

  it("does not include ANSI escape codes in JSON output", async () => {
    await emit({ name: "test" }, { json: true });
    const output = captured.chunks.join("");
    // ANSI escape sequences start with \x1b[
    expect(output).not.toMatch(/\x1b\[/);
  });
});

// ---------------------------------------------------------------------------
// emit — TTY mode without renderer (fallback to JSON)
// ---------------------------------------------------------------------------

describe("emit — TTY mode without renderer", () => {
  let captured: ReturnType<typeof captureStdout>;
  const originalExitCode = process.exitCode;
  const originalIsTTY = process.stdout.isTTY;
  const originalCI = process.env["CI"];
  const originalNO_COLOR = process.env["NO_COLOR"];

  beforeEach(() => {
    captured = captureStdout();
    process.exitCode = 0;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    delete process.env["CI"];
  });

  afterEach(() => {
    captured.restore();
    process.exitCode = originalExitCode;
    Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
    if (originalCI === undefined) delete process.env["CI"];
    else process.env["CI"] = originalCI;
    if (originalNO_COLOR === undefined) delete process.env["NO_COLOR"];
    else process.env["NO_COLOR"] = originalNO_COLOR;
  });

  it("falls back to JSON when no renderer is supplied (no crash)", async () => {
    const data = { systems: [{ name: "alpha" }] };
    await emit(data, {}); // no renderer — TTY fallback
    const parsed = JSON.parse(captured.chunks.join(""));
    expect(parsed).toEqual(data);
  });

  it("sets exitCode correctly in TTY fallback", async () => {
    await emit({ healthy: false, issues: [], checked: 0 }, { exitCode: 0 });
    expect(process.exitCode).toBe(0);
  });

  it("sets NO_COLOR env var when --no-color is passed in TTY mode", async () => {
    delete process.env["NO_COLOR"];
    await emit({ name: "test" }, { noColor: true });
    expect(process.env["NO_COLOR"]).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// emit — TTY mode with renderer
// ---------------------------------------------------------------------------

describe("emit — TTY mode with renderer", () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalCI = process.env["CI"];
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    delete process.env["CI"];
    process.exitCode = 0;
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
    if (originalCI === undefined) delete process.env["CI"];
    else process.env["CI"] = originalCI;
    process.exitCode = originalExitCode;
  });

  it("calls renderer callback with the data payload in TTY mode", async () => {
    const renderedData: unknown[] = [];
    const renderer = vi.fn(async (data: unknown) => {
      renderedData.push(data);
    });

    const data = { systems: [{ id: "abc", name: "Test" }] };
    await emit(data, { renderer });

    expect(renderer).toHaveBeenCalledOnce();
    expect(renderer).toHaveBeenCalledWith(data);
  });

  it("sets exitCode after renderer completes", async () => {
    const renderer = vi.fn(async () => {});
    await emit({ healthy: true, issues: [], checked: 2 }, { renderer, exitCode: 0 });
    expect(process.exitCode).toBe(0);
  });

  it("does NOT call renderer in JSON mode even when renderer is provided", async () => {
    const renderer = vi.fn(async () => {});
    const captured = captureStdout();
    try {
      await emit({ systems: [] }, { json: true, renderer });
      expect(renderer).not.toHaveBeenCalled();
    } finally {
      captured.restore();
    }
  });
});
