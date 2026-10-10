import { useDesktopLayout } from '../../src/hooks/use-desktop-layout';
import { checkDesktopUpdates, desktopUpdatesAvailable } from '../../src/components/DesktopUpdates';
import { useLedgerMode } from '../../src/ledger/mode';
import { switchLedger } from '../../src/services/demo-ledger';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { exportBackup, importBackup, exportRecoveryBackup } from '../../src/services/backup';
import { loadSampleData } from '../../src/services/sample-data';
import { useSettings, useShared, useTheme, useThemedStyles } from '../../src/hooks/SettingsContext';
import type { GainColor } from '../../src/hooks/SettingsContext';
import { confirmAsync, notify } from '../../src/utils/dialog';
import { radius, semantic, spacing, themes, type ThemeColors, type ThemeName } from '../../src/utils/theme';
import { LANGUAGES, type Language } from '../../src/i18n';
import CloudSyncSection from '../../src/components/CloudSyncSection';

const CURRENCY_OPTIONS = ['$', '€', '£', '¥', 'R$', '₹', '₩', 'CHF'];

const GAIN_COLOR_OPTIONS: { value: GainColor; labelKey: string; color: string }[] = [
  { value: 'green', labelKey: 'settings.green', color: semantic.positive },
  { value: 'red', labelKey: 'settings.red', color: semantic.negative },
];

const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  zh: '中文',
};

const THEME_LABEL_KEYS: Record<ThemeName, string> = {
  warmSlate: 'settings.themeWarmSlate',
  nordic: 'settings.themeNordic',
  seaGlass: 'settings.themeSeaGlass',
  duskBlue: 'settings.themeDuskBlue',
  sky: 'settings.themeSky',
  lilac: 'settings.themeLilac',
};

export default function SettingsScreen() {
  const router = useRouter();
  const { desktop } = useDesktopLayout();
  const scroll=useRef<ScrollView>(null);
  const anchors=useRef<Record<string,number>>({});
  const [section,setSection]=useState('settings.preferences');
  const mode=useLedgerMode();
  const { t } = useTranslation();
  const {
    currency,
    setCurrency,
    forwardFill,
    setForwardFill,
    gainColor,
    setGainColor,
    language,
    setLanguage,
    theme,
    setTheme,
  } = useSettings();
  const c = useTheme();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);
  const [loading, setLoading] = useState(false);
  const [preferenceStatus,setPreferenceStatus]=useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [preferenceError,setPreferenceError]=useState('');
  const preferenceGeneration=useRef(0);

  useEffect(()=>{preferenceGeneration.current++;setPreferenceStatus('idle');},[mode]);

  const reportSaveError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const key = /SQLITE_BUSY|SQLITE_LOCKED|database (?:is )?locked/i.test(message)
      ? 'common.databaseBusy' : 'common.saveFailed';
    if(desktop){setPreferenceError(t(key));setPreferenceStatus('error');}
    else notify(t('common.error'), t(key));
  };

  const savePreference=async(action:()=>Promise<void>)=>{
    const generation=++preferenceGeneration.current;setPreferenceStatus('saving');
    try{await action();if(generation===preferenceGeneration.current)setPreferenceStatus('saved');}
    catch(error){if(generation===preferenceGeneration.current)reportSaveError(error);}
  };

  const confirmReset = () => {
    router.push('/modals/erase-data');
  };

  const confirmLoadSample = async () => {
    const ok = await confirmAsync(
      t('settings.loadSampleTitle'),
      mode==='demo' ? t('demo.resetBody') : t('demo.enterBody'),
      t('settings.loadConfirm'),
      true
    );
    if (!ok) return;
    setLoading(true);
    try {
      if(mode==='live') await switchLedger('demo');
      else await loadSampleData();
      notify(t('settings.doneTitle'), t('settings.sampleLoaded'));
    } catch (e: any) {
      notify(t('common.error'), e?.message==='LEDGER_CHANGED'?t('demo.changed'):e?.message ?? t('settings.loadSampleFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[shared.screen,{flexDirection:'row'}]}>
    {desktop&&<View testID="desktop-settings-sections" style={{width:180,padding:20,gap:8,borderRightWidth:1,borderColor:c.border}}>{['settings.preferences','desktop.appearance','settings.cloudSync','settings.manage','settings.backup','settings.data'].map(key=><TouchableOpacity accessibilityRole="button" key={key} onPress={()=>{setSection(key);scroll.current?.scrollTo({y:anchors.current[key]??0,animated:false});}} style={{padding:12,borderRadius:8,backgroundColor:section===key?c.accentSoft:undefined}}><Text style={{color:section===key?c.accent:c.inkSoft}}>{t(key)}</Text></TouchableOpacity>)}</View>}
    <View style={{flex:1}}>
      {desktop&&preferenceStatus!=='idle'&&<View testID="desktop-settings-feedback" accessibilityRole={preferenceStatus==='error'?'alert':undefined} style={{padding:12,borderRadius:8,backgroundColor:c.accentSoft,marginHorizontal:24,marginTop:16}}><Text style={{color:c.ink}}>{preferenceStatus==='error'?preferenceError:t(preferenceStatus==='saving'?'common.working':'desktop.saved')}</Text></View>}
    <ScrollView ref={scroll} style={shared.screen} contentContainerStyle={[shared.scrollContent,desktop&&{maxWidth:1000,padding:32}]}>

      {mode==='demo' && <TouchableOpacity accessibilityRole="button" disabled={loading} style={shared.card} onPress={() => { void switchLedger('live').catch(()=>notify(t('common.error'),t('common.loadFailed'))); }}><Text style={{color:c.primary}}>{t('demo.return')}</Text></TouchableOpacity>}
      <View onLayout={e=>{anchors.current['settings.preferences']=e.nativeEvent.layout.y;}}><Text style={shared.sectionTitle}>{t('settings.preferences')}</Text></View>
      <View style={shared.card}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.rowTitle}>{t('settings.forwardFillTitle')}</Text>
            <Text style={shared.muted}>
              {t('settings.forwardFillHelp')}
            </Text>
          </View>
          <Switch value={forwardFill} disabled={loading} onValueChange={(v)=>{void savePreference(()=>setForwardFill(v));}} />
        </View>
      </View>
      <View style={shared.card}>
        <Text style={styles.rowTitle}>{t('settings.currency')}</Text>
        <Text style={shared.muted}>{t('settings.currencyHelp')}</Text>
        <View style={styles.currencyRow}>
          {CURRENCY_OPTIONS.map((symbol) => (
            <TouchableOpacity
              key={symbol}
              disabled={loading} onPress={() => { void savePreference(()=>setCurrency(symbol)); }}
              style={[
                styles.currencyChip,
                currency === symbol && styles.currencyChipActive,
              ]}>
              <Text
                style={[
                  styles.currencyChipText,
                  currency === symbol && { color: c.onAccent },
                ]}>
                {symbol}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      {desktop&&<View onLayout={e=>{anchors.current['desktop.appearance']=e.nativeEvent.layout.y;}}><Text style={shared.sectionTitle}>{t('desktop.appearance')}</Text></View>}
      <View style={shared.card}>
        <Text style={styles.rowTitle}>{t('settings.colorForGains')}</Text>
        <Text style={shared.muted}>
          {t('settings.colorForGainsHelp')}
        </Text>
        <View style={styles.currencyRow}>
          {GAIN_COLOR_OPTIONS.map((opt) => {
            const active = gainColor === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                disabled={loading} onPress={() => { void savePreference(()=>setGainColor(opt.value)); }}
                style={[
                  styles.currencyChip,
                  styles.gainChip,
                  active && { backgroundColor: opt.color, borderColor: opt.color },
                ]}>
                <Text
                  style={[
                    styles.currencyChipText,
                    { color: active ? c.onAccent : opt.color },
                  ]}>
                  {t(opt.labelKey)} {'▲'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={shared.card}>
        <Text style={styles.rowTitle}>{t('settings.language')}</Text>
        <Text style={shared.muted}>{t('settings.languageHelp')}</Text>
        <View style={styles.currencyRow}>
          {LANGUAGES.map((lang) => (
            <TouchableOpacity
              key={lang}
              disabled={loading} onPress={() => { void savePreference(()=>setLanguage(lang)); }}
              style={[
                styles.currencyChip,
                styles.gainChip,
                language === lang && styles.currencyChipActive,
              ]}>
              <Text
                style={[
                  styles.currencyChipText,
                  language === lang && { color: c.onAccent },
                ]}>
                {LANGUAGE_LABELS[lang]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={shared.card}>
        <Text style={styles.rowTitle}>{t('settings.theme')}</Text>
        <Text style={shared.muted}>{t('settings.themeHelp')}</Text>
        <View style={styles.themeGrid}>
          {(Object.keys(themes) as ThemeName[]).map((name) => {
            const p = themes[name];
            const active = theme === name;
            return (
              <TouchableOpacity
                key={name}
                disabled={loading} onPress={() => { void savePreference(()=>setTheme(name)); }}
                style={[
                  styles.themeSwatch,
                  { backgroundColor: p.bg, borderColor: active ? p.accent : c.border },
                  active && styles.themeSwatchActive,
                ]}>
                <View style={[styles.themeDot, { backgroundColor: p.accent }]}>
                  {active ? <Text style={[styles.themeCheck, { color: p.onAccent }]}>{'✓'}</Text> : null}
                </View>
                <Text style={[styles.themeLabel, { color: p.ink }]}>{t(THEME_LABEL_KEYS[name])}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View onLayout={e=>{anchors.current['settings.cloudSync']=e.nativeEvent.layout.y;}}><CloudSyncSection /></View>
      {desktopUpdatesAvailable() && <TouchableOpacity accessibilityRole="button" style={shared.card} onPress={checkDesktopUpdates}><Text style={{color:c.primary}}>{t('updates.check')}</Text></TouchableOpacity>}

      <View onLayout={e=>{anchors.current['settings.manage']=e.nativeEvent.layout.y;}}><Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>{t('settings.manage')}</Text></View>
      <Row
        title={t('settings.accountsAssets')}
        subtitle={t('settings.accountsAssetsSub')}
        onPress={() => router.push('/modals/manage-accounts')}
      />

      <View onLayout={e=>{anchors.current['settings.backup']=e.nativeEvent.layout.y;}}><Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>{t('settings.backup')}</Text></View>
      <Row
        title={t('settings.exportData')}
        subtitle={t('settings.exportDataSub')}
        onPress={async () => {
          setLoading(true);
          try {
            await exportBackup();
          } catch (e: any) {
            notify(t('settings.exportFailedTitle'), e?.message ?? t('settings.exportFailedBody'));
          } finally {
            setLoading(false);
          }
        }}
        disabled={loading}
      />
      <Row
        title={t('settings.importData')}
        subtitle={t('settings.importDataSub')}
        onPress={async () => {
          // Confirm synchronously on web so the file picker stays within the
          // user gesture that importBackup() needs.
          const proceed = await confirmAsync(
            t('settings.importTitle'),
            mode==='demo'?t('demo.importBody'):t('settings.importBody'),
            t('settings.importConfirm'),
            true
          );
          if (!proceed) return;
          setLoading(true);
          try {
            const counts = await importBackup();
            notify(
              t('settings.importedTitle'),
              t('settings.importedBody', { accounts: counts.accounts, assets: counts.assets, snapshots: counts.snapshots, transactions: counts.transactions })
            );
          } catch (e: any) {
            if (e?.message !== 'CANCELLED') {
              notify(t('settings.importFailedTitle'), e?.message==='LEDGER_CHANGED'?t('demo.changed'):e?.message ?? t('settings.importFailedBody'));
            }
          } finally {
            setLoading(false);
          }
        }}
        disabled={loading}
      />

      <Row title={t('settings.exportRecovery')} subtitle={t('settings.exportRecoverySub')} disabled={loading} onPress={async () => {
        setLoading(true);
        try { await exportRecoveryBackup(); }
        catch (e) { notify(t('common.error'), e instanceof Error && e.message === 'NO_RECOVERY_BACKUP' ? t('settings.noRecovery') : t('settings.exportFailedBody')); }
        finally { setLoading(false); }
      }} />

      <View onLayout={e=>{anchors.current['settings.data']=e.nativeEvent.layout.y;}}><Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>{t('settings.data')}</Text></View>
      <Row
        title={t(mode==='demo'?'demo.reset':'demo.enter')}
        subtitle={t('settings.loadSampleSub')}
        onPress={confirmLoadSample}
        disabled={loading}
      />
      <Row
        title={t('settings.resetDb')}
        subtitle={t('settings.resetDbSub')}
        onPress={confirmReset}
        destructive
        disabled={loading}
      />

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={c.primary} />
          <Text style={[shared.muted, { marginTop: spacing.sm }]}>{t('common.working')}</Text>
        </View>
      )}
    </ScrollView>
    </View>
    </View>
  );
}

function Row({
  title,
  subtitle,
  onPress,
  destructive = false,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      accessibilityRole="button" accessibilityLabel={title}
      onPress={onPress}
      disabled={disabled}
      style={[shared.card, styles.row, disabled && { opacity: 0.5 }]}>
      <Text
        style={[styles.rowTitle, destructive && { color: semantic.negative }]}>
        {title}
      </Text>
      {subtitle && <Text style={shared.muted}>{subtitle}</Text>}
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: {
      marginBottom: spacing.sm,
    },
    rowTitle: {
      fontSize: 16,
      fontWeight: '600',
    },
    currencyRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    currencyChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      minWidth: 48,
      alignItems: 'center',
    },
    currencyChipActive: {
      backgroundColor: c.primary,
      borderColor: c.primary,
    },
    currencyChipText: {
      fontSize: 16,
      fontWeight: '600',
      color: c.muted,
    },
    gainChip: {
      paddingHorizontal: spacing.lg,
      minWidth: 96,
    },
    loading: {
      marginTop: spacing.lg,
      alignItems: 'center',
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    toggleText: {
      flex: 1,
    },
    themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    themeSwatch: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
    themeSwatchActive: { borderWidth: 2 },
    themeDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    themeCheck: { fontSize: 13, fontWeight: '800', lineHeight: 15 },
    themeLabel: { fontSize: 14, fontWeight: '600' },
  });
