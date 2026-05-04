import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
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
  setAccountArchived,
} from '../../src/db/account-repo';
import {
  createAsset,
  listAssets,
  setAssetArchived,
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
  const [showArchived, setShowArchived] = useState(false);

  const loadData = useCallback(async () => {
    const [accs, ass] = await Promise.all([
      listAccounts({ includeArchived: showArchived }),
      listAssets({ includeArchived: showArchived }),
    ]);
    setAccounts(accs);
    setAssets(ass);
    if (selectedAccountId && !accs.some((a) => a.id === selectedAccountId)) {
      setSelectedAccountId(accs.length > 0 ? accs[0].id : null);
    } else if (!selectedAccountId && accs.length > 0) {
      setSelectedAccountId(accs[0].id);
    }
  }, [selectedAccountId, showArchived]);

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
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to create account';
      Alert.alert('Error', message);
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

  const archiveAccount = (acc: Account) => {
    Alert.alert(
      'Archive Account',
      `Hide "${acc.name}" and all its assets from default views? History is preserved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          onPress: async () => {
            await setAccountArchived(acc.id, true);
            loadData();
          },
        },
      ]
    );
  };

  const unarchiveAccount = async (acc: Account) => {
    await setAccountArchived(acc.id, false);
    loadData();
  };

  const unarchiveAsset = async (assetId: number) => {
    await setAssetArchived(assetId, false);
    loadData();
  };

  const addAsset = async () => {
    const name = newAssetName.trim();
    if (!name || !selectedAccountId) return;
    try {
      await createAsset(selectedAccountId, name);
      setNewAssetName('');
      loadData();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to create asset';
      Alert.alert('Error', message);
    }
  };

  const assetsForSelected = assets.filter((a) => a.accountId === selectedAccountId);
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={shared.screen} contentContainerStyle={shared.scrollContent}>
        <View style={[shared.card, styles.toggleRow]}>
          <Text style={styles.toggleLabel}>Show archived</Text>
          <Switch value={showArchived} onValueChange={setShowArchived} />
        </View>

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
                acc.archived && styles.archivedRow,
              ]}>
              <View style={styles.rowLeft}>
                <Text style={styles.listRowText}>{acc.name}</Text>
                {acc.archived && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Archived</Text>
                  </View>
                )}
              </View>
              <View style={styles.rowActions}>
                {acc.archived ? (
                  <TouchableOpacity onPress={() => unarchiveAccount(acc)}>
                    <Text style={styles.unarchiveBtn}>Unarchive</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={() => archiveAccount(acc)}>
                    <Text style={styles.archiveBtn}>Archive</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => removeAccount(acc)}>
                  <Text style={styles.deleteX}>✕</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {selectedAccount && (
          <>
            <Text style={shared.sectionTitle}>
              Assets in {selectedAccount.name}
            </Text>
            <View style={shared.card}>
              {!selectedAccount.archived && (
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
              )}
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
                      style={[
                        styles.listRow,
                        asset.archived && styles.archivedRow,
                      ]}
                      onPress={() => router.push(`/modals/edit-asset?id=${asset.id}`)}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.rowLeft}>
                          <Text style={styles.listRowText}>{asset.name}</Text>
                          {asset.archived && (
                            <View style={styles.badge}>
                              <Text style={styles.badgeText}>Archived</Text>
                            </View>
                          )}
                        </View>
                        {catStr ? <Text style={styles.listRowMeta}>{catStr}</Text> : null}
                      </View>
                      {asset.archived ? (
                        <TouchableOpacity onPress={() => unarchiveAsset(asset.id)}>
                          <Text style={styles.unarchiveBtn}>Unarchive</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.editArrow}>›</Text>
                      )}
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
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
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
  archivedRow: {
    opacity: 0.6,
  },
  rowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  archiveBtn: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  unarchiveBtn: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  badge: {
    backgroundColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
