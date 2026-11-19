import { palette } from './kit';

describe('mobile colours', () => {
  it('every text colour is readable on its background', () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const c = palette;
    expect(contrast(c.ink, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.muted, c.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.accentInk, c.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.good, c.goodSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.bad, c.badSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.wait, c.waitSoft)).toBeGreaterThanOrEqual(4.5);
  });
});
