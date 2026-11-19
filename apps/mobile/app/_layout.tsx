import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ApiProvider, createMobileClient } from '../src/api';
import { AuthProvider } from '../src/auth/AuthProvider';
import { ThemeProvider, useTheme } from '../src/ui/kit';

const mobile = createMobileClient(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000');

/** Status bar and screen background follow Day / Night. */
function ThemedStack() {
  const { name, colors } = useTheme();
  return (
    <>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />
    </>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider mobile={mobile}>
        <AuthProvider>
          <ThemeProvider>
            <ThemedStack />
          </ThemeProvider>
        </AuthProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}
