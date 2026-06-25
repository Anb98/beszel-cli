import { CliError } from "../types/errors.js";
import type { BeszelConfig } from "./config.js";
import {
  readCache,
  writeCache,
  clearCache,
  decodeJwtExp,
} from "./tokenCache.js";
import type { CachedToken } from "./tokenCache.js";

/**
 * The single Beszel agent/hub version range this CLI is validated against.
 * Out-of-range versions emit a stderr warning but never cause a non-zero exit.
 */
export const SUPPORTED_BESZEL = ">=0.18 <0.19";

export function checkVersion(observedVersion: string | undefined): void {
  if (!observedVersion) return;

  const match = observedVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return;

  const major = parseInt(match[1]!, 10);
  const minor = parseInt(match[2]!, 10);

  // SUPPORTED_BESZEL = ">=0.18 <0.19" means major==0 and minor==18.
  const inRange = major === 0 && minor === 18;
  if (!inRange) {
    process.stderr.write(
      `[beszel] WARNING: agent version ${observedVersion} is outside the supported range ${SUPPORTED_BESZEL}. ` +
        `Output fields may differ from documented shapes.\n`,
    );
  }
}

export type ListOptions = {
  filter?: string;
  sort?: string;
  fields?: string;
  perPage?: number;
  page?: number;
  /** When true, PocketBase skips the COUNT query (faster for large collections). */
  skipTotal?: boolean;
};

type AuthResponse = {
  token: string;
  record?: {
    id?: string;
    email?: string;
  };
};

export class BeszelClient {
  private readonly config: BeszelConfig;
  private readonly noCache: boolean;
  private token: string | null = null;

  constructor(config: BeszelConfig, noCache = false) {
    this.config = config;
    this.noCache = noCache;
  }

  async authenticate(): Promise<string> {
    const cached = readCache({
      noCache: this.noCache,
      url: this.config.url,
      collection: this.config.authCollection,
      email: this.config.email,
    });

    if (cached) {
      this.token = cached.token;
      return this.token;
    }

    this.token = await this.doAuthenticate();
    return this.token;
  }

  private async doAuthenticate(): Promise<string> {
    const url = `${this.config.url}/api/collections/${this.config.authCollection}/auth-with-password`;
    const body = JSON.stringify({
      identity: this.config.email,
      password: this.config.password,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (err) {
      // fetch threw — network/DNS/timeout error.
      throw new CliError(
        "NETWORK_ERROR",
        `Unable to reach Beszel hub at ${this.config.url}: ${(err as Error).message}`,
        `Check that BESZEL_URL is reachable and the server is running.`,
      );
    }

    if (response.status === 400 || response.status === 401) {
      throw new CliError(
        "AUTH_FAILED",
        `Authentication failed (HTTP ${response.status}). Check BESZEL_EMAIL and BESZEL_PASSWORD.`,
        `Verify your credentials and that BESZEL_AUTH_COLLECTION matches the user type.`,
      );
    }

    if (!response.ok) {
      throw new CliError(
        "NETWORK_ERROR",
        `Beszel hub returned HTTP ${response.status} during authentication.`,
        `Check the server logs at ${this.config.url}.`,
      );
    }

    let data: AuthResponse;
    try {
      data = (await response.json()) as AuthResponse;
    } catch {
      throw new CliError(
        "NETWORK_ERROR",
        `Beszel hub returned a non-JSON auth response.`,
        `This may indicate a proxy or firewall intercepting the request.`,
      );
    }

    if (!data.token) {
      throw new CliError(
        "AUTH_FAILED",
        `Beszel hub auth response did not include a token.`,
        `Check that the auth collection is correct.`,
      );
    }

    // Decode JWT exp for cache; if decoding fails exp=0 → not cached (safe).
    const exp = decodeJwtExp(data.token);
    const entry: CachedToken = {
      token: data.token,
      exp,
      url: this.config.url,
      collection: this.config.authCollection,
      email: this.config.email,
    };
    writeCache(entry, this.noCache);

    return data.token;
  }

  async request<T = unknown>(path: string, isRetry = false): Promise<T> {
    if (!this.token) {
      await this.authenticate();
    }

    const url = `${this.config.url}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          // Beszel/PocketBase style: raw token, NO "Bearer" prefix.
          Authorization: this.token!,
          "Content-Type": "application/json",
        },
      });
    } catch (err) {
      throw new CliError(
        "NETWORK_ERROR",
        `Network error reaching ${url}: ${(err as Error).message}`,
        `Check connectivity and that BESZEL_URL is correct.`,
      );
    }

    if (response.status === 401) {
      if (isRetry) {
        throw new CliError(
          "AUTH_FAILED",
          `Authentication failed on retry (HTTP 401). Session may have expired.`,
          `Try clearing the token cache or re-checking credentials.`,
        );
      }
      clearCache();
      this.token = await this.doAuthenticate();
      return this.request<T>(path, true);
    }

    if (response.status === 404) {
      throw new CliError(
        "NOT_FOUND",
        `Resource not found: ${path}`,
        `Check the collection name and that the resource exists.`,
      );
    }

    if (!response.ok) {
      throw new CliError(
        "NETWORK_ERROR",
        `Beszel hub returned HTTP ${response.status} for ${path}`,
        `Check the server logs at ${this.config.url}.`,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new CliError(
        "NETWORK_ERROR",
        `Beszel hub returned a non-JSON response for ${path}`,
        `This may indicate a proxy or firewall intercepting the request.`,
      );
    }
  }

  async listRecords<T = unknown>(collection: string, opts: ListOptions = {}): Promise<T> {
    const params = new URLSearchParams();

    if (opts.filter !== undefined) params.set("filter", opts.filter);
    if (opts.sort !== undefined) params.set("sort", opts.sort);
    if (opts.fields !== undefined) params.set("fields", opts.fields);
    if (opts.perPage !== undefined) params.set("perPage", String(opts.perPage));
    if (opts.page !== undefined) params.set("page", String(opts.page));
    if (opts.skipTotal === true) params.set("skipTotal", "1");

    const qs = params.toString();
    const path = `/api/collections/${collection}/records${qs ? `?${qs}` : ""}`;

    return this.request<T>(path);
  }
}

export async function createClient(config: BeszelConfig, noCache = false): Promise<BeszelClient> {
  const client = new BeszelClient(config, noCache);
  await client.authenticate();
  return client;
}
