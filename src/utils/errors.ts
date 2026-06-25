/**
 * utils/errors.ts — Top-level error handler.
 *
 * Catches CliError (and unknown errors), produces the standard error envelope
 * {error:{code,message,hint}}, and maps to the correct exit code.
 *
 * In JSON/agent mode the envelope goes to STDOUT — the single-channel contract
 * for machine consumers (STDOUT must contain only the data or error envelope).
 * In TTY mode the envelope goes to STDERR so the terminal separates data from
 * diagnostics.
 */

import { CliError, EXIT_CODES } from "../types/errors.js";
import type { ErrorEnvelope } from "../types/output.js";

// ---------------------------------------------------------------------------
// HandleErrorOptions
// ---------------------------------------------------------------------------

export type HandleErrorOptions = {
  /**
   * When true (--json flag or non-TTY), emit the error envelope to STDOUT.
   * When false (TTY human mode), write to STDERR.
   */
  json: boolean;
};

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
 */
export function handleError(err: unknown, opts: HandleErrorOptions): void {
  const envelope = buildEnvelope(err);
  const exitCode = resolveExitCode(err);

  const serialized = JSON.stringify(envelope) + "\n";

  if (opts.json) {
    process.stdout.write(serialized);
  } else {
    process.stderr.write(serialized);
  }

  process.exitCode = exitCode;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildEnvelope(err: unknown): ErrorEnvelope {
  if (err instanceof CliError) {
    return err.toEnvelope();
  }

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

function resolveExitCode(err: unknown): number {
  if (err instanceof CliError) {
    return err.exitCode;
  }
  return EXIT_CODES.INTERNAL_ERROR;
}
