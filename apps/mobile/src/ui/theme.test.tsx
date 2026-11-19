import { fireEvent, render, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Text } from 'react-native';
import { palettes, ThemeProvider, ThemeToggle, themed, useTheme } from './kit';

function Probe() {
  const { name, colors } = useTheme();
  return <Text testID="probe">{`${name} ${colors.bg}`}</Text>;
}

const useBox = themed((colors) => ({ backgroundColor: colors.surface }));
function Box() {
  const style = useBox();
  return <Text testID="box">{style.backgroundColor}</Text>;
}

const app = () => (
  <ThemeProvider>
    <Probe />
    <Box />
    <ThemeToggle />
  </ThemeProvider>
);

describe('Day / Night on the phone', () => {
  beforeEach(async () => {
    await SecureStore.deleteItemAsync('theme');
  });

  it('starts in Day, switches to Night and back, and saves the choice', async () => {
    await render(app());
    expect(screen.getByTestId('probe').props.children).toBe(`light ${palettes.light.bg}`);
    await fireEvent.press(screen.getByLabelText('Switch to night mode'));
    expect(screen.getByTestId('probe').props.children).toBe(`dark ${palettes.dark.bg}`);
    expect(screen.getByTestId('box').props.children).toBe(palettes.dark.surface);
    expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith('theme', 'dark');
    await fireEvent.press(screen.getByLabelText('Switch to day mode'));
    expect(screen.getByTestId('probe').props.children).toBe(`light ${palettes.light.bg}`);
    expect(SecureStore.setItemAsync).toHaveBeenLastCalledWith('theme', 'light');
  });

  it('opens in the mode chosen last time', async () => {
    await SecureStore.setItemAsync('theme', 'dark');
    await render(app());
    expect(await screen.findByLabelText('Switch to day mode')).toBeTruthy();
    expect(screen.getByText('☀ Day mode')).toBeTruthy();
  });

  it('every text colour is readable in both modes', () => {
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    for (const c of Object.values(palettes)) {
      expect(contrast(c.ink, c.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.muted, c.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.accentInk, c.accent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.good, c.goodSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.bad, c.badSoft)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.wait, c.waitSoft)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
