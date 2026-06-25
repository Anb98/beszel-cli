/**
 * test/boundary/ink-free-core.test.ts — Static dependency-graph boundary assertion.
 *
 * REQ-2: The Ink-free data core (client, queries, types, mapping, health, utils)
 * MUST contain NO static `from 'ink'` or `from 'react'` import (and no dynamic
 * import of them either).
 *
 * This test scans the source text of every .ts file in the boundary directories
 * and fails loudly if any ink or react import is found.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const INK_FREE_DIRS = [
  "client",
  "queries",
  "types",
  "mapping",
  "health",
  "utils",
] as const;

const VIOLATION_PATTERNS = [
  // Static ESM imports
  /from\s+['"]ink['"]/,
  /from\s+['"]react['"]/,
  /from\s+['"]react-dom['"]/,
  // Dynamic imports
  /import\s*\(\s*['"]ink['"]/,
  /import\s*\(\s*['"]react['"]/,
  /import\s*\(\s*['"]react-dom['"]/,
  // Require (should not appear in ESM, but guard anyway)
  /require\s*\(\s*['"]ink['"]/,
  /require\s*\(\s*['"]react['"]/,
];

/**
 * Recursively collect all .ts files under a directory (excludes .d.ts files
 * that might be in dist/ or node_modules/ — we only scan src/).
 */
function collectTsFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function findViolations(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const violations: string[] = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;
    for (const pattern of VIOLATION_PATTERNS) {
      if (pattern.test(line)) {
        violations.push(`  Line ${lineIdx + 1}: ${line.trim()}`);
        break; // one violation per line is enough
      }
    }
  }

  return violations;
}

const srcDir = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), "../../src");

describe("Ink-free core boundary", () => {
  for (const dir of INK_FREE_DIRS) {
    const absDir = path.join(srcDir, dir);

    it(`src/${dir}/ contains no ink/react imports`, () => {
      // If the directory doesn't exist, fail descriptively.
      expect(fs.existsSync(absDir), `Directory src/${dir}/ does not exist`).toBe(true);

      const files = collectTsFiles(absDir);
      const allViolations: string[] = [];

      for (const file of files) {
        const relPath = path.relative(srcDir, file);
        const violations = findViolations(file);
        if (violations.length > 0) {
          allViolations.push(`src/${relPath}:\n${violations.join("\n")}`);
        }
      }

      if (allViolations.length > 0) {
        throw new Error(
          `Ink/React boundary violation in core modules:\n\n${allViolations.join("\n\n")}\n\n` +
            `These directories must remain Ink-free (REQ-2). ` +
            `Use dynamic import() ONLY inside renderers/ink/ components.`,
        );
      }
    });
  }

  it("src/commands/ contains no STATIC ink/react imports", () => {
    const commandsDir = path.join(srcDir, "commands");
    expect(fs.existsSync(commandsDir), "Directory src/commands/ does not exist").toBe(true);

    const files = collectTsFiles(commandsDir);
    const allViolations: string[] = [];

    // Commands may use dynamic import() for renderers, but must NOT have static imports.
    const STATIC_ONLY_PATTERNS = [
      /^import\s.*from\s+['"]ink['"]/m,
      /^import\s.*from\s+['"]react['"]/m,
      /^import\s.*from\s+['"]react-dom['"]/m,
    ];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf-8");
      const relPath = path.relative(srcDir, file);

      for (const pattern of STATIC_ONLY_PATTERNS) {
        if (pattern.test(content)) {
          allViolations.push(`src/${relPath}: static ink/react import detected`);
        }
      }
    }

    if (allViolations.length > 0) {
      throw new Error(
        `Static Ink/React import in commands/:\n\n${allViolations.join("\n")}\n\n` +
          `Commands may only use dynamic import() for renderer callbacks (REQ-2).`,
      );
    }
  });
});
