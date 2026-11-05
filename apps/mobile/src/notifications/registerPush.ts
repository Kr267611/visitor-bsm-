import type { ApiClient } from '@visitor/shared';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

/** Push token server ko deta hai. Kuch bhi fail ho, app chalti rahe: host ko SMS jayega. */
export async function registerPush(api: ApiClient): Promise<void> {
  try {
    if (!Device.isDevice) return;
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await api.devices.savePushToken(data);
  } catch {
    // Jaan-boojh kar khaali: push zaroori nahi hai.
  }
}
