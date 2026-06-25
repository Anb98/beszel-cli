/**
 * renderers/ink/DisksList.tsx — Ink TUI renderer for `beszel disks`.
 *
 * REQ-2: Human/TTY path only. Dynamically imported from commands/disks.ts.
 * Groups devices by system. Colors RAID arrayState/syncAction. Marks failing disks.
 */

import React from "react";
import { Box, Text, render } from "ink";
import type { DisksOutput, DeviceInfo, DiskInfo, RaidInfo } from "../../types/output.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useColor(): boolean {
  return !process.env["NO_COLOR"];
}

/**
 * SMART disk state color: PASSED=green, anything else=red.
 */
function stateColor(state: string | null, colorEnabled: boolean): string | undefined {
  if (!colorEnabled || !state) return undefined;
  return state === "PASSED" ? "green" : "red";
}

/**
 * RAID arrayState color:
 * clean=green, degraded/failed/inactive=red, others=yellow.
 */
function arrayStateColor(arrayState: string | null, colorEnabled: boolean): string | undefined {
  if (!colorEnabled || !arrayState) return undefined;
  if (arrayState === "clean") return "green";
  if (["degraded", "failed", "inactive"].includes(arrayState)) return "red";
  return "yellow";
}

/**
 * RAID syncAction color:
 * idle=green (normal), anything else=yellow (active sync).
 */
function syncActionColor(syncAction: string | null, colorEnabled: boolean): string | undefined {
  if (!colorEnabled || !syncAction) return undefined;
  return syncAction === "idle" ? "green" : "yellow";
}

function fmtBytes(b: number | null): string {
  if (b == null) return "-";
  const gb = b / (1024 ** 3);
  return `${gb.toFixed(0)} GB`;
}

function fmtTemp(v: number | null): string {
  if (v == null) return "-";
  return `${v}°C`;
}

function truncate(s: string | null | undefined, width: number): string {
  if (!s) return "-".padEnd(width);
  return s.length > width ? s.slice(0, width - 1) + "…" : s.padEnd(width);
}

// ---------------------------------------------------------------------------
// Disk row (SMART physical drive)
// ---------------------------------------------------------------------------

type DiskRowProps = {
  item: DiskInfo;
  colorEnabled: boolean;
};

function DiskRow({ item, colorEnabled }: DiskRowProps): React.ReactElement {
  const sColor = stateColor(item.state, colorEnabled);
  const failing = item.state != null && item.state !== "PASSED";

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box>
        <Text dimColor>  disk  </Text>
        <Text bold={failing} color={failing && colorEnabled ? "red" : undefined}>
          {item.name}
        </Text>
      </Box>
      <Box marginLeft={8}>
        <Text dimColor>state: </Text>
        <Text color={sColor}>{item.state ?? "-"}</Text>
        <Text dimColor>  type: </Text>
        <Text>{item.type ?? "-"}</Text>
        <Text dimColor>  model: </Text>
        <Text>{truncate(item.model, 20)}</Text>
        <Text dimColor>  cap: </Text>
        <Text>{fmtBytes(item.capacityBytes)}</Text>
        <Text dimColor>  temp: </Text>
        <Text>{fmtTemp(item.tempC)}</Text>
      </Box>
      {(item.serial || item.hours != null || item.cycles != null) && (
        <Box marginLeft={8}>
          {item.serial && (
            <>
              <Text dimColor>serial: </Text>
              <Text>{item.serial}</Text>
            </>
          )}
          {item.hours != null && (
            <>
              <Text dimColor>  hours: </Text>
              <Text>{item.hours.toLocaleString()}</Text>
            </>
          )}
          {item.cycles != null && (
            <>
              <Text dimColor>  cycles: </Text>
              <Text>{item.cycles.toLocaleString()}</Text>
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// RAID row
// ---------------------------------------------------------------------------

type RaidRowProps = {
  item: RaidInfo;
  colorEnabled: boolean;
};

function RaidRow({ item, colorEnabled }: RaidRowProps): React.ReactElement {
  const asColor = arrayStateColor(item.arrayState, colorEnabled);
  const saColor = syncActionColor(item.syncAction, colorEnabled);
  const stColor = stateColor(item.state, colorEnabled);

  const failing =
    (item.arrayState != null && item.arrayState !== "clean") ||
    (item.state != null && item.state !== "PASSED");

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box>
        <Text dimColor>  raid  </Text>
        <Text bold={failing} color={failing && colorEnabled ? "red" : undefined}>
          {item.name}
        </Text>
        <Text dimColor>  {item.raidLevel ?? "-"}</Text>
        {item.raidDisks != null && (
          <Text dimColor>  ({item.raidDisks} disks)</Text>
        )}
      </Box>
      <Box marginLeft={8}>
        <Text dimColor>state: </Text>
        <Text color={stColor}>{item.state ?? "-"}</Text>
        <Text dimColor>  arrayState: </Text>
        <Text color={asColor}>{item.arrayState ?? "-"}</Text>
        <Text dimColor>  syncAction: </Text>
        <Text color={saColor}>{item.syncAction ?? "-"}</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Group by system
// ---------------------------------------------------------------------------

function groupBySystem(devices: DeviceInfo[]): Map<string, DeviceInfo[]> {
  const map = new Map<string, DeviceInfo[]>();
  for (const d of devices) {
    const key = d.system;
    const list = map.get(key) ?? [];
    list.push(d);
    map.set(key, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// DisksList root component
// ---------------------------------------------------------------------------

type DisksListProps = {
  data: DisksOutput;
};

export function DisksList({ data }: DisksListProps): React.ReactElement {
  const colorEnabled = useColor();
  const { devices } = data;

  if (devices.length === 0) {
    return (
      <Box paddingY={1}>
        <Text dimColor>No devices found.</Text>
      </Box>
    );
  }

  const grouped = groupBySystem(devices);

  return (
    <Box flexDirection="column" paddingY={1}>
      {Array.from(grouped.entries()).map(([system, items]) => (
        <Box key={system} flexDirection="column" marginBottom={1}>
          {/* System heading */}
          <Box>
            <Text bold color={colorEnabled ? "cyan" : undefined}>{system}</Text>
            <Text dimColor>{` — ${items.length} device${items.length !== 1 ? "s" : ""}`}</Text>
          </Box>
          <Text dimColor>{"─".repeat(50)}</Text>
          {items.map((d, i) =>
            d.kind === "disk" ? (
              <DiskRow key={`${d.name}-${i}`} item={d as DiskInfo} colorEnabled={colorEnabled} />
            ) : (
              <RaidRow key={`${d.name}-${i}`} item={d as RaidInfo} colorEnabled={colorEnabled} />
            ),
          )}
        </Box>
      ))}
      <Box>
        <Text dimColor>Total: {devices.length} device{devices.length !== 1 ? "s" : ""}</Text>
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// renderDisksList — dynamic-import entry point
// ---------------------------------------------------------------------------

export async function renderDisksList(data: DisksOutput): Promise<void> {
  const { waitUntilExit } = render(<DisksList data={data} />);
  await waitUntilExit();
}
