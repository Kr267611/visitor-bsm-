import { Redirect } from 'expo-router';
import { useAuth } from '../../src/auth/AuthProvider';
import { IconTabs } from '../../src/ui/IconTabs';

export default function GuardLayout() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (user?.role !== 'guard' && user?.role !== 'reception') return <Redirect href="/" />;
  return (
    <IconTabs
      tabs={[
        { name: 'index', label: 'Scan pass', icon: 'qr-code-outline' },
        { name: 'requests', label: 'Requests', icon: 'notifications-outline' },
        { name: 'inside', label: 'Visitors inside', icon: 'people-outline' },
        { name: 'walk-in', label: 'Walk-in entry', icon: 'person-add-outline' },
      ]}
    />
  );
}
