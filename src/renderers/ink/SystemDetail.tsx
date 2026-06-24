/**
 * renderers/ink/SystemDetail.tsx — Ink TUI renderer for `beszel system <name>`.
 *
 * REQ-2: Human/TTY path only. Dynamically imported; never statically imported
 * outside renderers/ink/.
 *
 * Renders: system snapshot fields + system_details hardware info.
 * Optional: history section when --since is used.
 */

import React from "react";
import { Box, Text, render } from "ink";
import type { SystemOutput, HistoricalEnvelope } from "../../types/output.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// The command may attach a `history` field to the system output when --since
// is used. We handle it here via an extended type.
type SystemDetailInput = SystemOutput & {
  history?: HistoricalEnvelope<Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function fmtBytes(b: number | null): string {
  if (b == null) return "-";
  const gb = b / (1024 ** 3);
  return `${gb.toFixed(1)} GB`;
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

// ---------------------------------------------------------------------------
// Field row — label: value
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  value: string;
  valueColor?: string;
}

function Field({ label, value, valueColor }: FieldProps): React.ReactElement {
  const padded = label.padEnd(18);
  return (
    <Box>
      <Text dimColor>{padded}</Text>
      <Text color={valueColor}>{value}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// SystemDetailComponent
// ---------------------------------------------------------------------------

interface SystemDetailComponentProps {
  data: SystemDetailInput;
}

function SystemDetailComponent({ data }: SystemDetailComponentProps): React.ReactElement {
  const colorEnabled = useColor();
  const { system, details, history } = data;

  const sColor = colorEnabled ? statusColor(system.status) : undefined;

  return (
    <Box flexDirection="column" paddingY={1}>
      {/* Title */}
      <Box marginBottom={1}>
        <Text bold>{system.name}</Text>
        <Text> — </Text>
        <Text color={sColor}>{system.status}</Text>
      </Box>

      {/* Snapshot metrics */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold dimColor>SNAPSHOT</Text>
        <Field label="ID" value={system.id} />
        <Field label="Host" value={system.host ?? "-"} />
        <Field label="CPU" value={fmtPct(system.cpu)} />
        <Field label="Memory" value={fmtPct(system.memPct)} />
        <Field label="Disk" value={fmtPct(system.diskPct)} />
        {system.tempC != null && (
          <Field label="Temp" value={fmtTemp(system.tempC)} />
        )}
        <Field label="Uptime" value={fmtUptime(system.uptimeS)} />
        <Field label="Agent version" value={system.agentVersion ?? "-"} />
        {system.containerCount != null && (
          <Field label="Containers" value={String(system.containerCount)} />
        )}
        {system.loadAvg != null && system.loadAvg.length === 3 && (
          <Field
            label="Load avg"
            value={`${system.loadAvg[0]?.toFixed(2)} / ${system.loadAvg[1]?.toFixed(2)} / ${system.loadAvg[2]?.toFixed(2)}`}
          />
        )}
      </Box>

      {/* Hardware details */}
      {details != null ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold dimColor>HARDWARE</Text>
          <Field label="Hostname" value={details.hostname ?? "-"} />
          <Field label="OS" value={details.os ?? "-"} />
          <Field label="Kernel" value={details.kernel ?? "-"} />
          <Field label="CPU model" value={details.cpuModel ?? "-"} />
          <Field label="Arch" value={details.arch ?? "-"} />
          <Field label="Cores / threads" value={`${details.cores ?? "-"} / ${details.threads ?? "-"}`} />
          <Field label="Memory total" value={fmtBytes(details.memoryBytes)} />
          {details.podman === true && (
            <Field label="Runtime" value="Podman" />
          )}
        </Box>
      ) : (
        <Box marginBottom={1}>
          <Text dimColor>No hardware details available.</Text>
        </Box>
      )}

      {/* Historical envelope summary */}
      {history != null && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold dimColor>HISTORY</Text>
          <Field label="Interval" value={history.interval} />
          <Field label="From" value={history.from} />
          <Field label="To" value={history.to} />
          <Field label="Data points" value={String(history.points.length)} />
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// renderSystemDetail — dynamic-import entry point
// ---------------------------------------------------------------------------

export async function renderSystemDetail(data: SystemOutput): Promise<void> {
  const { waitUntilExit } = render(
    <SystemDetailComponent data={data as SystemDetailInput} />,
  );
  await waitUntilExit();
}
