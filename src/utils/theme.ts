import { StyleSheet } from 'react-native';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const colors = {
  primary: '#2563eb',
  positive: '#16a34a',
  negative: '#dc2626',
  muted: '#6b7280',
  border: '#e5e7eb',
  card: '#ffffff',
  bg: '#f9fafb',
};

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
    borderRadius: 12,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  bigNumber: {
    fontSize: 32,
    fontWeight: '700',
  },
  muted: {
    color: colors.muted,
  },
});
