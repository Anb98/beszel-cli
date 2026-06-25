/**
 * renderers/ink/HealthReport.tsx — Ink TUI renderer for `beszel health`.
 *
 * REQ-2: Human/TTY path only. Dynamically imported from commands/health.ts.
 *
 * Renders:
 *   - Green check + "Healthy" when healthy:true
 *   - Issues grouped by severity (crit=red, warn=yellow)
 *   - Summary line with system count checked
 */

import React from "react";
import { Box, Text, render } from "ink";
import type { HealthReport as HealthReportData, HealthIssue, IssueSeverity } from "../../types/output.js";

function useColor(): boolean {
  return !process.env["NO_COLOR"];
}

function severityColor(sev: IssueSeverity, colorEnabled: boolean): string | undefined {
  if (!colorEnabled) return undefined;
  return sev === "crit" ? "red" : "yellow";
}

function severityLabel(sev: IssueSeverity): string {
  return sev === "crit" ? "CRITICAL" : "WARNING";
}

/** Kind display labels. */
function kindLabel(kind: string): string {
  switch (kind) {
    case "down":
      return "System down";
    case "smart":
      return "SMART failure";
    case "raid":
      return "RAID issue";
    case "disk":
      return "Disk usage";
    case "temp":
      return "Temperature";
    default:
      return kind;
  }
}

type IssueRowProps = {
  issue: HealthIssue;
  colorEnabled: boolean;
};

function IssueRow({ issue, colorEnabled }: IssueRowProps): React.ReactElement {
  const color = severityColor(issue.severity, colorEnabled);
  return (
    <Box marginLeft={2}>
      <Text color={color}>{severityLabel(issue.severity).padEnd(10)}</Text>
      <Text>{kindLabel(issue.kind).padEnd(16)}</Text>
      <Text dimColor>{issue.system.padEnd(18)}</Text>
      <Text>{issue.detail}</Text>
    </Box>
  );
}

type HealthReportComponentProps = {
  data: HealthReportData;
};

export function HealthReportComponent({ data }: HealthReportComponentProps): React.ReactElement {
  const colorEnabled = useColor();
  const { healthy, issues, checked } = data;

  const crits = issues.filter((i) => i.severity === "crit");
  const warns = issues.filter((i) => i.severity === "warn");

  return (
    <Box flexDirection="column" paddingY={1}>
      {/* Status banner */}
      {healthy ? (
        <Box marginBottom={1}>
          <Text color={colorEnabled ? "green" : undefined} bold>
            {colorEnabled ? "✓" : "[OK]"} Healthy
          </Text>
          <Text dimColor>  — all {checked} system{checked !== 1 ? "s" : ""} pass</Text>
        </Box>
      ) : (
        <Box marginBottom={1}>
          <Text color={colorEnabled ? "red" : undefined} bold>
            {colorEnabled ? "✗" : "[FAIL]"} Unhealthy
          </Text>
          <Text dimColor>
            {" "}— {issues.length} issue{issues.length !== 1 ? "s" : ""} across {checked} system{checked !== 1 ? "s" : ""}
          </Text>
        </Box>
      )}

      {/* Critical issues section */}
      {crits.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={colorEnabled ? "red" : undefined}>
            CRITICAL ({crits.length})
          </Text>
          {crits.map((issue, i) => (
            <IssueRow key={i} issue={issue} colorEnabled={colorEnabled} />
          ))}
        </Box>
      )}

      {/* Warning issues section */}
      {warns.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={colorEnabled ? "yellow" : undefined}>
            WARNINGS ({warns.length})
          </Text>
          {warns.map((issue, i) => (
            <IssueRow key={i} issue={issue} colorEnabled={colorEnabled} />
          ))}
        </Box>
      )}

      {/* Summary */}
      <Box>
        <Text dimColor>Checked {checked} system{checked !== 1 ? "s" : ""}</Text>
        {issues.length === 0 && <Text dimColor> — no issues found</Text>}
      </Box>
    </Box>
  );
}

export async function renderHealthReport(data: HealthReportData): Promise<void> {
  const { waitUntilExit } = render(<HealthReportComponent data={data} />);
  await waitUntilExit();
}
