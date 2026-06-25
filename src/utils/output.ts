import { serializeJson } from "../renderers/json.js";

export type RenderCallback<T> = (data: T) => Promise<void> | void;

export type EmitOptions<T> = {
  json?: boolean;
  noColor?: boolean;
  exitCode?: number;
  /** Dynamic import keeps Ink off the agent path — never loaded statically. */
  renderer?: RenderCallback<T>;
};

export function resolveMode(opts: { json?: boolean; noColor?: boolean }): "json" | "tty" {
  if (opts.json) return "json";
  if (!process.stdout.isTTY) return "json";
  if (process.env["CI"]) return "json";
  return "tty";
}

export async function emit<T>(data: T, opts: EmitOptions<T> = {}): Promise<void> {
  const mode = resolveMode({ json: opts.json, noColor: opts.noColor });
  const exitCode = opts.exitCode ?? 0;

  if (mode === "json") {
    process.stdout.write(serializeJson(data));
    process.exitCode = exitCode;
    return;
  }

  if (opts.noColor) {
    // Ink and Chalk both respect NO_COLOR (https://no-color.org/).
    process.env["NO_COLOR"] = "1";
  }

  if (opts.renderer) {
    await opts.renderer(data);
    process.exitCode = exitCode;
    return;
  }

  process.stdout.write(serializeJson(data));
  process.exitCode = exitCode;
}
