import type { Gate } from '@visitor/shared';
import { useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api';

const GATE_KEY = 'visitor.gate';

export function useGate() {
  const api = useApi();
  const gates = useQuery({ queryKey: ['gates'], queryFn: () => api.gates.list() });
  const [gateId, setGateId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void SecureStore.getItemAsync(GATE_KEY)
      .then(setGateId)
      .finally(() => setLoaded(true));
  }, []);

  const list: Gate[] = gates.data ?? [];
  const chosen = list.find((g) => g.id === gateId) ?? (list.length === 1 ? list[0] : null);

  const setGate = useCallback((id: string) => {
    setGateId(id);
    void SecureStore.setItemAsync(GATE_KEY, id);
  }, []);

  return { gates: list, gate: chosen, setGate, ready: loaded && !gates.isPending, error: gates.error };
}
