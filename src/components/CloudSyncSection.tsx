import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useSync, type SyncStatus } from '../hooks/SyncContext';
import { loadCredentials } from '../sync/credentials';
import { type StoredRemoteConfig } from '../sync/remote-config';
import { confirmAsync, notify } from '../utils/dialog';
import { colors, shared, spacing } from '../utils/theme';

const DEFAULT_WEBDAV_URL = 'https://dav.jianguoyun.com/dav/';

type Provider = 'webdav' | 's3';

const STATUS_KEY: Record<SyncStatus, string> = {
  idle: '', syncing: 'settings.cloudStatusSyncing', ok: 'settings.cloudStatusOk',
  offline: 'settings.cloudStatusOffline', authError: 'settings.cloudStatusAuthError', error: 'settings.cloudStatusError',
};

export default function CloudSyncSection() {
  const { t } = useTranslation();
  const sync = useSync();
  const [provider, setProvider] = useState<Provider>('webdav');
  // webdav fields
  const [baseUrl, setBaseUrl] = useState(DEFAULT_WEBDAV_URL);
  const [username, setUsername] = useState('');
  const [appPassword, setAppPassword] = useState('');
  // s3 fields
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('auto');
  const [bucket, setBucket] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sync.available) return;
    (async () => {
      const c = await loadCredentials();
      if (!c) return;
      setProvider(c.provider);
      if (c.provider === 'webdav') {
        setBaseUrl(c.baseUrl); setUsername(c.username); setAppPassword(c.appPassword);
      } else {
        setEndpoint(c.endpoint); setRegion(c.region); setBucket(c.bucket);
        setAccessKeyId(c.accessKeyId); setSecretAccessKey(c.secretAccessKey);
      }
    })();
  }, [sync.available, sync.connected]);

  if (!sync.available) return null;

  const buildConfig = (): StoredRemoteConfig =>
    provider === 'webdav'
      ? { provider: 'webdav', baseUrl: baseUrl.trim(), username: username.trim(), appPassword }
      : { provider: 's3', endpoint: endpoint.trim(), region: region.trim(), bucket: bucket.trim(), accessKeyId: accessKeyId.trim(), secretAccessKey };

  const hasFields =
    provider === 'webdav'
      ? Boolean(baseUrl.trim() && username.trim() && appPassword)
      : Boolean(endpoint.trim() && region.trim() && bucket.trim() && accessKeyId.trim() && secretAccessKey);

  const guard = async (fn: () => Promise<void>) => {
    if (!hasFields) { notify(t('common.error'), t('settings.cloudMissingFields')); return; }
    setBusy(true);
    try { await fn(); } catch (e: any) { notify(t('common.error'), e?.message ?? t('settings.cloudStatusError')); } finally { setBusy(false); }
  };
  const onTest = () => guard(async () => { await sync.testConnection(buildConfig()); notify(t('settings.doneTitle'), t('settings.cloudTestOk')); });
  const onConnect = () => guard(async () => { await sync.connect(buildConfig()); });
  const onDisconnect = async () => {
    const okc = await confirmAsync(t('settings.cloudDisconnect'), '', t('settings.cloudDisconnect'), true);
    if (!okc) return; setBusy(true); try { await sync.disconnect(); } finally { setBusy(false); }
  };
  const onOverwrite = async () => {
    const okc = await confirmAsync(t('settings.cloudOverwrite'), t('settings.cloudOverwriteConfirm'), t('settings.cloudOverwrite'), true);
    if (!okc) return; setBusy(true); try { await sync.overwriteCloud(); } finally { setBusy(false); }
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

        <Text style={styles.label}>{t('settings.cloudProvider')}</Text>
        <View style={styles.row}>
          {(['webdav', 's3'] as Provider[]).map((p) => (
            <TouchableOpacity key={p} disabled={sync.connected}
              onPress={() => setProvider(p)}
              style={[styles.chip, provider === p && styles.chipActive, sync.connected && { opacity: 0.5 }]}>
              <Text style={[styles.chipText, provider === p && { color: 'white' }]}>
                {t(p === 'webdav' ? 'settings.cloudProviderWebdav' : 'settings.cloudProviderS3')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {provider === 'webdav' ? (
          <>
            <Field label={t('settings.cloudServerUrl')} value={baseUrl} onChangeText={setBaseUrl} editable={!sync.connected} />
            <Field label={t('settings.cloudAccount')} value={username} onChangeText={setUsername} editable={!sync.connected} keyboardType="email-address" />
            <Field label={t('settings.cloudAppPassword')} value={appPassword} onChangeText={setAppPassword} editable={!sync.connected} secure />
            <Text style={shared.muted}>{t('settings.cloudAppPasswordHelp')}</Text>
          </>
        ) : (
          <>
            <Field label={t('settings.cloudEndpoint')} value={endpoint} onChangeText={setEndpoint} editable={!sync.connected} />
            <Text style={shared.muted}>{t('settings.cloudEndpointHelp')}</Text>
            <Field label={t('settings.cloudRegion')} value={region} onChangeText={setRegion} editable={!sync.connected} />
            <Text style={shared.muted}>{t('settings.cloudRegionHelp')}</Text>
            <Field label={t('settings.cloudBucket')} value={bucket} onChangeText={setBucket} editable={!sync.connected} />
            <Field label={t('settings.cloudAccessKeyId')} value={accessKeyId} onChangeText={setAccessKeyId} editable={!sync.connected} />
            <Field label={t('settings.cloudSecretAccessKey')} value={secretAccessKey} onChangeText={setSecretAccessKey} editable={!sync.connected} secure />
          </>
        )}

        <View style={styles.statusRow}>
          <Text style={[styles.statusText, (sync.status === 'authError' || sync.status === 'error') ? { color: colors.negative } : null]}>
            {sync.connected ? t('settings.cloudConnected') : t('settings.cloudNotConnected')}{statusKey ? ` · ${t(statusKey)}` : ''}
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

function Field(props: { label: string; value: string; onChangeText: (s: string) => void; editable?: boolean; secure?: boolean; keyboardType?: 'email-address' }) {
  return (
    <>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        editable={props.editable}
        secureTextEntry={props.secure}
        keyboardType={props.keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </>
  );
}

function Btn({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={[styles.btn, primary && styles.btnPrimary, disabled && { opacity: 0.5 }]}>
      <Text style={[styles.btnText, primary && { color: 'white' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', marginTop: spacing.md, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: 'white', fontSize: 15 },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: 'white' },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.muted },
  statusRow: { marginTop: spacing.md },
  statusText: { fontSize: 14, fontWeight: '600' },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: 'white' },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnText: { fontSize: 15, fontWeight: '600', color: colors.muted },
});
