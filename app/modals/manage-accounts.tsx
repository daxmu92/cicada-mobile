import { useCallback, useState } from 'react';
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
import { useFocusEffect, useRouter } from 'expo-router';

import {
  createAccount,
  deleteAccount,
  listAccounts,
} from '../../src/db/account-repo';
import {
  createAsset,
  listAssets,
} from '../../src/db/asset-repo';
import type { Account, AssetWithAccount } from '../../src/utils/types';
import { colors, shared, spacing } from '../../src/utils/theme';

export default function ManageAccountsModal() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [assets, setAssets] = useState<AssetWithAccount[]>([]);
  const [newAccountName, setNewAccountName] = useState('');
  const [newAssetName, setNewAssetName] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    const [accs, ass] = await Promise.all([listAccounts(), listAssets()]);
    setAccounts(accs);
    setAssets(ass);
    if (!selectedAccountId && accs.length > 0) {
      setSelectedAccountId(accs[0].id);
    }
  }, [selectedAccountId]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const addAccount = async () => {
    const name = newAccountName.trim();
    if (!name) return;
    try {
      await createAccount(name);
      setNewAccountName('');
      loadData();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to create account');
    }
  };

  const removeAccount = (acc: Account) => {
    Alert.alert(
      'Delete Account',
      `Delete "${acc.name}" and all its assets/snapshots?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteAccount(acc.id);
            if (selectedAccountId === acc.id) setSelectedAccountId(null);
            loadData();
          },
        },
      ]
    );
  };

  const addAsset = async () => {
    const name = newAssetName.trim();
    if (!name || !selectedAccountId) return;
    try {
      await createAsset(selectedAccountId, name);
      setNewAssetName('');
      loadData();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to create asset');
    }
  };

  const assetsForSelected = assets.filter((a) => a.accountId === selectedAccountId);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={shared.screen} contentContainerStyle={shared.scrollContent}>
        <Text style={shared.sectionTitle}>Accounts</Text>
        <View style={shared.card}>
          <View style={styles.addRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={newAccountName}
              onChangeText={setNewAccountName}
              placeholder="New account name"
            />
            <TouchableOpacity style={styles.addBtn} onPress={addAccount}>
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          </View>
          {accounts.map((acc) => (
            <TouchableOpacity
              key={acc.id}
              onPress={() => setSelectedAccountId(acc.id)}
              style={[
                styles.listRow,
                selectedAccountId === acc.id && { backgroundColor: '#eff6ff' },
              ]}>
              <Text style={styles.listRowText}>{acc.name}</Text>
              <TouchableOpacity onPress={() => removeAccount(acc)}>
                <Text style={styles.deleteX}>✕</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </View>

        {selectedAccountId && (
          <>
            <Text style={shared.sectionTitle}>
              Assets in {accounts.find((a) => a.id === selectedAccountId)?.name}
            </Text>
            <View style={shared.card}>
              <View style={styles.addRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={newAssetName}
                  onChangeText={setNewAssetName}
                  placeholder="New asset name"
                />
                <TouchableOpacity style={styles.addBtn} onPress={addAsset}>
                  <Text style={styles.addBtnText}>Add</Text>
                </TouchableOpacity>
              </View>
              {assetsForSelected.length === 0 ? (
                <Text style={shared.muted}>No assets yet</Text>
              ) : (
                assetsForSelected.map((asset) => {
                  const catStr = Object.entries(asset.categories)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ');
                  return (
                    <TouchableOpacity
                      key={asset.id}
                      style={styles.listRow}
                      onPress={() => router.push(`/modals/edit-asset?id=${asset.id}`)}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.listRowText}>{asset.name}</Text>
                        {catStr ? <Text style={styles.listRowMeta}>{catStr}</Text> : null}
                      </View>
                      <Text style={styles.editArrow}>›</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  addRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
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
  addBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: 8,
  },
  addBtnText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 6,
  },
  listRowText: {
    fontSize: 15,
  },
  listRowMeta: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  editArrow: {
    fontSize: 22,
    color: colors.muted,
    paddingHorizontal: spacing.sm,
  },
  deleteX: {
    color: colors.negative,
    fontSize: 18,
    paddingHorizontal: spacing.sm,
  },
});
