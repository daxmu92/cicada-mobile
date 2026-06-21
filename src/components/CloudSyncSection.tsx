import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useSync, type SyncStatus } from '../hooks/SyncContext';
import { loadCredentials } from '../sync/credentials';
import { type WebDavConfig } from '../sync/providers/webdav';
import { confirmAsync, notify } from '../utils/dialog';
import { colors, shared, spacing } from '../utils/theme';

const DEFAULT_URL = 'https://dav.jianguoyun.com/dav/';

const STATUS_KEY: Record<SyncStatus, string> = {
  idle: '',
  syncing: 'settings.cloudStatusSyncing',
  ok: 'settings.cloudStatusOk',
  offline: 'settings.cloudStatusOffline',
  authError: 'settings.cloudStatusAuthError',
  error: 'settings.cloudStatusError',
};

export default function CloudSyncSection() {
  const { t } = useTranslation();
  const sync = useSync();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_URL);
  const [username, setUsername] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // Prefill the non-secret fields when already connected.
  useEffect(() => {
    if (!sync.available) return;
    (async () => {
      const creds = await loadCredentials();
      if (creds) {
        setBaseUrl(creds.baseUrl);
        setUsername(creds.username);
        setAppPassword(creds.appPassword);
      }
    })();
  }, [sync.available, sync.connected]);

  if (!sync.available) return null; // hidden in a plain browser / PWA

  const config = (): WebDavConfig => ({ baseUrl: baseUrl.trim(), username: username.trim(), appPassword });
  const hasFields = baseUrl.trim() && username.trim() && appPassword;

  const guard = async (fn: () => Promise<void>) => {
    if (!hasFields) {
      notify(t('common.error'), t('settings.cloudMissingFields'));
      return;
    }
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      notify(t('common.error'), e?.message ?? t('settings.cloudStatusError'));
    } finally {
      setBusy(false);
    }
  };

  const onTest = () => guard(async () => {
    await sync.testConnection(config());
    notify(t('settings.doneTitle'), t('settings.cloudTestOk'));
  });
  const onConnect = () => guard(async () => { await sync.connect(config()); });
  const onDisconnect = async () => {
    const ok = await confirmAsync(t('settings.cloudDisconnect'), '', t('settings.cloudDisconnect'), true);
    if (!ok) return;
    setBusy(true);
    try { await sync.disconnect(); } finally { setBusy(false); }
  };
  const onOverwrite = async () => {
    const ok = await confirmAsync(t('settings.cloudOverwrite'), t('settings.cloudOverwriteConfirm'), t('settings.cloudOverwrite'), true);
    if (!ok) return;
    setBusy(true);
    try { await sync.overwriteCloud(); } finally { setBusy(false); }
  };

  const lastSynced = sync.lastSyncedAt
    ? t('settings.cloudLastSynced', { when: new Date(sync.lastSyncedAt).toLocaleString() })
    : t('settings.cloudNeverSynced');
  const statusKey = STATUS_KEY[sync.status];

  return (
    <>
      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>{t('settings.cloudSync')}</Text>
      <View style={shared.card}>
        <Text style={shared.muted}>{t('settings.cloudSyncHelp')}</Text>

        <Text style={styles.label}>{t('settings.cloudServerUrl')}</Text>
        <TextInput style={styles.input} value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} editable={!sync.connected} />

        <Text style={styles.label}>{t('settings.cloudAccount')}</Text>
        <TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!sync.connected} />

        <Text style={styles.label}>{t('settings.cloudAppPassword')}</Text>
        <TextInput style={styles.input} value={appPassword} onChangeText={setAppPassword} autoCapitalize="none" autoCorrect={false} secureTextEntry editable={!sync.connected} />
        <Text style={shared.muted}>{t('settings.cloudAppPasswordHelp')}</Text>

        <View style={styles.statusRow}>
          <Text style={[styles.statusText, sync.status === 'authError' || sync.status === 'error' ? { color: colors.negative } : null]}>
            {sync.connected ? t('settings.cloudConnected') : t('settings.cloudNotConnected')}
            {statusKey ? ` · ${t(statusKey)}` : ''}
          </Text>
          <Text style={shared.muted}>{lastSynced}</Text>
        </View>

        <View style={styles.buttonRow}>
          {!sync.connected ? (
            <>
              <Btn label={t('settings.cloudTest')} onPress={onTest} disabled={busy} />
              <Btn label={t('settings.cloudConnect')} onPress={onConnect} disabled={busy} primary />
            </>
          ) : (
            <>
              <Btn label={t('settings.cloudSyncNow')} onPress={() => sync.syncNow()} disabled={busy} primary />
              <Btn label={t('settings.cloudDisconnect')} onPress={onDisconnect} disabled={busy} />
            </>
          )}
        </View>
      </View>

      {sync.connected && (
        <TouchableOpacity onPress={onOverwrite} disabled={busy} style={[shared.card, busy && { opacity: 0.5 }]}>
          <Text style={[styles.label, { color: colors.negative, marginTop: 0 }]}>{t('settings.cloudOverwrite')}</Text>
          <Text style={shared.muted}>{t('settings.cloudOverwriteSub')}</Text>
        </TouchableOpacity>
      )}
    </>
  );
}

function Btn({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, primary && styles.btnPrimary, disabled && { opacity: 0.5 }]}>
      <Text style={[styles.btnText, primary && { color: 'white' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: 'white', fontSize: 15,
  },
  statusRow: { marginTop: spacing.md },
  statusText: { fontSize: 14, fontWeight: '600' },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: 'white',
  },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnText: { fontSize: 15, fontWeight: '600', color: colors.muted },
});
