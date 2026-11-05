const MAX_SIDE = 1024;
const QUALITIES = [0.8, 0.65, 0.5, 0.35];

export class PhotoError extends Error {}

const UNREADABLE = 'Yeh photo nahi chal rahi. Camera se nayi photo lein.';

export function fitWithin(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Quality ghatate hue pehla result jo limit mein aa jaye. */
export async function compressWith(encode: (quality: number) => Promise<Blob>, maxBytes: number): Promise<Blob> {
  for (const quality of QUALITIES) {
    const blob = await encode(quality);
    if (blob.size <= maxBytes) return blob;
  }
  throw new PhotoError(UNREADABLE);
}

/** Camera ki badi photo ko chhota JPEG banata hai, upload se pehle. */
export async function compressPhoto(file: File, maxBytes = 200_000): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new PhotoError('Sirf photo chunein.');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PhotoError(UNREADABLE);
  }

  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return compressWith(
    (quality) =>
      new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new PhotoError(UNREADABLE))),
          'image/jpeg',
          quality,
        );
      }),
    maxBytes,
  );
}
