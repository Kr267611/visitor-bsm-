import { normalizeIndianPhone } from './phone';

describe('normalizeIndianPhone', () => {
  it.each(['98765 43210', '+91-98765-43210', '09876543210', '919876543210', '+919876543210'])(
    '%s normalizes',
    (input) => {
      expect(normalizeIndianPhone(input)).toBe('+919876543210');
    },
  );

  it.each(['12345', '0000000000', '5876543210', 'abc', ''])('"%s" rejected', (input) => {
    expect(normalizeIndianPhone(input)).toBeNull();
  });
});
