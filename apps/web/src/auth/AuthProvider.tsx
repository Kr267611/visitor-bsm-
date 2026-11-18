import type { Session, SessionUser } from '@visitor/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { loadPremisesId, loadUser, savePremisesId, saveUser, useWebClient } from '../api';

interface Auth {
  user: SessionUser | null;
  /** Chuna gaya premises; null = server ka default. */
  premisesId: string | null;
  signedIn(session: Session): void;
  switchPremises(id: string): void;
  logout(): Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const web = useWebClient();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(loadUser);
  const [premisesId, setPremisesId] = useState<string | null>(loadPremisesId);

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
      premisesId,
      signedIn(session) {
        // Naye login par pichhla chuna premises (shayad doosre business ka) nahi rakhte.
        savePremisesId(null);
        setPremisesId(null);
        saveUser(session.user);
        setUser(session.user);
      },
      switchPremises(id) {
        savePremisesId(id);
        setPremisesId(id);
        // Har list ab naye premises ki: purana data turant hatao.
        void queryClient.resetQueries();
      },
      async logout() {
        saveUser(null);
        savePremisesId(null);
        setUser(null);
        setPremisesId(null);
        queryClient.clear();
        await web.client.auth.logout().catch(() => undefined);
      },
    }),
    [user, premisesId, web, queryClient],
  );

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('AuthProvider missing');
  return auth;
}
