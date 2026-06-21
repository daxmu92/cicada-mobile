import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import zh from './locales/zh.json';

export type Language = 'en' | 'zh';

export const LANGUAGES: Language[] = ['en', 'zh'];

// BCP-47 tags handed to Intl.NumberFormat / Intl.DateTimeFormat.
export const LOCALE_TAGS: Record<Language, string> = {
  en: 'en-US',
  zh: 'zh-CN',
};

export function isLanguage(v: string | null | undefined): v is Language {
  return v === 'en' || v === 'zh';
}

/** First-run default: Chinese device locale -> 'zh', otherwise 'en'. */
export function detectDeviceLanguage(): Language {
  const code = getLocales()[0]?.languageCode?.toLowerCase();
  return code === 'zh' ? 'zh' : 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: detectDeviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
