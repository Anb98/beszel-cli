import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "ink-testing-library";
import { SystemsTable } from "../../src/renderers/ink/SystemsTable.js";
import type { SystemsOutput } from "../../src/types/output.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SYSTEMS_FIXTURE: SystemsOutput = {
  systems: [
    {
      id: "s1",
      name: "Home Lab",
      host: "home.local",
      status: "up",
      cpu: 12.5,
      memPct: 63.2,
      diskPct: 45.1,
      uptimeS: 86400 * 3 + 3600 * 2,
      agentVersion: "0.18.7",
      tempC: 52.0,
      containerCount: 12,
    },
    {
      id: "s2",
      name: "OrangePi",
      host: "pi.local",
      status: "down",
      cpu: null,
      memPct: null,
      diskPct: null,
      uptimeS: null,
      agentVersion: null,
    },
    {
      id: "s3",
      name: "Zima blade",
      host: "zima.local",
      status: "paused",
      cpu: 3.1,
      memPct: 22.0,
      diskPct: 88.5,
      uptimeS: 7200,
      agentVersion: "0.18.5",
    },
  ],
};

const EMPTY_FIXTURE: SystemsOutput = { systems: [] };

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

describe("SystemsTable — smoke render", () => {
  describe("fleet with systems", () => {
    it("renders header labels", () => {
      const { lastFrame } = render(<SystemsTable data={SYSTEMS_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("NAME");
      expect(output).toContain("STATUS");
      expect(output).toContain("CPU");
      expect(output).toContain("MEM");
      expect(output).toContain("DISK");
      expect(output).toContain("UPTIME");
      expect(output).toContain("AGENT");
    });

    it("renders system names", () => {
      const { lastFrame } = render(<SystemsTable data={SYSTEMS_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("Home Lab");
      expect(output).toContain("OrangePi");
      expect(output).toContain("Zima blade");
    });

    it("renders system statuses", () => {
      const { lastFrame } = render(<SystemsTable data={SYSTEMS_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("up");
      expect(output).toContain("down");
      expect(output).toContain("paused");
    });

    it("renders cpu percentage for systems with data", () => {
      const { lastFrame } = render(<SystemsTable data={SYSTEMS_FIXTURE} />);
      const output = getOutput(lastFrame);
      // Home Lab has cpu 12.5
      expect(output).toContain("12.5%");
    });

    it("renders dash for null metrics", () => {
      const { lastFrame } = render(<SystemsTable data={SYSTEMS_FIXTURE} />);
      const output = getOutput(lastFrame);
      // OrangePi has all-null metrics; at least one dash should appear
      expect(output).toContain("-");
    });

    it("renders uptime in human-readable form", () => {
      const { lastFrame } = render(<SystemsTable data={SYSTEMS_FIXTURE} />);
      const output = getOutput(lastFrame);
      // Home Lab: 3d 2h uptime
      expect(output).toContain("3d");
    });

    it("renders summary count line", () => {
      const { lastFrame } = render(<SystemsTable data={SYSTEMS_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("3 systems");
    });

    it("renders agent version", () => {
      const { lastFrame } = render(<SystemsTable data={SYSTEMS_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("0.18.7");
    });
  });

  describe("empty fleet", () => {
    it("renders 'No systems found' message", () => {
      const { lastFrame } = render(<SystemsTable data={EMPTY_FIXTURE} />);
      const output = getOutput(lastFrame);
      expect(output).toContain("No systems found");
    });

    it("does not render header when fleet is empty", () => {
      const { lastFrame } = render(<SystemsTable data={EMPTY_FIXTURE} />);
      const output = getOutput(lastFrame);
      // With no systems, header should not render
      expect(output).not.toContain("AGENT");
    });
  });
});
