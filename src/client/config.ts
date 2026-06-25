import { z } from "zod";
import { CliError } from "../types/errors.js";

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

export type BeszelConfig = {
  url: string;
  email: string;
  password: string;
  authCollection: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): BeszelConfig {
  const result = ConfigSchema.safeParse(env);

  if (!result.success) {
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
