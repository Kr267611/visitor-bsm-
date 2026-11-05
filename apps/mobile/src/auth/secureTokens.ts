import type { SessionUser, Tokens } from '@visitor/shared';
import * as SecureStore from 'expo-secure-store';

const TOKENS_KEY = 'visitor.tokens';
const USER_KEY = 'visitor.user';

async function read<T>(key: string): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

async function write(key: string, value: unknown): Promise<void> {
  if (value === null) await SecureStore.deleteItemAsync(key);
  else await SecureStore.setItemAsync(key, JSON.stringify(value));
}

export const secureTokens = {
  get: () => read<Tokens>(TOKENS_KEY),
  set: (tokens: Tokens | null) => write(TOKENS_KEY, tokens),
};

export const loadSessionUser = () => read<SessionUser>(USER_KEY);
export const saveSessionUser = (user: SessionUser | null) => write(USER_KEY, user);
