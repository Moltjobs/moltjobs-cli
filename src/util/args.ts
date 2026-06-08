/**
 * Minimal POSIX-ish arg parser. No external dep.
 *
 * Recognises:
 *   --flag         → flag=true
 *   --flag=value   → flag=value
 *   --flag value   → flag=value      (when next token isn't another flag)
 *   --no-flag      → flag=false
 *   -x             → x=true
 *   --             → end of options; rest are positionals
 *
 * Returns { positional: string[], options: Record<string, string|boolean|string[]> }
 * Repeated flags become arrays.
 */

export interface ParsedArgs {
  positional: string[];
  options: Record<string, string | boolean | string[]>;
}

const KNOWN_VALUE_FLAGS = new Set([
  "api-key",
  "api-url",
  "agent-id",
  "agent",
  "amount",
  "cover-letter",
  "vertical",
  "status",
  "limit",
  "cursor",
  "q",
  "query",
  "to",
  "to-address",
  "name",
  "owner-email",
  "description",
  "reason",
  "output",
  "proof-hash",
  "job-id",
  "scope",
  "env",
]);

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const options: ParsedArgs["options"] = {};
  let i = 0;
  let onlyPositional = false;
  while (i < argv.length) {
    const tok = argv[i]!;
    if (onlyPositional) {
      positional.push(tok);
      i++;
      continue;
    }
    if (tok === "--") {
      onlyPositional = true;
      i++;
      continue;
    }
    if (tok.startsWith("--")) {
      const rest = tok.slice(2);
      if (rest.startsWith("no-")) {
        set(options, rest.slice(3), false);
        i++;
        continue;
      }
      const eq = rest.indexOf("=");
      if (eq >= 0) {
        set(options, rest.slice(0, eq), rest.slice(eq + 1));
        i++;
        continue;
      }
      // Known value-flag followed by a non-flag token → consume it as the value.
      // Otherwise treat as a bare boolean flag.
      const next = argv[i + 1];
      if (
        KNOWN_VALUE_FLAGS.has(rest) &&
        next !== undefined &&
        !next.startsWith("-")
      ) {
        set(options, rest, next);
        i += 2;
        continue;
      }
      set(options, rest, true);
      i++;
      continue;
    }
    if (tok.startsWith("-") && tok.length > 1) {
      for (const ch of tok.slice(1)) set(options, ch, true);
      i++;
      continue;
    }
    positional.push(tok);
    i++;
  }
  return { positional, options };
}

function set(options: ParsedArgs["options"], key: string, value: string | boolean) {
  const existing = options[key];
  if (existing === undefined) {
    options[key] = value;
  } else if (Array.isArray(existing)) {
    if (typeof value === "string") existing.push(value);
  } else if (typeof existing === "string" && typeof value === "string") {
    options[key] = [existing, value];
  } else {
    options[key] = value;
  }
}

function isNumericy(s: string) {
  return /^-?\d+(\.\d+)?$/.test(s);
}

export function flag(opts: ParsedArgs["options"], names: string[]): string | undefined {
  for (const n of names) {
    const v = opts[n];
    if (typeof v === "string") return v;
  }
  return undefined;
}

export function boolFlag(opts: ParsedArgs["options"], names: string[]): boolean {
  for (const n of names) {
    if (opts[n] === true) return true;
  }
  return false;
}
