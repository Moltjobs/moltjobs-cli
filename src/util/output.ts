const noColor =
  process.env.NO_COLOR != null ||
  process.env.MOLT_NO_COLOR != null ||
  !process.stdout.isTTY;

const code = (open: number, close: number) =>
  noColor ? (s: string) => s : (s: string) => `[${open}m${s}[${close}m`;

export const c = {
  bold: code(1, 22),
  dim: code(2, 22),
  red: code(31, 39),
  green: code(32, 39),
  yellow: code(33, 39),
  blue: code(34, 39),
  magenta: code(35, 39),
  cyan: code(36, 39),
  gray: code(90, 39),
};

export function info(msg: string) {
  process.stderr.write(`${c.cyan("›")} ${msg}\n`);
}
export function success(msg: string) {
  process.stderr.write(`${c.green("✓")} ${msg}\n`);
}
export function warn(msg: string) {
  process.stderr.write(`${c.yellow("!")} ${msg}\n`);
}
export function fail(msg: string) {
  process.stderr.write(`${c.red("✗")} ${msg}\n`);
}

export function out(data: unknown, asJson: boolean) {
  if (asJson) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  } else if (typeof data === "string") {
    process.stdout.write(data + (data.endsWith("\n") ? "" : "\n"));
  } else {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  }
}

export function table(rows: Array<Record<string, unknown>>, columns?: string[]) {
  if (rows.length === 0) {
    process.stdout.write(c.dim("(no results)\n"));
    return;
  }
  const cols = columns ?? Object.keys(rows[0] ?? {});
  const widths = cols.map((col) =>
    Math.max(col.length, ...rows.map((r) => fmt(r[col]).length)),
  );
  const sep = "  ";
  const header = cols.map((col, i) => c.bold(pad(col, widths[i] ?? 0))).join(sep);
  process.stdout.write(header + "\n");
  process.stdout.write(cols.map((_, i) => "─".repeat(widths[i] ?? 0)).join(sep) + "\n");
  for (const row of rows) {
    const line = cols.map((col, i) => pad(fmt(row[col]), widths[i] ?? 0)).join(sep);
    process.stdout.write(line + "\n");
  }
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return c.dim("—");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function pad(s: string, n: number) {
  // pad on raw length, but s may already contain ANSI codes; recompute width.
  const w = stripAnsi(s).length;
  return s + " ".repeat(Math.max(0, n - w));
}
function stripAnsi(s: string) {
  return s.replace(/\[[0-9;]*m/g, "");
}
