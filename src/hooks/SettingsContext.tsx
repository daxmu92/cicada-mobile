import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

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
  ready: boolean;
};

const DEFAULT_CURRENCY = '$';
const DEFAULT_FORWARD_FILL = false;
const DEFAULT_GAIN_COLOR: GainColor = 'green';

const SettingsContext = createContext<SettingsContextValue>({
  currency: DEFAULT_CURRENCY,
  setCurrency: async () => {},
  forwardFill: DEFAULT_FORWARD_FILL,
  setForwardFill: async () => {},
  gainColor: DEFAULT_GAIN_COLOR,
  setGainColor: async () => {},
  ready: false,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState(DEFAULT_CURRENCY);
  const [forwardFill, setForwardFillState] = useState(DEFAULT_FORWARD_FILL);
  const [gainColor, setGainColorState] = useState<GainColor>(DEFAULT_GAIN_COLOR);
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

  return (
    <SettingsContext.Provider
      value={{
        currency,
        setCurrency: updateCurrency,
        forwardFill,
        setForwardFill: updateForwardFill,
        gainColor,
        setGainColor: updateGainColor,
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

export function useFormat() {
  const currency = useCurrency();
  const fmt = useCallback((v: number) => formatCurrency(v, currency), [currency]);
  const fmtSigned = useCallback((v: number) => formatSigned(v, currency), [currency]);
  const fmtCompact = useCallback(
    (v: number) => formatCurrencyCompact(v, currency),
    [currency]
  );
  const fmtSignedCompact = useCallback(
    (v: number) => formatSignedCompact(v, currency),
    [currency]
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
