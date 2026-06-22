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
import { useTranslation } from 'react-i18next';

import { getAccount } from '../../src/db/account-repo';
import {
  deleteAsset,
  getAsset,
  setAssetArchived,
  updateAsset,
} from '../../src/db/asset-repo';
import type { Asset } from '../../src/utils/types';
import { semantic, spacing, type ThemeColors } from '../../src/utils/theme';
import { useShared, useThemedStyles } from '../../src/hooks/SettingsContext';

type Category = { key: string; value: string };

export default function EditAssetModal() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const assetId = Number(params.id);
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);

  const [asset, setAsset] = useState<Asset | null>(null);
  const [accountName, setAccountName] = useState('');
  const [name, setName] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);

  const loadData = useCallback(async () => {
    const a = await getAsset(assetId);
    if (!a) return;
    setAsset(a);
    setName(a.name);
    setCategories(
      Object.entries(a.categories).map(([key, value]) => ({ key, value }))
    );
    const acc = await getAccount(a.accountId);
    setAccountName(acc?.name ?? '');
  }, [assetId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addCategory = () => {
    setCategories([...categories, { key: '', value: '' }]);
  };

  const updateCategory = (index: number, field: 'key' | 'value', text: string) => {
    const next = [...categories];
    next[index] = { ...next[index], [field]: text };
    setCategories(next);
  };

  const removeCategory = (index: number) => {
    setCategories(categories.filter((_, i) => i !== index));
  };

  const save = async () => {
    if (!name.trim()) {
      Alert.alert(t('editAsset.invalidTitle'), t('editAsset.emptyName'));
      return;
    }
    const catMap: Record<string, string> = {};
    for (const { key, value } of categories) {
      const k = key.trim();
      const v = value.trim();
      if (k) catMap[k] = v;
    }
    try {
      await updateAsset(assetId, name.trim(), catMap);
      router.back();
    } catch (e) {
      const message = e instanceof Error ? e.message : t('editAsset.saveFailed');
      Alert.alert(t('common.error'), message);
    }
  };

  const toggleArchive = async () => {
    if (!asset) return;
    const nextArchived = !asset.archived;
    const title = nextArchived ? t('editAsset.archiveTitle') : t('editAsset.unarchiveTitle');
    const message = nextArchived ? t('editAsset.archiveBody', { name: asset.name }) : t('editAsset.unarchiveBody', { name: asset.name });
    Alert.alert(title, message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: nextArchived ? t('common.archive') : t('common.unarchive'),
        onPress: async () => {
          await setAssetArchived(assetId, nextArchived);
          router.back();
        },
      },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert(
      t('editAsset.deleteTitle'),
      t('editAsset.deleteBody', { name: asset?.name ?? '' }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            await deleteAsset(assetId);
            router.back();
          },
        },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={shared.screen} contentContainerStyle={shared.scrollContent}>
        {asset && (
          <>
            <View style={shared.card}>
              <View style={styles.headerRow}>
                <Text style={shared.sectionTitle}>{accountName}</Text>
                {asset.archived && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{t('common.archived')}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.label}>{t('editAsset.assetName')}</Text>
              <TextInput style={styles.input} value={name} onChangeText={setName} />
            </View>

            <View style={shared.card}>
              <Text style={[shared.sectionTitle, { marginBottom: spacing.sm }]}>
                {t('editAsset.categories')}
              </Text>
              <Text style={shared.muted}>
                {t('editAsset.categoriesHelp')}
              </Text>

              {categories.map((cat, index) => (
                <View key={index} style={styles.catRow}>
                  <TextInput
                    style={[styles.input, styles.catKey]}
                    value={cat.key}
                    onChangeText={(txt) => updateCategory(index, 'key', txt)}
                    placeholder={t('editAsset.keyPlaceholder')}
                  />
                  <TextInput
                    style={[styles.input, styles.catValue]}
                    value={cat.value}
                    onChangeText={(txt) => updateCategory(index, 'value', txt)}
                    placeholder={t('editAsset.valuePlaceholder')}
                  />
                  <TouchableOpacity
                    onPress={() => removeCategory(index)}
                    style={styles.removeBtn}>
                    <Text style={styles.removeBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <TouchableOpacity onPress={addCategory} style={styles.addCatBtn}>
                <Text style={styles.addCatBtnText}>{t('editAsset.addCategory')}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={save}>
              <Text style={styles.saveBtnText}>{t('common.save')}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.archiveBtn} onPress={toggleArchive}>
              <Text style={styles.archiveBtnText}>
                {asset.archived ? t('editAsset.unarchiveAsset') : t('editAsset.archiveAsset')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete}>
              <Text style={styles.deleteBtnText}>{t('editAsset.deleteAsset')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    badge: {
      backgroundColor: c.border,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: 10,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: c.muted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: spacing.xs,
      marginTop: spacing.sm,
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
    catRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    catKey: {
      flex: 1,
    },
    catValue: {
      flex: 2,
    },
    removeBtn: {
      padding: spacing.sm,
    },
    removeBtnText: {
      color: semantic.negative,
      fontSize: 18,
    },
    addCatBtn: {
      marginTop: spacing.md,
      padding: spacing.sm,
      alignItems: 'center',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      borderStyle: 'dashed',
    },
    addCatBtnText: {
      color: c.primary,
      fontWeight: '600',
    },
    saveBtn: {
      backgroundColor: c.primary,
      padding: spacing.md,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: spacing.md,
    },
    saveBtnText: {
      color: c.onAccent,
      fontSize: 16,
      fontWeight: '600',
    },
    archiveBtn: {
      padding: spacing.md,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: spacing.sm,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
    },
    archiveBtnText: {
      color: c.muted,
      fontSize: 16,
      fontWeight: '600',
    },
    deleteBtn: {
      padding: spacing.md,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    deleteBtnText: {
      color: semantic.negative,
      fontSize: 16,
      fontWeight: '600',
    },
  });
