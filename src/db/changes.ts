let version = 0;
const subscribers = new Set<() => void>();
export const dataVersion = () => version;
export const serverDataVersion = () => 0;
export function subscribeData(listener: () => void) { subscribers.add(listener); return () => { subscribers.delete(listener); }; }
export function notifyDataChanged(): void { version++; subscribers.forEach((listener) => listener()); }
