import { Alert, Platform } from 'react-native';
import i18n from '../i18n';

// react-native-web's Alert is a no-op (`static alert() {}`), so dialogs silently
// do nothing on web/desktop. These helpers fall back to the browser's native
// confirm()/alert() there and keep using React Native's Alert on devices.

/**
 * Confirm dialog. Resolves true when the user accepts.
 *
 * On web this uses the synchronous window.confirm so that any follow-up action
 * requiring a user gesture (e.g. opening a file picker) stays within the gesture.
 */
export function confirmAsync(
  title: string,
  message: string,
  confirmLabel?: string,
  destructive = false
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }
  const confirm = confirmLabel ?? i18n.t('common.ok');
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: i18n.t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirm,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}

/** Single-message dialog (Alert is a no-op on react-native-web). */
export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}
