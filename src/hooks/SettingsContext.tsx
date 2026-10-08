import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import i18n, {
  detectDeviceLanguage,
  isLanguage,
  LOCALE_TAGS,
  type Language,
} from '../i18n';
import { useDataVersion } from './use-data-version';
import { getAllSettings, setSetting } from '../db/setting-repo';
import {
  formatCurrency,
  formatCurrencyCompact,
  formatSigned,
  formatSignedCompact,
} from '../utils/format';
import {
  semantic,
  themes,
  resolveTheme,
  makeShared,
  type ThemeColors,
  type ThemeName,
} from '../utils/theme';

export type GainColor = 'green' | 'red';

type SettingsContextValue = {
  currency: string;
  setCurrency: (symbol: string) => Promise<void>;
  forwardFill: boolean;
  setForwardFill: (v: boolean) => Promise<void>;
  gainColor: GainColor;
  setGainColor: (v: GainColor) => Promise<void>;
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
  theme: ThemeName;
  setTheme: (name: ThemeName) => Promise<void>;
  ready: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

const DEFAULT_CURRENCY = '$';
const DEFAULT_FORWARD_FILL = false;
const DEFAULT_GAIN_COLOR: GainColor = 'green';
const DEFAULT_LANGUAGE: Language = detectDeviceLanguage();
const DEFAULT_THEME: ThemeName = 'warmSlate';

const SettingsContext = createContext<SettingsContextValue>({
  currency: DEFAULT_CURRENCY,
  setCurrency: async () => {},
  forwardFill: DEFAULT_FORWARD_FILL,
  setForwardFill: async () => {},
  gainColor: DEFAULT_GAIN_COLOR,
  setGainColor: async () => {},
  language: DEFAULT_LANGUAGE,
  setLanguage: async () => {},
  theme: DEFAULT_THEME,
  setTheme: async () => {},
  ready: false,
  error: null,
  reload: async () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState(DEFAULT_CURRENCY);
  const [forwardFill, setForwardFillState] = useState(DEFAULT_FORWARD_FILL);
  const [gainColor, setGainColorState] = useState<GainColor>(DEFAULT_GAIN_COLOR);
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useDataVersion();

  const reload = useCallback(async () => {
    try {
      const stored = await getAllSettings();
      setCurrencyState(stored.currency || DEFAULT_CURRENCY);
      setForwardFillState(stored.forwardFill === 'true');
      setGainColorState(stored.gainColor === 'red' ? 'red' : 'green');
      const lang = isLanguage(stored.language) ? stored.language : DEFAULT_LANGUAGE;
      setLanguageState(lang);
      await i18n.changeLanguage(lang);
      if (typeof document !== 'undefined') document.documentElement.lang = lang;
      setThemeState(stored.theme && Object.hasOwn(themes, stored.theme) ? stored.theme as ThemeName : DEFAULT_THEME);
      setError(null); setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }, []);
  useEffect(() => { void reload().catch(() => {}); }, [reload, version]);

  const updateCurrency = useCallback(async (symbol: string) => {
    await setSetting('currency', symbol);
    setCurrencyState(symbol);
  }, []);

  const updateForwardFill = useCallback(async (v: boolean) => {
    await setSetting('forwardFill', v ? 'true' : 'false');
    setForwardFillState(v);
  }, []);

  const updateGainColor = useCallback(async (v: GainColor) => {
    await setSetting('gainColor', v);
    setGainColorState(v);
  }, []);

  const updateLanguage = useCallback(async (lang: Language) => {
    await setSetting('language', lang);
    await i18n.changeLanguage(lang);
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
    setLanguageState(lang);
  }, []);

  const updateTheme = useCallback(async (name: ThemeName) => {
    await setSetting('theme', name);
    setThemeState(name);
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        currency,
        setCurrency: updateCurrency,
        forwardFill,
        setForwardFill: updateForwardFill,
        gainColor,
        setGainColor: updateGainColor,
        language,
        setLanguage: updateLanguage,
        theme,
        setTheme: updateTheme,
        ready, error, reload,
      }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}

export function useCurrency() {
  return useContext(SettingsContext).currency;
}

export function useLocale(): string {
  return LOCALE_TAGS[useContext(SettingsContext).language];
}

export function useFormat() {
  const currency = useCurrency();
  const locale = useLocale();
  const fmt = useCallback((v: number) => formatCurrency(v, currency, locale), [currency, locale]);
  const fmtSigned = useCallback(
    (v: number) => formatSigned(v, currency, locale),
    [currency, locale]
  );
  const fmtCompact = useCallback(
    (v: number) => formatCurrencyCompact(v, currency, locale),
    [currency, locale]
  );
  const fmtSignedCompact = useCallback(
    (v: number) => formatSignedCompact(v, currency, locale),
    [currency, locale]
  );
  return { fmt, fmtSigned, fmtCompact, fmtSignedCompact };
}

export function useSemanticColors() {
  const { gainColor } = useContext(SettingsContext);
  return {
    gain: gainColor === 'red' ? semantic.negative : semantic.positive,
    loss: gainColor === 'red' ? semantic.positive : semantic.negative,
  };
}

export function useTheme(): ThemeColors {
  const { theme } = useContext(SettingsContext);
  return useMemo(() => resolveTheme(themes[theme]), [theme]);
}

/**
 * Memoizes a themed StyleSheet. `factory` MUST be a module-scope const —
 * defining it inside a component re-creates it each render and defeats the memo.
 *
 *   const makeStyles = (c: ThemeColors) => StyleSheet.create({ ... });
 *   const styles = useThemedStyles(makeStyles);
 */
export function useThemedStyles<T>(factory: (c: ThemeColors) => T): T {
  const c = useTheme();
  return useMemo(() => factory(c), [c, factory]);
}

export function useShared() {
  return useThemedStyles(makeShared);
}
