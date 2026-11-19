import { normalizeIndianPhone } from '@visitor/shared';
import * as Device from 'expo-device';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { errorMessage, useApi } from '../api';
import { Button, ErrorText, Field, Muted, Screen, ThemeToggle, Title } from '../ui/kit';
import { useAuth } from './AuthProvider';
import { homeRouteFor } from './homeRoute';

export function LoginScreen() {
  const api = useApi();
  const router = useRouter();
  const { signedIn } = useAuth();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestOtp() {
    setError(null);
    const normalized = normalizeIndianPhone(phone);
    if (!normalized) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    setBusy(true);
    try {
      await api.auth.requestOtp(normalized);
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setError(null);
    setBusy(true);
    try {
      const session = await api.auth.verifyOtp({
        phone,
        otp,
        deviceName: Device.modelName ?? 'Mobile',
      });
      await signedIn(session);
      router.replace(homeRouteFor(session.user.role));
    } catch (e) {
      setError(errorMessage(e));
      setOtp('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Visitor BSM</Title>
      {!sent ? (
        <>
          <Field label="Mobile number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <Button title="Send OTP" onPress={() => void requestOtp()} busy={busy} />
        </>
      ) : (
        <>
          <Muted>OTP sent to {phone}.</Muted>
          <Field
            label="OTP"
            keyboardType="number-pad"
            autoComplete="sms-otp"
            maxLength={6}
            value={otp}
            onChangeText={(v) => setOtp(v.replace(/\D/g, ''))}
          />
          <Button title="Sign in" onPress={() => void verify()} busy={busy} disabled={otp.length !== 6} />
          <Button title="Change number" kind="plain" onPress={() => setSent(false)} />
        </>
      )}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <ThemeToggle />
    </Screen>
  );
}
