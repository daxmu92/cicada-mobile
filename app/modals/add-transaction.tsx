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
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  createTransaction,
  deleteTransaction,
  getAllTags,
  getTransaction,
  updateTransaction,
} from '../../src/db/tran-repo';
import { currentDate } from '../../src/utils/date';
import type { TranType } from '../../src/utils/types';
import { colors, shared, spacing } from '../../src/utils/theme';

export default function AddTransactionModal() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; id?: string }>();
  const editingId = params.id ? Number(params.id) : null;

  const [type, setType] = useState<TranType>('OUTLAY');
  const [date, setDate] = useState(params.date ?? currentDate());
  const [value, setValue] = useState('');
  const [cat, setCat] = useState('');
  const [note, setNote] = useState('');
  const [existingTags, setExistingTags] = useState<string[]>([]);

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
    .map((t) => t.trim())
    .filter(Boolean);

  const toggleTag = (tag: string) => {
    if (activeTags.includes(tag)) {
      setCat(activeTags.filter((t) => t !== tag).join(', '));
    } else {
      setCat([...activeTags, tag].join(', '));
    }
  };

  const submit = async () => {
    const v = parseFloat(value);
    if (isNaN(v) || v <= 0) {
      Alert.alert('Invalid input', 'Please enter a valid positive value.');
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
    Alert.alert('Delete Transaction', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
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
          <Text style={styles.label}>Type</Text>
          <View style={styles.typeRow}>
            {(['INCOME', 'OUTLAY'] as const).map((t) => (
              <TouchableOpacity
                key={t}
                onPress={() => setType(t)}
                style={[
                  styles.typeBtn,
                  type === t && {
                    backgroundColor: t === 'INCOME' ? colors.positive : colors.negative,
                    borderColor: t === 'INCOME' ? colors.positive : colors.negative,
                  },
                ]}>
                <Text
                  style={[
                    styles.typeBtnText,
                    type === t && { color: 'white' },
                  ]}>
                  {t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Date</Text>
          <TextInput
            style={styles.input}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
          />

          <Text style={styles.label}>Value</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>Tags (comma-separated)</Text>
          <TextInput
            style={styles.input}
            value={cat}
            onChangeText={setCat}
            placeholder="e.g. food, dining"
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

          <Text style={styles.label}>Note</Text>
          <TextInput
            style={[styles.input, { height: 80 }]}
            value={note}
            onChangeText={setNote}
            placeholder="Optional description"
            multiline
          />
        </View>

        <TouchableOpacity style={styles.submitBtn} onPress={submit}>
          <Text style={styles.submitText}>{editingId ? 'Update' : 'Save'}</Text>
        </TouchableOpacity>

        {editingId && (
          <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete}>
            <Text style={styles.deleteText}>Delete</Text>
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
