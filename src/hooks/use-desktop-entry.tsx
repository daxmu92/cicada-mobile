import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
const EntryContext = createContext({ active: false, setActive: (_active: boolean) => {} });
export function DesktopEntryProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const value = useMemo(() => ({ active, setActive }), [active]);
  return <EntryContext.Provider value={value}>{children}</EntryContext.Provider>;
}
export const useDesktopEntry = () => useContext(EntryContext);
