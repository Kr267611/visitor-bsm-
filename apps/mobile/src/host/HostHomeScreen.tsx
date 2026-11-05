import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { errorMessage, useApi } from '../api';
import { Button, colors, ErrorText, Muted, Title } from '../ui/kit';

export function HostHomeScreen() {
  const api = useApi();
  const router = useRouter();
  const visits = useQuery({ queryKey: ['visits', 'mine'], queryFn: () => api.visits.list({ scope: 'mine' }) });

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Title>Mere visitors</Title>
      <Button title="Naya invite" onPress={() => router.push('/(host)/invite')} />
      {visits.isError ? <ErrorText>{errorMessage(visits.error)}</ErrorText> : null}
      {visits.data?.length === 0 ? <Muted>Abhi koi visitor nahi hai. "Naya invite" se shuru karein.</Muted> : null}
      {visits.data?.map((visit) => (
        <Button
          key={visit.id}
          kind="plain"
          title={`${visit.visitorName} · ${visit.status}`}
          onPress={() => router.push(`/(host)/visits/${visit.id}`)}
        />
      ))}
      <Button title="Settings" kind="plain" onPress={() => router.push('/(host)/settings')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 12, backgroundColor: colors.bg },
});
