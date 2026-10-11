import { DesktopUpdates } from '../src/components/DesktopUpdates';
import { DraftExitGuard } from '../src/components/DraftExitGuard';
import { useLedgerMode } from '../src/ledger/mode';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import '../src/i18n';
import { useTranslation } from 'react-i18next';

import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { SettingsProvider, useSettings, useTheme } from '../src/hooks/SettingsContext';
import { SyncProvider } from '../src/hooks/SyncContext';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return <SettingsProvider><ReadyLayout /></SettingsProvider>;
}

function ReadyLayout() {
  const { ready, error, reload } = useSettings();
  const c = useTheme();
  const { t } = useTranslation();
  const mode=useLedgerMode();
  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg, gap: 16 }}>
    {!error && <ActivityIndicator color={c.primary} />}
    <Text style={{ color: c.ink }}>{t(error ? 'common.loadFailed' : 'common.loading')}</Text>
    {error && <TouchableOpacity accessibilityRole="button" onPress={() => { void reload().catch(() => {}); }}><Text style={{ color: c.primary }}>{t('common.retry')}</Text></TouchableOpacity>}
  </View>;

  return (
      <SyncProvider>
        <DraftExitGuard />
        <DesktopUpdates />
        <ThemeProvider value={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: c.primary, background: c.bg, card: c.card, text: c.ink, border: c.border } }}>
        {mode==='demo' && <View style={{backgroundColor:c.accentSoft,padding:10}}><Text style={{color:c.ink}}>{t('demo.banner')}</Text></View>}
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="asset/[id]"
            options={{ title: t('nav.asset') }}
          />
          <Stack.Screen
            name="modals/add-record"
            options={{ presentation: 'modal', title: t('nav.recordSnapshot') }}
          />
          <Stack.Screen
            name="modals/add-transaction"
            options={{ presentation: 'modal', title: t('nav.addTransaction') }}
          />
          <Stack.Screen
            name="modals/manage-accounts"
            options={{ presentation: 'modal', title: t('nav.manageAccounts') }}
          />
          <Stack.Screen
            name="modals/edit-asset"
            options={{ presentation: 'modal', title: t('nav.editAsset') }}
          />
          <Stack.Screen name="modals/reconcile-asset" options={{presentation:'modal',title:t('reconcile.title')}} />
          <Stack.Screen
            name="modals/erase-data"
            options={{ presentation: 'modal', title: t('eraseData.title') }}
          />
        </Stack>
        <StatusBar style="dark" />
        </ThemeProvider>
      </SyncProvider>
  );
}
