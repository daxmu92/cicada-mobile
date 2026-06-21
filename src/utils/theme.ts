import { StyleSheet } from 'react-native';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 10,
  md: 16,
  lg: 20,
  pill: 999,
};

// Warm Slate palette — professional but approachable. Numbers stay legible on a
// soft off-white; the terracotta accent carries brand/UI emphasis (selected
// states, links, primary buttons) while gains/losses follow the user's
// semantic green/red convention (see useSemanticColors).
export const colors = {
  // brand / UI accent
  primary: '#c4663a', // terracotta
  accent: '#c4663a',
  accentSoft: 'rgba(196,102,58,0.12)',

  // semantic (refined to harmonize with the warm neutrals)
  positive: '#1f9d6b',
  negative: '#c4503f',

  // text
  ink: '#2b2b33', // primary text (graphite)
  inkSoft: '#5a564e', // secondary text
  muted: '#9a9488', // labels / tertiary

  // surfaces
  bg: '#f7f4ef', // app background (off-white)
  card: '#ffffff',
  border: '#ece9e2', // hairline / track
  track: '#eceae4', // bar/chart track
};

// Soft tints for change pills, keyed by the resolved semantic color so the pill
// background always matches its text color regardless of the green/red setting.
export const tints: Record<string, string> = {
  [colors.positive]: 'rgba(31,157,107,0.12)',
  [colors.negative]: 'rgba(196,80,63,0.12)',
};

// Secondary categorical palette for allocation bars etc. — warm, muted tones.
export const categoryPalette = [
  '#c4663a', // terracotta
  '#d8a05f', // amber
  '#7d8471', // sage
  '#9c6b58', // clay
  '#c7a27c', // sand
  '#6b8480', // teal-gray
  '#b08968', // taupe
  '#8a7a6d', // stone
];

export const shared = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    // Soft elevation replaces the old hard 1px border.
    shadowColor: '#3a3530',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: spacing.md,
  },
  bigNumber: {
    fontSize: 34,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  muted: {
    color: colors.muted,
  },
});
