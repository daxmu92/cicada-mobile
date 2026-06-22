// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // react-native-web stubs Alert.alert as a no-op, so dialogs silently do
    // nothing on web/desktop. Use confirmAsync/notify from src/utils/dialog
    // instead, which fall back to window.confirm/alert. dialog.ts itself is
    // the one allowed caller and is excluded below.
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    ignores: ['src/utils/dialog.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.name='Alert'][property.name='alert']",
          message:
            'Alert.alert is a no-op on web/desktop. Use confirmAsync/notify from src/utils/dialog instead.',
        },
      ],
    },
  },
]);
