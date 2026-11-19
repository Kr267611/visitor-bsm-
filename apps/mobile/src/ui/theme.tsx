import * as SecureStore from 'expo-secure-store';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

export type ThemeName = 'light' | 'dark';

/** Brand: Midnight Navy #1B1E4A, Warm Stone Grey #AFAEA2 and Crimson Red #D21319 (same as the web app; solid colours, no blur, for speed and sunlight). */
const light = {
  bg: '#e9e7e0',
  surface: '#ffffff',
  ink: '#16182f',
  muted: '#4b4a44',
  line: '#dedcd3',
  accent: '#d21319',
  accentSoft: '#fdeeee',
  /** Text on the accent colour. */
  accentInk: '#ffffff',
  /** Status colours stay apart from the brand: green = entry allowed / inside, orange-red = refused / error. */
  good: '#13663d',
  goodSoft: '#ddf1e6',
  wait: '#8a5100',
  waitSoft: '#fbebcf',
  bad: '#b3400b',
  badSoft: '#fde6d8',
};
export type Palette = typeof light;

/** Night: midnight navy with a crimson-rose accent, the same colours as the web app's night mode. */
const dark: Palette = {
  bg: '#0c0e26',
  surface: '#171a40',
  ink: '#efeee8',
  muted: '#c2c1b7',
  line: '#2c3066',
  accent: '#ff7a7f',
  accentSoft: '#3a1a2a',
  accentInk: '#1b0a0c',
  good: '#7fe0aa',
  goodSoft: '#143022',
  wait: '#ecb862',
  waitSoft: '#3a2f17',
  bad: '#ffa06b',
  badSoft: '#3a1f12',
};

export const palettes: Record<ThemeName, Palette> = { light, dark };

const KEY = 'theme';

interface ThemeValue {
  name: ThemeName;
  colors: Palette;
  toggle(): void;
}

const ThemeContext = createContext<ThemeValue>({ name: 'light', colors: light, toggle: () => undefined });

/** Day or Night as chosen on this phone; until someone chooses, the phone setting decides. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [chosen, setChosen] = useState<ThemeName | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark') setChosen(saved);
      })
      .catch(() => undefined);
  }, []);

  const name: ThemeName = chosen ?? (system === 'dark' ? 'dark' : 'light');
  const toggle = useCallback(() => {
    const next: ThemeName = name === 'dark' ? 'light' : 'dark';
    setChosen(next);
    SecureStore.setItemAsync(KEY, next).catch(() => undefined);
  }, [name]);

  const value = useMemo(() => ({ name, colors: palettes[name], toggle }), [name, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/** Styles built once per theme: `const useStyles = themed((colors) => StyleSheet.create({...}))`. */
export function themed<T>(factory: (colors: Palette) => T): () => T {
  const cache: Partial<Record<ThemeName, T>> = {};
  return function useStyles() {
    const { name, colors } = useTheme();
    return (cache[name] ??= factory(colors));
  };
}
