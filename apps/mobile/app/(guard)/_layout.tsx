import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/auth/AuthProvider';

export default function GuardLayout() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (user?.role !== 'guard' && user?.role !== 'reception') return <Redirect href="/" />;
  return <Stack screenOptions={{ headerTitle: 'Gate', headerBackTitle: 'Back' }} />;
}
