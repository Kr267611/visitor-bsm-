import { Image, StyleSheet, Text, View } from 'react-native';
import { Button, colors, Muted } from '../ui/kit';
import type { ScanOutcome } from './scanWithRetry';

const TIME = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

interface Props {
  outcome: ScanOutcome;
  onNext(): void;
  onWalkIn(): void;
}

export function ScanResult({ outcome, onNext, onWalkIn }: Props) {
  if (outcome.kind === 'ok') {
    const { data } = outcome;
    return (
      <View style={[styles.panel, styles.good]}>
        <Text style={[styles.verdict, styles.goodText]}>
          {data.result === 'CHECKED_IN' ? 'Allowed in' : 'Allowed out'}
        </Text>
        {data.visitor.photoUrl ? (
          <Image accessibilityLabel="Visitor photo" source={{ uri: data.visitor.photoUrl }} style={styles.photo} />
        ) : (
          <Muted>No photo on file for this visitor. Please check their ID.</Muted>
        )}
        <Text style={styles.name}>{data.visitor.name}</Text>
        {data.visitor.company ? <Muted>{data.visitor.company}</Muted> : null}
        <Text style={styles.host}>Host: {data.host}</Text>
        <Button title="Next scan" onPress={onNext} />
      </View>
    );
  }

  if (outcome.kind === 'network') {
    return (
      <View style={[styles.panel, styles.wait]}>
        <Text style={[styles.verdict, styles.waitText]}>Entry not confirmed. Please scan again.</Text>
        <Muted>Could not reach the server. Check your internet connection. If it still fails, use the paper register.</Muted>
        <Button title="Next scan" onPress={onNext} />
      </View>
    );
  }

  const { error } = outcome;
  const at: string | undefined = error.body.at;
  return (
    <View style={[styles.panel, styles.bad]}>
      <Text style={[styles.verdict, styles.badText]}>{error.message}</Text>
      {at ? <Text style={styles.host}>Time: {TIME.format(new Date(at))}</Text> : null}
      {error.code === 'PASS_EXPIRED' || error.code === 'PASS_NOT_YET_VALID' ? (
        <Button title="Register as walk-in" kind="plain" onPress={onWalkIn} />
      ) : null}
      <Button title="Next scan" onPress={onNext} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, borderRadius: 14, padding: 20, gap: 14, justifyContent: 'center' },
  good: { backgroundColor: colors.goodSoft },
  wait: { backgroundColor: colors.waitSoft },
  bad: { backgroundColor: colors.badSoft },
  verdict: { fontSize: 26, fontWeight: '700' },
  goodText: { color: colors.good },
  waitText: { color: colors.wait },
  badText: { color: colors.bad },
  photo: { width: 220, height: 220, borderRadius: 12, alignSelf: 'center', backgroundColor: colors.line },
  name: { fontSize: 24, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  host: { fontSize: 18, color: colors.ink, textAlign: 'center' },
});
