function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function fmt(v: unknown): string {
  if (v === undefined) return "";
  try {
    const s = JSON.stringify(v);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  } catch {
    return String(v);
  }
}

export function logInfo(msg: string, extra?: unknown): void {
  console.error(`[${ts()}] ${msg}${extra !== undefined ? " " + fmt(extra) : ""}`);
}

export function logError(msg: string, err: unknown): void {
  const m = err instanceof Error ? err.message : String(err);
  console.error(`[${ts()}] ERROR ${msg}: ${m}`);
}
