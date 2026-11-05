import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';
import { errorMessage, useApi } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { Button, colors, ErrorText, Muted, Screen, Title } from '../ui/kit';
import { createScanGate } from './createScanGate';
import { ScanResult } from './ScanResult';
import { ScanOutcome, scanWithRetry } from './scanWithRetry';
import { useGate } from './useGate';

type Mode = 'IN' | 'OUT';

export function GuardHomeScreen() {
  const api = useApi();
  const router = useRouter();
  const { logout } = useAuth();
  const { gates, gate, setGate, ready, error } = useGate();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [choosingGate, setChoosingGate] = useState(false);
  // Network fail hua to pata nahi entry hui ya nahi: us QR ke dobara scan par wahi id, taaki galat "pehle hi andar" na aaye.
  const unconfirmed = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    // Settings se wapas aane par permission dobara dekho.
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
        <Muted>Load ho raha hai…</Muted>
      </Screen>
    );
  }

  if (gates.length === 0) {
    return (
      <Screen>
        <Title>Gate</Title>
        {error ? <ErrorText>{errorMessage(error)}</ErrorText> : <Muted>Koi gate nahi mila. Admin se gate banwayein.</Muted>}
        <Button title="Logout" kind="plain" onPress={() => void logout()} />
      </Screen>
    );
  }

  if (!gate || choosingGate) {
    return (
      <Screen>
        <Title>Aap kis gate par hain?</Title>
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
          <Button title="Andar" kind={mode === 'IN' ? 'primary' : 'plain'} onPress={() => setMode('IN')} />
        </View>
        <View style={styles.mode}>
          <Button title="Bahar" kind={mode === 'OUT' ? 'primary' : 'plain'} onPress={() => setMode('OUT')} />
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
              <ErrorText>Camera ki permission nahi hai. Settings mein jaakar chalu karein.</ErrorText>
              <Button title="Settings kholein" kind="plain" onPress={() => void Linking.openSettings()} />
            </>
          ) : (
            <Button title="Camera chalu karein" onPress={() => void requestPermission()} />
          )}
          <Button title="Bina QR check-in" kind="plain" onPress={() => router.push('/(guard)/inside')} />
        </View>
      )}

      <Button title="Walk-in entry" kind="plain" onPress={() => router.push('/(guard)/walk-in')} />
      <Button title="Andar kaun hai" kind="plain" onPress={() => router.push('/(guard)/inside')} />
      <View style={styles.modes}>
        {gates.length > 1 ? (
          <View style={styles.mode}>
            <Button title="Gate badlein" kind="plain" onPress={() => setChoosingGate(true)} />
          </View>
        ) : null}
        <View style={styles.mode}>
          <Button title="Logout" kind="plain" onPress={() => void logout()} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  modes: { flexDirection: 'row', gap: 10 },
  mode: { flex: 1 },
  camera: { flex: 1, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.ink },
  noCamera: { flex: 1, gap: 12, justifyContent: 'center' },
});
