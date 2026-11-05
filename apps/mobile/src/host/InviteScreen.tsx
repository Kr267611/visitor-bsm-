import { normalizeIndianPhone } from '@visitor/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { errorMessage, useApi } from '../api';
import { Button, colors, ErrorText, Field, Title } from '../ui/kit';

const todayIst = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function InviteScreen() {
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [date, setDate] = useState(todayIst);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function problem(): string | null {
    if (!name.trim() || !purpose.trim()) return 'Naam aur kaam zaroori hai.';
    if (!normalizeIndianPhone(phone)) return 'Mobile number sahi nahi hai. 10 digit ka number daalein.';
    if (!DATE.test(date)) return 'Date YYYY-MM-DD format mein daalein, jaise 2026-11-06.';
    if (!TIME.test(start) || !TIME.test(end)) return 'Time HH:MM format mein daalein, jaise 14:30.';
    if (end <= start) return 'Kab tak ka time "Kab se" ke baad ka hona chahiye.';
    return null;
  }

  async function submit() {
    const invalid = problem();
    setError(invalid);
    if (invalid) return;
    setBusy(true);
    try {
      await api.visits.create({
        visitorName: name.trim(),
        visitorPhone: phone,
        validFrom: `${date}T${start}:00+05:30`,
        validTo: `${date}T${end}:00+05:30`,
        purpose: purpose.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ['visits'] });
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Title>Naya invite</Title>
      <Field label="Visitor ka naam" value={name} onChangeText={setName} />
      <Field label="Visitor ka mobile" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      <Field label="Kab se (HH:MM)" value={start} onChangeText={setStart} />
      <Field label="Kab tak (HH:MM)" value={end} onChangeText={setEnd} />
      <Field label="Kaam" value={purpose} onChangeText={setPurpose} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button title="Invite bhejein" onPress={() => void submit()} busy={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, backgroundColor: colors.bg },
});
