/** Camera ek QR ko second mein kai baar padhta hai. Sirf pehla scan aage jaye. */
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
