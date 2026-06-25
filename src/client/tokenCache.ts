/**
 * tokenCache.ts — Read/write the Beszel auth token from/to
 * ~/.cache/beszel-cli/token.json.
 *
 * REQ-1 token-cache requirements:
 * - Store {token, exp, url, collection, email} keyed to the endpoint so a
 *   cache from one hub cannot be replayed against another.
 * - Decode the JWT exp claim WITHOUT signature verification — only to gate
 *   reuse. A small clock-skew buffer (TOKEN_SKEW_MS) is applied: if exp is
 *   within the skew window the token is treated as expired.
 * - Cache directory: mode 0700; file: mode 0600.
 * - If --no-cache is set, both read and write are bypassed entirely.
 * - Any I/O error (permission denied, corrupt JSON, …) is silently treated as
 *   a cache miss so the caller falls back to a fresh auth call.
 *
 * This module is Ink-free (REQ-2 boundary).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Clock skew buffer — tokens expiring within 60 s are considered expired. */
const TOKEN_SKEW_MS = 60_000;

/** Cache file name (relative to the cache directory). */
const CACHE_FILE_NAME = "token.json";

/** Directory under ~/.cache where the token lives. */
const CACHE_DIR_NAME = "beszel-cli";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Shape persisted to token.json.
 * `exp` is the JWT numeric exp claim (Unix seconds), decoded from the token
 * payload without signature verification.
 */
export type CachedToken = {
  token: string;
  /** JWT exp in Unix seconds */
  exp: number;
  /** Base URL of the hub this token belongs to */
  url: string;
  /** Auth collection used (e.g. _superusers) */
  collection: string;
  /** E-mail / identity used to authenticate */
  email: string;
};

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Absolute path to ~/.cache/beszel-cli/token.json */
export function getCachePath(): string {
  return path.join(os.homedir(), ".cache", CACHE_DIR_NAME, CACHE_FILE_NAME);
}

/** Absolute path to ~/.cache/beszel-cli/ */
function getCacheDir(): string {
  return path.join(os.homedir(), ".cache", CACHE_DIR_NAME);
}

// ---------------------------------------------------------------------------
// JWT exp decoder — NO signature verification, payload only
// ---------------------------------------------------------------------------

/**
 * Decode the `exp` claim from a JWT payload (middle segment) without
 * verifying the signature. Returns `0` if decoding fails so the token is
 * treated as expired and a fresh auth call is made.
 */
export function decodeJwtExp(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return 0;
    // Base64url → Base64 → JSON
    const payload = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as unknown;
    if (typeof decoded === "object" && decoded !== null && "exp" in decoded) {
      const exp = (decoded as Record<string, unknown>)["exp"];
      if (typeof exp === "number") return exp;
    }
    return 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Expiry check
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the token is still valid (not expired + skew buffer).
 * @param expUnixSeconds - The `exp` claim from the JWT (Unix seconds).
 */
export function isTokenValid(expUnixSeconds: number): boolean {
  return expUnixSeconds * 1000 - TOKEN_SKEW_MS > Date.now();
}

// ---------------------------------------------------------------------------
// read — returns a valid CachedToken or null on any failure
// ---------------------------------------------------------------------------

/**
 * Read and validate the cached token. Returns `null` if:
 * - `noCache` is true
 * - the cache file does not exist
 * - JSON is corrupt
 * - the token is expired (within skew buffer)
 * - the stored url/collection/email does not match the current config
 *
 * Never throws; I/O errors are treated as cache misses.
 */
export function readCache(opts: {
  noCache: boolean;
  url: string;
  collection: string;
  email: string;
}): CachedToken | null {
  if (opts.noCache) return null;

  try {
    const raw = fs.readFileSync(getCachePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("token" in parsed) ||
      !("exp" in parsed) ||
      !("url" in parsed) ||
      !("collection" in parsed) ||
      !("email" in parsed)
    ) {
      return null;
    }

    const cached = parsed as CachedToken;

    // Scope check — a token from hub A must not be reused for hub B.
    if (
      cached.url !== opts.url ||
      cached.collection !== opts.collection ||
      cached.email !== opts.email
    ) {
      return null;
    }

    if (!isTokenValid(cached.exp)) return null;

    return cached;
  } catch {
    // File not found, permission error, JSON parse error → cache miss.
    return null;
  }
}

// ---------------------------------------------------------------------------
// write — persist a fresh token; silently ignores I/O errors
// ---------------------------------------------------------------------------

/**
 * Write a fresh token to the cache file (mode 0600). Creates the cache
 * directory (mode 0700) if it does not exist.
 *
 * Never throws; write failures are silently ignored so the auth flow
 * can continue without caching.
 */
export function writeCache(entry: CachedToken, noCache: boolean): void {
  if (noCache) return;

  try {
    const dir = getCacheDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const filePath = getCachePath();
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Silently ignore — cache miss on next run is acceptable.
  }
}

// ---------------------------------------------------------------------------
// clearCache — remove the token file; called on 401 mid-session
// ---------------------------------------------------------------------------

/**
 * Remove the cached token file. Called when the server returns 401 so the
 * next auth attempt performs a fresh login.
 *
 * Never throws.
 */
export function clearCache(): void {
  try {
    fs.unlinkSync(getCachePath());
  } catch {
    // File may already be absent — ignore.
  }
}
