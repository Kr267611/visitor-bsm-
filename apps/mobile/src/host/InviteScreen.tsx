import { normalizeIndianPhone } from '@visitor/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { errorMessage, useApi } from '../api';
import { Button, ErrorText, Field, themed, Title } from '../ui/kit';

const todayIst = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function InviteScreen() {
  const styles = useStyles();
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
    if (!name.trim() || !purpose.trim()) return 'Name and purpose are required.';
    if (!normalizeIndianPhone(phone)) return 'Enter a valid 10-digit mobile number.';
    if (!DATE.test(date)) return 'Enter the date as YYYY-MM-DD, for example 2026-11-06.';
    if (!TIME.test(start) || !TIME.test(end)) return 'Enter times as HH:MM, for example 14:30.';
    if (end <= start) return '"Until" must be later than "From".';
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
      <Title>New invite</Title>
      <Field label="Visitor name" value={name} onChangeText={setName} />
      <Field label="Visitor mobile" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
      <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      <Field label="From (HH:MM)" value={start} onChangeText={setStart} />
      <Field label="Until (HH:MM)" value={end} onChangeText={setEnd} />
      <Field label="Purpose" value={purpose} onChangeText={setPurpose} />
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button title="Send invite" onPress={() => void submit()} busy={busy} />
    </ScrollView>
  );
}

const useStyles = themed((colors) =>
  StyleSheet.create({
    page: { padding: 16, gap: 12, backgroundColor: colors.bg },
  }),
);
