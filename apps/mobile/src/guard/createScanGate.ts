/** The camera reads a QR several times per second. Only the first scan goes through. */
export function createScanGate(cooldownMs = 3000) {
  let lastValue: string | null = null;
  let lastAt = -Infinity;
  return {
    accept(value: string, now: number): boolean {
      if (value === lastValue && now - lastAt < cooldownMs) return false;
      lastValue = value;
      lastAt = now;
      return true;
    },
  };
}
