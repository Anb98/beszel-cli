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
import { resolveSince, toPocketBaseDateTime, type SinceResult } from "./since.js";

export type StatsOptions = {
  since: string;
  systemId: string;
  includeContainers?: boolean;
  /** Optional override for "now" — used in tests for deterministic timestamps. */
  now?: Date;
};

export type StatsPoint = {
  timestamp: string;
  system: MappedSystemStats;
  containers?: ContainerStatsOutput[];
};

export async function fetchStats(
  client: BeszelClient,
  opts: StatsOptions,
): Promise<HistoricalEnvelope<StatsPoint>> {
  const sinceResult: SinceResult = resolveSince(opts.since, opts.now);

  const SysStatsListSchema = PocketBaseListSchema(SystemStatsRecordSchema);

  // PocketBase datetime filters require space format, not ISO 'T'.
  const statsFilter = `system="${opts.systemId}" && type="${sinceResult.interval}" && created>="${toPocketBaseDateTime(sinceResult.from)}"`;

  const rawStats = await client.listRecords("system_stats", {
    filter: statsFilter,
    sort: "-created",
    perPage: 500,
    skipTotal: true,
  });

  const parsedStats = SysStatsListSchema.parse(rawStats);

  const statsRecords = parsedStats.items.slice().reverse();

  let containerStatsMap: Map<string, ContainerStatsOutput[]> = new Map();
  if (opts.includeContainers) {
    const ConStatsListSchema = PocketBaseListSchema(ContainerStatsRecordSchema);

    const conFilter = `system="${opts.systemId}" && type="${sinceResult.interval}" && created>="${toPocketBaseDateTime(sinceResult.from)}"`;
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
