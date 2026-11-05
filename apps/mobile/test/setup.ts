// Har test se pehle saaf secure store.
const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));

jest.mock('expo-crypto', () => {
  let n = 0;
  return {
    randomUUID: () => {
      n += 1;
      return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    },
  };
});

jest.mock('expo-router', () => {
  const router = { replace: jest.fn(), push: jest.fn(), back: jest.fn() };
  return {
    useRouter: () => router,
    useLocalSearchParams: jest.fn(() => ({})),
    Link: ({ children }: { children: unknown }) => children,
    __router: router,
  };
});

beforeEach(() => {
  mockStore.clear();
  const { __router } = jest.requireMock('expo-router');
  Object.values(__router).forEach((fn) => (fn as jest.Mock).mockClear());
});

// Asli app jaisa React Native ka FormData, jo { uri, name, type } leta hai.
(globalThis as any).FormData = jest.requireActual('react-native/Libraries/Network/FormData').default;
