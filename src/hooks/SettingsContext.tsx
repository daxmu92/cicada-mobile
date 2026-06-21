import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import i18n, {
  detectDeviceLanguage,
  isLanguage,
  LOCALE_TAGS,
  type Language,
} from '../i18n';
import { getSetting, setSetting } from '../db/setting-repo';
import {
  formatCurrency,
  formatCurrencyCompact,
  formatSigned,
  formatSignedCompact,
} from '../utils/format';
import { colors } from '../utils/theme';

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
  ready: boolean;
};

const DEFAULT_CURRENCY = '$';
const DEFAULT_FORWARD_FILL = false;
const DEFAULT_GAIN_COLOR: GainColor = 'green';
const DEFAULT_LANGUAGE: Language = detectDeviceLanguage();

const SettingsContext = createContext<SettingsContextValue>({
  currency: DEFAULT_CURRENCY,
  setCurrency: async () => {},
  forwardFill: DEFAULT_FORWARD_FILL,
  setForwardFill: async () => {},
  gainColor: DEFAULT_GAIN_COLOR,
  setGainColor: async () => {},
  language: DEFAULT_LANGUAGE,
  setLanguage: async () => {},
  ready: false,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState(DEFAULT_CURRENCY);
  const [forwardFill, setForwardFillState] = useState(DEFAULT_FORWARD_FILL);
  const [gainColor, setGainColorState] = useState<GainColor>(DEFAULT_GAIN_COLOR);
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const storedCurrency = await getSetting('currency');
      if (storedCurrency) setCurrencyState(storedCurrency);
      const storedForwardFill = await getSetting('forwardFill');
      if (storedForwardFill != null) {
        setForwardFillState(storedForwardFill === 'true');
      }
      const storedGainColor = await getSetting('gainColor');
      if (storedGainColor === 'red' || storedGainColor === 'green') {
        setGainColorState(storedGainColor);
      }
      const storedLanguage = await getSetting('language');
      if (isLanguage(storedLanguage)) {
        setLanguageState(storedLanguage);
        if (i18n.language !== storedLanguage) {
          await i18n.changeLanguage(storedLanguage);
        }
      }
      setReady(true);
    })();
  }, []);

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
    setLanguageState(lang);
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
        ready,
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
    gain: gainColor === 'red' ? colors.negative : colors.positive,
    loss: gainColor === 'red' ? colors.positive : colors.negative,
  };
}
