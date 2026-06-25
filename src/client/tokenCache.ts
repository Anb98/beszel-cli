import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Clock skew buffer — tokens expiring within 60 s are considered expired. */
const TOKEN_SKEW_MS = 60_000;

/** Cache file name (relative to the cache directory). */
const CACHE_FILE_NAME = "token.json";

/** Directory under ~/.cache where the token lives. */
const CACHE_DIR_NAME = "beszel-cli";

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

/** Absolute path to ~/.cache/beszel-cli/token.json */
export function getCachePath(): string {
  return path.join(os.homedir(), ".cache", CACHE_DIR_NAME, CACHE_FILE_NAME);
}

/** Absolute path to ~/.cache/beszel-cli/ */
function getCacheDir(): string {
  return path.join(os.homedir(), ".cache", CACHE_DIR_NAME);
}

export function decodeJwtExp(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return 0;
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

export function isTokenValid(expUnixSeconds: number): boolean {
  return expUnixSeconds * 1000 - TOKEN_SKEW_MS > Date.now();
}

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

export function clearCache(): void {
  try {
    fs.unlinkSync(getCachePath());
  } catch {
    // File may already be absent — ignore.
  }
}
