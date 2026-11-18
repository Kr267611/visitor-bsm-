import type { Session, SessionUser } from '@visitor/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useMobileClient } from '../api';
import { registerPush } from '../notifications/registerPush';
import { loadSessionUser, saveSessionUser } from './secureTokens';

interface Auth {
  user: SessionUser | null;
  ready: boolean;
  signedIn(session: Session): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const mobile = useMobileClient();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadSessionUser()
      .then(setUser)
      .finally(() => setReady(true));
    return mobile.onSessionExpired(() => {
      setUser(null);
      void saveSessionUser(null);
      queryClient.clear();
    });
  }, [mobile, queryClient]);

  const auth = useMemo<Auth>(
    () => ({
      user,
      ready,
      async signedIn(session) {
        await saveSessionUser(session.user);
        setUser(session.user);
        // Sign-in keeps working even if push registration fails.
        void registerPush(mobile.client);
      },
      async logout() {
        setUser(null);
        await saveSessionUser(null);
        queryClient.clear();
        await mobile.client.auth.logout().catch(() => undefined);
      },
    }),
    [user, ready, mobile, queryClient],
  );

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('AuthProvider missing');
  return auth;
}
