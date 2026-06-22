import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useShared } from '../hooks/SettingsContext';
import { spacing } from '../utils/theme';

type Props = {
  title?: string;
  /** Optional element rendered on the right of the title row (e.g. a link). */
  action?: ReactNode;
  children: ReactNode;
};

/** A surface card with an optional uppercase section title row. */
export function SectionCard({ title, action, children }: Props) {
  const shared = useShared();

  return (
    <View style={shared.card}>
      {(title || action) && (
        <View style={styles.header}>
          {title ? <Text style={shared.sectionTitle}>{title}</Text> : <View />}
          {action}
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
});
