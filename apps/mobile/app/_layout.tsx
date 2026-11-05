import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ApiProvider, createMobileClient } from '../src/api';
import { AuthProvider } from '../src/auth/AuthProvider';

const mobile = createMobileClient(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000');

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider mobile={mobile}>
        <AuthProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }} />
        </AuthProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}
