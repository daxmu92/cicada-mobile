import { useRecoverableDraft } from '../../src/hooks/use-recoverable-draft';
import { DraftRecoveryNotice } from '../../src/components/DraftRecoveryNotice';
import { useUnsavedChanges } from '../../src/hooks/use-unsaved-changes';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { DateField } from '../../src/components/DateField';
import { parseAmount } from '../../src/utils/money';
import { useSaveAction } from '../../src/hooks/use-save-action';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { confirmAsync, notify } from '../../src/utils/dialog';
import {
  createTransaction,
  deleteTransaction,
  getAllTags,
  getTransaction,
  updateTransaction,
} from '../../src/db/tran-repo';
import { currentDate } from '../../src/utils/date';
import { useSemanticColors, useShared, useTheme, useThemedStyles } from '../../src/hooks/SettingsContext';
import type { TranType } from '../../src/utils/types';
import { semantic, spacing, type ThemeColors } from '../../src/utils/theme';

export default function AddTransactionModal() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ date?: string; id?: string }>();
  const editingId = params.id ? Number(params.id) : null;
  const { gain, loss } = useSemanticColors();
  const c = useTheme();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);

  const [type, setType] = useState<TranType>('OUTLAY');
  const [date, setDate] = useState(params.date ?? currentDate());
  const { saving, save } = useSaveAction();
  const [value, setValue] = useState('');
  const [cat, setCat] = useState('');
  const [note, setNote] = useState('');
  const [existingTags, setExistingTags] = useState<string[]>([]);

  const [loadedId,setLoadedId]=useState<number|null>(null);
  const ready=editingId===null||editingId===loadedId;
  const [recordUuid,setRecordUuid]=useState<string|null>(null);
  const baseline=useRef(JSON.stringify(['OUTLAY',params.date??currentDate(),'','','']));
  const dirty=ready&&JSON.stringify([type,date,value,cat,note])!==baseline.current;
  const recovery=useRecoverableDraft({key:editingId===null?'transaction:new':recordUuid?`transaction:${recordUuid}`:null,ready,dirty,baseline:editingId===null?'new-transaction':baseline.current,value:[type,date,value,cat,note],valid:value=>Array.isArray(value)&&value.length===5&&value.every(v=>typeof v==='string')&&['INCOME','OUTLAY'].includes(value[0]),restore:value=>{const values=value as string[];setType(values[0] as TranType);setDate(values[1]);setValue(values[2]);setCat(values[3]);setNote(values[4]);}});
  const busy=saving||!ready||recovery.blocked;
  const markSaved=useUnsavedChanges(dirty,saving,async()=>{if(!await recovery.clear())throw new Error('Draft cleanup failed');});
  const loadData = useCallback(async (cancelled:()=>boolean) => {
    const tags = await getAllTags();
    if(cancelled())return;
    setExistingTags(tags);

    if (editingId !== null) {
      const tx = await getTransaction(editingId);
      if(cancelled())return;
      if(!tx)throw new Error('Transaction not found');
      if (tx) {
        baseline.current=JSON.stringify([tx.type,tx.date,String(tx.value),tx.cat,tx.note]);
        setRecordUuid(tx.uuid??null);
        setLoadedId(editingId);
        setType(tx.type);
        setDate(tx.date);
        setValue(String(tx.value));
        setCat(tx.cat);
        setNote(tx.note);
      }
    }
  }, [editingId]);

  useEffect(() => {
    let cancelled=false;
    void loadData(()=>cancelled).catch(()=>{if(!cancelled)notify(t('common.error'),t('common.loadFailed'));});
    return()=>{cancelled=true;};
  }, [loadData,t]);

  const activeTags = cat
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  const toggleTag = (tag: string) => {
    if(busy)return;
    if (activeTags.includes(tag)) {
      setCat(activeTags.filter((s) => s !== tag).join(', '));
    } else {
      setCat([...activeTags, tag].join(', '));
    }
  };

  const submit = () => save(async () => {
    if(!ready)return;
    const v = parseAmount(value);
    if (v <= 0) {
      notify(t('addTransaction.invalidTitle'), t('addTransaction.invalidValue'));
      return;
    }
    recovery.pause();
    try {
    if (editingId !== null) {
      await updateTransaction(editingId, date, type, v, cat.trim(), note.trim(),{key:`transaction:${recordUuid}`});
    } else {
      await createTransaction(date, type, v, cat.trim(), note.trim(),{key:'transaction:new'});
    }
    recovery.consumed();markSaved();router.back();
    }catch(error){recovery.resume();throw error;}
  });

  const confirmDelete = () => save(async () => {
    if (editingId===null||!ready) return;
    const ok = await confirmAsync(
      t('addTransaction.deleteTitle'),
      t('addTransaction.deleteBody'),
      t('common.delete'),
      true
    );
    if (!ok) return;
    recovery.pause();
    try{await deleteTransaction(editingId,{key:`transaction:${recordUuid}`});recovery.consumed();markSaved();router.back();}
    catch(error){recovery.resume();throw error;}
  });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={shared.screen} contentContainerStyle={shared.scrollContent}>
        <DraftRecoveryNotice recovery={recovery}/>
        <View style={shared.card}>
          <Text style={styles.label}>{t('addTransaction.type')}</Text>
          <View style={styles.typeRow}>
            {(['INCOME', 'OUTLAY'] as const).map((opt) => (
              <TouchableOpacity
                key={opt}
                disabled={busy} onPress={() => {if(!busy)setType(opt);}}
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
                    type === opt && { color: c.onAccent },
                  ]}>
                  {opt === 'INCOME' ? t('addTransaction.typeIncome') : t('addTransaction.typeOutlay')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>{t('addTransaction.date')}</Text>
          <DateField value={date} onChange={setDate} label={t('addTransaction.date')} disabled={busy} />

          <Text style={styles.label}>{t('addTransaction.value')}</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel={t('addTransaction.value')}
            value={value}
            onChangeText={setValue}
            placeholder={t('addTransaction.valuePlaceholder')}
            keyboardType="decimal-pad"
            editable={!busy}
          />

          <Text style={styles.label}>{t('addTransaction.tags')}</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel={t('addTransaction.tags')}
            value={cat}
            onChangeText={setCat}
            placeholder={t('addTransaction.tagsPlaceholder')}
            autoCapitalize="none" editable={!busy}
          />

          {existingTags.length > 0 && (
            <View style={styles.tagChipsRow}>
              {existingTags.map((tag) => {
                const active = activeTags.includes(tag);
                return (
                  <TouchableOpacity
                    key={tag} disabled={busy}
                    onPress={() => toggleTag(tag)}
                    style={[styles.tagChip, active && styles.tagChipActive]}>
                    <Text
                      style={[
                        styles.tagChipText,
                        active && { color: c.onAccent },
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
            accessibilityLabel={t('addTransaction.note')}
            value={note}
            onChangeText={setNote}
            placeholder={t('addTransaction.notePlaceholder')}
            multiline editable={!busy}
          />
        </View>

        <TouchableOpacity accessibilityRole="button" style={styles.submitBtn} onPress={submit} disabled={busy}>
          <Text style={styles.submitText}>{saving ? t('common.saving') : editingId !== null ? t('common.update') : t('common.save')}</Text>
        </TouchableOpacity>

        {editingId && (
          <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete} disabled={busy}>
            <Text style={styles.deleteText}>{t('common.delete')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
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
      borderColor: c.border,
      borderRadius: 8,
      alignItems: 'center',
      backgroundColor: c.card,
    },
    typeBtnText: {
      fontSize: 14,
      fontWeight: '600',
      color: c.muted,
    },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 16,
      backgroundColor: c.card,
    },
    inputText: {
      fontSize: 16,
      paddingVertical: 2,
    },
    pickerWrap: {
      marginTop: spacing.xs,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      padding: spacing.sm,
    },
    doneBtn: {
      alignSelf: 'flex-end',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    doneText: {
      color: c.primary,
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
      borderColor: c.border,
      backgroundColor: c.card,
    },
    tagChipActive: {
      backgroundColor: c.primary,
      borderColor: c.primary,
    },
    tagChipText: {
      fontSize: 13,
      color: c.muted,
    },
    submitBtn: {
      backgroundColor: c.primary,
      padding: spacing.md,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: spacing.md,
    },
    submitText: {
      color: c.onAccent,
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
      color: semantic.negative,
      fontSize: 16,
      fontWeight: '600',
    },
  });
