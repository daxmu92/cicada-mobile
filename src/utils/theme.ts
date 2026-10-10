import { StyleSheet } from 'react-native';

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 10, md: 16, lg: 20, pill: 999 };

export type ThemeName =
  | 'warmSlate' | 'nordic' | 'seaGlass' | 'duskBlue' | 'sky' | 'lilac';

/** The values a theme actually picks. Everything else is derived. */
export type ThemePalette = {
  accent: string;
  onAccent: string; // text/icon on an accent fill (button labels)
  ink: string;
  inkSoft: string;
  muted: string;
  bg: string;
  card: string;
  border: string;
  shadowColor: string;
};

/** Resolved palette = stored choice points + derived fields. */
export type ThemeColors = ThemePalette & {
  primary: string; // = accent
  accentSoft: string; // = accent @ 16% alpha
  track: string; // = border
};

export const themes: Record<ThemeName, ThemePalette> = {
  warmSlate: { accent: '#b4572f', onAccent: '#ffffff', ink: '#2b2b33', inkSoft: '#5a564e', muted: '#6f685f', bg: '#f7f4ef', card: '#ffffff', border: '#ece9e2', shadowColor: '#3a3530' },
  nordic:    { accent: '#445162', onAccent: '#ffffff', ink: '#1f2933', inkSoft: '#52606d', muted: '#65727d', bg: '#f5f7f8', card: '#ffffff', border: '#e3e8ea', shadowColor: '#2a3340' },
  seaGlass:  { accent: '#2f7674', onAccent: '#ffffff', ink: '#1c2b2a', inkSoft: '#4b5c5a', muted: '#5f7673', bg: '#f2f7f6', card: '#ffffff', border: '#dde9e7', shadowColor: '#1e3433' },
  duskBlue:  { accent: '#5a6bb0', onAccent: '#ffffff', ink: '#1e2233', inkSoft: '#525879', muted: '#69708e', bg: '#f5f6fb', card: '#ffffff', border: '#e2e5f0', shadowColor: '#222a4a' },
  sky:       { accent: '#5b9bd5', onAccent: '#1f3346', ink: '#243747', inkSoft: '#5b7184', muted: '#5b7184', bg: '#f5faff', card: '#ffffff', border: '#e2ecf5', shadowColor: '#243747' },
  lilac:     { accent: '#8470c8', onAccent: '#241f3a', ink: '#2b2740', inkSoft: '#5f5878', muted: '#6f6383', bg: '#f9f7fe', card: '#ffffff', border: '#e9e3f7', shadowColor: '#2b2740' },
};

const withAlpha = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export function resolveTheme(p: ThemePalette): ThemeColors {
  return { ...p, primary: p.accent, accentSoft: withAlpha(p.accent, 0.16), track: p.border };
}

// Theme-independent: standard pure gain/loss, shared by all themes.
export const semantic = { positive: '#15803d', negative: '#b91c1c' };

export const tints: Record<string, string> = {
  [semantic.positive]: 'rgba(22,163,74,0.13)',
  [semantic.negative]: 'rgba(220,38,38,0.12)',
};

// Multi-hue category palette (asset categories must be easy to tell apart).
export const categoryPalette = [
  '#4f86c6', '#e8a33d', '#57b08a', '#cc6f8e',
  '#8b7fc7', '#e0823f', '#4cb1bf', '#b0a04e',
];

/** Themed version of the old `shared` StyleSheet. */
export function makeShared(c: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    scrollContent: { padding: spacing.lg, width: '100%', maxWidth: 760, alignSelf: 'center' },
    card: {
      backgroundColor: c.card,
      borderRadius: radius.lg,
      padding: spacing.lg,
      marginBottom: spacing.md,
      shadowColor: c.shadowColor,
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    row: { flexDirection: 'row', alignItems: 'center' },
    sectionTitle: { fontSize: 12, fontWeight: '600', color: c.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
    heading: { fontSize: 20, fontWeight: '700', color: c.ink, marginBottom: spacing.md },
    bigNumber: { fontSize: 34, fontWeight: '800', color: c.ink, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
    muted: { color: c.muted },
  });
}
