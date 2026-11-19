import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { errorMessage, useApi } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { Button, ErrorText, Field, Muted, themed, Title } from '../ui/kit';

export function SettingsScreen() {
  const styles = useStyles();
  const api = useApi();
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.me.get() });
  const q = search.trim();
  const hosts = useQuery({ queryKey: ['hosts', q], queryFn: () => api.users.searchHosts(q), enabled: q.length >= 2 });

  async function setDelegate(delegateId: string | null) {
    setError(null);
    try {
      queryClient.setQueryData(['me'], await api.me.update({ delegateId }));
      setSearch('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Title>Settings</Title>
      <Muted>If you do not respond in time, the approval request goes to your backup person.</Muted>
      {me.data?.delegateName ? (
        <>
          <Text style={styles.line}>Current backup: {me.data.delegateName}</Text>
          <Button title="Remove backup" kind="plain" onPress={() => void setDelegate(null)} />
        </>
      ) : null}
      <Field label="Search for a backup person" value={search} onChangeText={setSearch} />
      {hosts.data
        ?.filter((host) => host.id !== user?.id)
        .map((host) => (
          <Button key={host.id} kind="plain" title={host.name} onPress={() => void setDelegate(host.id)} />
        ))}
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Button title="Log out" kind="plain" onPress={() => void logout()} />
    </ScrollView>
  );
}

const useStyles = themed((colors) =>
  StyleSheet.create({
    page: { padding: 16, gap: 12, backgroundColor: colors.bg },
    line: { fontSize: 16, color: colors.ink },
  }),
);
