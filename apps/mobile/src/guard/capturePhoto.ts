import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

const QUALITIES = [0.8, 0.65, 0.5, 0.35];
const MAX_BYTES = 200_000;
const MAX_WIDTH = 1024;

/** Lowers quality until the photo fits the limit; if it never does, keeps the smallest. */
export async function compressUntilSmall(
  encode: (quality: number) => Promise<{ uri: string; size: number }>,
  maxBytes = MAX_BYTES,
): Promise<string> {
  let last = '';
  for (const quality of QUALITIES) {
    const { uri, size } = await encode(quality);
    last = uri;
    if (size <= maxBytes) return uri;
  }
  return last;
}

/** Photo from the camera. null when the guard cancels. */
export async function capturePhoto(): Promise<{ uri: string } | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Camera permission is off. Turn it on in Settings.');

  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled) return null;
  const source = result.assets[0].uri;

  const uri = await compressUntilSmall(async (quality) => {
    const image = await ImageManipulator.manipulateAsync(source, [{ resize: { width: MAX_WIDTH } }], {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    const blob = await (await fetch(image.uri)).blob();
    return { uri: image.uri, size: blob.size };
  });
  return { uri };
}
