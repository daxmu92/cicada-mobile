type Draft = { dirty: () => boolean; saving: () => boolean; discard: () => void };
const drafts = new Map<string,Draft>();
export function registerDraft(key: string, draft: Draft) { drafts.set(key,draft); return()=>{drafts.delete(key);}; }
export function hasUnsavedDrafts() { return [...drafts.values()].some(d=>d.dirty()); }
export function hasSavingDrafts() { return [...drafts.values()].some(d=>d.saving()); }
export function discardDrafts() { for(const draft of drafts.values()) if(draft.dirty()) draft.discard(); }
