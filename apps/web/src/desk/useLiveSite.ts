import type { LiveDashboard } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { accessToken, loadPremisesId, useWebClient } from '../api';

const POLL_MS = 30_000;
const RECONNECT_MS = 3_000;
export const DASHBOARD_KEY = ['dashboard', 'live'];

export function useLiveSite(): {
  query: ReturnType<typeof useQuery<LiveDashboard>>;
  connected: boolean;
} {
  const web = useWebClient();
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(`${web.apiUrl}/live`, {
      transports: ['websocket'],
      // Har reconnect par naya token.
      auth: (callback) => callback({ token: accessToken(), premisesId: loadPremisesId() ?? undefined }),
    });
    let retry: ReturnType<typeof setTimeout> | null = null;
    socket.on('ready', () => {
      setConnected(true);
      // Connection tootne ke beech jo badla, woh bhi dikhe.
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY });
    });
    socket.on('disconnect', (reason: string) => {
      setConnected(false);
      // Server ne token expire hone par nikala: library khud reconnect nahi karti.
      if (reason === 'io server disconnect') {
        retry = setTimeout(() => {
          void web.client.me.get().catch(() => undefined).finally(() => socket.connect());
        }, RECONNECT_MS);
      }
    });
    socket.on('connect_error', () => setConnected(false));
    socket.on('visit.updated', () => {
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY });
    });
    return () => {
      if (retry) clearTimeout(retry);
      socket.disconnect();
    };
  }, [web, queryClient]);

  const query = useQuery<LiveDashboard>({
    queryKey: DASHBOARD_KEY,
    queryFn: () => web.client.dashboard.live(),
    refetchInterval: connected ? false : POLL_MS,
  });

  return { query, connected };
}
