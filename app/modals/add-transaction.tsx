import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  createTransaction,
  deleteTransaction,
  getAllTags,
  getTransaction,
  updateTransaction,
} from '../../src/db/tran-repo';
import { currentDate } from '../../src/utils/date';
import { useSemanticColors } from '../../src/hooks/SettingsContext';
import type { TranType } from '../../src/utils/types';
import { colors, shared, spacing } from '../../src/utils/theme';

function formatYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseYMD(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export default function AddTransactionModal() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ date?: string; id?: string }>();
  const editingId = params.id ? Number(params.id) : null;
  const { gain, loss } = useSemanticColors();

  const [type, setType] = useState<TranType>('OUTLAY');
  const [date, setDate] = useState(params.date ?? currentDate());
  const [showPicker, setShowPicker] = useState(false);
  const [value, setValue] = useState('');
  const [cat, setCat] = useState('');
  const [note, setNote] = useState('');
  const [existingTags, setExistingTags] = useState<string[]>([]);

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
      if (event.type === 'set' && selected) {
        setDate(formatYMD(selected));
      }
    } else if (selected) {
      setDate(formatYMD(selected));
    }
  };

  const loadData = useCallback(async () => {
    const tags = await getAllTags();
    setExistingTags(tags);

    if (editingId) {
      const tx = await getTransaction(editingId);
      if (tx) {
        setType(tx.type);
        setDate(tx.date);
        setValue(String(tx.value));
        setCat(tx.cat);
        setNote(tx.note);
      }
    }
  }, [editingId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeTags = cat
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  const toggleTag = (tag: string) => {
    if (activeTags.includes(tag)) {
      setCat(activeTags.filter((s) => s !== tag).join(', '));
    } else {
      setCat([...activeTags, tag].join(', '));
    }
  };

  const submit = async () => {
    const v = parseFloat(value);
    if (isNaN(v) || v <= 0) {
      Alert.alert(t('addTransaction.invalidTitle'), t('addTransaction.invalidValue'));
      return;
    }
    if (editingId) {
      await updateTransaction(editingId, date, type, v, cat.trim(), note.trim());
    } else {
      await createTransaction(date, type, v, cat.trim(), note.trim());
    }
    router.back();
  };

  const confirmDelete = () => {
    if (!editingId) return;
    Alert.alert(t('addTransaction.deleteTitle'), t('addTransaction.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteTransaction(editingId);
          router.back();
        },
      },
    ]);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={shared.screen} contentContainerStyle={shared.scrollContent}>
        <View style={shared.card}>
          <Text style={styles.label}>{t('addTransaction.type')}</Text>
          <View style={styles.typeRow}>
            {(['INCOME', 'OUTLAY'] as const).map((opt) => (
              <TouchableOpacity
                key={opt}
                onPress={() => setType(opt)}
                style={[
                  styles.typeBtn,
                  type === opt && {
                    backgroundColor: opt === 'INCOME' ? gain : loss,
                    borderColor: opt === 'INCOME' ? gain : loss,
                  },
                ]}>
                <Text
                  style={[
                    styles.typeBtnText,
                    type === opt && { color: 'white' },
                  ]}>
                  {opt === 'INCOME' ? t('addTransaction.typeIncome') : t('addTransaction.typeOutlay')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>{t('addTransaction.date')}</Text>
          <TouchableOpacity
            style={styles.input}
            onPress={() => setShowPicker((s) => !s)}>
            <Text style={styles.inputText}>{date}</Text>
          </TouchableOpacity>
          {showPicker && (
            <View style={styles.pickerWrap}>
              <DateTimePicker
                value={parseYMD(date)}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={onPickerChange}
              />
              {Platform.OS === 'ios' && (
                <TouchableOpacity
                  style={styles.doneBtn}
                  onPress={() => setShowPicker(false)}>
                  <Text style={styles.doneText}>{t('common.done')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <Text style={styles.label}>{t('addTransaction.value')}</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder={t('addTransaction.valuePlaceholder')}
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>{t('addTransaction.tags')}</Text>
          <TextInput
            style={styles.input}
            value={cat}
            onChangeText={setCat}
            placeholder={t('addTransaction.tagsPlaceholder')}
            autoCapitalize="none"
          />

          {existingTags.length > 0 && (
            <View style={styles.tagChipsRow}>
              {existingTags.map((tag) => {
                const active = activeTags.includes(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    onPress={() => toggleTag(tag)}
                    style={[styles.tagChip, active && styles.tagChipActive]}>
                    <Text
                      style={[
                        styles.tagChipText,
                        active && { color: 'white' },
                      ]}>
                      {tag}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <Text style={styles.label}>{t('addTransaction.note')}</Text>
          <TextInput
            style={[styles.input, { height: 80 }]}
            value={note}
            onChangeText={setNote}
            placeholder={t('addTransaction.notePlaceholder')}
            multiline
          />
        </View>

        <TouchableOpacity style={styles.submitBtn} onPress={submit}>
          <Text style={styles.submitText}>{editingId ? t('common.update') : t('common.save')}</Text>
        </TouchableOpacity>

        {editingId && (
          <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete}>
            <Text style={styles.deleteText}>{t('common.delete')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  typeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  typeBtn: {
    flex: 1,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: 'white',
  },
  typeBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    backgroundColor: 'white',
  },
  inputText: {
    fontSize: 16,
    paddingVertical: 2,
  },
  pickerWrap: {
    marginTop: spacing.xs,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.sm,
  },
  doneBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  doneText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  tagChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  tagChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'white',
  },
  tagChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tagChipText: {
    fontSize: 13,
    color: colors.muted,
  },
  submitBtn: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  submitText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  deleteBtn: {
    padding: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  deleteText: {
    color: colors.negative,
    fontSize: 16,
    fontWeight: '600',
  },
});
