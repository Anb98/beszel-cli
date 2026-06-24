/**
 * test/renderers/HealthReport.test.tsx — Render smoke tests for HealthReport.
 *
 * Uses ink-testing-library to render to a virtual stdout.
 * Tests do NOT import Ink into the core.
 *
 * Coverage:
 *   - Healthy fleet: "Healthy" appears, no issue blocks
 *   - Unhealthy fleet with CRITICAL: "CRITICAL" section, issue details visible
 *   - Warning-only fleet: "WARNINGS" section appears, no CRITICAL section
 *   - Checked count appears in output
 */

import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "ink-testing-library";
import { HealthReportComponent } from "../../src/renderers/ink/HealthReport.js";
import type { HealthReport } from "../../src/types/output.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HEALTHY_FIXTURE: HealthReport = {
  healthy: true,
  issues: [],
  checked: 3,
};

const CRITICAL_FIXTURE: HealthReport = {
  healthy: false,
  issues: [
    {
      system: "OrangePi",
      severity: "crit",
      kind: "down",
      detail: "System status is down",
    },
    {
      system: "Home Lab",
      severity: "crit",
      kind: "smart",
      detail: "Disk /dev/sda state FAILED",
    },
  ],
  checked: 3,
};

const WARN_ONLY_FIXTURE: HealthReport = {
  healthy: false,
  issues: [
    {
      system: "Zima blade",
      severity: "warn",
      kind: "disk",
      detail: "diskPct 92% exceeds warn threshold 90%",
    },
  ],
  checked: 2,
};

const MIXED_FIXTURE: HealthReport = {
  healthy: false,
  issues: [
    {
      system: "Home Lab",
      severity: "crit",
      kind: "raid",
      detail: "RAID arrayState: degraded",
    },
    {
      system: "Zima blade",
      severity: "warn",
      kind: "temp",
      detail: "displayTempC 83°C exceeds warn threshold 80°C",
    },
  ],
  checked: 3,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getOutput(lastFrame: () => string | undefined): string {
  return lastFrame() ?? "";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
});

describe("HealthReport — smoke render", () => {
  describe("healthy fleet", () => {
    it("renders Healthy status", () => {
      const { lastFrame } = render(<HealthReportComponent data={HEALTHY_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("Healthy");
    });

    it("renders checked count", () => {
      const { lastFrame } = render(<HealthReportComponent data={HEALTHY_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("3");
    });

    it("does not render CRITICAL section when no issues", () => {
      const { lastFrame } = render(<HealthReportComponent data={HEALTHY_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).not.toContain("CRITICAL");
    });
  });

  describe("fleet with CRITICAL issues", () => {
    it("renders Unhealthy status", () => {
      const { lastFrame } = render(<HealthReportComponent data={CRITICAL_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("Unhealthy");
    });

    it("renders CRITICAL section header", () => {
      const { lastFrame } = render(<HealthReportComponent data={CRITICAL_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("CRITICAL");
    });

    it("renders issue details including system name", () => {
      const { lastFrame } = render(<HealthReportComponent data={CRITICAL_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("OrangePi");
      expect(output).toContain("Home Lab");
    });

    it("renders kind labels", () => {
      const { lastFrame } = render(<HealthReportComponent data={CRITICAL_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("System down");
      expect(output).toContain("SMART failure");
    });

    it("renders issue detail text", () => {
      const { lastFrame } = render(<HealthReportComponent data={CRITICAL_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("System status is down");
    });
  });

  describe("warning-only fleet", () => {
    it("renders Unhealthy status (warnings make fleet unhealthy)", () => {
      const { lastFrame } = render(<HealthReportComponent data={WARN_ONLY_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("Unhealthy");
    });

    it("renders WARNINGS section", () => {
      const { lastFrame } = render(<HealthReportComponent data={WARN_ONLY_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("WARNINGS");
    });

    it("does not render CRITICAL section", () => {
      const { lastFrame } = render(<HealthReportComponent data={WARN_ONLY_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).not.toContain("CRITICAL");
    });

    it("renders warning system name", () => {
      const { lastFrame } = render(<HealthReportComponent data={WARN_ONLY_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("Zima blade");
    });
  });

  describe("mixed critical + warning fleet", () => {
    it("renders both CRITICAL and WARNINGS sections", () => {
      const { lastFrame } = render(<HealthReportComponent data={MIXED_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("CRITICAL");
      expect(output).toContain("WARNINGS");
    });

    it("renders RAID issue kind label", () => {
      const { lastFrame } = render(<HealthReportComponent data={MIXED_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("RAID issue");
    });

    it("renders temp issue kind label", () => {
      const { lastFrame } = render(<HealthReportComponent data={MIXED_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("Temperature");
    });
  });
});
