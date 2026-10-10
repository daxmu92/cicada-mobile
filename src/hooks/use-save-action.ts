import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { notify } from '../utils/dialog';
export function useSaveAction() {
  const locked = useRef(false); const [saving, setSaving] = useState(false); const { t } = useTranslation();
  const save = useCallback(async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true; setSaving(true);
    try { await action(); }
    catch (e) { notify(t('common.error'), e instanceof Error && e.message === 'Invalid amount' ? t('common.invalidAmount') : t('common.saveFailed')); }
    finally { locked.current = false; setSaving(false); }
  }, [t]);
  return { saving, save };
}
