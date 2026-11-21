import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text } from 'react-native';
import { errorMessage, useApi } from '../api';
import { Button, ErrorText, Field, Muted, themed, Title } from '../ui/kit';

const WHEN = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
});

export function VisitScreen() {
  const styles = useStyles();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const router = useRouter();
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
      // Refresh even on error: someone else may have decided first.
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: ['visits'] });
    }
  }

  if (visit.isPending) {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Muted>Loading…</Muted>
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
      <Button title="‹ My visitors" label="Back to my visitors" kind="plain" onPress={() => router.navigate('/(host)')} />
      <Title>{v.visitorName}</Title>
      <Text style={styles.status}>{v.status}</Text>
      {v.photoUrl ? <Image accessibilityLabel="Visitor photo" source={{ uri: v.photoUrl }} style={styles.photo} /> : null}
      {v.company ? <Muted>{v.company}</Muted> : null}
      <Text style={styles.line}>Purpose: {v.purpose}</Text>
      {v.purposeNote ? <Text style={styles.line}>About the visit: {v.purposeNote}</Text> : null}
      <Text style={styles.line}>
        {WHEN.format(new Date(v.validFrom))} – {WHEN.format(new Date(v.validTo))}
      </Text>
      {v.decisionNote ? <Text style={styles.line}>Note: {v.decisionNote}</Text> : null}
      {v.deliveryFailed ? <ErrorText>The SMS could not be delivered. Use "Resend link" or call the visitor.</ErrorText> : null}

      {pending ? (
        <>
          <Field label="Note for the guard" maxLength={200} value={note} onChangeText={setNote} />
          <Button title="Approve" onPress={() => void act(() => api.visits.approve(id, trimmed))} busy={busy} />
          <Button title="Reject" kind="danger" onPress={() => void act(() => api.visits.reject(id, trimmed))} busy={busy} />
        </>
      ) : null}

      {open ? (
        <>
          <Button
            title="Resend link"
            kind="plain"
            busy={busy}
            onPress={() => void act(() => api.visits.resendInvite(id), 'New link sent. The old link no longer works.')}
          />
          {!confirmCancel ? (
            <Button title="Cancel visit" kind="danger" onPress={() => setConfirmCancel(true)} />
          ) : (
            <>
              <Button
                title="Yes, cancel"
                kind="danger"
                busy={busy}
                onPress={() => {
                  setConfirmCancel(false);
                  void act(() => api.visits.cancel(id));
                }}
              />
              <Button title="No" kind="plain" onPress={() => setConfirmCancel(false)} />
            </>
          )}
        </>
      ) : null}

      {message ? <Text style={styles.line}>{message}</Text> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </ScrollView>
  );
}

const useStyles = themed((colors) =>
  StyleSheet.create({
    page: { padding: 16, gap: 12, backgroundColor: colors.bg },
    status: { fontSize: 14, fontWeight: '700', color: colors.accent },
    line: { fontSize: 16, color: colors.ink },
    photo: { width: 180, height: 180, borderRadius: 24, backgroundColor: colors.line },
  }),
);
