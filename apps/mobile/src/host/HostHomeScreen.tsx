import { VISIT_STATUS_LABEL } from '@visitor/shared';
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
      <Title>My visitors</Title>
      <Button title="New invite" onPress={() => router.push('/(host)/invite')} />
      {visits.isError ? <ErrorText>{errorMessage(visits.error)}</ErrorText> : null}
      {visits.data?.length === 0 ? <Muted>No visitors yet. Tap "New invite" to start.</Muted> : null}
      {visits.data?.map((visit) => (
        <Button
          key={visit.id}
          kind="plain"
          title={`${visit.visitorName} · ${VISIT_STATUS_LABEL[visit.status]}`}
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
