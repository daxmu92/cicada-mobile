import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { SettingsProvider } from '../src/hooks/SettingsContext';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <SettingsProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="asset/[id]"
            options={{ title: 'Asset' }}
          />
          <Stack.Screen
            name="modals/add-record"
            options={{ presentation: 'modal', title: 'Record Snapshot' }}
          />
          <Stack.Screen
            name="modals/add-transaction"
            options={{ presentation: 'modal', title: 'Add Transaction' }}
          />
          <Stack.Screen
            name="modals/manage-accounts"
            options={{ presentation: 'modal', title: 'Manage Accounts' }}
          />
          <Stack.Screen
            name="modals/edit-asset"
            options={{ presentation: 'modal', title: 'Edit Asset' }}
          />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </SettingsProvider>
  );
}
