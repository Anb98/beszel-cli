/**
 * containers.test.ts — Tests for src/queries/containers.ts
 *
 * REQ-5: list all containers; --top N; --sort cpu|memory (server-side);
 * --system filter; empty result returns [] (never error).
 * Uses msw to mock PocketBase API.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { BeszelClient } from "../../src/client/beszelClient.js";
import { fetchContainers } from "../../src/queries/containers.js";
import { CliError } from "../../src/types/errors.js";
import type { BeszelConfig } from "../../src/client/config.js";

import containersFixture from "../fixtures/containers.json" with { type: "json" };
import systemsFixture from "../fixtures/systems.json" with { type: "json" };

const BASE_URL = "http://beszel-containers.test";
const VALID_CONFIG: BeszelConfig = {
  url: BASE_URL,
  email: "admin@test.com",
  password: "pass",
  authCollection: "_superusers",
};
const AUTH_PATH = "/api/collections/_superusers/auth-with-password";

function buildJwt(exp: number): string {
  const h = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");
  const p = Buffer.from(JSON.stringify({ sub: "u", exp })).toString("base64url");
  return `${h}.${p}.sig`;
}
const VALID_TOKEN = buildJwt(Math.floor(Date.now() / 1000) + 7 * 86400);

interface CapturedRequest {
  url: URL;
  params: URLSearchParams;
}

const defaultHandlers = [
  http.post(`${BASE_URL}${AUTH_PATH}`, () =>
    HttpResponse.json({ token: VALID_TOKEN, record: { id: "admin" } }),
  ),
  http.get(`${BASE_URL}/api/collections/systems/records`, () =>
    HttpResponse.json(systemsFixture),
  ),
  http.get(`${BASE_URL}/api/collections/containers/records`, () =>
    HttpResponse.json(containersFixture),
  ),
];

const server = setupServer(...defaultHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

async function makeClient(): Promise<BeszelClient> {
  const client = new BeszelClient(VALID_CONFIG, true);
  await client.authenticate();
  return client;
}

describe("fetchContainers", () => {
  describe("basic listing", () => {
    it("returns ContainersOutput with containers array", async () => {
      const client = await makeClient();
      const result = await fetchContainers(client);
      expect(Array.isArray(result.containers)).toBe(true);
    });

    it("maps all 4 containers from fixture", async () => {
      const client = await makeClient();
      const result = await fetchContainers(client);
      expect(result.containers).toHaveLength(4);
    });

    it("each ContainerInfo has required fields", async () => {
      const client = await makeClient();
      const result = await fetchContainers(client);
      for (const c of result.containers) {
        expect(typeof c.name).toBe("string");
        expect(typeof c.system).toBe("string");
        // status, health, cpuPct, memMB, image can be null (nullable stable fields)
        expect("status" in c).toBe(true);
        expect("health" in c).toBe(true);
        expect("cpuPct" in c).toBe(true);
        expect("memMB" in c).toBe(true);
        expect("image" in c).toBe(true);
      }
    });

    it("system field is the human-readable system name (not id)", async () => {
      const client = await makeClient();
      const result = await fetchContainers(client);
      const homeLabContainers = result.containers.filter(
        (c) => c.system === "Home Lab",
      );
      expect(homeLabContainers.length).toBeGreaterThan(0);
    });
  });

  describe("empty result", () => {
    it("returns empty array when no containers exist (never error)", async () => {
      server.use(
        http.get(`${BASE_URL}/api/collections/containers/records`, () =>
          HttpResponse.json({ page: 1, perPage: 500, totalItems: 0, totalPages: 0, items: [] }),
        ),
      );
      const client = await makeClient();
      const result = await fetchContainers(client);
      expect(result.containers).toEqual([]);
    });
  });

  describe("--sort flag sends correct server-side sort", () => {
    it("sort=cpu sends sort=-cpu to the server", async () => {
      let capturedSort: string | null = null;
      server.use(
        http.get(`${BASE_URL}/api/collections/containers/records`, ({ request }) => {
          capturedSort = new URL(request.url).searchParams.get("sort");
          return HttpResponse.json(containersFixture);
        }),
      );
      const client = await makeClient();
      await fetchContainers(client, { sort: "cpu" });
      expect(capturedSort).toBe("-cpu");
    });

    it("sort=memory sends sort=-memory to the server", async () => {
      let capturedSort: string | null = null;
      server.use(
        http.get(`${BASE_URL}/api/collections/containers/records`, ({ request }) => {
          capturedSort = new URL(request.url).searchParams.get("sort");
          return HttpResponse.json(containersFixture);
        }),
      );
      const client = await makeClient();
      await fetchContainers(client, { sort: "memory" });
      expect(capturedSort).toBe("-memory");
    });

    it("no sort option → does NOT send sort=-created (containers has no created field)", async () => {
      let capturedSort: string | null = null;
      server.use(
        http.get(`${BASE_URL}/api/collections/containers/records`, ({ request }) => {
          capturedSort = new URL(request.url).searchParams.get("sort");
          return HttpResponse.json(containersFixture);
        }),
      );
      const client = await makeClient();
      await fetchContainers(client);
      expect(capturedSort).not.toContain("created");
    });
  });

  describe("--top N sends perPage=N to the server", () => {
    it("top=5 → perPage=5 in query", async () => {
      let capturedPerPage: string | null = null;
      server.use(
        http.get(`${BASE_URL}/api/collections/containers/records`, ({ request }) => {
          capturedPerPage = new URL(request.url).searchParams.get("perPage");
          return HttpResponse.json({ page: 1, perPage: 5, totalItems: 4, totalPages: 1, items: containersFixture.items.slice(0, 5) });
        }),
      );
      const client = await makeClient();
      await fetchContainers(client, { top: 5, sort: "cpu" });
      expect(capturedPerPage).toBe("5");
    });
  });

  describe("--system filter", () => {
    it("resolves system name to id and sends filter to server", async () => {
      let capturedFilter: string | null = null;
      server.use(
        http.get(`${BASE_URL}/api/collections/containers/records`, ({ request }) => {
          capturedFilter = new URL(request.url).searchParams.get("filter");
          // Return only Home Lab containers
          const filtered = { ...containersFixture, items: containersFixture.items.filter(c => c.system === "sys001homela") };
          return HttpResponse.json(filtered);
        }),
      );
      const client = await makeClient();
      const result = await fetchContainers(client, { system: "Home Lab" });
      expect(capturedFilter).toContain("sys001homela");
      // All returned containers belong to Home Lab
      for (const c of result.containers) {
        expect(c.system).toBe("Home Lab");
      }
    });

    it("throws NOT_FOUND when --system name does not exist", async () => {
      const client = await makeClient();
      await expect(
        fetchContainers(client, { system: "Nonexistent" }),
      ).rejects.toThrow(CliError);

      try {
        await fetchContainers(client, { system: "Nonexistent" });
      } catch (err) {
        expect((err as CliError).code).toBe("NOT_FOUND");
        expect((err as CliError).exitCode).toBe(3);
      }
    });
  });
});
