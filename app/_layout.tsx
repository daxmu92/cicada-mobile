import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import '../src/i18n';
import { useTranslation } from 'react-i18next';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { SettingsProvider } from '../src/hooks/SettingsContext';
import { SyncProvider } from '../src/hooks/SyncContext';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { t } = useTranslation();

  return (
    <SettingsProvider>
      <SyncProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
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
        </Stack>
        <StatusBar style="auto" />
        </ThemeProvider>
      </SyncProvider>
    </SettingsProvider>
  );
}
