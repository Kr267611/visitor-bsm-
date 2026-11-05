import type { Session, SessionUser } from '@visitor/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { loadUser, saveUser, useWebClient } from '../api';

interface Auth {
  user: SessionUser | null;
  signedIn(session: Session): void;
  logout(): Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const web = useWebClient();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(loadUser);

  useEffect(
    () =>
      web.onSessionExpired(() => {
        saveUser(null);
        setUser(null);
      }),
    [web],
  );

  const auth = useMemo<Auth>(
    () => ({
      user,
      signedIn(session) {
        saveUser(session.user);
        setUser(session.user);
      },
      async logout() {
        saveUser(null);
        setUser(null);
        queryClient.clear();
        await web.client.auth.logout().catch(() => undefined);
      },
    }),
    [user, web, queryClient],
  );

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('AuthProvider missing');
  return auth;
}
