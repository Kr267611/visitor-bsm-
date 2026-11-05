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
          {data.result === 'CHECKED_IN' ? 'Andar ja sakte hain' : 'Bahar ja sakte hain'}
        </Text>
        {data.visitor.photoUrl ? (
          <Image accessibilityLabel="Visitor ki photo" source={{ uri: data.visitor.photoUrl }} style={styles.photo} />
        ) : (
          <Muted>Is visitor ki photo nahi hai. ID dekh lein.</Muted>
        )}
        <Text style={styles.name}>{data.visitor.name}</Text>
        {data.visitor.company ? <Muted>{data.visitor.company}</Muted> : null}
        <Text style={styles.host}>Host: {data.host}</Text>
        <Button title="Agla scan" onPress={onNext} />
      </View>
    );
  }

  if (outcome.kind === 'network') {
    return (
      <View style={[styles.panel, styles.wait]}>
        <Text style={[styles.verdict, styles.waitText]}>Entry confirm nahi hui. Dobara scan karein.</Text>
        <Muted>Internet ya server se connection nahi ho paya. Na chale to paper register par likhein.</Muted>
        <Button title="Agla scan" onPress={onNext} />
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
        <Button title="Walk-in entry karein" kind="plain" onPress={onWalkIn} />
      ) : null}
      <Button title="Agla scan" onPress={onNext} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, borderRadius: 14, padding: 20, gap: 14, justifyContent: 'center' },
  good: { backgroundColor: colors.accentSoft },
  wait: { backgroundColor: colors.waitSoft },
  bad: { backgroundColor: colors.badSoft },
  verdict: { fontSize: 26, fontWeight: '700' },
  goodText: { color: colors.accent },
  waitText: { color: colors.wait },
  badText: { color: colors.bad },
  photo: { width: 220, height: 220, borderRadius: 12, alignSelf: 'center', backgroundColor: colors.line },
  name: { fontSize: 24, fontWeight: '700', color: colors.ink, textAlign: 'center' },
  host: { fontSize: 18, color: colors.ink, textAlign: 'center' },
});
