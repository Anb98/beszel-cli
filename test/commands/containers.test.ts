/**
 * commands/containers.test.ts — Integration tests for src/commands/containers.ts
 *
 * REQ-5 scenarios tested:
 *   - Happy path: all containers listed with required fields
 *   - --top N limits results
 *   - --sort cpu|memory changes sort field
 *   - --system filter restricts to one system
 *   - Empty result → {containers:[]}
 *
 * REQ-9: --since on containers (not tested here; since.test.ts covers bucket logic)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { BeszelClient } from "../../src/client/beszelClient.js";
import { fetchContainers } from "../../src/queries/containers.js";
import type { BeszelConfig } from "../../src/client/config.js";

import containersFixture from "../fixtures/containers.json" with { type: "json" };
import systemsFixture from "../fixtures/systems.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "http://beszel-containers-cmd.test";
const VALID_CONFIG: BeszelConfig = {
  url: BASE_URL,
  email: "admin@test.com",
  password: "pass",
  authCollection: "_superusers",
};
const AUTH_PATH = "/api/collections/_superusers/auth-with-password";

function buildJwt(exp: number): string {
  const h = Buffer.from('{"alg":"HS256"}').toString("base64url");
  const p = Buffer.from(JSON.stringify({ sub: "u", exp })).toString("base64url");
  return `${h}.${p}.sig`;
}
const TOKEN = buildJwt(Math.floor(Date.now() / 1000) + 7 * 86400);

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer(
  http.post(`${BASE_URL}${AUTH_PATH}`, () =>
    HttpResponse.json({ token: TOKEN }),
  ),
  http.get(`${BASE_URL}/api/collections/containers/records`, () =>
    HttpResponse.json(containersFixture),
  ),
  http.get(`${BASE_URL}/api/collections/systems/records`, () =>
    HttpResponse.json(systemsFixture),
  ),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => server.resetHandlers());

async function makeClient(): Promise<BeszelClient> {
  const client = new BeszelClient(VALID_CONFIG, true);
  await client.authenticate();
  return client;
}

// ---------------------------------------------------------------------------
// Tests — REQ-5
// ---------------------------------------------------------------------------

describe("beszel containers — REQ-5", () => {
  describe("happy path — list all containers", () => {
    it("returns a containers array with required fields", async () => {
      const client = await makeClient();
      const result = await fetchContainers(client);

      expect(Array.isArray(result.containers)).toBe(true);
      expect(result.containers.length).toBeGreaterThan(0);

      for (const c of result.containers) {
        expect("name" in c).toBe(true);
        expect("system" in c).toBe(true);
        expect("status" in c).toBe(true);
        expect("health" in c).toBe(true);
        expect("cpuPct" in c).toBe(true);
        expect("memMB" in c).toBe(true);
        expect("image" in c).toBe(true);
      }
    });

    it("returns all 4 containers from fixture", async () => {
      const client = await makeClient();
      const result = await fetchContainers(client);
      expect(result.containers).toHaveLength(4);
    });

    it("resolves system name for each container", async () => {
      const client = await makeClient();
      const result = await fetchContainers(client);
      // All containers should have a non-empty system name
      for (const c of result.containers) {
        expect(typeof c.system).toBe("string");
        expect(c.system.length).toBeGreaterThan(0);
      }
    });
  });

  describe("--top N", () => {
    it("tracks server-side perPage for top limit (server returns only N items)", async () => {
      // When --top 2 is set, perPage=2 is sent to the server.
      // Our mock returns the full fixture; client uses perPage from opts.
      let capturedPerPage: string | null = null;

      server.use(
        http.get(`${BASE_URL}/api/collections/containers/records`, ({ request }) => {
          const url = new URL(request.url);
          capturedPerPage = url.searchParams.get("perPage");
          // Return only 2 items as the server would with perPage=2
          const limited = {
            ...containersFixture,
            items: containersFixture.items.slice(0, 2),
          };
          return HttpResponse.json(limited);
        }),
      );

      const client = await makeClient();
      const result = await fetchContainers(client, { top: 2 });

      // The query was made with perPage=2
      expect(capturedPerPage).toBe("2");
      expect(result.containers).toHaveLength(2);
    });
  });

  describe("--sort cpu|memory", () => {
    it("sends sort=-cpu when sort=cpu is requested", async () => {
      let capturedSort: string | null = null;

      server.use(
        http.get(`${BASE_URL}/api/collections/containers/records`, ({ request }) => {
          const url = new URL(request.url);
          capturedSort = url.searchParams.get("sort");
          return HttpResponse.json(containersFixture);
        }),
      );

      const client = await makeClient();
      await fetchContainers(client, { sort: "cpu" });

      expect(capturedSort).toBe("-cpu");
    });

    it("sends sort=-memory when sort=memory is requested", async () => {
      let capturedSort: string | null = null;

      server.use(
        http.get(`${BASE_URL}/api/collections/containers/records`, ({ request }) => {
          const url = new URL(request.url);
          capturedSort = url.searchParams.get("sort");
          return HttpResponse.json(containersFixture);
        }),
      );

      const client = await makeClient();
      await fetchContainers(client, { sort: "memory" });

      expect(capturedSort).toBe("-memory");
    });

    it("never sorts by -created (containers collection lacks created field)", async () => {
      let capturedSort: string | null = null;

      server.use(
        http.get(`${BASE_URL}/api/collections/containers/records`, ({ request }) => {
          const url = new URL(request.url);
          capturedSort = url.searchParams.get("sort");
          return HttpResponse.json(containersFixture);
        }),
      );

      const client = await makeClient();
      await fetchContainers(client);

      expect(capturedSort).not.toBe("-created");
    });
  });

  describe("--system filter", () => {
    it("resolves system name to id and applies server-side filter", async () => {
      let capturedFilter: string | null = null;

      server.use(
        http.get(`${BASE_URL}/api/collections/containers/records`, ({ request }) => {
          const url = new URL(request.url);
          capturedFilter = url.searchParams.get("filter");
          // Return only containers for sys001homela
          const filtered = {
            ...containersFixture,
            items: containersFixture.items.filter((c) => c.system === "sys001homela"),
          };
          return HttpResponse.json(filtered);
        }),
      );

      const client = await makeClient();
      const result = await fetchContainers(client, { system: "Home Lab" });

      // Filter should contain the system id
      expect(capturedFilter).toContain("sys001homela");
      // Only Home Lab containers
      expect(result.containers).toHaveLength(2);
      expect(result.containers.every((c) => c.system === "Home Lab")).toBe(true);
    });
  });

  describe("empty result", () => {
    it("returns {containers:[]} and exits 0 (no error)", async () => {
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
});
