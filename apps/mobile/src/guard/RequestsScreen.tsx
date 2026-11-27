import type { LiveDashboard, VisitSummary } from '@visitor/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { errorMessage, useApi } from '../api';
import { useLiveUpdates } from '../live/useLive';
import { Button, ErrorText, Muted, themed, Title } from '../ui/kit';

const KEY = ['dashboard', 'live'];
const POLL_MS = 15_000;

function Request({ visit }: { visit: VisitSummary }) {
  const styles = useStyles();
  const api = useApi();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: 'approve' | 'reject') {
    setBusy(action);
    setError(null);
    try {
      await (action === 'approve' ? api.visits.approve(visit.id) : api.visits.reject(visit.id));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      // Refresh even on error: someone else may have decided first.
      await queryClient.invalidateQueries({ queryKey: KEY });
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.person}>
        {visit.photoUrl ? (
          <Image accessibilityLabel={`Photo of ${visit.visitorName}`} source={{ uri: visit.photoUrl }} style={styles.photo} />
        ) : (
          <View style={styles.photo} />
        )}
        <View style={styles.text}>
          <Text style={styles.name}>{visit.visitorName}</Text>
          {visit.company ? <Muted>{visit.company}</Muted> : null}
        </View>
      </View>
      <Text style={styles.purpose}>{visit.purposeNote ? `${visit.purpose} — ${visit.purposeNote}` : visit.purpose}</Text>
      <Muted>To meet: {visit.hostName}</Muted>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button title="Approve" label={`Approve ${visit.visitorName}`} onPress={() => void decide('approve')} busy={busy === 'approve'} disabled={!!busy} />
        </View>
        <View style={styles.action}>
          <Button title="Reject" label={`Reject ${visit.visitorName}`} kind="danger" onPress={() => void decide('reject')} busy={busy === 'reject'} disabled={!!busy} />
        </View>
      </View>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

/** QR and walk-in requests waiting at this gate. Approving turns the visitor's page into their pass. */
export function RequestsScreen() {
  const styles = useStyles();
  const api = useApi();
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: KEY });
  const connected = useLiveUpdates(refresh, refresh);
  const board = useQuery<LiveDashboard>({
    queryKey: KEY,
    queryFn: () => api.dashboard.live(),
    refetchInterval: connected ? false : POLL_MS,
  });
  const waiting = [...(board.data?.needsCall ?? []), ...(board.data?.pending ?? [])];

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Title>Requests</Title>
      <Muted>Visitors who filled the QR form or came as walk-ins. Read the purpose, then approve or reject.</Muted>
      {board.isError ? <ErrorText>{errorMessage(board.error)}</ErrorText> : null}
      {board.data && waiting.length === 0 ? <Muted>No requests waiting.</Muted> : null}
      {waiting.map((visit) => (
        <Request key={visit.id} visit={visit} />
      ))}
    </ScrollView>
  );
}

const useStyles = themed((colors) =>
  StyleSheet.create({
    page: { padding: 16, gap: 12, backgroundColor: colors.bg },
    card: {
      backgroundColor: colors.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.cardLine,
      padding: 14,
      gap: 8,
      shadowColor: '#28467a',
      shadowOpacity: 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    person: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    photo: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.line },
    text: { flex: 1 },
    name: { fontSize: 18, fontWeight: '700', color: colors.ink },
    purpose: { fontSize: 16, color: colors.ink },
    actions: { flexDirection: 'row', gap: 10 },
    action: { flex: 1 },
  }),
);
