import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { ComponentProps } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette } from './theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface IconTab {
  /** Route file name inside the group, e.g. "index" or "walk-in". */
  name: string;
  /** Spoken name of the button. */
  label: string;
  icon: IconName;
}

const ITEM = 52;
const GAP = 10;
const PAD = 8;

/**
 * Round icon buttons in a pill that floats at the bottom of the screen.
 * The open page is a filled blue circle. Routes not listed (like a visit's detail) are hidden from the bar.
 */
export function IconTabs({ tabs, hidden = [] }: { tabs: IconTab[]; hidden?: string[] }) {
  const insets = useSafeAreaInsets();
  const { width: screen } = useWindowDimensions();
  const width = tabs.length * ITEM + (tabs.length - 1) * GAP + PAD * 2;
  const bottom = Math.max(insets.bottom, 12) + 4;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarHideOnKeyboard: true,
        // Room at the top for the status bar and at the bottom for the floating bar.
        sceneStyle: { backgroundColor: palette.bg, paddingTop: insets.top, paddingBottom: ITEM + PAD * 2 + bottom + 8 },
        tabBarStyle: [styles.bar, { width, left: (screen - width) / 2, bottom }],
        tabBarItemStyle: styles.item,
        tabBarIconStyle: styles.iconSlot,
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.label,
            tabBarAccessibilityLabel: tab.label,
            tabBarIcon: ({ focused }) => (
              <View style={[styles.circle, focused && styles.circleActive]}>
                <Ionicons name={tab.icon} size={24} color={focused ? palette.accentInk : palette.ink} />
              </View>
            ),
          }}
        />
      ))}
      {hidden.map((name) => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    height: ITEM + PAD * 2,
    paddingHorizontal: PAD - GAP / 2,
    paddingTop: PAD,
    paddingBottom: PAD,
    borderRadius: (ITEM + PAD * 2) / 2,
    borderTopWidth: 1,
    borderWidth: 1,
    borderColor: palette.cardLine,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    shadowColor: '#28467a',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  item: { width: ITEM, height: ITEM, marginHorizontal: GAP / 2, padding: 0 },
  iconSlot: { width: ITEM, height: ITEM },
  circle: {
    width: ITEM,
    height: ITEM,
    borderRadius: ITEM / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.line,
  },
  circleActive: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
    shadowColor: palette.accent,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
