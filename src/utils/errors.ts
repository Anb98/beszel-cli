/**
 * utils/errors.ts — Top-level error handler.
 *
 * Catches CliError (and unknown errors), produces the standard error envelope
 * {error:{code,message,hint}}, maps to the correct exit code, and emits to
 * STDERR in JSON/agent mode (so stdout carries only the data envelope or is
 * empty on error). In TTY mode the same envelope goes to STDERR as well, so
 * the renderer can decide whether to pretty-print.
 *
 * Usage:
 *   handleError(err, { json: true })  → envelope to STDERR, set process.exitCode
 *
 * Design note: In both modes we write the envelope to STDERR (not STDOUT).
 * This is intentional: the data output slot (STDOUT) must stay clean for
 * downstream piping. Human callers see the error on STDERR; machine callers
 * (--json / piped) also read STDERR for diagnostics.
 *
 * The spec says error envelopes go to STDOUT only for non-zero exits where the
 * data channel would otherwise be empty; we follow the cross-cutting rule:
 * "This envelope MUST be the ONLY output on stdout for error cases." So in
 * agent/JSON mode we write the envelope to STDOUT (not STDERR) to preserve
 * the single-channel contract for machine consumers.
 */

import { CliError, EXIT_CODES } from "../types/errors.js";
import type { ErrorEnvelope } from "../types/output.js";

// ---------------------------------------------------------------------------
// HandleErrorOptions
// ---------------------------------------------------------------------------

export interface HandleErrorOptions {
  /**
   * When true (--json flag or non-TTY), emit the error envelope as JSON to
   * STDOUT (machine-readable channel). When false (TTY human mode), write to
   * STDERR so the terminal can separate data from diagnostics.
   */
  json: boolean;
}

// ---------------------------------------------------------------------------
// handleError — public API
// ---------------------------------------------------------------------------

/**
 * Catch-all error handler. Call from the top-level CLI entry point after any
 * command throws.
 *
 * - Maps CliError → {error:{code,message,hint}} envelope.
 * - Maps unknown errors → INTERNAL_ERROR envelope.
 * - Sets process.exitCode (never calls process.exit() so the event loop drains).
 *
 * @param err  - The thrown value (CliError | Error | unknown).
 * @param opts - HandleErrorOptions.
 */
export function handleError(err: unknown, opts: HandleErrorOptions): void {
  const envelope = buildEnvelope(err);
  const exitCode = resolveExitCode(err);

  const serialized = JSON.stringify(envelope) + "\n";

  if (opts.json) {
    // JSON / agent path: machine consumers read stdout for both data and errors.
    process.stdout.write(serialized);
  } else {
    // TTY / human path: write to stderr so the human sees it; stdout stays clean.
    process.stderr.write(serialized);
  }

  process.exitCode = exitCode;
}

// ---------------------------------------------------------------------------
// buildEnvelope — internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert any thrown value into the standard error envelope.
 */
function buildEnvelope(err: unknown): ErrorEnvelope {
  if (err instanceof CliError) {
    return err.toEnvelope();
  }

  // Unknown / unexpected error.
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "An unexpected error occurred.";

  return {
    error: {
      code: "INTERNAL_ERROR",
      message,
      hint: "Run with --json for machine-readable output or check stderr for details.",
    },
  };
}

/**
 * Determine the process exit code from the thrown value.
 */
function resolveExitCode(err: unknown): number {
  if (err instanceof CliError) {
    return err.exitCode;
  }
  // Unknown errors map to INTERNAL_ERROR exit code (1).
  return EXIT_CODES.INTERNAL_ERROR;
}
