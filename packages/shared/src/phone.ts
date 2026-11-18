/** Converts an Indian mobile number to E.164 (+91XXXXXXXXXX). Returns null when invalid. */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const match = /^(?:91|0)?([6-9]\d{9})$/.exec(digits);
  return match ? `+91${match[1]}` : null;
}
