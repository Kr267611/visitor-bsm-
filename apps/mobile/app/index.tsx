import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth/AuthProvider';
import { homeRouteFor } from '../src/auth/homeRoute';

export default function Index() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return <Redirect href={user ? homeRouteFor(user.role) : '/login'} />;
}
