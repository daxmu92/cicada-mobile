# Language Switching (i18n) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-switchable language setting (English + Simplified Chinese) that auto-detects the device locale on first run, persists the choice, applies live across all UI text, and localizes number/date formatting.

**Architecture:** `i18next` + `react-i18next` provide a `t('key')` translation layer backed by two JSON resource bundles (`en`, `zh`). `expo-localization` supplies the first-run device locale. A new `language` value in `SettingsContext` (persisted to the existing `setting` table) is the single source of truth; `setLanguage` both persists and calls `i18next.changeLanguage`, and components re-render via `useTranslation()`. Locale-sensitive number/date formatting moves to the platform `Intl` API, with the active BCP-47 locale derived from the `language` setting.

**Tech Stack:** Expo SDK 54, React Native 0.81, React 19, TypeScript (strict), expo-router, i18next, react-i18next, expo-localization, `Intl` (Hermes/native browser).

## Global Constraints

- **Node 20+**; installs via `npm ci` / `npx expo install` (SDK-pinned).
- **No test runner exists.** The per-task verification gate is: `npx tsc --noEmit` passes, `npm run lint` passes, and the stated manual check on the web target (`npm run web`). Never claim a task passes without running these.
- **Two languages only:** `'en'` and `'zh'` (Simplified Chinese). Code must be typed to this union so adding a third later is a compile-time-guided change.
- **Fallback language is `'en'`** (i18next `fallbackLng`). Missing keys must fall back, never render the raw key.
- **Storage keys are ISO and unchanged:** snapshots `"YYYY-MM"`, transactions `"YYYY-MM-DD"`. Only *displayed* dates/numbers are localized.
- **Currency symbol stays user-controlled** (the existing `currency` setting). Locale only governs digit grouping / decimal separators, not the symbol.
- **Follow existing patterns:** new settings mirror the `currency`/`gainColor` shape in `src/hooks/SettingsContext.tsx`; new Settings UI mirrors the chip-button pattern in `app/(tabs)/settings.tsx`.
- **All user-facing strings route through `t()`.** Do not localize user data (account/asset names, category keys/values, tags, notes).

---

## File Structure

**Created:**
- `src/i18n/index.ts` — configures & initializes the i18next instance; exports it, the `Language` type, `LOCALE_TAGS`, and `detectDeviceLanguage()`.
- `src/i18n/locales/en.json` — English resource bundle (source of truth for keys).
- `src/i18n/locales/zh.json` — Simplified Chinese resource bundle.

**Modified:**
- `app/_layout.tsx` — import the i18n side-effect module; localize Stack screen titles.
- `src/hooks/SettingsContext.tsx` — add `language`/`setLanguage`; add `useLocale()`; thread locale into `useFormat()`.
- `src/utils/format.ts` — `Intl.NumberFormat`-based formatting taking a `locale` arg.
- `src/utils/date.ts` — replace `MONTH_NAMES` with locale-aware `Intl.DateTimeFormat` helpers.
- `app/(tabs)/_layout.tsx` — localize tab titles.
- `app/(tabs)/index.tsx`, `assets.tsx`, `transactions.tsx`, `settings.tsx` — `t()` extraction; locale-aware dates.
- `app/asset/[id].tsx`, `app/modals/{add-transaction,add-record,manage-accounts,edit-asset}.tsx` — `t()` extraction.
- `src/components/YearCalendar.tsx` — locale-aware month labels + "Today".
- `src/components/charts/{CategoryBars,AllocationBarList,AssetLineChart}.tsx` — `t()` empty-state text.
- `src/utils/dialog.ts` — localize default `OK`/`Cancel` labels.

---

## Task 1: Install dependencies and create the i18n core + resource bundles

**Files:**
- Modify: `package.json` (via installers)
- Create: `src/i18n/index.ts`
- Create: `src/i18n/locales/en.json`
- Create: `src/i18n/locales/zh.json`

**Interfaces:**
- Produces:
  - `export type Language = 'en' | 'zh'`
  - `export const LANGUAGES: Language[]` = `['en', 'zh']`
  - `export const LOCALE_TAGS: Record<Language, string>` = `{ en: 'en-US', zh: 'zh-CN' }`
  - `export function detectDeviceLanguage(): Language` — returns `'zh'` if device locale is Chinese, else `'en'`.
  - `export function isLanguage(v: string | null | undefined): v is Language`
  - `export default i18n` — the initialized i18next instance (also re-exported as `export { default as i18n }`).
  - Translation keys defined in `en.json` / `zh.json` (full catalog below). Later tasks consume these via `t('namespace.key')`.

- [ ] **Step 1: Install packages**

```bash
npx expo install expo-localization
npm install i18next react-i18next
```

- [ ] **Step 2: Verify install**

Run: `node -e "require('i18next'); require('react-i18next'); require('expo-localization'); console.log('ok')"`
Expected: prints `ok` with no error.

- [ ] **Step 3: Create `src/i18n/locales/en.json`**

```json
{
  "common": {
    "save": "Save",
    "update": "Update",
    "delete": "Delete",
    "cancel": "Cancel",
    "add": "Add",
    "done": "Done",
    "ok": "OK",
    "archive": "Archive",
    "unarchive": "Unarchive",
    "archived": "Archived",
    "error": "Error",
    "working": "Working…",
    "today": "Today"
  },
  "nav": {
    "home": "Home",
    "assets": "Assets",
    "transactions": "Transactions",
    "settings": "Settings",
    "asset": "Asset",
    "recordSnapshot": "Record Snapshot",
    "addTransaction": "Add Transaction",
    "manageAccounts": "Manage Accounts",
    "editAsset": "Edit Asset"
  },
  "home": {
    "totalNetWorth": "Total Net Worth",
    "netGrowth": "Net Growth",
    "profit": "Profit",
    "allocation": "Allocation"
  },
  "assets": {
    "noAccountsTitle": "No accounts yet",
    "noAccountsBody": "Go to Settings to create an account and add assets.",
    "noAssets": "No assets"
  },
  "transactions": {
    "income": "Income",
    "outlay": "Outlay",
    "net": "Net",
    "list": "List",
    "breakdown": "Breakdown",
    "noTransactions": "No transactions this month",
    "incomeByCategory": "Income by Category",
    "outlayByCategory": "Outlay by Category",
    "noIncome": "No income this month",
    "noOutlay": "No outlay this month"
  },
  "assetDetail": {
    "netWorth": "Net Worth",
    "profit": "Profit",
    "inflow": "Inflow",
    "recordSnapshot": "+ Record Snapshot",
    "history": "History",
    "noSnapshots": "No snapshots yet. Tap \"Record Snapshot\" above.",
    "asOf": "As of {{date}}",
    "colDate": "Date",
    "colNetWorth": "Net Worth",
    "colProfit": "Profit"
  },
  "addTransaction": {
    "type": "Type",
    "date": "Date",
    "value": "Value",
    "tags": "Tags (comma-separated)",
    "tagsPlaceholder": "e.g. food, dining",
    "note": "Note",
    "notePlaceholder": "Optional description",
    "typeIncome": "INCOME",
    "typeOutlay": "OUTLAY",
    "valuePlaceholder": "0.00",
    "invalidTitle": "Invalid input",
    "invalidValue": "Please enter a valid positive value.",
    "deleteTitle": "Delete Transaction",
    "deleteBody": "This cannot be undone."
  },
  "addRecord": {
    "autoCalculate": "Auto-calculate",
    "autoCalcHelp": "When enabled, editing any two fields auto-fills the third using: profit = (netWorth - lastNetWorth) - inflow",
    "netWorth": "Net Worth",
    "inflow": "Inflow",
    "profit": "Profit",
    "valuePlaceholder": "0.00",
    "dateLabel": "Date: {{date}}",
    "previousNetWorth": "Previous net worth: {{value}}",
    "invalidTitle": "Invalid input",
    "invalidNetWorth": "Please enter a valid net worth.",
    "deleteTitle": "Delete Snapshot",
    "deleteBody": "Remove {{date}} snapshot?"
  },
  "manageAccounts": {
    "showArchived": "Show archived",
    "accounts": "Accounts",
    "newAccountPlaceholder": "New account name",
    "newAssetPlaceholder": "New asset name",
    "assetsIn": "Assets in {{name}}",
    "noAssetsYet": "No assets yet",
    "createAccountFailed": "Failed to create account",
    "createAssetFailed": "Failed to create asset",
    "deleteAccountTitle": "Delete Account",
    "deleteAccountBody": "Delete \"{{name}}\" and all its assets/snapshots?",
    "archiveAccountTitle": "Archive Account",
    "archiveAccountBody": "Hide \"{{name}}\" and all its assets from default views? History is preserved."
  },
  "editAsset": {
    "assetName": "Asset Name",
    "categories": "Categories",
    "categoriesHelp": "Key/value pairs (e.g. Risk: High, Type: Stock)",
    "keyPlaceholder": "Key",
    "valuePlaceholder": "Value",
    "addCategory": "+ Add Category",
    "archiveAsset": "Archive Asset",
    "unarchiveAsset": "Unarchive Asset",
    "deleteAsset": "Delete Asset",
    "invalidTitle": "Invalid input",
    "emptyName": "Asset name cannot be empty",
    "saveFailed": "Failed to save",
    "archiveTitle": "Archive Asset",
    "unarchiveTitle": "Unarchive Asset",
    "archiveBody": "Hide \"{{name}}\" from default views? History is preserved and can be restored later.",
    "unarchiveBody": "Restore \"{{name}}\" to default views?",
    "deleteTitle": "Delete Asset",
    "deleteBody": "Delete \"{{name}}\" and all its snapshots?"
  },
  "settings": {
    "preferences": "Preferences",
    "forwardFillTitle": "Forward-fill missing months",
    "forwardFillHelp": "Use the last known value when a snapshot is missing",
    "currency": "Currency",
    "currencyHelp": "Displayed before all amounts",
    "colorForGains": "Color for gains",
    "colorForGainsHelp": "Red for gains matches Chinese/HK stock market convention",
    "green": "Green",
    "red": "Red",
    "language": "Language",
    "languageHelp": "Choose your preferred language",
    "manage": "Manage",
    "accountsAssets": "Accounts & Assets",
    "accountsAssetsSub": "Add, rename, or delete accounts and assets",
    "backup": "Backup",
    "exportData": "Export Data",
    "exportDataSub": "Save a JSON backup file",
    "importData": "Import Data",
    "importDataSub": "Replace all data from a backup file",
    "data": "Data",
    "loadSample": "Load Sample Data",
    "loadSampleSub": "Populate with 24 months of sample accounts and transactions",
    "resetDb": "Reset Database",
    "resetDbSub": "Delete all data",
    "resetTitle": "Reset Database",
    "resetBody": "This will permanently delete all accounts, assets, snapshots, and transactions. This cannot be undone.",
    "resetConfirm": "Reset",
    "resetDone": "Database has been reset.",
    "loadSampleTitle": "Load Sample Data",
    "loadSampleBody": "This will replace all current data with generated sample accounts, assets, snapshots, and transactions.",
    "loadConfirm": "Load",
    "doneTitle": "Done",
    "sampleLoaded": "Sample data loaded. Check the Home and Assets tabs.",
    "loadSampleFailed": "Failed to load sample data",
    "exportFailedTitle": "Export Failed",
    "exportFailedBody": "Unable to export",
    "importTitle": "Import Backup",
    "importBody": "This will replace all existing data. Continue?",
    "importConfirm": "Import",
    "importedTitle": "Imported",
    "importedBody": "Accounts: {{accounts}}\nAssets: {{assets}}\nSnapshots: {{snapshots}}\nTransactions: {{transactions}}",
    "importFailedTitle": "Import Failed",
    "importFailedBody": "Unable to import"
  },
  "charts": {
    "noData": "No data",
    "noDataToDisplay": "No data to display",
    "noDataYet": "No data yet"
  }
}
```

- [ ] **Step 4: Create `src/i18n/locales/zh.json`** (Simplified Chinese — drafted; user reviews later)

```json
{
  "common": {
    "save": "保存",
    "update": "更新",
    "delete": "删除",
    "cancel": "取消",
    "add": "添加",
    "done": "完成",
    "ok": "确定",
    "archive": "归档",
    "unarchive": "取消归档",
    "archived": "已归档",
    "error": "错误",
    "working": "处理中…",
    "today": "今天"
  },
  "nav": {
    "home": "首页",
    "assets": "资产",
    "transactions": "交易",
    "settings": "设置",
    "asset": "资产",
    "recordSnapshot": "记录快照",
    "addTransaction": "添加交易",
    "manageAccounts": "管理账户",
    "editAsset": "编辑资产"
  },
  "home": {
    "totalNetWorth": "总净值",
    "netGrowth": "净增长",
    "profit": "收益",
    "allocation": "资产配置"
  },
  "assets": {
    "noAccountsTitle": "还没有账户",
    "noAccountsBody": "前往设置创建账户并添加资产。",
    "noAssets": "暂无资产"
  },
  "transactions": {
    "income": "收入",
    "outlay": "支出",
    "net": "净额",
    "list": "列表",
    "breakdown": "分类",
    "noTransactions": "本月暂无交易",
    "incomeByCategory": "收入分类",
    "outlayByCategory": "支出分类",
    "noIncome": "本月暂无收入",
    "noOutlay": "本月暂无支出"
  },
  "assetDetail": {
    "netWorth": "净值",
    "profit": "收益",
    "inflow": "流入",
    "recordSnapshot": "+ 记录快照",
    "history": "历史",
    "noSnapshots": "还没有快照。点击上方“记录快照”。",
    "asOf": "截至 {{date}}",
    "colDate": "日期",
    "colNetWorth": "净值",
    "colProfit": "收益"
  },
  "addTransaction": {
    "type": "类型",
    "date": "日期",
    "value": "金额",
    "tags": "标签（逗号分隔）",
    "tagsPlaceholder": "例如：餐饮，外食",
    "note": "备注",
    "notePlaceholder": "可选描述",
    "typeIncome": "收入",
    "typeOutlay": "支出",
    "valuePlaceholder": "0.00",
    "invalidTitle": "输入无效",
    "invalidValue": "请输入有效的正数金额。",
    "deleteTitle": "删除交易",
    "deleteBody": "此操作无法撤销。"
  },
  "addRecord": {
    "autoCalculate": "自动计算",
    "autoCalcHelp": "启用后，编辑任意两个字段会自动计算第三个：收益 =（净值 - 上次净值）- 流入",
    "netWorth": "净值",
    "inflow": "流入",
    "profit": "收益",
    "valuePlaceholder": "0.00",
    "dateLabel": "日期：{{date}}",
    "previousNetWorth": "上次净值：{{value}}",
    "invalidTitle": "输入无效",
    "invalidNetWorth": "请输入有效的净值。",
    "deleteTitle": "删除快照",
    "deleteBody": "删除 {{date}} 的快照？"
  },
  "manageAccounts": {
    "showArchived": "显示已归档",
    "accounts": "账户",
    "newAccountPlaceholder": "新账户名称",
    "newAssetPlaceholder": "新资产名称",
    "assetsIn": "{{name}} 中的资产",
    "noAssetsYet": "还没有资产",
    "createAccountFailed": "创建账户失败",
    "createAssetFailed": "创建资产失败",
    "deleteAccountTitle": "删除账户",
    "deleteAccountBody": "删除“{{name}}”及其所有资产/快照？",
    "archiveAccountTitle": "归档账户",
    "archiveAccountBody": "将“{{name}}”及其所有资产从默认视图中隐藏？历史记录将被保留。"
  },
  "editAsset": {
    "assetName": "资产名称",
    "categories": "分类",
    "categoriesHelp": "键值对（例如：风险：高，类型：股票）",
    "keyPlaceholder": "键",
    "valuePlaceholder": "值",
    "addCategory": "+ 添加分类",
    "archiveAsset": "归档资产",
    "unarchiveAsset": "取消归档资产",
    "deleteAsset": "删除资产",
    "invalidTitle": "输入无效",
    "emptyName": "资产名称不能为空",
    "saveFailed": "保存失败",
    "archiveTitle": "归档资产",
    "unarchiveTitle": "取消归档资产",
    "archiveBody": "将“{{name}}”从默认视图中隐藏？历史记录将被保留，可稍后恢复。",
    "unarchiveBody": "将“{{name}}”恢复到默认视图？",
    "deleteTitle": "删除资产",
    "deleteBody": "删除“{{name}}”及其所有快照？"
  },
  "settings": {
    "preferences": "偏好设置",
    "forwardFillTitle": "向前填充缺失月份",
    "forwardFillHelp": "当快照缺失时使用最近一次的已知值",
    "currency": "货币符号",
    "currencyHelp": "显示在所有金额前",
    "colorForGains": "上涨颜色",
    "colorForGainsHelp": "红色表示上涨符合中国/香港股市习惯",
    "green": "绿色",
    "red": "红色",
    "language": "语言",
    "languageHelp": "选择您偏好的语言",
    "manage": "管理",
    "accountsAssets": "账户与资产",
    "accountsAssetsSub": "添加、重命名或删除账户和资产",
    "backup": "备份",
    "exportData": "导出数据",
    "exportDataSub": "保存 JSON 备份文件",
    "importData": "导入数据",
    "importDataSub": "从备份文件替换所有数据",
    "data": "数据",
    "loadSample": "加载示例数据",
    "loadSampleSub": "填充 24 个月的示例账户和交易",
    "resetDb": "重置数据库",
    "resetDbSub": "删除所有数据",
    "resetTitle": "重置数据库",
    "resetBody": "这将永久删除所有账户、资产、快照和交易。此操作无法撤销。",
    "resetConfirm": "重置",
    "resetDone": "数据库已重置。",
    "loadSampleTitle": "加载示例数据",
    "loadSampleBody": "这将用生成的示例账户、资产、快照和交易替换所有当前数据。",
    "loadConfirm": "加载",
    "doneTitle": "完成",
    "sampleLoaded": "示例数据已加载。请查看首页和资产标签页。",
    "loadSampleFailed": "加载示例数据失败",
    "exportFailedTitle": "导出失败",
    "exportFailedBody": "无法导出",
    "importTitle": "导入备份",
    "importBody": "这将替换所有现有数据。是否继续？",
    "importConfirm": "导入",
    "importedTitle": "导入成功",
    "importedBody": "账户：{{accounts}}\n资产：{{assets}}\n快照：{{snapshots}}\n交易：{{transactions}}",
    "importFailedTitle": "导入失败",
    "importFailedBody": "无法导入"
  },
  "charts": {
    "noData": "暂无数据",
    "noDataToDisplay": "暂无数据显示",
    "noDataYet": "暂无数据"
  }
}
```

- [ ] **Step 5: Create `src/i18n/index.ts`**

```ts
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import zh from './locales/zh.json';

export type Language = 'en' | 'zh';

export const LANGUAGES: Language[] = ['en', 'zh'];

// BCP-47 tags handed to Intl.NumberFormat / Intl.DateTimeFormat.
export const LOCALE_TAGS: Record<Language, string> = {
  en: 'en-US',
  zh: 'zh-CN',
};

export function isLanguage(v: string | null | undefined): v is Language {
  return v === 'en' || v === 'zh';
}

/** First-run default: Chinese device locale -> 'zh', otherwise 'en'. */
export function detectDeviceLanguage(): Language {
  const code = getLocales()[0]?.languageCode?.toLowerCase();
  return code === 'zh' ? 'zh' : 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: detectDeviceLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
```

- [ ] **Step 6: Verify type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0. (If lint flags JSON import resolution, confirm `resolveJsonModule` is enabled in `tsconfig.json` — Expo's base config enables it; if not, add `"resolveJsonModule": true` to `compilerOptions` and re-run.)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/i18n tsconfig.json
git commit -m "feat(i18n): add i18next core, device detection, and en/zh resource bundles"
```

---

## Task 2: Wire i18n into SettingsContext (language state + locale hook)

**Files:**
- Modify: `src/hooks/SettingsContext.tsx`
- Modify: `app/_layout.tsx` (import side-effect init only in this task)

**Interfaces:**
- Consumes: `i18n`, `Language`, `LOCALE_TAGS`, `isLanguage`, `detectDeviceLanguage` from `src/i18n` (Task 1); `getSetting`/`setSetting` (existing).
- Produces (on the `useSettings()` value and as hooks):
  - `language: Language`
  - `setLanguage: (lang: Language) => Promise<void>`
  - `export function useLocale(): string` — returns the active BCP-47 tag (`LOCALE_TAGS[language]`).
  - `useFormat()` keeps the same returned shape (`{ fmt, fmtSigned, fmtCompact, fmtSignedCompact }`) but now passes locale into the formatters (Task 3 changes the formatter signatures; this task wires the locale through).

- [ ] **Step 1: Import i18n init at the app entry**

In `app/_layout.tsx`, add this import near the top (after `import 'react-native-reanimated';`), so the instance initializes before any screen renders:

```tsx
import '../src/i18n';
```

- [ ] **Step 2: Add language imports to SettingsContext**

In `src/hooks/SettingsContext.tsx`, add after the existing imports:

```tsx
import i18n, {
  detectDeviceLanguage,
  isLanguage,
  LOCALE_TAGS,
  type Language,
} from '../i18n';
```

- [ ] **Step 3: Extend the context type and defaults**

Add to `SettingsContextValue` (after `gainColor`/`setGainColor`):

```tsx
  language: Language;
  setLanguage: (lang: Language) => Promise<void>;
```

Add the default constant near the other `DEFAULT_*`:

```tsx
const DEFAULT_LANGUAGE: Language = detectDeviceLanguage();
```

Add to the `createContext` default object:

```tsx
  language: DEFAULT_LANGUAGE,
  setLanguage: async () => {},
```

- [ ] **Step 4: Add state, loader, and updater**

Add state (with the other `useState` calls):

```tsx
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);
```

Inside the loader `useEffect`'s async block, before `setReady(true)`:

```tsx
      const storedLanguage = await getSetting('language');
      if (isLanguage(storedLanguage)) {
        setLanguageState(storedLanguage);
        if (i18n.language !== storedLanguage) {
          await i18n.changeLanguage(storedLanguage);
        }
      }
```

Add the updater callback (with the other `update*` callbacks):

```tsx
  const updateLanguage = useCallback(async (lang: Language) => {
    await setSetting('language', lang);
    await i18n.changeLanguage(lang);
    setLanguageState(lang);
  }, []);
```

Add to the Provider `value` object:

```tsx
        language,
        setLanguage: updateLanguage,
```

- [ ] **Step 5: Add the `useLocale` hook**

Add after `useCurrency`:

```tsx
export function useLocale(): string {
  return LOCALE_TAGS[useContext(SettingsContext).language];
}
```

- [ ] **Step 6: Thread locale into `useFormat`**

Replace the body of `useFormat` with the locale-aware version (formatter signatures land in Task 3; this compiles only after Task 3, so commit Tasks 2+3 together — see Task 3 Step 5):

```tsx
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
```

- [ ] **Step 7: Hold commit until Task 3**

Do NOT commit yet — `useFormat` now references 3-arg formatters that don't exist until Task 3. Proceed directly to Task 3, then run the shared verify + commit there.

---

## Task 3: Locale-aware number formatting (`format.ts`)

**Files:**
- Modify: `src/utils/format.ts`
- Test (manual): web target

**Interfaces:**
- Consumes: nothing new.
- Produces (new 3-arg signatures; `locale` optional, defaults to `'en-US'` for any direct/legacy callers):
  - `formatCurrency(value: number, symbol?: string, locale?: string): string`
  - `formatSigned(value: number, symbol?: string, locale?: string): string`
  - `formatCurrencyCompact(value: number, symbol?: string, locale?: string): string`
  - `formatSignedCompact(value: number, symbol?: string, locale?: string): string`

- [ ] **Step 1: Rewrite `src/utils/format.ts`**

```ts
export function formatCurrency(
  value: number,
  symbol: string = '$',
  locale: string = 'en-US'
): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const body = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return `${sign}${symbol}${body}`;
}

export function formatSigned(
  value: number,
  symbol: string = '$',
  locale: string = 'en-US'
): string {
  const arrow = value >= 0 ? '▲' : '▼';
  return `${arrow} ${formatCurrency(Math.abs(value), symbol, locale)}`;
}

export function formatCurrencyCompact(
  value: number,
  symbol: string = '$',
  locale: string = 'en-US'
): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.round(Math.abs(value));
  const body = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(abs);
  return `${sign}${symbol}${body}`;
}

export function formatSignedCompact(
  value: number,
  symbol: string = '$',
  locale: string = 'en-US'
): string {
  const arrow = value >= 0 ? '▲' : '▼';
  return `${arrow} ${formatCurrencyCompact(Math.abs(value), symbol, locale)}`;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0 (resolves the Task 2 `useFormat` references).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 4: Manual sanity check (numbers)**

Run: `npm run web`
Open the app; on Home the net-worth figure renders with grouped digits and the user's currency symbol unchanged (e.g. `$1,234.56`). No crash. (Locale switching is verified end-to-end in Task 13.)

- [ ] **Step 5: Commit Tasks 2 + 3 together**

```bash
git add src/utils/format.ts src/hooks/SettingsContext.tsx app/_layout.tsx
git commit -m "feat(i18n): language setting + useLocale; Intl-based number formatting"
```

---

## Task 4: Locale-aware date helpers (`date.ts`) + month-label consumers

**Files:**
- Modify: `src/utils/date.ts`
- Modify: `app/(tabs)/transactions.tsx`
- Modify: `src/components/YearCalendar.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces (added to `date.ts`; `MONTH_NAMES` is removed):
  - `monthShort(month1to12: number, locale?: string): string` — localized short month name.
  - `formatMonthYear(ym: string, locale?: string): string` — e.g. `"Jun 2026"` / `"2026年6月"` from `"YYYY-MM"`.
  - `formatLongDate(isoDate: string, locale?: string): string` — e.g. `"Jun 21, 2026"` from `"YYYY-MM-DD"`; returns the input unchanged if unparseable.

- [ ] **Step 1: Replace `MONTH_NAMES` in `src/utils/date.ts`**

Delete the `MONTH_NAMES` export (lines 45-48) and append:

```ts
function monthFormatter(locale: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
}

export function monthShort(month1to12: number, locale: string = 'en-US'): string {
  // Use a fixed UTC date in the given month; day/year are irrelevant for 'short' month.
  return monthFormatter(locale).format(new Date(Date.UTC(2000, month1to12 - 1, 1)));
}

export function formatMonthYear(ym: string, locale: string = 'en-US'): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function formatLongDate(isoDate: string, locale: string = 'en-US'): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
```

- [ ] **Step 2: Update `app/(tabs)/transactions.tsx` imports**

Change the date import block (lines 9-14) to drop `MONTH_NAMES` and add the new helpers:

```tsx
import {
  currentYearMonth,
  prevYearMonth,
  nextYearMonth,
  formatMonthYear,
  formatLongDate,
} from '../../src/utils/date';
```

Add `useLocale` to the SettingsContext import (line 15):

```tsx
import { useFormat, useLocale, useSemanticColors } from '../../src/hooks/SettingsContext';
```

- [ ] **Step 3: Use locale for the month label and section dates in transactions.tsx**

Add inside the component (near `const { fmt } = useFormat();`):

```tsx
  const locale = useLocale();
```

Replace the hardcoded `Intl.DateTimeFormat('en-US', …)` block (lines 76-86) with the helper:

```tsx
    const formatDate = (isoDate: string) => formatLongDate(isoDate, locale);
```

(Delete the now-unused `dateFormatter` declaration. Add `locale` to the `sections` `useMemo` dependency array.)

Replace the month label (line 108):

```tsx
            {formatMonthYear(selectedMonth, locale)}
```

(The `const [year, month] = selectedMonth.split('-').map(Number);` line at 95 becomes unused — remove it.)

- [ ] **Step 4: Update `src/components/YearCalendar.tsx`**

Change the date import (line 6):

```tsx
import { currentYear, currentYearMonth, monthShort, yearMonth } from '../utils/date';
```

Add `useLocale` + `useTranslation`:

```tsx
import { useFormat, useLocale, useSemanticColors, useSettings } from '../hooks/SettingsContext';
import { useTranslation } from 'react-i18next';
```

Inside the component add:

```tsx
  const { t } = useTranslation();
  const locale = useLocale();
```

Replace the month label (line 116) `{MONTH_NAMES[c.month - 1]}` with:

```tsx
                  {monthShort(c.month, locale)}
```

Replace the "Today" link text (line 80) `Today` with `{t('common.today')}`.

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0. (tsc will flag any remaining `MONTH_NAMES` references — there should be none.)

- [ ] **Step 6: Commit**

```bash
git add src/utils/date.ts app/\(tabs\)/transactions.tsx src/components/YearCalendar.tsx
git commit -m "feat(i18n): Intl-based locale-aware date/month formatting"
```

---

## Task 5: Localize navigation titles (tabs + stack)

**Files:**
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `app/_layout.tsx`

**Interfaces:**
- Consumes: `useTranslation` (react-i18next), `nav.*` keys.

- [ ] **Step 1: Localize tab titles in `app/(tabs)/_layout.tsx`**

Add import:

```tsx
import { useTranslation } from 'react-i18next';
```

Inside `TabLayout`, add `const { t } = useTranslation();` and replace the four `title:` literals:

| Line | From | To |
|------|------|----|
| 26 | `title: 'Home',` | `title: t('nav.home'),` |
| 33 | `title: 'Assets',` | `title: t('nav.assets'),` |
| 40 | `title: 'Transactions',` | `title: t('nav.transactions'),` |
| 47 | `title: 'Settings',` | `title: t('nav.settings'),` |

- [ ] **Step 2: Localize stack titles in `app/_layout.tsx`**

Add `import { useTranslation } from 'react-i18next';`, add `const { t } = useTranslation();` inside `RootLayout`, and replace:

| From | To |
|------|----|
| `options={{ title: 'Asset' }}` | `options={{ title: t('nav.asset') }}` |
| `title: 'Record Snapshot'` | `title: t('nav.recordSnapshot')` |
| `title: 'Add Transaction'` | `title: t('nav.addTransaction')` |
| `title: 'Manage Accounts'` | `title: t('nav.manageAccounts')` |
| `title: 'Edit Asset'` | `title: t('nav.editAsset')` |

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/_layout.tsx app/_layout.tsx
git commit -m "feat(i18n): localize navigation titles"
```

---

## Task 6: Localize Home + Assets screens

**Files:**
- Modify: `app/(tabs)/index.tsx`
- Modify: `app/(tabs)/assets.tsx`

**Interfaces:**
- Consumes: `useTranslation`, `home.*` and `assets.*` keys.

**Extraction pattern (applies to every screen task):** add `import { useTranslation } from 'react-i18next';`, add `const { t } = useTranslation();` at the top of the component body, then replace each literal below with the `t('key')` call. Leave all data values, `fmt(...)` calls, and styles untouched.

- [ ] **Step 1: `app/(tabs)/index.tsx`**

| Line | Literal | Replacement |
|------|---------|-------------|
| 72 | `Total Net Worth` | `{t('home.totalNetWorth')}` |
| 88 | `Net Growth` | `{t('home.netGrowth')}` |
| 98 | `Profit` | `{t('home.profit')}` |
| 110 | `Allocation` | `{t('home.allocation')}` |

- [ ] **Step 2: `app/(tabs)/assets.tsx`**

| Line | Literal | Replacement |
|------|---------|-------------|
| 66 | `No accounts yet` | `{t('assets.noAccountsTitle')}` |
| 67 | `Go to Settings to create an account and add assets.` | `{t('assets.noAccountsBody')}` |
| 82 | `No assets` | `{t('assets.noAssets')}` |

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/index.tsx app/\(tabs\)/assets.tsx
git commit -m "feat(i18n): localize Home and Assets screens"
```

---

## Task 7: Localize Transactions screen text

**Files:**
- Modify: `app/(tabs)/transactions.tsx`

**Interfaces:**
- Consumes: `useTranslation`, `transactions.*` keys. (`useLocale` already added in Task 4.)

- [ ] **Step 1: Add translation hook**

Add `import { useTranslation } from 'react-i18next';` and `const { t } = useTranslation();` in the component.

- [ ] **Step 2: Replace literals**

| Line | Literal | Replacement |
|------|---------|-------------|
| 119 | `Income` | `{t('transactions.income')}` |
| 125 | `Outlay` | `{t('transactions.outlay')}` |
| 131 | `Net` | `{t('transactions.net')}` |
| 149 | `t === 'list' ? 'List' : 'Breakdown'` | `t === 'list' ? t('transactions.list') : t('transactions.breakdown')` |
| 165 | `No transactions this month` | `{t('transactions.noTransactions')}` |
| 205 | `Income by Category` | `{t('transactions.incomeByCategory')}` |
| 211 | `emptyText="No income this month"` | `emptyText={t('transactions.noIncome')}` |
| 215 | `Outlay by Category` | `{t('transactions.outlayByCategory')}` |
| 221 | `emptyText="No outlay this month"` | `emptyText={t('transactions.noOutlay')}` |

Note: line 149's `t` (the loop variable) shadows nothing problematic, but to avoid confusion with the translation `t`, rename the map parameter from `t` to `tabKey` in the `.map((t) => …)` at line 143 and update its three uses inside that block (`tab === tabKey`, `setTab(tabKey)`, `tabKey === 'list' ? …`). Verify with tsc.

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/transactions.tsx
git commit -m "feat(i18n): localize Transactions screen text"
```

---

## Task 8: Localize Asset Detail screen

**Files:**
- Modify: `app/asset/[id].tsx`

**Interfaces:**
- Consumes: `useTranslation`, `useLocale`, `assetDetail.*`, `nav.asset`, `common.today` (not needed), `assetDetail.asOf` (interpolated).

- [ ] **Step 1: Add hooks**

Add `import { useTranslation } from 'react-i18next';`, add `useLocale` to the SettingsContext import, and inside the component:

```tsx
  const { t } = useTranslation();
  const locale = useLocale();
```

- [ ] **Step 2: Localize the metric labels map**

`METRIC_LABELS` is a module-level constant of static English. Convert metric labels to keys. Replace the constant (lines 16-20) with a key map:

```tsx
const METRIC_LABEL_KEYS: Record<Metric, string> = {
  netWorth: 'assetDetail.netWorth',
  profit: 'assetDetail.profit',
  inflow: 'assetDetail.inflow',
};
```

Update the two references:
- Line 110 `(Object.keys(METRIC_LABELS) as Metric[])` → `(Object.keys(METRIC_LABEL_KEYS) as Metric[])`
- Line 123 `{METRIC_LABELS[m]}` → `{t(METRIC_LABEL_KEYS[m])}`

- [ ] **Step 3: Replace remaining literals**

| Line | Literal | Replacement |
|------|---------|-------------|
| 90 | `asset?.name ?? 'Asset'` | `asset?.name ?? t('nav.asset')` |
| 103 | `As of {latest.date}` | `{t('assetDetail.asOf', { date: latest.date })}` |
| 165 | `+ Record Snapshot` | `{t('assetDetail.recordSnapshot')}` |
| 168 | `History` | `{t('assetDetail.history')}` |
| 171 | `No snapshots yet. Tap "Record Snapshot" above.` | `{t('assetDetail.noSnapshots')}` |
| 176 | `Date` | `{t('assetDetail.colDate')}` |
| 177 | `Net Worth` | `{t('assetDetail.colNetWorth')}` |
| 178 | `Profit` | `{t('assetDetail.colProfit')}` |

Optional (locale dates): the history table and `As of` show raw ISO `s.date`/`latest.date`. Leave as ISO for now (snapshots are `"YYYY-MM"`; keeping ISO is acceptable and consistent). Do not change `{s.date}` cells.

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/asset/\[id\].tsx
git commit -m "feat(i18n): localize Asset Detail screen"
```

---

## Task 9: Localize Add Transaction + Add Record modals

**Files:**
- Modify: `app/modals/add-transaction.tsx`
- Modify: `app/modals/add-record.tsx`

**Interfaces:**
- Consumes: `useTranslation`, `addTransaction.*`, `addRecord.*`, `common.*`. For `Alert.alert` (native) the strings come from `t(...)`; the Cancel/Delete buttons use `common.cancel`/`common.delete`.

- [ ] **Step 1: `add-transaction.tsx` — add hook**

Add `import { useTranslation } from 'react-i18next';` and `const { t } = useTranslation();`.

- [ ] **Step 2: `add-transaction.tsx` — replace literals**

| Line | Literal | Replacement |
|------|---------|-------------|
| 98 | `Alert.alert('Invalid input', 'Please enter a valid positive value.')` | `Alert.alert(t('addTransaction.invalidTitle'), t('addTransaction.invalidValue'))` |
| 111 | `Alert.alert('Delete Transaction', 'This cannot be undone.', [` | `Alert.alert(t('addTransaction.deleteTitle'), t('addTransaction.deleteBody'), [` |
| 112 | `{ text: 'Cancel', style: 'cancel' }` | `{ text: t('common.cancel'), style: 'cancel' }` |
| 114 | `text: 'Delete',` | `text: t('common.delete'),` |
| 130 | `Type` | `{t('addTransaction.type')}` |
| 148-149 | `{t === 'INCOME' ? '+' : '−'}` (this is the symbol, leave) / line 148 type button label `{t}` | type button label at line 148 shows `{t}` (the loop var). Replace with `{type === t ? ... }` — see note below |
| 154 | `Date` | `{t('addTransaction.date')}` |
| 172 | `Done` | `{t('common.done')}` |
| 178 | `Value` | `{t('addTransaction.value')}` |
| 183 | `placeholder="0.00"` | `placeholder={t('addTransaction.valuePlaceholder')}` |
| 187 | `Tags (comma-separated)` | `{t('addTransaction.tags')}` |
| 192 | `placeholder="e.g. food, dining"` | `placeholder={t('addTransaction.tagsPlaceholder')}` |
| 218 | `Note` | `{t('addTransaction.note')}` |
| 223 | `placeholder="Optional description"` | `placeholder={t('addTransaction.notePlaceholder')}` |
| 229 | `{editingId ? 'Update' : 'Save'}` | `{editingId ? t('common.update') : t('common.save')}` |
| 234 | `Delete` | `{t('common.delete')}` |

**Type-button label note (lines 132-150):** the type selector maps over `(['INCOME', 'OUTLAY'] as const)` with parameter `t`, which shadows the translation function and renders `{t}` (the raw `INCOME`/`OUTLAY`). Rename the map parameter to `opt`:
- Line 132: `.map((opt) => (`
- Lines 135-148: replace `t` uses — `setType(opt)`, `type === opt && {...}`, `t === 'INCOME'` → `opt === 'INCOME'` (twice in the style block).
- Line 148 label: replace `{t}` with `{opt === 'INCOME' ? t('addTransaction.typeIncome') : t('addTransaction.typeOutlay')}`.
Verify with tsc that no `t` shadow remains in this block.

- [ ] **Step 3: `add-record.tsx` — add hook**

Add `import { useTranslation } from 'react-i18next';` and `const { t } = useTranslation();`.

- [ ] **Step 4: `add-record.tsx` — replace literals**

| Line | Literal | Replacement |
|------|---------|-------------|
| 122 | `Alert.alert('Invalid input', 'Please enter a valid net worth.')` | `Alert.alert(t('addRecord.invalidTitle'), t('addRecord.invalidNetWorth'))` |
| 130 | `Alert.alert('Delete Snapshot', \`Remove ${date} snapshot?\`, [` | `Alert.alert(t('addRecord.deleteTitle'), t('addRecord.deleteBody', { date }), [` |
| 131 | `{ text: 'Cancel', style: 'cancel' }` | `{ text: t('common.cancel'), style: 'cancel' }` |
| 133 | `text: 'Delete',` | `text: t('common.delete'),` |
| 153 | `Date: {date}` | `{t('addRecord.dateLabel', { date })}` |
| 167 | `Done` | `{t('common.done')}` |
| 173 | `Previous net worth: {fmt(lastNetWorth)}` | `{t('addRecord.previousNetWorth', { value: fmt(lastNetWorth) })}` |
| 179 | `Auto-calculate` | `{t('addRecord.autoCalculate')}` |
| 183-184 | `When enabled, editing any two fields auto-fills the third using: profit = (netWorth - lastNetWorth) - inflow` | `{t('addRecord.autoCalcHelp')}` |
| 189 | `Net Worth` | `{t('addRecord.netWorth')}` |
| 194 | `placeholder="0.00"` | `placeholder={t('addRecord.valuePlaceholder')}` |
| 198 | `Inflow` | `{t('addRecord.inflow')}` |
| 204 | `placeholder="0.00"` | `placeholder={t('addRecord.valuePlaceholder')}` |
| 207 | `Profit` | `{t('addRecord.profit')}` |
| 213 | `placeholder="0.00"` | `placeholder={t('addRecord.valuePlaceholder')}` |
| 218 | `{hasExisting ? 'Update' : 'Save'}` | `{hasExisting ? t('common.update') : t('common.save')}` |
| 223 | `Delete` | `{t('common.delete')}` |

The `{accountName} · {assetName}` header (line 150) is user data — leave unchanged.

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/modals/add-transaction.tsx app/modals/add-record.tsx
git commit -m "feat(i18n): localize Add Transaction and Add Record modals"
```

---

## Task 10: Localize Manage Accounts + Edit Asset modals

**Files:**
- Modify: `app/modals/manage-accounts.tsx`
- Modify: `app/modals/edit-asset.tsx`

**Interfaces:**
- Consumes: `useTranslation`, `manageAccounts.*`, `editAsset.*`, `common.*`.

- [ ] **Step 1: `manage-accounts.tsx` — add hook**

Add `import { useTranslation } from 'react-i18next';` and `const { t } = useTranslation();`.

- [ ] **Step 2: `manage-accounts.tsx` — replace literals**

| Line | Literal | Replacement |
|------|---------|-------------|
| 67 | `'Failed to create account'` | `t('manageAccounts.createAccountFailed')` |
| 68 | `Alert.alert('Error', message)` | `Alert.alert(t('common.error'), message)` |
| 73-74 | `Alert.alert('Delete Account', \`Delete "${acc.name}" and all its assets/snapshots?\`,` | `Alert.alert(t('manageAccounts.deleteAccountTitle'), t('manageAccounts.deleteAccountBody', { name: acc.name }),` |
| 77 | `{ text: 'Cancel', style: 'cancel' }` | `{ text: t('common.cancel'), style: 'cancel' }` |
| 79 | `text: 'Delete',` | `text: t('common.delete'),` |
| 92-94 | `Alert.alert('Archive Account', \`Hide "${acc.name}" and all its assets from default views? History is preserved.\`,` | `Alert.alert(t('manageAccounts.archiveAccountTitle'), t('manageAccounts.archiveAccountBody', { name: acc.name }),` |
| 96 | `{ text: 'Cancel', style: 'cancel' }` | `{ text: t('common.cancel'), style: 'cancel' }` |
| 98 | `text: 'Archive',` | `text: t('common.archive'),` |
| 126 | `'Failed to create asset'` | `t('manageAccounts.createAssetFailed')` |
| 127 | `Alert.alert('Error', message)` | `Alert.alert(t('common.error'), message)` |
| 140 | `Show archived` | `{t('manageAccounts.showArchived')}` |
| 144 | `Accounts` | `{t('manageAccounts.accounts')}` |
| 151 | `placeholder="New account name"` | `placeholder={t('manageAccounts.newAccountPlaceholder')}` |
| 154 | `Add` | `{t('common.add')}` |
| 171 | `Archived` | `{t('common.archived')}` |
| 177 | `Unarchive` | `{t('common.unarchive')}` |
| 181 | `Archive` | `{t('common.archive')}` |
| 194-195 | `Assets in {selectedAccount.name}` | `{t('manageAccounts.assetsIn', { name: selectedAccount.name })}` |
| 204 | `placeholder="New asset name"` | `placeholder={t('manageAccounts.newAssetPlaceholder')}` |
| 207 | `Add` | `{t('common.add')}` |
| 212 | `No assets yet` | `{t('manageAccounts.noAssetsYet')}` |
| 231 | `Archived` | `{t('common.archived')}` |
| 239 | `Unarchive` | `{t('common.unarchive')}` |

The `catStr` (category key/value, line 235) and account/asset names are user data — leave unchanged.

- [ ] **Step 3: `edit-asset.tsx` — add hook**

Add `import { useTranslation } from 'react-i18next';` and `const { t } = useTranslation();`.

- [ ] **Step 4: `edit-asset.tsx` — replace literals**

| Line | Literal | Replacement |
|------|---------|-------------|
| 69 | `Alert.alert('Invalid input', 'Asset name cannot be empty')` | `Alert.alert(t('editAsset.invalidTitle'), t('editAsset.emptyName'))` |
| 82 | `'Failed to save'` | `t('editAsset.saveFailed')` |
| 83 | `Alert.alert('Error', message)` | `Alert.alert(t('common.error'), message)` |
| 90 | `const title = nextArchived ? 'Archive Asset' : 'Unarchive Asset';` | `const title = nextArchived ? t('editAsset.archiveTitle') : t('editAsset.unarchiveTitle');` |
| 91-93 | `const message = nextArchived ? \`Hide "${asset.name}"…\` : \`Restore "${asset.name}"…\`;` | `const message = nextArchived ? t('editAsset.archiveBody', { name: asset.name }) : t('editAsset.unarchiveBody', { name: asset.name });` |
| 95 | `{ text: 'Cancel', style: 'cancel' }` | `{ text: t('common.cancel'), style: 'cancel' }` |
| 97 | `text: nextArchived ? 'Archive' : 'Unarchive',` | `text: nextArchived ? t('common.archive') : t('common.unarchive'),` |
| 108-109 | `Alert.alert('Delete Asset', \`Delete "${asset?.name}" and all its snapshots?\`,` | `Alert.alert(t('editAsset.deleteTitle'), t('editAsset.deleteBody', { name: asset?.name ?? '' }),` |
| 111 | `{ text: 'Cancel', style: 'cancel' }` | `{ text: t('common.cancel'), style: 'cancel' }` |
| 113 | `text: 'Delete',` | `text: t('common.delete'),` |
| 136 | `Archived` | `{t('common.archived')}` |
| 140 | `Asset Name` | `{t('editAsset.assetName')}` |
| 146 | `Categories` | `{t('editAsset.categories')}` |
| 149 | `Key/value pairs (e.g. Risk: High, Type: Stock)` | `{t('editAsset.categoriesHelp')}` |
| 158 | `placeholder="Key"` | `placeholder={t('editAsset.keyPlaceholder')}` |
| 163 | `placeholder="Value"` | `placeholder={t('editAsset.valuePlaceholder')}` |
| 175 | `+ Add Category` | `{t('editAsset.addCategory')}` |
| 180 | `Save` | `{t('common.save')}` |
| 185 | `{asset.archived ? 'Unarchive Asset' : 'Archive Asset'}` | `{asset.archived ? t('editAsset.unarchiveAsset') : t('editAsset.archiveAsset')}` |
| 190 | `Delete Asset` | `{t('editAsset.deleteAsset')}` |

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/modals/manage-accounts.tsx app/modals/edit-asset.tsx
git commit -m "feat(i18n): localize Manage Accounts and Edit Asset modals"
```

---

## Task 11: Localize chart empty states

**Files:**
- Modify: `src/components/charts/CategoryBars.tsx`
- Modify: `src/components/charts/AllocationBarList.tsx`
- Modify: `src/components/charts/AssetLineChart.tsx`

**Interfaces:**
- Consumes: `useTranslation`, `charts.*`.

- [ ] **Step 1: `CategoryBars.tsx`**

The default prop `emptyText = 'No data'` cannot call a hook at the default position. Change the default to `undefined` and resolve inside the component:

- Change the prop type/default so `emptyText?: string` (already optional) keeps `emptyText` with no default in the signature: `export function CategoryBars({ items, color, emptyText }: Props) {`
- Add `import { useTranslation } from 'react-i18next';` and inside: `const { t } = useTranslation();`
- Replace the empty render (line 24) with: `return <Text style={{ color: colors.muted }}>{emptyText ?? t('charts.noData')}</Text>;`

(Callers in transactions.tsx already pass explicit `emptyText`, so this only affects the unlikely no-prop case.)

- [ ] **Step 2: `AllocationBarList.tsx`**

Add `import { useTranslation } from 'react-i18next';`, add `const { t } = useTranslation();`, and replace line 30 `No data to display` with `{t('charts.noDataToDisplay')}`.

- [ ] **Step 3: `AssetLineChart.tsx`**

Add `import { useTranslation } from 'react-i18next';`, add `const { t } = useTranslation();`, and replace line 35 `No data yet` with `{t('charts.noDataYet')}`.

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0. (If `t()` is added but a chart has no other hook and renders before data, ensure the hook is called unconditionally at the top of the component, before any early `return`.)

- [ ] **Step 5: Commit**

```bash
git add src/components/charts/CategoryBars.tsx src/components/charts/AllocationBarList.tsx src/components/charts/AssetLineChart.tsx
git commit -m "feat(i18n): localize chart empty states"
```

---

## Task 12: Localize Settings screen + dialog defaults + add the Language card

**Files:**
- Modify: `app/(tabs)/settings.tsx`
- Modify: `src/utils/dialog.ts`

**Interfaces:**
- Consumes: `useTranslation`, `useSettings().language/setLanguage` (Task 2), `settings.*`, `common.*`, `Language`/`LANGUAGES` from `src/i18n`.

- [ ] **Step 1: `dialog.ts` — localize default button labels**

`confirmAsync`'s `confirmLabel` defaults to `'OK'` and the Cancel button is hardcoded. These are module functions (no hooks). Use `i18n.t` directly:

Add import at top: `import i18n from '../i18n';`

Change the signature default and the Cancel label:
- `confirmLabel = 'OK'` → `confirmLabel?: string` (optional, no default)
- In the native branch, resolve: `const confirm = confirmLabel ?? i18n.t('common.ok');` and use `text: confirm` for the confirm button; use `text: i18n.t('common.cancel')` for the Cancel button.

```ts
export function confirmAsync(
  title: string,
  message: string,
  confirmLabel?: string,
  destructive = false
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  }
  const confirm = confirmLabel ?? i18n.t('common.ok');
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: i18n.t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirm,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
```

(Callers in settings.tsx pass explicit confirm labels via `t(...)` in Step 3, so the default is only a fallback.)

- [ ] **Step 2: `settings.tsx` — imports and hook**

Add imports:

```tsx
import { useTranslation } from 'react-i18next';
import { LANGUAGES, type Language } from '../../src/i18n';
```

Add `const { t } = useTranslation();` inside `SettingsScreen`, and pull `language`/`setLanguage` from `useSettings()`:

```tsx
  const {
    currency,
    setCurrency,
    forwardFill,
    setForwardFill,
    gainColor,
    setGainColor,
    language,
    setLanguage,
  } = useSettings();
```

- [ ] **Step 3: `settings.tsx` — localize the GAIN_COLOR options + dialogs + section text**

`GAIN_COLOR_OPTIONS` (lines 23-26) holds static `label` strings. Replace its `label` with a `labelKey`:

```tsx
const GAIN_COLOR_OPTIONS: { value: GainColor; labelKey: string; color: string }[] = [
  { value: 'green', labelKey: 'settings.green', color: colors.positive },
  { value: 'red', labelKey: 'settings.red', color: colors.negative },
];
```

Update the chip render (line 130) `{opt.label} {'▲'}` → `{t(opt.labelKey)} {'▲'}`.

Add the language option labels as a module constant:

```tsx
const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  zh: '中文',
};
```

Replace the dialog/notify strings and section text per this table:

| Line | Literal | Replacement |
|------|---------|-------------|
| 42-43 | `'Reset Database'`, `'This will permanently delete…'` | `t('settings.resetTitle')`, `t('settings.resetBody')` |
| 44 | `'Reset'` | `t('settings.resetConfirm')` |
| 49 | `notify('Done', 'Database has been reset.')` | `notify(t('settings.doneTitle'), t('settings.resetDone'))` |
| 54-55 | `'Load Sample Data'`, `'This will replace all current data…'` | `t('settings.loadSampleTitle')`, `t('settings.loadSampleBody')` |
| 56 | `'Load'` | `t('settings.loadConfirm')` |
| 63 | `notify('Done', 'Sample data loaded. Check the Home and Assets tabs.')` | `notify(t('settings.doneTitle'), t('settings.sampleLoaded'))` |
| 65 | `notify('Error', e?.message ?? 'Failed to load sample data')` | `notify(t('common.error'), e?.message ?? t('settings.loadSampleFailed'))` |
| 73 | `Preferences` | `{t('settings.preferences')}` |
| 77 | `Forward-fill missing months` | `{t('settings.forwardFillTitle')}` |
| 79 | `Use the last known value when a snapshot is missing` | `{t('settings.forwardFillHelp')}` |
| 86 | `Currency` | `{t('settings.currency')}` |
| 87 | `Displayed before all amounts` | `{t('settings.currencyHelp')}` |
| 109 | `Color for gains` | `{t('settings.colorForGains')}` |
| 110-111 | `Red for gains matches Chinese/HK stock market convention` | `{t('settings.colorForGainsHelp')}` |
| 138 | `Manage` | `{t('settings.manage')}` |
| 140 | `title="Accounts & Assets"` | `title={t('settings.accountsAssets')}` |
| 141 | `subtitle="Add, rename, or delete accounts and assets"` | `subtitle={t('settings.accountsAssetsSub')}` |
| 145 | `Backup` | `{t('settings.backup')}` |
| 147 | `title="Export Data"` | `title={t('settings.exportData')}` |
| 148 | `subtitle="Save a JSON backup file"` | `subtitle={t('settings.exportDataSub')}` |
| 154 | `notify('Export Failed', e?.message ?? 'Unable to export')` | `notify(t('settings.exportFailedTitle'), e?.message ?? t('settings.exportFailedBody'))` |
| 162 | `title="Import Data"` | `title={t('settings.importData')}` |
| 163 | `subtitle="Replace all data from a backup file"` | `subtitle={t('settings.importDataSub')}` |
| 168-169 | `'Import Backup'`, `'This will replace all existing data. Continue?'` | `t('settings.importTitle')`, `t('settings.importBody')` |
| 170 | `'Import'` | `t('settings.importConfirm')` |
| 177-180 | `notify('Imported', \`Accounts: ${counts.accounts}\n…\`)` | `notify(t('settings.importedTitle'), t('settings.importedBody', { accounts: counts.accounts, assets: counts.assets, snapshots: counts.snapshots, transactions: counts.transactions }))` |
| 183 | `notify('Import Failed', e?.message ?? 'Unable to import')` | `notify(t('settings.importFailedTitle'), e?.message ?? t('settings.importFailedBody'))` |
| 192 | `Data` | `{t('settings.data')}` |
| 194 | `title="Load Sample Data"` | `title={t('settings.loadSample')}` |
| 195 | `subtitle="Populate with 24 months…"` | `subtitle={t('settings.loadSampleSub')}` |
| 200 | `title="Reset Database"` | `title={t('settings.resetDb')}` |
| 201 | `subtitle="Delete all data"` | `subtitle={t('settings.resetDbSub')}` |
| 210 | `Working…` | `{t('common.working')}` |

- [ ] **Step 4: `settings.tsx` — add the Language card**

Insert a new card immediately after the gain-color card (after line 136, before the `Manage` section title at line 138), mirroring the currency chip pattern:

```tsx
      <View style={shared.card}>
        <Text style={styles.rowTitle}>{t('settings.language')}</Text>
        <Text style={shared.muted}>{t('settings.languageHelp')}</Text>
        <View style={styles.currencyRow}>
          {LANGUAGES.map((lang) => (
            <TouchableOpacity
              key={lang}
              onPress={() => setLanguage(lang)}
              style={[
                styles.currencyChip,
                styles.gainChip,
                language === lang && styles.currencyChipActive,
              ]}>
              <Text
                style={[
                  styles.currencyChipText,
                  language === lang && { color: 'white' },
                ]}>
                {LANGUAGE_LABELS[lang]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
```

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add app/\(tabs\)/settings.tsx src/utils/dialog.ts
git commit -m "feat(i18n): localize Settings screen, dialog defaults, and add Language card"
```

---

## Task 13: End-to-end verification on web + grep for stragglers

**Files:**
- No code changes unless stragglers are found (then fix in the owning file and amend its commit / add a fixup commit).

- [ ] **Step 1: Grep for remaining hardcoded user-facing strings**

Run:

```bash
grep -rnE ">[A-Z][a-z]+( [A-Za-z]+)*<|placeholder=\"[A-Z]|Alert\.alert\('|notify\('" app src/components | grep -v "i18n\|t('"
```

Expected: no rows that are user-facing English copy. (Symbols like `+`, `−`, `‹`, `›`, `✕`, `▲`, currency symbols, and user-data interpolations are fine.) If any real string remains, route it through `t()` using the existing keys (or add a key to both `en.json` and `zh.json`).

- [ ] **Step 2: Confirm `MONTH_NAMES` is fully gone**

Run: `grep -rn "MONTH_NAMES" app src`
Expected: no matches.

- [ ] **Step 3: Type-check + lint (full)**

Run: `npx tsc --noEmit && npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Manual end-to-end on web**

Run: `npm run web` (clear the service worker first if testing a built PWA — see project memory on stale SW cache).

Verify:
1. App boots in the device-detected language (or `en`).
2. Settings → Language → tap **中文**: tab bar, all visible screen text, section titles, and the Settings screen itself switch to Chinese **immediately** (no reload).
3. Home net-worth number keeps the currency symbol and shows locale grouping.
4. Transactions month label and date section headers render in the selected locale (e.g. `2026年6月`).
5. Reload the page: the chosen language **persists** (read back from the `setting` table).
6. Switch back to **English**: everything reverts.

- [ ] **Step 5: (If on macOS/with Android available) spot-check the Intl risk**

If an Android target is available, run `npm run android`, switch to 中文, and confirm month names and number grouping render correctly. If they render as English/ungrouped on Android (Hermes locale-data gap), install polyfills:

```bash
npm install @formatjs/intl-locale @formatjs/intl-pluralrules @formatjs/intl-numberformat @formatjs/intl-datetimeformat
```

Then add a polyfill side-effect import at the very top of `src/i18n/index.ts` (before other imports) loading `@formatjs/intl-*` + `zh`/`en` locale data, guarded to native. Document this in the file with a comment. (Skip this step if no Android target is available; the risk is web-irrelevant.)

- [ ] **Step 6: Final commit (if stragglers were fixed)**

```bash
git add -A
git commit -m "fix(i18n): localize remaining strings found in verification sweep"
```

---

## Self-Review

**Spec coverage check:**
- English + Simplified Chinese → Task 1 (both bundles). ✅
- Auto-detect device locale on first run → Task 1 `detectDeviceLanguage`, used as `lng` and `DEFAULT_LANGUAGE` (Task 2). ✅
- Manual override persisted → Task 2 `setLanguage` (writes `setting` table) + Task 12 Language card. ✅
- Live re-render → `useTranslation()` used in every screen task; `changeLanguage` in Task 2. ✅
- Full locale number formatting (separators, symbol stays user-controlled) → Task 3. ✅
- Full locale date/month formatting, ISO storage keys unchanged → Task 4. ✅
- All ~70 strings extracted → Tasks 5-12 cover every file in the inventory; Task 13 greps for stragglers. ✅
- Language card mirrors chip pattern → Task 12 Step 4. ✅
- Native Intl risk → Task 13 Step 5. ✅
- Fallback to `en` → Task 1 `fallbackLng`. ✅

**Type consistency check:** `Language` union, `LOCALE_TAGS`, `LANGUAGES`, `isLanguage`, `detectDeviceLanguage` defined in Task 1 and consumed with identical names in Tasks 2/12. `useLocale` defined in Task 2, consumed in Tasks 4/7/8. Formatter 3-arg signatures defined in Task 3, called from Task 2's `useFormat` (commit ordering handled: Task 2 holds, Task 3 commits both). `monthShort`/`formatMonthYear`/`formatLongDate` defined in Task 4, consumed in same task. ✅

**Placeholder scan:** No TBD/TODO; every step shows concrete code or an exact literal→key mapping. ✅

**Scope:** Single feature, one implementation plan. ✅
