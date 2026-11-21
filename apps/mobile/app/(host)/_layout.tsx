import { Redirect } from 'expo-router';
import { useAuth } from '../../src/auth/AuthProvider';
import { useNotificationRouting } from '../../src/notifications/handleTap';
import { IconTabs } from '../../src/ui/IconTabs';

export default function HostLayout() {
  const { user, ready } = useAuth();
  useNotificationRouting();
  if (!ready) return null;
  if (user?.role !== 'employee') return <Redirect href="/" />;
  return (
    <IconTabs
      tabs={[
        { name: 'index', label: 'My visitors', icon: 'home-outline' },
        { name: 'invite', label: 'New invite', icon: 'add' },
        { name: 'settings', label: 'Settings', icon: 'person-outline' },
      ]}
      hidden={['visits/[id]']}
    />
  );
}
