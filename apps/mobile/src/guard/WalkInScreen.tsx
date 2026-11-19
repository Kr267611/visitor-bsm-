import { normalizeIndianPhone } from '@visitor/shared';
import { useQuery } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { errorMessage, useApi } from '../api';
import { Button, colors, ErrorText, Field, Muted, Screen, Title } from '../ui/kit';
import { capturePhoto } from './capturePhoto';
import { useGate } from './useGate';
import { WaitingForHost } from './WaitingForHost';

const RESEND_DELAY_MS = 30_000;

export function WalkInScreen({ resendDelayMs = RESEND_DELAY_MS }: { resendDelayMs?: number }) {
  const api = useApi();
  const { gate } = useGate();
  const [step, setStep] = useState<'phone' | 'form' | 'wait'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [purpose, setPurpose] = useState('');
  const [hostSearch, setHostSearch] = useState('');
  const [host, setHost] = useState<{ id: string; name: string } | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [savedPhoto, setSavedPhoto] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [visitId, setVisitId] = useState<string | null>(null);
  const [canResend, setCanResend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uploadedKey = useRef<string | null>(null);
  const eventId = useRef(Crypto.randomUUID());
  const resendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resendTimer.current) clearTimeout(resendTimer.current);
    },
    [],
  );

  const q = hostSearch.trim();
  const hosts = useQuery({
    queryKey: ['hosts', q],
    queryFn: () => api.users.searchHosts(q),
    enabled: q.length >= 2 && !host,
  });

  function armResend() {
    setCanResend(false);
    if (resendTimer.current) clearTimeout(resendTimer.current);
    resendTimer.current = setTimeout(() => setCanResend(true), resendDelayMs);
  }

  async function start() {
    setError(null);
    if (!normalizeIndianPhone(phone)) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    setBusy(true);
    try {
      const known = await api.gate.visitorLookup(phone);
      if (known.found) {
        setName(known.name ?? '');
        setCompany(known.company ?? '');
        setSavedPhoto(known.photoUrl ?? null);
      }
      await api.gate.walkInOtp(phone);
      armResend();
      setStep('form');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function resendOtp() {
    setError(null);
    try {
      await api.gate.walkInOtp(phone);
      armResend();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function takePhoto() {
    setError(null);
    try {
      const photo = await capturePhoto();
      if (photo) {
        setPhotoUri(photo.uri);
        uploadedKey.current = null;
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit() {
    if (!gate || !host) return;
    setBusy(true);
    setError(null);
    try {
      // On retry, do not upload the photo again.
      if (photoUri && !uploadedKey.current) {
        const file = { uri: photoUri, name: 'photo.jpg', type: 'image/jpeg' };
        uploadedKey.current = (await api.uploads.uploadPhoto(file)).key;
      }
      const res = await api.gate.walkIn({
        phone,
        otp,
        name: name.trim(),
        company: company.trim() || undefined,
        photoKey: uploadedKey.current ?? undefined,
        hostId: host.id,
        purpose: purpose.trim(),
        gateId: gate.id,
        consent,
        clientEventId: eventId.current,
      });
      setVisitId(res.visitId);
      setStep('wait');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'wait' && visitId && gate) {
    return (
      <Screen>
        <WaitingForHost visitId={visitId} gateId={gate.id} />
      </Screen>
    );
  }

  if (step === 'phone') {
    return (
      <Screen>
        <Title>Walk-in entry</Title>
        <Field label="Visitor mobile" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
        <Button title="Continue" onPress={() => void start()} busy={busy} />
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Screen>
    );
  }

  const hasPhoto = !!photoUri || !!savedPhoto;
  const canSubmit = otp.length === 6 && !!name.trim() && !!purpose.trim() && !!host && hasPhoto && consent && !!gate;

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <Title>Visitor details</Title>
      <Field
        label="OTP"
        keyboardType="number-pad"
        maxLength={6}
        value={otp}
        onChangeText={(v) => setOtp(v.replace(/\D/g, ''))}
        hint={`SMS sent to ${phone}. Ask the visitor for the code.`}
      />
      <Button title="Resend OTP" kind="plain" disabled={!canResend} onPress={() => void resendOtp()} />
      <Field label="Name" value={name} onChangeText={setName} />
      <Field label="Company" value={company} onChangeText={setCompany} />
      <Field label="Purpose" value={purpose} onChangeText={setPurpose} />

      {photoUri || savedPhoto ? (
        <Image accessibilityLabel="Captured photo" source={{ uri: (photoUri ?? savedPhoto) as string }} style={styles.photo} />
      ) : (
        <Muted>A photo is required for a new visitor.</Muted>
      )}
      <Button title="Take photo" kind="plain" onPress={() => void takePhoto()} />

      <Field
        label="Who are they meeting?"
        value={host ? host.name : hostSearch}
        onChangeText={(v) => {
          setHost(null);
          setHostSearch(v);
        }}
      />
      {!host &&
        hosts.data?.map((h) => (
          <Button
            key={h.id}
            kind="plain"
            title={`${h.name}${h.department ? ` (${h.department})` : ''}`}
            onPress={() => setHost({ id: h.id, name: h.name })}
          />
        ))}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="The visitor has been told their details will be stored for the visitor record."
        accessibilityState={{ checked: consent }}
        onPress={() => setConsent(!consent)}
        style={styles.check}
      >
        <View style={[styles.box, consent && styles.boxOn]}>{consent ? <Text style={styles.tick}>✓</Text> : null}</View>
        <Text style={styles.checkText}>The visitor has been told their details will be stored for the visitor record.</Text>
      </Pressable>

      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button title="Send to host" disabled={!canSubmit} busy={busy} onPress={() => void submit()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { padding: 16, gap: 14, backgroundColor: colors.bg },
  photo: { width: 140, height: 140, borderRadius: 10, backgroundColor: colors.line },
  check: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 6 },
  box: { width: 28, height: 28, borderWidth: 2, borderColor: colors.accent, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.accent },
  tick: { color: colors.accentInk, fontWeight: '700' },
  checkText: { flex: 1, fontSize: 15, color: colors.ink },
});
