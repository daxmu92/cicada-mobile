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

import { getAccount } from '../../src/db/account-repo';
import {
  deleteAsset,
  getAsset,
  setAssetArchived,
  updateAsset,
} from '../../src/db/asset-repo';
import type { Asset } from '../../src/utils/types';
import { colors, shared, spacing } from '../../src/utils/theme';

type Category = { key: string; value: string };

export default function EditAssetModal() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const assetId = Number(params.id);

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
      Alert.alert('Invalid input', 'Asset name cannot be empty');
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
      const message = e instanceof Error ? e.message : 'Failed to save';
      Alert.alert('Error', message);
    }
  };

  const toggleArchive = async () => {
    if (!asset) return;
    const nextArchived = !asset.archived;
    const title = nextArchived ? 'Archive Asset' : 'Unarchive Asset';
    const message = nextArchived
      ? `Hide "${asset.name}" from default views? History is preserved and can be restored later.`
      : `Restore "${asset.name}" to default views?`;
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: nextArchived ? 'Archive' : 'Unarchive',
        onPress: async () => {
          await setAssetArchived(assetId, nextArchived);
          router.back();
        },
      },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete Asset',
      `Delete "${asset?.name}" and all its snapshots?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
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
                    <Text style={styles.badgeText}>Archived</Text>
                  </View>
                )}
              </View>
              <Text style={styles.label}>Asset Name</Text>
              <TextInput style={styles.input} value={name} onChangeText={setName} />
            </View>

            <View style={shared.card}>
              <Text style={[shared.sectionTitle, { marginBottom: spacing.sm }]}>
                Categories
              </Text>
              <Text style={shared.muted}>
                Key/value pairs (e.g. Risk: High, Type: Stock)
              </Text>

              {categories.map((cat, index) => (
                <View key={index} style={styles.catRow}>
                  <TextInput
                    style={[styles.input, styles.catKey]}
                    value={cat.key}
                    onChangeText={(t) => updateCategory(index, 'key', t)}
                    placeholder="Key"
                  />
                  <TextInput
                    style={[styles.input, styles.catValue]}
                    value={cat.value}
                    onChangeText={(t) => updateCategory(index, 'value', t)}
                    placeholder="Value"
                  />
                  <TouchableOpacity
                    onPress={() => removeCategory(index)}
                    style={styles.removeBtn}>
                    <Text style={styles.removeBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <TouchableOpacity onPress={addCategory} style={styles.addCatBtn}>
                <Text style={styles.addCatBtnText}>+ Add Category</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={save}>
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.archiveBtn} onPress={toggleArchive}>
              <Text style={styles.archiveBtnText}>
                {asset.archived ? 'Unarchive Asset' : 'Archive Asset'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete}>
              <Text style={styles.deleteBtnText}>Delete Asset</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    backgroundColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
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
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    backgroundColor: 'white',
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
    color: colors.negative,
    fontSize: 18,
  },
  addCatBtn: {
    marginTop: spacing.md,
    padding: spacing.sm,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  addCatBtnText: {
    color: colors.primary,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  saveBtnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  archiveBtn: {
    padding: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'white',
  },
  archiveBtnText: {
    color: colors.muted,
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
    color: colors.negative,
    fontSize: 16,
    fontWeight: '600',
  },
});
