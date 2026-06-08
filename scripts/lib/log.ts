// Plain stdout logger. The point of this script is to be diff-able against
// dashboard network panels, so we lean on JSON.stringify with 2-space indent.
export function step(label: string): void {
  process.stdout.write(`\n=== ${label} ===\n`);
}

export function info(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

export function kv(label: string, value: unknown): void {
  const s = typeof value === 'string' ? value : safeStringify(value, 2);
  process.stdout.write(`${label}: ${s}\n`);
}

export function safeStringify(value: unknown, indent = 0): string {
  return JSON.stringify(
    value,
    (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    indent,
  );
}

export function err(e: unknown): never {
  let msg: string;
  if (e instanceof Error) {
    msg = `${e.message}\n${e.stack ?? ''}`;
  } else if (typeof e === 'object' && e !== null) {
    // SDK throws plain objects for some errors; stringify so we can see fields.
    msg = safeStringify(e, 2);
  } else {
    msg = String(e);
  }
  process.stderr.write(`ERROR: ${msg}\n`);
  process.exit(1);
}
