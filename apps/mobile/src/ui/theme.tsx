import * as SecureStore from 'expo-secure-store';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

export type ThemeName = 'light' | 'dark';

/** Brand: Deep Crimson Burgundy #790B13 on Warm Ivory Cream #FFF0DC (same as the web app). */
const light = {
  bg: '#faf3e8',
  surface: '#fffdf9',
  ink: '#2a1214',
  muted: '#6e5a55',
  line: '#eadccb',
  accent: '#790b13',
  accentSoft: '#f7e3dc',
  /** Text on the accent colour. */
  accentInk: '#fff0dc',
  /** Status colours stay apart from the brand: green = entry allowed / inside, orange-red = refused / error. */
  good: '#1a6e44',
  goodSoft: '#def0e5',
  wait: '#8a5100',
  waitSoft: '#fbebcf',
  bad: '#b03a0c',
  badSoft: '#fde4d6',
};
export type Palette = typeof light;

/** Night: black with a burgundy-rose accent, the same colours as the web app's night mode. */
const dark: Palette = {
  bg: '#0a0a0a',
  surface: '#141414',
  ink: '#f5f2ee',
  muted: '#a9a39e',
  line: '#2a2a2a',
  accent: '#f2b3b0',
  accentSoft: '#2b1416',
  accentInk: '#3b060a',
  good: '#74d39f',
  goodSoft: '#10271a',
  wait: '#e9b35a',
  waitSoft: '#2e230e',
  bad: '#ff9466',
  badSoft: '#33190f',
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
