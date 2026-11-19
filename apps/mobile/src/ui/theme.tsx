import { ReactNode } from 'react';

/**
 * Brand: Powder Blue #8DB9F0, Soft Lavender White #E9E8F8 and Warm Sunset Peach #F5B69E,
 * with deep indigo for actions (same as the web app). One theme.
 */
const colors = {
  bg: '#e9e8f8',
  surface: '#ffffff',
  ink: '#1b1a3a',
  muted: '#4c4a70',
  line: '#dcdbf0',
  accent: '#3d3592',
  accentSoft: '#e3eefc',
  /** Text on the accent colour. */
  accentInk: '#ffffff',
  /** Status colours stay apart from the brand: green = entry allowed / inside, red = refused / error. */
  good: '#13663d',
  goodSoft: '#ddf1e6',
  wait: '#8a5100',
  waitSoft: '#fbebcf',
  bad: '#b42318',
  badSoft: '#fde4e1',
};
export type Palette = typeof colors;
export const palette: Palette = colors;

const value = { colors };

/** Kept so screens need no changes if a second theme is ever added. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export const useTheme = () => value;

/** Styles built once: `const useStyles = themed((colors) => StyleSheet.create({...}))`. */
export function themed<T>(factory: (colors: Palette) => T): () => T {
  let styles: T | undefined;
  return function useStyles() {
    return (styles ??= factory(colors));
  };
}
