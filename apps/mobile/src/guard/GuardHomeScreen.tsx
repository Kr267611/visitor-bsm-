import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';
import { errorMessage, useApi } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { Button, ErrorText, Muted, Screen, themed, ThemeToggle, Title } from '../ui/kit';
import { createScanGate } from './createScanGate';
import { ScanResult } from './ScanResult';
import { ScanOutcome, scanWithRetry } from './scanWithRetry';
import { useGate } from './useGate';

type Mode = 'IN' | 'OUT';

export function GuardHomeScreen() {
  const styles = useStyles();
  const api = useApi();
  const router = useRouter();
  const { logout } = useAuth();
  const { gates, gate, setGate, ready, error } = useGate();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [choosingGate, setChoosingGate] = useState(false);
  // After a network failure we cannot tell whether the entry happened: rescanning that QR reuses the id, so we never wrongly say "already inside".
  const unconfirmed = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    // Check the permission again when returning from Settings.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getPermission();
    });
    return () => sub.remove();
  }, [getPermission]);
  const [mode, setMode] = useState<Mode>('IN');
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const scanGate = useRef(createScanGate());
  const processing = useRef(false);

  async function onScanned(data: string) {
    if (processing.current || !gate || !scanGate.current.accept(data, Date.now())) return;
    processing.current = true;
    setBusy(true);
    try {
      const key = `${data}|${mode}`;
      const clientEventId = unconfirmed.current?.key === key ? unconfirmed.current.id : Crypto.randomUUID();
      const result = await scanWithRetry(api, { qr: data, gateId: gate.id, mode, clientEventId });
      unconfirmed.current = result.kind === 'network' ? { key, id: clientEventId } : null;
      setOutcome(result);
    } finally {
      processing.current = false;
      setBusy(false);
    }
  }

  if (outcome) {
    return (
      <Screen>
        <ScanResult
          outcome={outcome}
          onNext={() => {
            scanGate.current = createScanGate();
            setOutcome(null);
          }}
          onWalkIn={() => router.push('/(guard)/walk-in')}
        />
      </Screen>
    );
  }

  if (!ready) {
    return (
      <Screen>
        <Muted>Loading…</Muted>
      </Screen>
    );
  }

  if (gates.length === 0) {
    return (
      <Screen>
        <Title>Gate</Title>
        {error ? <ErrorText>{errorMessage(error)}</ErrorText> : <Muted>No gates found. Ask your admin to add a gate.</Muted>}
        <Button title="Log out" kind="plain" onPress={() => void logout()} />
      </Screen>
    );
  }

  if (!gate || choosingGate) {
    return (
      <Screen>
        <Title>Which gate are you at?</Title>
        {gates.map((g) => (
          <Button
            key={g.id}
            title={g.name}
            kind="plain"
            onPress={() => {
              setGate(g.id);
              setChoosingGate(false);
            }}
          />
        ))}
      </Screen>
    );
  }

  return (
    <Screen>
      <Muted>{gate.name}</Muted>
      <View style={styles.modes}>
        <View style={styles.mode}>
          <Button title="Entry" kind={mode === 'IN' ? 'primary' : 'plain'} onPress={() => setMode('IN')} />
        </View>
        <View style={styles.mode}>
          <Button title="Exit" kind={mode === 'OUT' ? 'primary' : 'plain'} onPress={() => setMode('OUT')} />
        </View>
      </View>

      {permission?.granted ? (
        <View style={styles.camera}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={busy ? undefined : ({ data }) => void onScanned(data)}
          />
        </View>
      ) : (
        <View style={styles.noCamera}>
          {permission && !permission.canAskAgain ? (
            <>
              <ErrorText>Camera permission is off. Turn it on in Settings.</ErrorText>
              <Button title="Open Settings" kind="plain" onPress={() => void Linking.openSettings()} />
            </>
          ) : (
            <Button title="Turn on camera" onPress={() => void requestPermission()} />
          )}
          <Button title="Check in without QR" kind="plain" onPress={() => router.push('/(guard)/inside')} />
        </View>
      )}

      <Button title="Walk-in entry" kind="plain" onPress={() => router.push('/(guard)/walk-in')} />
      <Button title="Visitors inside" kind="plain" onPress={() => router.push('/(guard)/inside')} />
      <View style={styles.modes}>
        {gates.length > 1 ? (
          <View style={styles.mode}>
            <Button title="Change gate" kind="plain" onPress={() => setChoosingGate(true)} />
          </View>
        ) : null}
        <View style={styles.mode}>
          <ThemeToggle />
        </View>
        <View style={styles.mode}>
          <Button title="Log out" kind="plain" onPress={() => void logout()} />
        </View>
      </View>
    </Screen>
  );
}

const useStyles = themed((colors) =>
  StyleSheet.create({
    modes: { flexDirection: 'row', gap: 10 },
    mode: { flex: 1 },
    camera: { flex: 1, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.ink },
    noCamera: { flex: 1, gap: 12, justifyContent: 'center' },
  }),
);
