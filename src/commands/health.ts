/**
 * commands/health.ts — beszel health command handler.
 *
 * REQ-8: Fleet health evaluation with configurable thresholds.
 * Gathers: systems + smart_devices (all systems) + temps sensors,
 * runs evaluateHealth(), emits HealthReport, sets exit code via healthExitCode().
 *
 * Threshold flags (design R2):
 *   --disk-warn, --disk-crit, --temp-warn, --temp-crit,
 *   --disk-temp-warn, --disk-temp-crit, --strict
 *
 * Exit codes (design R5):
 *   0 = healthy or warning-only fleet
 *   1 = any CRITICAL issue (or --strict with any warning)
 *
 * This module is Ink-free (REQ-2 boundary). No static Ink/React import.
 */

import type { Command } from "commander";
import { loadConfig } from "../client/config.js";
import { createClient } from "../client/beszelClient.js";
import { fetchSystems } from "../queries/systems.js";
import { fetchDisks } from "../queries/disks.js";
import { fetchTemps } from "../queries/temps.js";
import { resolveThresholds } from "../health/thresholds.js";
import { evaluateHealth, healthExitCode } from "../health/severity.js";
import type { HealthSystem, HealthDevice } from "../health/severity.js";
import type { SystemItem } from "../types/output.js";
import { emit, resolveMode, type RenderCallback } from "../utils/output.js";
import { handleError } from "../utils/errors.js";
import type { HealthReport as HealthReportData } from "../types/output.js";

export function registerHealth(program: Command): void {
  program
    .command("health")
    .description("Evaluate fleet health — checks status, SMART, RAID, disks, temps")
    .option("--disk-warn <pct>", "Disk usage warning threshold % (default 90)", parseFloat)
    .option("--disk-crit <pct>", "Disk usage critical threshold % (default 95)", parseFloat)
    .option("--temp-warn <c>", "System temperature warning threshold °C (default 80)", parseFloat)
    .option("--temp-crit <c>", "System temperature critical threshold °C (default 90)", parseFloat)
    .option("--disk-temp-warn <c>", "Disk temperature warning threshold °C (default 55)", parseFloat)
    .option("--disk-temp-crit <c>", "Disk temperature critical threshold °C (default 65)", parseFloat)
    .option("--strict", "Promote all warnings to critical (exit 1 when any issue)")
    .action(
      async (
        opts: {
          diskWarn?: number;
          diskCrit?: number;
          tempWarn?: number;
          tempCrit?: number;
          diskTempWarn?: number;
          diskTempCrit?: number;
          strict?: boolean;
        },
        cmd: Command,
      ) => {
        const globalOpts = cmd.optsWithGlobals() as {
          json?: boolean;
          noColor?: boolean;
          noCache?: boolean;
        };

        const json = resolveMode({ json: globalOpts.json }) === "json";

        try {
          const config = loadConfig();
          const client = await createClient(config, globalOpts.noCache ?? false);

          const thresholds = resolveThresholds({
            diskWarn: opts.diskWarn,
            diskCrit: opts.diskCrit,
            tempWarn: opts.tempWarn,
            tempCrit: opts.tempCrit,
            diskTempWarn: opts.diskTempWarn,
            diskTempCrit: opts.diskTempCrit,
            strict: opts.strict,
          });

          const [systemsResult, disksResult, tempsResult] = await Promise.all([
            fetchSystems(client),
            fetchDisks(client),
            fetchTemps(client),
          ]);

          const sensorsBySystem = new Map<string, Record<string, number>>();
          for (const tempInfo of tempsResult.systems) {
            sensorsBySystem.set(tempInfo.system, tempInfo.sensors);
          }

          const healthSystems: HealthSystem[] = systemsResult.systems.map(
            (s: SystemItem) => ({
              name: s.name,
              status: s.status,
              diskPct: s.diskPct,
              displayTempC: s.tempC ?? null,
              sensors: sensorsBySystem.get(s.name) ?? {},
            }),
          );

          const healthDevices: HealthDevice[] = disksResult.devices.map((d) => ({
            system: d.system,
            kind: d.kind,
            state: "state" in d ? d.state : undefined,
            tempC: "tempC" in d ? d.tempC : undefined,
            arrayState: "arrayState" in d ? d.arrayState : undefined,
            syncAction: "syncAction" in d ? d.syncAction : undefined,
          }));

          const report = evaluateHealth(healthSystems, healthDevices, thresholds);
          const exitCode = healthExitCode(report);

          const renderer: RenderCallback<HealthReportData> = async (data) => {
            const { renderHealthReport } = await import("../renderers/ink/HealthReport.js");
            await renderHealthReport(data);
          };

          await emit(report, { json, noColor: globalOpts.noColor, exitCode, renderer });
        } catch (err) {
          handleError(err, { json });
        }
      },
    );
}
