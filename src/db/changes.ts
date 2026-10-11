let version = 0;
const subscribers = new Set<() => void>();
export const dataVersion = () => version;
export const serverDataVersion = () => 0;
export function subscribeData(listener: () => void) { subscribers.add(listener); return () => { subscribers.delete(listener); }; }
export function notifyDataChanged(): void { version++; subscribers.forEach((listener) => listener()); }

let settingsRevision=0;
const settingsSubscribers=new Set<()=>void>();
export const settingsVersion=()=>settingsRevision;
export function subscribeSettings(listener:()=>void){settingsSubscribers.add(listener);return()=>{settingsSubscribers.delete(listener);};}
export function notifySettingsChanged(){settingsRevision++;settingsSubscribers.forEach(listener=>listener());}
