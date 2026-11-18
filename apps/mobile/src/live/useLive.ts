import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useApi, useMobileClient } from '../api';
import { secureTokens } from '../auth/secureTokens';

/** Live updates for the premises. Returns whether the connection is up. */
export function useLiveUpdates(onUpdate: (event: { visitId: string; status: string }) => void, onReady?: () => void): boolean {
  const { apiUrl, client } = useMobileClient();
  const readyHandler = useRef(onReady);
  readyHandler.current = onReady;
  const [connected, setConnected] = useState(false);
  const handler = useRef(onUpdate);
  handler.current = onUpdate;

  useEffect(() => {
    const socket = io(`${apiUrl}/live`, {
      transports: ['websocket'],
      auth: (callback) => {
        void secureTokens.get().then((tokens) => callback({ token: tokens?.accessToken }));
      },
    });
    let retry: ReturnType<typeof setTimeout> | null = null;
    socket.on('ready', () => {
      setConnected(true);
      readyHandler.current?.();
    });
    socket.on('disconnect', (reason: string) => {
      setConnected(false);
      // The server dropped us because the token expired; the library does not reconnect by itself.
      if (reason === 'io server disconnect') {
        retry = setTimeout(() => {
          void client.me.get().catch(() => undefined).finally(() => socket.connect());
        }, RECONNECT_MS);
      }
    });
    socket.on('connect_error', () => setConnected(false));
    socket.on('visit.updated', (event: { visitId: string; status: string }) => handler.current(event));
    return () => {
      if (retry) clearTimeout(retry);
      socket.disconnect();
    };
  }, [apiUrl, client]);

  return connected;
}

const WAITING_POLL_MS = 5000;
const RECONNECT_MS = 3000;

/** For a visitor waiting at the gate: show the answer within 5 seconds even if the socket is down. */
export function useLiveVisit(visitId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const key = ['visit', visitId];
  const connected = useLiveUpdates(
    (event) => {
      if (event.visitId === visitId) void queryClient.invalidateQueries({ queryKey: key });
    },
    () => void queryClient.invalidateQueries({ queryKey: key }),
  );
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.visits.get(visitId),
    refetchInterval: (q) => (!connected && q.state.data?.status === 'PENDING_APPROVAL' ? WAITING_POLL_MS : false),
  });
  return { query, connected };
}
