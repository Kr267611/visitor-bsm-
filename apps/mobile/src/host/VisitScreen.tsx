import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text } from 'react-native';
import { errorMessage, useApi } from '../api';
import { Button, colors, ErrorText, Field, Muted, Title } from '../ui/kit';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});

export function VisitScreen() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const queryClient = useQueryClient();
  const key = ['visit', id];
  const visit = useQuery({ queryKey: key, queryFn: () => api.visits.get(id) });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  async function act(work: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await work();
      if (success) setMessage(success);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      // Galti par bhi: ho sakta hai kisi aur ne pehle faisla kar liya ho.
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: ['visits'] });
    }
  }

  if (visit.isPending) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Muted>Load ho raha hai…</Muted>
      </ScrollView>
    );
  }
  if (visit.isError) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <ErrorText>{errorMessage(visit.error)}</ErrorText>
      </ScrollView>
    );
  }

  const v = visit.data;
  const pending = v.status === 'PENDING_APPROVAL';
  const open = v.status === 'INVITED' || v.status === 'APPROVED';
  const trimmed = note.trim() || undefined;

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Title>{v.visitorName}</Title>
      <Text style={styles.status}>{v.status}</Text>
      {v.photoUrl ? <Image accessibilityLabel="Visitor ki photo" source={{ uri: v.photoUrl }} style={styles.photo} /> : null}
      {v.company ? <Muted>{v.company}</Muted> : null}
      <Text style={styles.line}>Kaam: {v.purpose}</Text>
      <Text style={styles.line}>
        {WHEN.format(new Date(v.validFrom))} se {WHEN.format(new Date(v.validTo))} tak
      </Text>
      {v.decisionNote ? <Text style={styles.line}>Note: {v.decisionNote}</Text> : null}

      {pending ? (
        <>
          <Field label="Guard ke liye note" maxLength={200} value={note} onChangeText={setNote} />
          <Button title="Approve" onPress={() => void act(() => api.visits.approve(id, trimmed))} busy={busy} />
          <Button title="Reject" kind="danger" onPress={() => void act(() => api.visits.reject(id, trimmed))} busy={busy} />
        </>
      ) : null}

      {open ? (
        <>
          <Button
            title="Link dobara bhejein"
            kind="plain"
            busy={busy}
            onPress={() => void act(() => api.visits.resendInvite(id), 'Naya link bhej diya. Purana link ab band hai.')}
          />
          {!confirmCancel ? (
            <Button title="Visit cancel karein" kind="danger" onPress={() => setConfirmCancel(true)} />
          ) : (
            <>
              <Button
                title="Haan, cancel karein"
                kind="danger"
                busy={busy}
                onPress={() => {
                  setConfirmCancel(false);
                  void act(() => api.visits.cancel(id));
                }}
              />
              <Button title="Nahi" kind="plain" onPress={() => setConfirmCancel(false)} />
            </>
          )}
        </>
      ) : null}

      {message ? <Text style={styles.line}>{message}</Text> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, backgroundColor: colors.bg },
  status: { fontSize: 14, fontWeight: '700', color: colors.accent },
  line: { fontSize: 16, color: colors.ink },
  photo: { width: 180, height: 180, borderRadius: 10, backgroundColor: colors.line },
});
