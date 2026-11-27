import type { LiveDashboard, VisitSummary } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { errorMessage, useApi } from '../api';
import { useLiveUpdates } from '../live/useLive';
import { Button, ErrorText, Field, Muted, themed, Title } from '../ui/kit';
import { useGate } from './useGate';

const KEY = ['dashboard', 'live'];
const POLL_MS = 30_000;

function Row(props: { visit: VisitSummary; gateId: string | null; mode: 'in' | 'out'; onOut?(message: string): void }) {
  const styles = useStyles();
  const { visit, gateId, mode, onOut } = props;
  const api = useApi();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState('');
  const eventId = useRef(Crypto.randomUUID());

  async function run(action: 'in' | 'out') {
    if (!gateId) return;
    setBusy(true);
    setError(null);
    const body = { gateId, clientEventId: eventId.current };
    try {
      if (action === 'in') {
        await api.visits.checkIn(visit.id, body);
      } else {
        const result = await api.visits.checkOut(visit.id, { ...body, itemsOut: items.trim() || undefined });
        onOut?.(`${visit.visitorName} checked out. Gate pass ${result.gatePassNo ?? ''}`.trim());
      }
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
          <Image accessibilityLabel={`Photo of ${visit.visitorName}`} source={{ uri: visit.photoUrl }} style={styles.photo} />
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
            <Field label="Items carried out (optional)" placeholder="e.g. 2 sample cones" maxLength={200} value={items} onChangeText={setItems} />
            <Button title="Yes, check out" kind="danger" onPress={() => void run('out')} busy={busy} />
            <Button title="No" kind="plain" onPress={() => setConfirming(false)} />
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
  const styles = useStyles();
  const api = useApi();
  const queryClient = useQueryClient();
  const { gate } = useGate();
  const [search, setSearch] = useState('');
  const [done, setDone] = useState<string | null>(null);
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
      <Title>Visitors inside</Title>
      <Field label="Search by name" value={search} onChangeText={setSearch} />
      {done ? (
        <Text accessibilityRole="alert" style={styles.done}>
          {done}
        </Text>
      ) : null}
      {board.isError ? <ErrorText>{errorMessage(board.error)}</ErrorText> : null}
      {board.data && inside.length === 0 ? <Muted>No visitors inside right now.</Muted> : null}
      {inside.map((visit) => (
        <Row key={visit.id} visit={visit} gateId={gate?.id ?? null} mode="out" onOut={setDone} />
      ))}
      <Text style={styles.heading}>Expected (check in without QR)</Text>
      {board.data && expected.length === 0 ? <Muted>No more visitors expected today.</Muted> : null}
      {expected.map((visit) => (
        <Row key={visit.id} visit={visit} gateId={gate?.id ?? null} mode="in" />
      ))}
    </ScrollView>
  );
}

const useStyles = themed((colors) =>
  StyleSheet.create({
    page: { padding: 16, gap: 12, backgroundColor: colors.bg },
    heading: { fontSize: 18, fontWeight: '700', color: colors.ink, marginTop: 8 },
    done: { padding: 12, borderRadius: 16, backgroundColor: colors.goodSoft, color: colors.good, fontSize: 16, fontWeight: '600' },
    row: {
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.cardLine,
      padding: 14,
      gap: 10,
      shadowColor: '#28467a',
      shadowOpacity: 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    person: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    photo: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.line },
    text: { flex: 1 },
    name: { fontSize: 18, fontWeight: '600', color: colors.ink },
  }),
);
