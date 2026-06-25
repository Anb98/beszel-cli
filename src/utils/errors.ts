import { CliError, EXIT_CODES } from "../types/errors.js";
import type { ErrorEnvelope } from "../types/output.js";

export type HandleErrorOptions = {
  /**
   * When true (--json flag or non-TTY), emit the error envelope to STDOUT.
   * When false (TTY human mode), write to STDERR.
   */
  json: boolean;
};

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
