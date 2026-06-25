/**
 * tokenCache.test.ts — Unit tests for src/client/tokenCache.ts
 *
 * Tests are purely in-process (no HTTP, no msw). They write to a temp
 * directory to avoid touching the real ~/.cache/beszel-cli/token.json.
 *
 * Covers:
 * - decodeJwtExp: valid JWT / malformed / missing exp
 * - isTokenValid: future / past / within-skew
 * - readCache / writeCache / clearCache: round-trip, no-cache bypass,
 *   scope mismatch, expired token, corrupt JSON
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  decodeJwtExp,
  isTokenValid,
  readCache,
  writeCache,
  clearCache,
  getCachePath,
} from "../../src/client/tokenCache.js";

function buildJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "user", exp })).toString("base64url");
  return `${header}.${payload}.fakesignature`;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "beszel-test-"));
  vi.spyOn(os, "homedir").mockReturnValue(tmpDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("decodeJwtExp", () => {
  it("decodes a valid JWT exp", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(decodeJwtExp(buildJwt(exp))).toBe(exp);
  });

  it("returns 0 for a malformed token (not three parts)", () => {
    expect(decodeJwtExp("notavalidtoken")).toBe(0);
  });

  it("returns 0 when payload has no exp field", () => {
    const header = Buffer.from("{}").toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "user" })).toString("base64url");
    expect(decodeJwtExp(`${header}.${payload}.sig`)).toBe(0);
  });

  it("returns 0 for an empty string", () => {
    expect(decodeJwtExp("")).toBe(0);
  });
});

describe("isTokenValid", () => {
  it("returns true for a far-future exp", () => {
    const futureSec = Math.floor(Date.now() / 1000) + 3600;
    expect(isTokenValid(futureSec)).toBe(true);
  });

  it("returns false for an exp in the past", () => {
    const pastSec = Math.floor(Date.now() / 1000) - 1;
    expect(isTokenValid(pastSec)).toBe(false);
  });

  it("returns false when exp is within the 60s skew window", () => {
    // exp = now + 30s — within the 60s buffer.
    const soonSec = Math.floor(Date.now() / 1000) + 30;
    expect(isTokenValid(soonSec)).toBe(false);
  });
});

const SCOPE = {
  url: "https://beszel.example.com",
  collection: "_superusers",
  email: "admin@example.com",
};

describe("writeCache + readCache round-trip", () => {
  it("persists and retrieves a valid token", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const entry = { token: buildJwt(exp), exp, ...SCOPE };
    writeCache(entry, false);

    const cached = readCache({ noCache: false, ...SCOPE });
    expect(cached).not.toBeNull();
    expect(cached!.token).toBe(entry.token);
    expect(cached!.exp).toBe(exp);
  });

  it("creates cache dir with mode 0700 and file with mode 0600 (POSIX only)", () => {
    // On Windows, chmod is a no-op — skip the mode assertion there.
    if (process.platform === "win32") return;

    const exp = Math.floor(Date.now() / 1000) + 3600;
    writeCache({ token: buildJwt(exp), exp, ...SCOPE }, false);

    const cachePath = getCachePath();
    const dirPath = path.dirname(cachePath);

    const dirStat = fs.statSync(dirPath);
    const fileStat = fs.statSync(cachePath);

    // Mask to get permission bits only.
    expect(dirStat.mode & 0o777).toBe(0o700);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });
});

describe("readCache", () => {
  it("returns null when noCache is true (even if file exists)", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    writeCache({ token: buildJwt(exp), exp, ...SCOPE }, false);

    expect(readCache({ noCache: true, ...SCOPE })).toBeNull();
  });

  it("returns null when the cache file does not exist", () => {
    expect(readCache({ noCache: false, ...SCOPE })).toBeNull();
  });

  it("returns null for an expired token", () => {
    const exp = Math.floor(Date.now() / 1000) - 10; // already past
    writeCache({ token: "expired.token.sig", exp, ...SCOPE }, false);

    expect(readCache({ noCache: false, ...SCOPE })).toBeNull();
  });

  it("returns null when url scope does not match", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    writeCache({ token: buildJwt(exp), exp, ...SCOPE }, false);

    expect(
      readCache({ noCache: false, url: "https://other.example.com", collection: SCOPE.collection, email: SCOPE.email }),
    ).toBeNull();
  });

  it("returns null when collection scope does not match", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    writeCache({ token: buildJwt(exp), exp, ...SCOPE }, false);

    expect(
      readCache({ noCache: false, url: SCOPE.url, collection: "users", email: SCOPE.email }),
    ).toBeNull();
  });

  it("returns null when email scope does not match", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    writeCache({ token: buildJwt(exp), exp, ...SCOPE }, false);

    expect(
      readCache({ noCache: false, url: SCOPE.url, collection: SCOPE.collection, email: "other@example.com" }),
    ).toBeNull();
  });

  it("returns null for corrupt JSON in the cache file", () => {
    const cachePath = getCachePath();
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, "{invalid json}", "utf8");

    expect(readCache({ noCache: false, ...SCOPE })).toBeNull();
  });
});

describe("writeCache", () => {
  it("does nothing when noCache is true", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    writeCache({ token: buildJwt(exp), exp, ...SCOPE }, true);

    // File should NOT exist.
    expect(fs.existsSync(getCachePath())).toBe(false);
  });
});

describe("clearCache", () => {
  it("removes an existing cache file", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    writeCache({ token: buildJwt(exp), exp, ...SCOPE }, false);
    expect(fs.existsSync(getCachePath())).toBe(true);

    clearCache();
    expect(fs.existsSync(getCachePath())).toBe(false);
  });

  it("does not throw when the cache file does not exist", () => {
    expect(() => clearCache()).not.toThrow();
  });
});
