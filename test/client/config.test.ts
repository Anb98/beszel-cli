/**
 * config.test.ts — Unit tests for src/client/config.ts
 *
 * Covers REQ-1 scenario: missing env var → CONFIG_MISSING CliError exit 1.
 * Uses a plain in-process env override (no HTTP, no msw needed here).
 */

import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/client/config.js";
import { CliError } from "../../src/types/errors.js";

const BASE_ENV = {
  BESZEL_URL: "https://beszel.example.com",
  BESZEL_EMAIL: "admin@example.com",
  BESZEL_PASSWORD: "s3cr3t",
};

describe("loadConfig", () => {
  it("returns a valid BeszelConfig when all required vars are present", () => {
    const cfg = loadConfig(BASE_ENV);
    expect(cfg.url).toBe("https://beszel.example.com");
    expect(cfg.email).toBe("admin@example.com");
    expect(cfg.password).toBe("s3cr3t");
    expect(cfg.authCollection).toBe("_superusers");
  });

  it("uses BESZEL_AUTH_COLLECTION when provided", () => {
    const cfg = loadConfig({ ...BASE_ENV, BESZEL_AUTH_COLLECTION: "users" });
    expect(cfg.authCollection).toBe("users");
  });

  it("strips a trailing slash from BESZEL_URL", () => {
    const cfg = loadConfig({ ...BASE_ENV, BESZEL_URL: "https://beszel.example.com/" });
    expect(cfg.url).toBe("https://beszel.example.com");
  });

  it("throws CliError CONFIG_MISSING when BESZEL_URL is absent", () => {
    const env = { BESZEL_EMAIL: "admin@example.com", BESZEL_PASSWORD: "s3cr3t" };
    expect(() => loadConfig(env)).toThrow(CliError);
    try {
      loadConfig(env);
    } catch (err) {
      const cliErr = err as CliError;
      expect(cliErr.code).toBe("CONFIG_MISSING");
      expect(cliErr.exitCode).toBe(1);
      expect(cliErr.message).toMatch(/BESZEL_URL/);
    }
  });

  it("throws CliError CONFIG_MISSING when BESZEL_URL is not a valid URL", () => {
    const env = { ...BASE_ENV, BESZEL_URL: "not-a-url" };
    expect(() => loadConfig(env)).toThrow(CliError);
    try {
      loadConfig(env);
    } catch (err) {
      const cliErr = err as CliError;
      expect(cliErr.code).toBe("CONFIG_MISSING");
      expect(cliErr.message).toMatch(/BESZEL_URL/);
    }
  });

  it("throws CliError CONFIG_MISSING when BESZEL_EMAIL is absent", () => {
    const env = { BESZEL_URL: "https://beszel.example.com", BESZEL_PASSWORD: "s3cr3t" };
    expect(() => loadConfig(env)).toThrow(CliError);
    try {
      loadConfig(env);
    } catch (err) {
      const cliErr = err as CliError;
      expect(cliErr.code).toBe("CONFIG_MISSING");
      expect(cliErr.exitCode).toBe(1);
    }
  });

  it("throws CliError CONFIG_MISSING when BESZEL_PASSWORD is absent", () => {
    const env = { BESZEL_URL: "https://beszel.example.com", BESZEL_EMAIL: "admin@example.com" };
    expect(() => loadConfig(env)).toThrow(CliError);
    try {
      loadConfig(env);
    } catch (err) {
      const cliErr = err as CliError;
      expect(cliErr.code).toBe("CONFIG_MISSING");
      expect(cliErr.exitCode).toBe(1);
    }
  });
});
