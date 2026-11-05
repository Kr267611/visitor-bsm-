import { describe, expect, it } from 'vitest';
import { compressWith, fitWithin, PhotoError } from './compressPhoto';

describe('fitWithin', () => {
  it('keeps small images as they are', () => {
    expect(fitWithin(800, 600, 1024)).toEqual({ width: 800, height: 600 });
  });
  it('shrinks the longer side to the limit', () => {
    expect(fitWithin(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(3000, 4000, 1024)).toEqual({ width: 768, height: 1024 });
  });
});

describe('compressWith', () => {
  const blobOf = (bytes: number) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });

  it('large photo is compressed to <= 200 KB by lowering quality', async () => {
    const seen: number[] = [];
    const result = await compressWith(async (quality) => {
      seen.push(quality);
      return blobOf(quality > 0.5 ? 900_000 : 150_000);
    }, 200_000);
    expect(result.size).toBeLessThanOrEqual(200_000);
    expect(seen[0]).toBeGreaterThan(seen[seen.length - 1]);
  });

  it('stops at the first quality that fits', async () => {
    const seen: number[] = [];
    await compressWith(async (quality) => {
      seen.push(quality);
      return blobOf(1000);
    }, 200_000);
    expect(seen).toHaveLength(1);
  });

  it('never fits: throws a clear error', async () => {
    await expect(compressWith(async () => blobOf(900_000), 200_000)).rejects.toBeInstanceOf(PhotoError);
  });
});
