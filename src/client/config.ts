/**
 * config.ts — Load and validate environment variables for the Beszel CLI.
 *
 * REQ-1: Reads BESZEL_URL, BESZEL_EMAIL, BESZEL_PASSWORD (required) and
 * BESZEL_AUTH_COLLECTION (optional, defaults to "_superusers"). Any missing or
 * invalid required variable throws a CliError with code CONFIG_MISSING so the
 * caller can emit the error envelope and exit 1.
 *
 * This module is Ink-free (REQ-2 boundary).
 */

import { z } from "zod";
import { CliError } from "../types/errors.js";

// ---------------------------------------------------------------------------
// Zod schema for the expected environment variables
// ---------------------------------------------------------------------------

const ConfigSchema = z.looseObject({
  /** Full base URL of the Beszel hub, e.g. https://beszel.example.com */
  BESZEL_URL: z.string().url({
    message: "BESZEL_URL must be a valid URL (e.g. https://beszel.example.com)",
  }),
  /** PocketBase superuser / user e-mail address */
  BESZEL_EMAIL: z.string().min(1, { message: "BESZEL_EMAIL must not be empty" }),
  /** PocketBase superuser / user password */
  BESZEL_PASSWORD: z.string().min(1, { message: "BESZEL_PASSWORD must not be empty" }),
  /**
   * PocketBase auth collection.
   * Defaults to "_superusers" (standard Beszel superuser collection).
   * Override with BESZEL_AUTH_COLLECTION=users for regular-user auth.
   */
  BESZEL_AUTH_COLLECTION: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Exported config shape
// ---------------------------------------------------------------------------

export type BeszelConfig = {
  url: string;
  email: string;
  password: string;
  authCollection: string;
};

// ---------------------------------------------------------------------------
// loadConfig — parse process.env; throws CliError on any validation failure
// ---------------------------------------------------------------------------

/**
 * Reads the four Beszel env vars from `process.env` (or an override map for
 * testing), validates them with Zod, and returns a typed {@link BeszelConfig}.
 *
 * Throws a {@link CliError} with code `CONFIG_MISSING` if any required var is
 * absent or invalid. The caller should catch this and emit the error envelope.
 *
 * @param env - Optional override; defaults to `process.env`.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): BeszelConfig {
  const result = ConfigSchema.safeParse(env);

  if (!result.success) {
    // Collect the first failing path for a precise human message.
    const firstIssue = result.error.issues[0];
    const varName = String(firstIssue?.path?.[0] ?? "BESZEL_*");
    const detail = firstIssue?.message ?? "validation failed";

    throw new CliError(
      "CONFIG_MISSING",
      `Environment variable ${varName} is missing or invalid: ${detail}`,
      `Set ${varName} before running beszel. Example: export ${varName}=<value>`,
    );
  }

  return {
    url: result.data.BESZEL_URL.replace(/\/+$/, ""), // strip trailing slash
    email: result.data.BESZEL_EMAIL,
    password: result.data.BESZEL_PASSWORD,
    authCollection: result.data.BESZEL_AUTH_COLLECTION ?? "_superusers",
  };
}
