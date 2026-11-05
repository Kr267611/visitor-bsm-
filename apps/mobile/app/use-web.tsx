import { useAuth } from '../src/auth/AuthProvider';
import { Button, Muted, Screen, Title } from '../src/ui/kit';

export default function UseWeb() {
  const { logout } = useAuth();
  return (
    <Screen>
      <Title>Yeh account web par use karein</Title>
      <Muted>Admin aur security ka kaam web app par hota hai.</Muted>
      <Button title="Logout" kind="plain" onPress={() => void logout()} />
    </Screen>
  );
}
