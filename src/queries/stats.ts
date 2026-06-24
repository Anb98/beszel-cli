/**
 * stats.ts — Historical time-series query for a system over a --since window.
 *
 * REQ-9: uses since.ts to pick the interval bucket, then queries system_stats
 * and/or container_stats filtered by (system, type=interval, created>=from).
 *
 * Returns a HistoricalEnvelope<MappedSystemStats | ContainerStatsOutput[]>.
 * Callers choose which payload type they need (commands layer selects).
 *
 * CRITICAL gotcha (live recon #472):
 *   system_stats and container_stats DO have `created` → sort by -created valid.
 *   containers / smart_devices / system_details / systemd_services → NO created.
 *
 * This module is Ink-free (REQ-2 boundary).
 */

import type { BeszelClient } from "../client/beszelClient.js";
import {
  mapSystemStats,
  mapContainerStatsItem,
  type MappedSystemStats,
  type ContainerStatsOutput,
} from "../mapping/key-map.js";
import type { HistoricalEnvelope } from "../types/output.js";
import {
  PocketBaseListSchema,
  SystemStatsRecordSchema,
  ContainerStatsRecordSchema,
} from "../types/upstream.js";
import { resolveSince, type SinceResult } from "./since.js";

// ---------------------------------------------------------------------------
// StatsOptions
// ---------------------------------------------------------------------------

export interface StatsOptions {
  /**
   * Raw --since flag value (e.g. "12h"). Required for historical queries.
   * Passed through resolveSince() → interval + from + to.
   */
  since: string;
  /**
   * System id (NOT name). Caller is responsible for resolving name→id first
   * (e.g. via fetchSystem). Stats collections use system id for filtering.
   */
  systemId: string;
  /**
   * When true, also fetches container_stats for the window.
   * When false/absent, only system_stats is fetched.
   */
  includeContainers?: boolean;
  /**
   * Optional override for "now" — used in tests for deterministic timestamps.
   */
  now?: Date;
}

// ---------------------------------------------------------------------------
// StatsPoint — one time-series data point
// ---------------------------------------------------------------------------

export interface StatsPoint {
  /** ISO 8601 timestamp of the stats record's created field. */
  timestamp: string;
  /** Mapped system stats for this interval. */
  system: MappedSystemStats;
  /** Per-container stats for this interval (only when includeContainers=true). */
  containers?: ContainerStatsOutput[];
}

// ---------------------------------------------------------------------------
// fetchStats — public API
// ---------------------------------------------------------------------------

/**
 * Fetch historical time-series stats for one system over a --since window.
 *
 * @param client - An authenticated BeszelClient.
 * @param opts - systemId, since flag, optional containers flag.
 * @returns HistoricalEnvelope<StatsPoint[]>.
 */
export async function fetchStats(
  client: BeszelClient,
  opts: StatsOptions,
): Promise<HistoricalEnvelope<StatsPoint>> {
  const sinceResult: SinceResult = resolveSince(opts.since, opts.now);

  const SysStatsListSchema = PocketBaseListSchema(SystemStatsRecordSchema);

  // PocketBase filter: system id, type=interval, created >= from ISO.
  // system_stats DOES have `created` → sort by -created is valid.
  const statsFilter = `system="${opts.systemId}" && type="${sinceResult.interval}" && created>="${sinceResult.from}"`;

  const rawStats = await client.listRecords("system_stats", {
    filter: statsFilter,
    sort: "-created",     // newest first; we reverse below for chronological order
    perPage: 500,
    skipTotal: true,
  });

  const parsedStats = SysStatsListSchema.parse(rawStats);

  // Reverse to chronological order (oldest→newest).
  const statsRecords = parsedStats.items.slice().reverse();

  // Optionally fetch container_stats for the same window.
  // container_stats also has `created` → sort -created is valid.
  let containerStatsMap: Map<string, ContainerStatsOutput[]> = new Map();
  if (opts.includeContainers) {
    const ConStatsListSchema = PocketBaseListSchema(ContainerStatsRecordSchema);

    const conFilter = `system="${opts.systemId}" && type="${sinceResult.interval}" && created>="${sinceResult.from}"`;
    const rawConStats = await client.listRecords("container_stats", {
      filter: conFilter,
      sort: "-created",
      perPage: 500,
      skipTotal: true,
    });
    const parsedConStats = ConStatsListSchema.parse(rawConStats);

    for (const record of parsedConStats.items) {
      const ts = record.created ?? "";
      const mapped = (record.stats ?? []).map(mapContainerStatsItem);
      containerStatsMap.set(ts, mapped);
    }
  }

  // Build points array.
  const points: StatsPoint[] = statsRecords.map((record) => {
    const ts = record.created ?? "";
    const point: StatsPoint = {
      timestamp: ts,
      system: mapSystemStats(record),
    };

    if (opts.includeContainers) {
      point.containers = containerStatsMap.get(ts) ?? [];
    }

    return point;
  });

  return {
    interval: sinceResult.interval,
    from: sinceResult.from,
    to: sinceResult.to,
    points,
  };
}
