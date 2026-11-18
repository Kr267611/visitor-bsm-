const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Start and end of an India day, in UTC. `date` is YYYY-MM-DD; defaults to today. */
export function istDayRange(date?: string, now: Date = new Date()): { start: Date; end: Date } {
  const day = date ?? new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const start = new Date(new Date(`${day}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** For example "4 Nov". */
export function formatIstDate(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(d);
}

export function istYear(d: Date): number {
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCFullYear();
}

/** Current India time as "HH:MM" (24-hour), for comparing with visiting hours. */
export function istClock(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(11, 16);
}

/** Distance in metres between two GPS points (haversine). */
export function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
