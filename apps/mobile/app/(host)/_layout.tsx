import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/auth/AuthProvider';
import { useNotificationRouting } from '../../src/notifications/handleTap';

export default function HostLayout() {
  const { user, ready } = useAuth();
  useNotificationRouting();
  if (!ready) return null;
  if (user?.role !== 'employee') return <Redirect href="/" />;
  return <Stack screenOptions={{ headerTitle: 'Visitors', headerBackTitle: 'Back' }} />;
}
