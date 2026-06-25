import React from "react";
import { Box, Text, render } from "ink";
import type { SystemsOutput, SystemItem } from "../../types/output.js";

function useColor(): boolean {
  return !process.env["NO_COLOR"];
}

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "up":
      return "green";
    case "down":
      return "red";
    case "paused":
      return "yellow";
    default:
      return "gray";
  }
}

function fmtPct(v: number | null): string {
  if (v == null) return "-";
  return `${v.toFixed(1)}%`;
}

function fmtTemp(v: number | undefined | null): string {
  if (v == null) return "-";
  return `${v.toFixed(1)}°C`;
}

function fmtUptime(s: number | null): string {
  if (s == null) return "-";
  const days = Math.floor(s / 86400);
  const hrs = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function fmtAgent(v: string | null): string {
  return v ?? "-";
}

const COL_WIDTHS = {
  name: 18,
  status: 8,
  cpu: 7,
  mem: 7,
  disk: 7,
  temp: 8,
  uptime: 10,
  agent: 10,
};

function pad(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

type RowProps = {
  item: SystemItem;
  useColorOutput: boolean;
};

function Row({ item, useColorOutput }: RowProps): React.ReactElement {
  const color = useColorOutput ? statusColor(item.status) : undefined;

  return (
    <Box>
      <Text>{pad(item.name, COL_WIDTHS.name)}</Text>
      <Text color={color}>{pad(item.status, COL_WIDTHS.status)}</Text>
      <Text>{pad(fmtPct(item.cpu), COL_WIDTHS.cpu)}</Text>
      <Text>{pad(fmtPct(item.memPct), COL_WIDTHS.mem)}</Text>
      <Text>{pad(fmtPct(item.diskPct), COL_WIDTHS.disk)}</Text>
      <Text>{pad(fmtTemp(item.tempC), COL_WIDTHS.temp)}</Text>
      <Text>{pad(fmtUptime(item.uptimeS), COL_WIDTHS.uptime)}</Text>
      <Text>{pad(fmtAgent(item.agentVersion), COL_WIDTHS.agent)}</Text>
    </Box>
  );
}

function Header(): React.ReactElement {
  return (
    <Box>
      <Text bold>{pad("NAME", COL_WIDTHS.name)}</Text>
      <Text bold>{pad("STATUS", COL_WIDTHS.status)}</Text>
      <Text bold>{pad("CPU", COL_WIDTHS.cpu)}</Text>
      <Text bold>{pad("MEM", COL_WIDTHS.mem)}</Text>
      <Text bold>{pad("DISK", COL_WIDTHS.disk)}</Text>
      <Text bold>{pad("TEMP", COL_WIDTHS.temp)}</Text>
      <Text bold>{pad("UPTIME", COL_WIDTHS.uptime)}</Text>
      <Text bold>{pad("AGENT", COL_WIDTHS.agent)}</Text>
    </Box>
  );
}

function Divider(): React.ReactElement {
  const totalWidth =
    COL_WIDTHS.name +
    COL_WIDTHS.status +
    COL_WIDTHS.cpu +
    COL_WIDTHS.mem +
    COL_WIDTHS.disk +
    COL_WIDTHS.temp +
    COL_WIDTHS.uptime +
    COL_WIDTHS.agent;
  return <Text dimColor>{"─".repeat(totalWidth)}</Text>;
}

type SystemsTableProps = {
  data: SystemsOutput;
};

export function SystemsTable({ data }: SystemsTableProps): React.ReactElement {
  const colorEnabled = useColor();
  const { systems } = data;

  if (systems.length === 0) {
    return (
      <Box paddingY={1}>
        <Text dimColor>No systems found.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box paddingBottom={0}>
        <Header />
      </Box>
      <Divider />
      {systems.map((item) => (
        <Row key={item.id} item={item} useColorOutput={colorEnabled} />
      ))}
      <Box paddingTop={1}>
        <Text dimColor>{systems.length} system{systems.length !== 1 ? "s" : ""}</Text>
      </Box>
    </Box>
  );
}

/**
 * Called via dynamic import from the TTY branch in emit().
 * Renders the SystemsTable component and resolves when Ink is done.
 */
export async function renderSystemsTable(data: SystemsOutput): Promise<void> {
  const { waitUntilExit } = render(<SystemsTable data={data} />);
  await waitUntilExit();
}
