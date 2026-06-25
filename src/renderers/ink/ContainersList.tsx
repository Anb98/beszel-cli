/**
 * renderers/ink/ContainersList.tsx — Ink TUI renderer for `beszel containers`.
 *
 * REQ-2: Human/TTY path only. Dynamically imported from commands/containers.ts.
 * Groups containers by system; shows name, status, health code, cpu%, mem MB, image.
 */

import React from "react";
import { Box, Text, render } from "ink";
import type { ContainersOutput, ContainerInfo } from "../../types/output.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useColor(): boolean {
  return !process.env["NO_COLOR"];
}

function statusColor(status: string | null): string {
  if (!status) return "gray";
  switch (status.toLowerCase()) {
    case "running":
      return "green";
    case "exited":
    case "dead":
    case "stopped":
      return "red";
    case "paused":
      return "yellow";
    default:
      return "white";
  }
}

/**
 * Beszel health codes: 0 = healthy, 1 = unhealthy, others = unknown.
 * Returns a display string.
 */
function fmtHealth(h: number | null): string {
  if (h == null) return "-";
  if (h === 0) return "healthy";
  if (h === 1) return "unhealthy";
  return `code:${h}`;
}

function healthColor(h: number | null, colorEnabled: boolean): string | undefined {
  if (!colorEnabled || h == null) return undefined;
  if (h === 0) return "green";
  if (h === 1) return "red";
  return "yellow";
}

function fmtPct(v: number | null): string {
  if (v == null) return "-";
  return `${v.toFixed(1)}%`;
}

function fmtMem(v: number | null): string {
  if (v == null) return "-";
  return `${v.toFixed(0)} MB`;
}

function truncate(s: string | null, width: number): string {
  if (!s) return "-";
  return s.length > width ? s.slice(0, width - 1) + "…" : s.padEnd(width);
}

// ---------------------------------------------------------------------------
// Column widths
// ---------------------------------------------------------------------------

const COL = {
  name: 20,
  status: 10,
  health: 10,
  cpu: 8,
  mem: 10,
  image: 30,
};

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header(): React.ReactElement {
  return (
    <Box>
      <Text bold>{truncate("NAME", COL.name)}</Text>
      <Text bold>{truncate("STATUS", COL.status)}</Text>
      <Text bold>{truncate("HEALTH", COL.health)}</Text>
      <Text bold>{truncate("CPU", COL.cpu)}</Text>
      <Text bold>{truncate("MEM", COL.mem)}</Text>
      <Text bold>{truncate("IMAGE", COL.image)}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Container row
// ---------------------------------------------------------------------------

type ContainerRowProps = {
  item: ContainerInfo;
  colorEnabled: boolean;
};

function ContainerRow({ item, colorEnabled }: ContainerRowProps): React.ReactElement {
  const sColor = colorEnabled ? statusColor(item.status) : undefined;
  const hColor = healthColor(item.health, colorEnabled);

  return (
    <Box>
      <Text>{truncate(item.name, COL.name)}</Text>
      <Text color={sColor}>{truncate(item.status ?? "-", COL.status)}</Text>
      <Text color={hColor}>{truncate(fmtHealth(item.health), COL.health)}</Text>
      <Text>{truncate(fmtPct(item.cpuPct), COL.cpu)}</Text>
      <Text>{truncate(fmtMem(item.memMB), COL.mem)}</Text>
      <Text dimColor>{truncate(item.image, COL.image)}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Group by system
// ---------------------------------------------------------------------------

function groupBySystem(containers: ContainerInfo[]): Map<string, ContainerInfo[]> {
  const map = new Map<string, ContainerInfo[]>();
  for (const c of containers) {
    const key = c.system;
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// ContainersList root component
// ---------------------------------------------------------------------------

type ContainersListProps = {
  data: ContainersOutput;
};

export function ContainersList({ data }: ContainersListProps): React.ReactElement {
  const colorEnabled = useColor();
  const { containers } = data;

  if (containers.length === 0) {
    return (
      <Box paddingY={1}>
        <Text dimColor>No containers found.</Text>
      </Box>
    );
  }

  const grouped = groupBySystem(containers);

  return (
    <Box flexDirection="column" paddingY={1}>
      {Array.from(grouped.entries()).map(([system, items]) => (
        <Box key={system} flexDirection="column" marginBottom={1}>
          {/* System heading */}
          <Box marginBottom={0}>
            <Text bold color={colorEnabled ? "cyan" : undefined}>{system}</Text>
            <Text dimColor>{` (${items.length} container${items.length !== 1 ? "s" : ""})`}</Text>
          </Box>
          <Header />
          <Text dimColor>{"─".repeat(COL.name + COL.status + COL.health + COL.cpu + COL.mem + COL.image)}</Text>
          {items.map((c, i) => (
            <ContainerRow key={`${c.name}-${i}`} item={c} colorEnabled={colorEnabled} />
          ))}
        </Box>
      ))}
      <Box>
        <Text dimColor>Total: {containers.length} container{containers.length !== 1 ? "s" : ""}</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// renderContainersList — dynamic-import entry point
// ---------------------------------------------------------------------------

export async function renderContainersList(data: ContainersOutput): Promise<void> {
  const { waitUntilExit } = render(<ContainersList data={data} />);
  await waitUntilExit();
}
