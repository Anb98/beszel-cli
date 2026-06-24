/**
 * utils/output.ts — Dual-mode output router.
 *
 * REQ-2: The CLI MUST emit exactly one JSON object to STDOUT when:
 *   - --json flag is set, OR
 *   - process.stdout.isTTY is false (piped/non-TTY), OR
 *   - process.env.CI is set (CI environment).
 *
 * In JSON/agent mode:
 *   - STDOUT: JSON.stringify(data, null, 2) + newline. No ANSI, no spinners.
 *   - Sets process.exitCode; does NOT call process.exit().
 *
 * In TTY/human mode:
 *   - Calls an optional Ink render callback (RenderCallback) via DYNAMIC import.
 *   - Ink is NEVER imported statically — only via `await import()` inside the
 *     TTY branch, so the agent path never loads React/Ink (REQ-2 boundary).
 *   - When no renderer is supplied (Phase 7 not yet wired), falls back to the
 *     same pretty-printed JSON output (no Ink import, no crash).
 *   - --no-color suppresses ANSI (sets NO_COLOR env var; Ink respects it).
 *
 * Design (R5): exit code 0 on success; caller provides exitCode for health
 * commands (warnings = 0, crits = 1). handleError() in utils/errors.ts owns
 * the non-zero exit path for thrown CliErrors.
 *
 * IMPORTANT: Ink renderers do NOT exist yet (Phase 7). The TTY path is
 * designed to be pluggable — pass a RenderCallback and it will be invoked
 * dynamically. Until then, TTY falls back to pretty JSON.
 */

import { serializeJson } from "../renderers/json.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A render callback invoked in TTY mode. The callback receives the data
 * payload and must render it to stdout (typically by mounting an Ink component
 * via `ink.render()`). It is loaded dynamically so the import never reaches
 * the agent path.
 *
 * Returns a Promise that resolves when rendering is complete.
 */
export type RenderCallback<T> = (data: T) => Promise<void> | void;

export interface EmitOptions<T> {
  /**
   * --json flag: force JSON mode regardless of TTY state.
   */
  json?: boolean;
  /**
   * --no-color: suppress ANSI escape codes in TTY mode.
   */
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
}

// ---------------------------------------------------------------------------
// resolveMode — determine JSON vs TTY
// ---------------------------------------------------------------------------

/**
 * Determine output mode.
 *
 * JSON/agent mode is active when ANY of the following is true:
 *   - flags.json is truthy
 *   - process.stdout.isTTY is false/undefined (piped output)
 *   - process.env.CI is set (non-empty string)
 *
 * @returns "json" or "tty"
 */
export function resolveMode(opts: { json?: boolean; noColor?: boolean }): "json" | "tty" {
  if (opts.json) return "json";
  if (!process.stdout.isTTY) return "json";
  if (process.env["CI"]) return "json";
  return "tty";
}

// ---------------------------------------------------------------------------
// emit — public API
// ---------------------------------------------------------------------------

/**
 * Emit `data` to stdout according to the resolved output mode.
 *
 * JSON mode  → serializeJson(data) → process.stdout.write → process.exitCode
 * TTY mode   → renderer(data) if provided; else fall back to JSON (no Ink)
 *
 * @param data    - The payload to emit (must be JSON-serializable).
 * @param opts    - EmitOptions controlling mode, color, exit code, renderer.
 */
export async function emit<T>(data: T, opts: EmitOptions<T> = {}): Promise<void> {
  const mode = resolveMode({ json: opts.json, noColor: opts.noColor });
  const exitCode = opts.exitCode ?? 0;

  if (mode === "json") {
    // Agent / pipe path — pure JSON, no ANSI, no Ink.
    process.stdout.write(serializeJson(data));
    process.exitCode = exitCode;
    return;
  }

  // TTY / human path.
  if (opts.noColor) {
    // Ink and Chalk both respect NO_COLOR (https://no-color.org/).
    process.env["NO_COLOR"] = "1";
  }

  if (opts.renderer) {
    // Renderer is a dynamic callback — caller is responsible for loading Ink
    // via dynamic import() so this file never has a static Ink dependency.
    await opts.renderer(data);
    process.exitCode = exitCode;
    return;
  }

  // No renderer supplied (Phase 7 not yet wired) — fall back to pretty JSON.
  // This is safe: no Ink import, no crash. Useful during development and CI.
  process.stdout.write(serializeJson(data));
  process.exitCode = exitCode;
}
