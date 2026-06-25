import React from "react";
import { Box, Text, render } from "ink";
import type { TempsOutput, TempInfo } from "../../types/output.js";

function useColor(): boolean {
  return !process.env["NO_COLOR"];
}

/**
 * Color-code a temperature reading against common thresholds.
 * Warn threshold: 80°C (system) / 55°C (disk). Crit: 90°C / 65°C.
 * We use generic thresholds here since we don't have the configured thresholds
 * at render time. Defaults match the resolveThresholds() defaults.
 */
function tempColor(celsius: number, colorEnabled: boolean, isDisk = false): string | undefined {
  if (!colorEnabled) return undefined;
  const critThreshold = isDisk ? 65 : 90;
  const warnThreshold = isDisk ? 55 : 80;
  if (celsius >= critThreshold) return "red";
  if (celsius >= warnThreshold) return "yellow";
  return "green";
}

function fmtTemp(v: number | null): string {
  if (v == null) return "-";
  return `${v.toFixed(1)}°C`;
}

type TempBlockProps = {
  info: TempInfo;
  colorEnabled: boolean;
};

function TempBlock({ info, colorEnabled }: TempBlockProps): React.ReactElement {
  const sensorEntries = Object.entries(info.sensors).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const isDiskSensor = (key: string): boolean =>
    key.includes("_temp") || key.includes("sda") || key.includes("nvme") || key.includes("sd");

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* System heading */}
      <Box>
        <Text bold color={colorEnabled ? "cyan" : undefined}>{info.system}</Text>
        {info.displayTempC != null && (
          <>
            <Text dimColor>  display: </Text>
            <Text color={tempColor(info.displayTempC, colorEnabled)}>
              {fmtTemp(info.displayTempC)}
            </Text>
          </>
        )}
      </Box>

      {/* Per-sensor breakdown */}
      {sensorEntries.length > 0 ? (
        <Box flexDirection="column" marginLeft={2}>
          {sensorEntries.map(([key, val]) => {
            const disk = isDiskSensor(key);
            return (
              <Box key={key}>
                <Text dimColor>{key.padEnd(22)}</Text>
                <Text color={tempColor(val, colorEnabled, disk)}>
                  {fmtTemp(val)}
                </Text>
              </Box>
            );
          })}
        </Box>
      ) : (
        <Box marginLeft={2}>
          <Text dimColor>No sensor data available.</Text>
        </Box>
      )}
    </Box>
  );
}

type TempsListProps = {
  data: TempsOutput;
};

export function TempsList({ data }: TempsListProps): React.ReactElement {
  const colorEnabled = useColor();
  const { systems } = data;

  if (systems.length === 0) {
    return (
      <Box paddingY={1}>
        <Text dimColor>No temperature data found.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingY={1}>
      {systems.map((info) => (
        <TempBlock key={info.system} info={info} colorEnabled={colorEnabled} />
      ))}
      <Box>
        <Text dimColor>{systems.length} system{systems.length !== 1 ? "s" : ""} checked</Text>
      </Box>
    </Box>
  );
}

export async function renderTempsList(data: TempsOutput): Promise<void> {
  const { waitUntilExit } = render(<TempsList data={data} />);
  await waitUntilExit();
}
