import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

export const colors = {
  bg: '#f2f5f4',
  surface: '#ffffff',
  ink: '#13211d',
  muted: '#55665f',
  line: '#d5ddda',
  accent: '#0b6e5f',
  accentSoft: '#dceeea',
  wait: '#915500',
  waitSoft: '#faefd9',
  bad: '#b3261e',
  badSoft: '#fbe6e4',
};

export function Button(props: {
  title: string;
  onPress(): void;
  kind?: 'primary' | 'plain' | 'danger';
  disabled?: boolean;
  busy?: boolean;
}) {
  const kind = props.kind ?? 'primary';
  const disabled = props.disabled || props.busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={props.onPress}
      style={[styles.button, styles[kind], disabled && styles.disabled]}
    >
      {props.busy ? (
        <ActivityIndicator color={kind === 'primary' ? '#ffffff' : colors.ink} />
      ) : (
        <Text style={[styles.buttonText, kind === 'primary' && styles.primaryText, kind === 'danger' && styles.dangerText]}>
          {props.title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string; hint?: string }) {
  const { label, hint, ...input } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} style={styles.input} {...input} />
      {hint ? <Text style={styles.muted}>{hint}</Text> : null}
    </View>
  );
}

export const ErrorText = ({ children }: { children: ReactNode }) => (
  <Text accessibilityRole="alert" style={styles.error}>
    {children}
  </Text>
);

export const Muted = ({ children }: { children: ReactNode }) => <Text style={styles.muted}>{children}</Text>;

export const Title = ({ children }: { children: ReactNode }) => (
  <Text accessibilityRole="header" style={styles.title}>
    {children}
  </Text>
);

export const Screen = ({ children }: { children: ReactNode }) => <View style={styles.screen}>{children}</View>;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: 16, gap: 14 },
  title: { fontSize: 26, fontWeight: '700', color: colors.ink },
  field: { gap: 6 },
  label: { fontSize: 15, fontWeight: '600', color: colors.ink },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 18,
    backgroundColor: colors.surface,
    color: colors.ink,
  },
  button: { minHeight: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1 },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  plain: { backgroundColor: colors.surface, borderColor: colors.line },
  danger: { backgroundColor: colors.surface, borderColor: colors.bad },
  disabled: { opacity: 0.5 },
  buttonText: { fontSize: 18, fontWeight: '600', color: colors.ink },
  primaryText: { color: '#ffffff' },
  dangerText: { color: colors.bad },
  error: { color: colors.bad, fontSize: 16 },
  muted: { color: colors.muted, fontSize: 14 },
});
