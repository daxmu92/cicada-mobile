import { useDesktopEntry } from '../../hooks/use-desktop-entry';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../hooks/SettingsContext';
import { useSync } from '../../hooks/SyncContext';
import { useDesktopLayout } from '../../hooks/use-desktop-layout';
import { useObservationMonth } from '../../hooks/use-observation-month';
import { useLedgerMode } from '../../ledger/mode';
import { hasSavingDrafts, hasUnsavedDrafts, discardDrafts } from '../../ledger/drafts';
import { confirmAsync, notify } from '../../utils/dialog';
import { MonthSelector } from '../MonthSelector';

const icons = { index: 'grid-outline', assets: 'pie-chart-outline', transactions: 'swap-horizontal-outline', analysis: 'analytics-outline', settings: 'settings-outline' } as const;
const labels = { index: 'nav.home', assets: 'nav.assets', transactions: 'nav.transactions', analysis: 'nav.analysis', settings: 'nav.settings' } as const;

export function DesktopNavigation({ state, descriptors, navigation }: BottomTabBarProps) {
  const c = useTheme();
  const { t } = useTranslation();
  const { compact, sidebarWidth } = useDesktopLayout();
  const mode = useLedgerMode();
  return <View testID="desktop-navigation" style={{ width: sidebarWidth, backgroundColor: c.card, borderRightWidth: 1, borderColor: c.border, padding: compact ? 10 : 16 }}>
    <View style={{ minHeight: 64, justifyContent: 'center', paddingHorizontal: 8 }}>
      <Text style={{ color: c.accent, fontSize: compact ? 22 : 23, fontWeight: '800' }}>{compact ? 'C' : 'Cicada'}</Text>
      {!compact && <Text style={{ color: c.muted, marginTop: 4, fontSize: 12 }}>{t('desktop.workspace')}</Text>}
    </View>
    <View accessibilityRole="tablist" style={{ gap: 6, flex: 1, paddingTop: 12 }}>
      {state.routes.map((route, index) => {
        const name = route.name as keyof typeof labels;
        if (!(name in labels)) return null;
        const selected = index === state.index;
        return <TouchableOpacity key={route.key} accessibilityRole="tab" accessibilityLabel={t(labels[name])} accessibilityState={{ selected }}
          onPress={() => { const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true }); if (!selected && !event.defaultPrevented) navigation.navigate(route.name, route.params); }}
          onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: compact ? 'center' : 'flex-start', gap: 12, padding: 12, borderRadius: 10, backgroundColor: selected ? c.accentSoft : undefined, marginTop: name === 'settings' ? 24 : 0 }}>
          <Ionicons name={icons[name]} size={21} color={selected ? c.accent : c.muted}/>
          {!compact && <Text style={{ color: selected ? c.accent : c.inkSoft, fontSize: 14, fontWeight: selected ? '700' : '500' }}>{descriptors[route.key].options.title}</Text>}
        </TouchableOpacity>;
      })}
    </View>
    {!compact && <Text style={{ color: c.muted, fontSize: 12, padding: 8 }}>{t(mode === 'demo' ? 'desktop.demoLedger' : 'desktop.mainLedger')}</Text>}
  </View>;
}

export function DesktopToolbar() {
  const c = useTheme();
  const { t } = useTranslation();
  const path = usePathname();
  const [month, setMonth] = useObservationMonth();
  const sync = useSync();
  const mode = useLedgerMode();
  const name = path === '/' ? 'index' : path.split('/').pop() as keyof typeof labels;
  const entry = useDesktopEntry();
  const showMonth = name !== 'settings' && !(name === 'assets' && entry.active);
  const changeMonth = async (next: string) => {
    if (hasSavingDrafts()) return;
    if (hasUnsavedDrafts()) {
      if (!await confirmAsync(t('drafts.title'), t('drafts.body'))) return;
      try { await discardDrafts(); } catch { notify(t('common.error'), t('draftRecovery.error')); return; }
    }
    setMonth(next);
  };
  const status = !sync.connected ? t('desktop.localLedger') : t(sync.status === 'syncing' ? 'settings.cloudStatusSyncing' : sync.status === 'ok' ? 'settings.cloudStatusOk' : sync.status === 'idle' ? 'desktop.syncReady' : 'settings.cloudStatusError');
  return <View testID="desktop-toolbar" style={{ minHeight: 72, backgroundColor: c.card, borderBottomWidth: 1, borderColor: c.border, paddingHorizontal: 24, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      <Text style={{ color: c.ink, fontSize: 20, fontWeight: '700' }}>{name in labels ? t(labels[name]) : ''}</Text>
      <Text style={{ color: c.muted, fontSize: 12 }}>{t(mode === 'demo' ? 'desktop.demoLedger' : 'desktop.mainLedger')}</Text>
    </View>
    {showMonth && <MonthSelector value={month} onChange={next => { void changeMonth(next); }}/>}
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: sync.connected && ['error','authError','offline'].includes(sync.status) ? '#b98842' : c.accent }}/>
      <Text style={{ color: c.muted, fontSize: 12 }}>{status}</Text>
    </View>
  </View>;
}
