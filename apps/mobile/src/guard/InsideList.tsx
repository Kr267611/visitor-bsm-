import type { LiveDashboard, VisitSummary } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { errorMessage, useApi } from '../api';
import { useLiveUpdates } from '../live/useLive';
import { Button, colors, ErrorText, Field, Muted, Title } from '../ui/kit';
import { useGate } from './useGate';

const KEY = ['dashboard', 'live'];
const POLL_MS = 30_000;

function Row(props: { visit: VisitSummary; gateId: string | null; mode: 'in' | 'out' }) {
  const { visit, gateId, mode } = props;
  const api = useApi();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventId = useRef(Crypto.randomUUID());

  async function run(action: 'in' | 'out') {
    if (!gateId) return;
    setBusy(true);
    setError(null);
    const body = { gateId, clientEventId: eventId.current };
    try {
      await (action === 'in' ? api.visits.checkIn(visit.id, body) : api.visits.checkOut(visit.id, body));
      eventId.current = Crypto.randomUUID();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: KEY });
    }
  }

  return (
    <View style={styles.row}>
      <View style={styles.person}>
        {visit.photoUrl ? (
          <Image accessibilityLabel={`${visit.visitorName} ki photo`} source={{ uri: visit.photoUrl }} style={styles.photo} />
        ) : (
          <View style={styles.photo} />
        )}
        <View style={styles.text}>
          <Text style={styles.name}>{visit.visitorName}</Text>
          <Muted>Host: {visit.hostName}</Muted>
        </View>
      </View>
      {mode === 'out' &&
        (!confirming ? (
          <Button title={`${visit.visitorName} check-out`} kind="plain" onPress={() => setConfirming(true)} disabled={!gateId} />
        ) : (
          <>
            <Button title="Haan, check-out karein" kind="danger" onPress={() => void run('out')} busy={busy} />
            <Button title="Nahi" kind="plain" onPress={() => setConfirming(false)} />
          </>
        ))}
      {mode === 'in' && visit.status === 'APPROVED' && (
        <Button title={`${visit.visitorName} check-in`} kind="plain" onPress={() => void run('in')} busy={busy} disabled={!gateId} />
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

export function InsideList() {
  const api = useApi();
  const queryClient = useQueryClient();
  const { gate } = useGate();
  const [search, setSearch] = useState('');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });
  const connected = useLiveUpdates(refresh, refresh);
  const board = useQuery<LiveDashboard>({
    queryKey: KEY,
    queryFn: () => api.dashboard.live(),
    refetchInterval: connected ? false : POLL_MS,
  });

  const q = search.trim().toLowerCase();
  const match = (v: VisitSummary) => !q || v.visitorName.toLowerCase().includes(q);
  const inside = board.data?.inside.filter(match) ?? [];
  const expected = board.data?.expected.filter(match) ?? [];

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Title>Andar kaun hai</Title>
      <Field label="Naam se dhoondein" value={search} onChangeText={setSearch} />
      {board.isError ? <ErrorText>{errorMessage(board.error)}</ErrorText> : null}
      {board.data && inside.length === 0 ? <Muted>Abhi koi visitor andar nahi hai.</Muted> : null}
      {inside.map((visit) => (
        <Row key={visit.id} visit={visit} gateId={gate?.id ?? null} mode="out" />
      ))}
      <Text style={styles.heading}>Aane wale (bina QR check-in)</Text>
      {board.data && expected.length === 0 ? <Muted>Aaj aur koi visitor aane wala nahi hai.</Muted> : null}
      {expected.map((visit) => (
        <Row key={visit.id} visit={visit} gateId={gate?.id ?? null} mode="in" />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, backgroundColor: colors.bg },
  heading: { fontSize: 18, fontWeight: '700', color: colors.ink, marginTop: 8 },
  row: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10 },
  person: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  photo: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.line },
  text: { flex: 1 },
  name: { fontSize: 18, fontWeight: '600', color: colors.ink },
});
