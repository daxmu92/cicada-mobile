import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import { getSetting, setSetting } from '../db/setting-repo';
import { formatCurrency, formatSigned } from '../utils/format';

type SettingsContextValue = {
  currency: string;
  setCurrency: (symbol: string) => Promise<void>;
  ready: boolean;
};

const DEFAULT_CURRENCY = '$';

const SettingsContext = createContext<SettingsContextValue>({
  currency: DEFAULT_CURRENCY,
  setCurrency: async () => {},
  ready: false,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState(DEFAULT_CURRENCY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await getSetting('currency');
      if (stored) setCurrencyState(stored);
      setReady(true);
    })();
  }, []);

  const updateCurrency = useCallback(async (symbol: string) => {
    await setSetting('currency', symbol);
    setCurrencyState(symbol);
  }, []);

  return (
    <SettingsContext.Provider value={{ currency, setCurrency: updateCurrency, ready }}>
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

export function useFormat() {
  const currency = useCurrency();
  const fmt = useCallback((v: number) => formatCurrency(v, currency), [currency]);
  const fmtSigned = useCallback((v: number) => formatSigned(v, currency), [currency]);
  return { fmt, fmtSigned };
}
