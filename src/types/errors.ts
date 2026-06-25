/**
 * errors.ts — CliError class, ErrorCode union, error envelope shape,
 * and exit-code mapping.
 *
 * This is the SINGLE definition of machine-readable error codes and their
 * associated process exit codes (cross-cutting; see design exit-code table).
 */

export type ErrorCode =
  /** Required env var missing (BESZEL_URL, EMAIL, PASSWORD) */
  | "CONFIG_MISSING"
  /** Auth request returned 4xx, or second 401 after token refresh */
  | "AUTH_FAILED"
  /** System name or id not found in the fleet */
  | "NOT_FOUND"
  /** Multiple systems match the given name case-insensitively */
  | "AMBIGUOUS_SYSTEM"
  /** fetch threw, ECONNREFUSED, 5xx, or timeout */
  | "NETWORK_ERROR"
  /** --since value is not a valid duration string (not m/h/d format) */
  | "INVALID_DURATION"
  /** --disk-crit < --disk-warn, or similar threshold contradiction */
  | "INVALID_THRESHOLD"
  /** Catch-all for unexpected errors */
  | "INTERNAL_ERROR";

/** Maps each ErrorCode to its process exit code. */
export const EXIT_CODES: Record<ErrorCode, number> = {
  CONFIG_MISSING: 1,
  AUTH_FAILED: 2,
  NOT_FOUND: 3,
  AMBIGUOUS_SYSTEM: 3,
  NETWORK_ERROR: 4,
  INVALID_DURATION: 1,
  INVALID_THRESHOLD: 1,
  INTERNAL_ERROR: 1,
};

export class CliError extends Error {
  readonly code: ErrorCode;
  readonly hint: string;
  readonly exitCode: number;

  constructor(code: ErrorCode, message: string, hint = "") {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.hint = hint;
    this.exitCode = EXIT_CODES[code];
    // Maintain proper prototype chain in ES2022 compiled to CommonJS targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Serialize to the stdout error envelope shape (REQ cross-cutting).
   * {error: {code, message, hint}}
   */
  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        hint: this.hint,
      },
    };
  }
}

export type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    hint: string;
  };
};

/**
 * Build the error envelope JSON string ready for process.stdout.write().
 * Diagnostic prose goes to stderr; this MUST be the only stdout output.
 */
export function toErrorJson(error: CliError): string {
  return JSON.stringify(error.toEnvelope()) + "\n";
}
