import type { LiveDashboard } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { accessToken, useWebClient } from '../api';

const POLL_MS = 30_000;
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
      auth: (callback) => callback({ token: accessToken() }),
    });
    socket.on('ready', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('visit.updated', () => {
      void queryClient.invalidateQueries({ queryKey: DASHBOARD_KEY });
    });
    return () => {
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
