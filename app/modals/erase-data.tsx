import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { eraseAllDataAndSync } from '../../src/services/erase-data';
import { notify } from '../../src/utils/dialog';
import { semantic, spacing, type ThemeColors } from '../../src/utils/theme';
import { useShared, useThemedStyles } from '../../src/hooks/SettingsContext';

export default function EraseDataModal() {
  const { t } = useTranslation();
  const router = useRouter();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);
  const [resetSettings, setResetSettings] = useState(false);
  const [busy, setBusy] = useState(false);

  const onConfirm = async () => {
    setBusy(true);
    try {
      await eraseAllDataAndSync({ resetSettings });
      notify(t('eraseData.doneTitle'), t('eraseData.doneBody'));
      router.back();
    } catch (e) {
      notify(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={shared.screen} contentContainerStyle={shared.scrollContent}>
        <View style={[shared.card, styles.warningCard]}>
          <Text style={styles.warningTitle}>{t('eraseData.warningTitle')}</Text>
          <Text style={styles.warningBody}>{t('eraseData.warningBody')}</Text>
        </View>

        <View style={[shared.card, styles.toggleRow]}>
          <Text style={styles.toggleLabel}>{t('eraseData.resetSettingsLabel')}</Text>
          <Switch
            value={resetSettings}
            onValueChange={setResetSettings}
            disabled={busy}
          />
        </View>

        <TouchableOpacity
          style={[styles.confirmBtn, busy && styles.btnDisabled]}
          onPress={onConfirm}
          disabled={busy}>
          <Text style={styles.confirmBtnText}>{t('eraseData.confirm')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.cancelBtn, busy && styles.btnDisabled]}
          onPress={() => router.back()}
          disabled={busy}>
          <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    warningCard: {
      borderColor: semantic.negative,
      borderWidth: 1,
    },
    warningTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: semantic.negative,
      marginBottom: spacing.sm,
    },
    warningBody: {
      fontSize: 14,
      color: c.ink,
      lineHeight: 20,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
    },
    toggleLabel: {
      fontSize: 15,
      fontWeight: '500',
      flex: 1,
      marginRight: spacing.md,
    },
    confirmBtn: {
      backgroundColor: semantic.negative,
      paddingVertical: spacing.md,
      borderRadius: 10,
      alignItems: 'center',
      marginTop: spacing.md,
    },
    confirmBtnText: {
      color: 'white',
      fontSize: 16,
      fontWeight: '700',
    },
    cancelBtn: {
      paddingVertical: spacing.md,
      borderRadius: 10,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    cancelBtnText: {
      color: c.muted,
      fontSize: 16,
      fontWeight: '500',
    },
    btnDisabled: {
      opacity: 0.5,
    },
  });
