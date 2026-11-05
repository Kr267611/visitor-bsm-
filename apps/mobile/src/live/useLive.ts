import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useApi, useMobileClient } from '../api';
import { secureTokens } from '../auth/secureTokens';

/** Site ke live updates. Lautata hai connection chal raha hai ya nahi. */
export function useLiveUpdates(onUpdate: (event: { visitId: string; status: string }) => void): boolean {
  const { apiUrl } = useMobileClient();
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
    socket.on('ready', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('visit.updated', (event: { visitId: string; status: string }) => handler.current(event));
    return () => {
      socket.disconnect();
    };
  }, [apiUrl]);

  return connected;
}

const WAITING_POLL_MS = 5000;

/** Gate par khade visitor ke liye: socket band ho to bhi 5 second mein jawab dikhe. */
export function useLiveVisit(visitId: string) {
  const api = useApi();
  const queryClient = useQueryClient();
  const key = ['visit', visitId];
  const connected = useLiveUpdates((event) => {
    if (event.visitId === visitId) void queryClient.invalidateQueries({ queryKey: key });
  });
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.visits.get(visitId),
    refetchInterval: (q) => (!connected && q.state.data?.status === 'PENDING_APPROVAL' ? WAITING_POLL_MS : false),
  });
  return { query, connected };
}
