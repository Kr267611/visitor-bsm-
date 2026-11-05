import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
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
  const [permission, requestPermission] = useCameraPermissions();
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
      setOutcome(await scanWithRetry(api, { qr: data, gateId: gate.id, mode, clientEventId: Crypto.randomUUID() }));
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

  if (!gate) {
    return (
      <Screen>
        <Title>Aap kis gate par hain?</Title>
        {gates.map((g) => (
          <Button key={g.id} title={g.name} kind="plain" onPress={() => setGate(g.id)} />
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  modes: { flexDirection: 'row', gap: 10 },
  mode: { flex: 1 },
  camera: { flex: 1, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.ink },
  noCamera: { flex: 1, gap: 12, justifyContent: 'center' },
});
