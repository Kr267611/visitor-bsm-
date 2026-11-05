/** Indian mobile number ko E.164 (+91XXXXXXXXXX) mein badalta hai. Invalid ho to null. */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const match = /^(?:91|0)?([6-9]\d{9})$/.exec(digits);
  return match ? `+91${match[1]}` : null;
}
