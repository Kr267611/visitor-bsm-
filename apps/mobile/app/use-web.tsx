import { useAuth } from '../src/auth/AuthProvider';
import { Button, Muted, Screen, Title } from '../src/ui/kit';

export default function UseWeb() {
  const { logout } = useAuth();
  return (
    <Screen>
      <Title>Please use this account on the web</Title>
      <Muted>Admin and security work is done in the web app.</Muted>
      <Button title="Log out" kind="plain" onPress={() => void logout()} />
    </Screen>
  );
}
