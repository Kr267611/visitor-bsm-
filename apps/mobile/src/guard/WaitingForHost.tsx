import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Text } from 'react-native';
import { errorMessage, useApi } from '../api';
import { useLiveVisit } from '../live/useLive';
import { Button, ErrorText, Muted, Title } from '../ui/kit';

export function WaitingForHost({ visitId, gateId }: { visitId: string; gateId: string }) {
  const api = useApi();
  const router = useRouter();
  const { query } = useLiveVisit(visitId);
  const eventId = useRef(Crypto.randomUUID());
  const [checkedIn, setCheckedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkIn() {
    setBusy(true);
    setError(null);
    try {
      await api.visits.checkIn(visitId, { gateId, clientEventId: eventId.current });
      setCheckedIn(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const visit = query.data;
  const note = visit?.decisionNote ? <Text>Host note: {visit.decisionNote}</Text> : null;
  const back = <Button title="Back" kind="plain" onPress={() => router.back()} />;

  if (checkedIn || visit?.status === 'CHECKED_IN') {
    return (
      <>
        <Title>Checked in</Title>
        {note}
        {back}
      </>
    );
  }
  if (!visit) return <Muted>Loading…</Muted>;

  if (visit.status === 'APPROVED') {
    return (
      <>
        <Title>Host approved</Title>
        {note}
        <Button title="Check in" onPress={() => void checkIn()} busy={busy} />
        {error ? <ErrorText>{error}</ErrorText> : null}
        {back}
      </>
    );
  }
  if (visit.status === 'REJECTED') {
    return (
      <>
        <Title>Host declined</Title>
        {note}
        {back}
      </>
    );
  }
  if (visit.status !== 'PENDING_APPROVAL') {
    return (
      <>
        <Title>This entry is closed</Title>
        <Muted>Status: {visit.status}</Muted>
        {back}
      </>
    );
  }
  return (
    <>
      <Title>Waiting for the host</Title>
      <Muted>
        {visit.visitorName} is here to meet {visit.hostName}.
      </Muted>
      {visit.receptionCallRequestedAt ? <Text>Reception is calling the host.</Text> : null}
    </>
  );
}
