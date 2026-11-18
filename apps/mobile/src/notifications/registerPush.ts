import type { ApiClient } from '@visitor/shared';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

/** Sends the push token to the server. If anything fails the app keeps working; the host gets an SMS instead. */
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
    // Deliberately empty: push is optional.
  }
}
