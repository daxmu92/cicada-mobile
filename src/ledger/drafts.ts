type Draft = { dirty: () => boolean; saving: () => boolean; discard: () => void | Promise<void> };
const drafts = new Map<string,Draft>();
export function registerDraft(key: string, draft: Draft) { drafts.set(key,draft); return()=>{drafts.delete(key);}; }
export function hasUnsavedDrafts() { return [...drafts.values()].some(d=>d.dirty()); }
export function hasSavingDrafts() { return [...drafts.values()].some(d=>d.saving()); }
export async function discardDrafts() { await Promise.all([...drafts.values()].filter(d=>d.dirty()).map(d=>d.discard())); }
