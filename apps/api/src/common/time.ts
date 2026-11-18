const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Start and end of an India day, in UTC. `date` is YYYY-MM-DD; defaults to today. */
export function istDayRange(date?: string, now: Date = new Date()): { start: Date; end: Date } {
  const day = date ?? new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const start = new Date(new Date(`${day}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** Jaise "4 Nov". */
export function formatIstDate(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(d);
}

export function istYear(d: Date): number {
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCFullYear();
}
