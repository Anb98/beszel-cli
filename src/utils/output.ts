/**
 * utils/output.ts — Dual-mode output router.
 *
 * REQ-2: The CLI MUST emit exactly one JSON object to STDOUT when:
 *   - --json flag is set, OR
 *   - process.stdout.isTTY is false (piped/non-TTY), OR
 *   - process.env.CI is set (CI environment).
 *
 * In JSON/agent mode: STDOUT gets JSON; no ANSI, no spinners.
 * In TTY/human mode: calls the renderer callback loaded via dynamic import.
 *   Ink is NEVER imported statically — only via `await import()` inside the
 *   TTY branch, preserving the Ink-free agent path (REQ-2 boundary).
 *
 * Design (R5): exit code 0 on success; caller provides exitCode for health
 * commands (warnings = 0, crits = 1). handleError() in utils/errors.ts owns
 * the non-zero exit path for thrown CliErrors.
 */

import { serializeJson } from "../renderers/json.js";

/**
 * A render callback invoked in TTY mode. Loaded dynamically so the import
 * never reaches the agent path.
 */
export type RenderCallback<T> = (data: T) => Promise<void> | void;

export type EmitOptions<T> = {
  /** --json flag: force JSON mode regardless of TTY state. */
  json?: boolean;
  /** --no-color: suppress ANSI escape codes in TTY mode. */
  noColor?: boolean;
  /**
   * Process exit code to set after emitting (default: 0).
   * Health commands pass 1 when CRITICAL issues exist.
   */
  exitCode?: number;
  /**
   * Optional Ink render callback for TTY mode. Loaded via dynamic import only.
   * When absent, TTY mode falls back to pretty-printed JSON.
   */
  renderer?: RenderCallback<T>;
};

/**
 * Determine output mode.
 *
 * JSON/agent mode is active when ANY of the following is true:
 *   - flags.json is truthy
 *   - process.stdout.isTTY is false/undefined (piped output)
 *   - process.env.CI is set (non-empty string)
 */
export function resolveMode(opts: { json?: boolean; noColor?: boolean }): "json" | "tty" {
  if (opts.json) return "json";
  if (!process.stdout.isTTY) return "json";
  if (process.env["CI"]) return "json";
  return "tty";
}

/**
 * Emit `data` to stdout according to the resolved output mode.
 *
 * JSON mode  → serializeJson(data) → process.stdout.write → process.exitCode
 * TTY mode   → renderer(data) if provided; else fall back to JSON (no Ink)
 */
export async function emit<T>(data: T, opts: EmitOptions<T> = {}): Promise<void> {
  const mode = resolveMode({ json: opts.json, noColor: opts.noColor });
  const exitCode = opts.exitCode ?? 0;

  if (mode === "json") {
    process.stdout.write(serializeJson(data));
    process.exitCode = exitCode;
    return;
  }

  if (opts.noColor) {
    // Ink and Chalk both respect NO_COLOR (https://no-color.org/).
    process.env["NO_COLOR"] = "1";
  }

  if (opts.renderer) {
    await opts.renderer(data);
    process.exitCode = exitCode;
    return;
  }

  process.stdout.write(serializeJson(data));
  process.exitCode = exitCode;
}
