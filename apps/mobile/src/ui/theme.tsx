import { ReactNode } from 'react';

/**
 * Sky Glass, same as the web app: soft sky-blue background, white cards with large rounded corners,
 * calm blue for actions and peach for what needs attention. One theme.
 */
const colors = {
  bg: '#e3ebf5',
  /** Top of the screen, for a gentle sky tint behind headers. */
  sky: '#c9def4',
  surface: '#ffffff',
  /** Frosted card over the background. */
  card: 'rgba(255, 255, 255, 0.82)',
  cardLine: 'rgba(255, 255, 255, 0.95)',
  ink: '#18202f',
  muted: '#5b6577',
  line: '#dbe4f0',
  accent: '#3b66b8',
  accentSoft: '#e2ebf8',
  /** Text on the accent colour. */
  accentInk: '#ffffff',
  peach: '#f5b69e',
  peachInk: '#5a2414',
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
