import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ABBREVIATED_KEYS = [
  // systems.info abbreviated keys
  "mp",  // → memPct
  "dp",  // → diskPct
  "dt",  // → displayTempC
  "efs", // → extraFs
  // Note: "u", "v", "ct", "la", "cpu" are NOT listed as they are also valid
  // variable names in other contexts; only the truly opaque abbreviations are guarded.
  // container_stats abbreviated keys
  "c",   // → cpuPct  (but too short/common, skip)
  // system_stats abbreviated keys
  "mu",  // → memUsedGB
  "du",  // → diskUsedGB
  "dw",  // → diskWrite
  "mb",  // → memBufCacheGB
] as const;

const EXEMPT_FILES = new Set([
  "mapping/key-map.ts",
  "types/upstream.ts",
]);

function collectTsFiles(dir: string, relBase: string): Array<{ abs: string; rel: string }> {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: Array<{ abs: string; rel: string }> = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.join(relBase, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(fullPath, relPath));
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push({ abs: fullPath, rel: relPath });
    }
  }
  return files;
}

/**
 * Build patterns that match property access on the abbreviated key.
 * We look for: .mp, ["mp"], ['mp'] in actual code, NOT in comments or strings.
 * We are deliberately conservative and do NOT flag plain string literals like
 * "mp" used in filter strings, only property-access contexts.
 *
 * Conservative approach: skip lines that are JSDoc/comment lines or that only
 * reference the key inside a description string context.
 */
function buildPropertyAccessPattern(key: string): RegExp {
  // Match: .mp / ["mp"] / ['mp'] — property access on abbreviated key
  return new RegExp(
    `\\.${key}\\b|\\["${key}"\\]|\\['${key}'\\]`,
    "g",
  );
}

/**
 * Returns true if the line appears to be a comment or JSDoc line, or if the
 * match occurs purely inside a string literal (as a documentation note).
 */
function isCommentOrDocLine(line: string): boolean {
  const trimmed = line.trim();
  // JSDoc / block comment line: starts with * or /**  or //
  if (trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/**")) {
    return true;
  }
  return false;
}

/**
 * Returns true if the match on the line is inside a string (description field)
 * rather than as a code expression. We detect this by checking whether the
 * match appears inside a quoted string value that follows `description:`.
 */
function isInsideDescriptionString(line: string, key: string): boolean {
  // Pattern: description: "...info.dt..." or description: '...info.dt...'
  // The key appears in a descriptive prose string, not as a code expression.
  // Heuristic: if the entire ".<key>" occurrence is inside a quoted string
  // that also contains words like "info." or "→" or "from", it's prose.
  const inString = /description\s*:\s*["']/.test(line);
  if (!inString) return false;
  // Check if the abbreviated key appears as part of a dot-path in prose
  // like "info.dt" or "systems.info.dt" — preceded by another identifier char
  const prosePattern = new RegExp(`[a-zA-Z_]\\.${key}\\b`);
  return prosePattern.test(line);
}

const srcDir = path.resolve(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "../../src",
);

describe("Key-map centralization boundary", () => {
  it("abbreviated upstream keys are not accessed outside key-map.ts", () => {
    const allFiles = collectTsFiles(srcDir, "");
    const violations: string[] = [];

    for (const { abs, rel } of allFiles) {
      // Skip exempt files
      if (EXEMPT_FILES.has(rel)) continue;

      const content = fs.readFileSync(abs, "utf-8");
      const lines = content.split("\n");

      for (const key of ABBREVIATED_KEYS) {
        const pattern = buildPropertyAccessPattern(key);
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx]!;
          if (!pattern.test(line)) continue;
          // Skip comment/JSDoc lines — they may reference abbreviated keys in prose
          if (isCommentOrDocLine(line)) continue;
          // Skip lines where the key appears only inside a description string
          if (isInsideDescriptionString(line, key)) continue;
          violations.push(
            `src/${rel}:${lineIdx + 1}: abbreviated key ".${key}" accessed outside key-map.ts\n    > ${line.trim()}`,
          );
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Key-map centralization violation:\n\n${violations.join("\n\n")}\n\n` +
          `Abbreviated upstream keys must only be accessed in src/mapping/key-map.ts. ` +
          `Other modules must use canonical output field names only.`,
      );
    }
  });

  it("src/mapping/key-map.ts exists and is the single translation point", () => {
    const keyMapPath = path.join(srcDir, "mapping", "key-map.ts");
    expect(fs.existsSync(keyMapPath), "src/mapping/key-map.ts must exist").toBe(true);

    const content = fs.readFileSync(keyMapPath, "utf-8");

    // It should contain at least some of the known abbreviated keys as property accesses.
    const hasMp = /\.mp\b/.test(content);
    const hasDp = /\.dp\b/.test(content);
    const hasDt = /\.dt\b/.test(content);
    const hasEfs = /\.efs\b/.test(content);

    expect(hasMp, "key-map.ts should access .mp (memPct)").toBe(true);
    expect(hasDp, "key-map.ts should access .dp (diskPct)").toBe(true);
    expect(hasDt, "key-map.ts should access .dt (displayTempC)").toBe(true);
    expect(hasEfs, "key-map.ts should access .efs (extraFs)").toBe(true);
  });
});
