# Theme Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-selectable color **Theme** setting with six light palettes that re-theme the whole app instantly on all five targets.

**Architecture:** Palettes live as a `themes` record in `src/utils/theme.ts`. A `ThemeProvider`-equivalent is folded into the existing `SettingsContext`, exposing `useTheme()` / `useThemedStyles()` / `useShared()`. Every component's module-level `StyleSheet.create` that references colors is converted to a module-scope `makeStyles(c)` factory consumed via `useThemedStyles`. Gain/loss red/green and the category palette become theme-independent constants.

**Tech Stack:** TypeScript, React Native, Expo Router, expo-sqlite (settings persistence), i18next.

## Global Constraints

- **No test runner exists.** Verify every task with `npx tsc --noEmit` and `npm run lint`. Behavior is confirmed by running the web target (`npm run web`). Do not add a test framework.
- **Node 20+** (`.nvmrc`); use existing deps only — this feature adds no dependencies.
- Layout tokens `spacing` / `radius` stay as static imports from `src/utils/theme`; only **color-bearing** values move into themed factories.
- `makeStyles` factories MUST be **module-scope `const`** (never defined inside a component) or `useThemedStyles` memoization breaks.
- Components render on-accent text with the theme's `onAccent`, **never a literal `'#fff'`/`'white'`**.
- Default theme is `'warmSlate'` (current look is unchanged until the user picks another).
- Commit after each task with the message shown in that task.

---

## File Structure

- `src/utils/theme.ts` — types (`ThemeName`, `ThemePalette`, `ThemeColors`), `themes` record, `resolveTheme`, `withAlpha`, `makeShared`, and theme-independent constants (`semantic`, `tints`, `categoryPalette`, `spacing`, `radius`). Old `colors`/`shared` exports kept during migration, removed in the final task.
- `src/hooks/SettingsContext.tsx` — theme state + `useTheme`/`useThemedStyles`/`useShared`; `useSemanticColors` repointed to `semantic`.
- `app/(tabs)/_layout.tsx` — tab bar tint via `useTheme()`.
- `app/(tabs)/settings.tsx` — theme picker section + conversion.
- `src/i18n/locales/en.json` + `zh.json` — theme section title + 6 theme names.
- ~24 component/screen files — mechanical `StyleSheet.create` → `makeStyles` conversion.

Migration ordering: foundation (Tasks 1–2) ships the new machinery while old `colors`/`shared` still work, so the app keeps compiling. Tasks 3–6 convert consumers in reviewable batches. Task 7 adds the picker UI. Task 8 removes the old exports, which turns any missed conversion into a compile error.

---

### Task 1: Theme foundation in `theme.ts` + decouple semantic colors

**Files:**
- Modify: `src/utils/theme.ts` (full rewrite of the exports below; keep old `colors` + add a back-compat `shared`)
- Modify: `src/hooks/SettingsContext.tsx:156-162` (`useSemanticColors`)

**Interfaces:**
- Produces:
  - `type ThemeName`, `type ThemePalette`, `type ThemeColors`
  - `const themes: Record<ThemeName, ThemePalette>`
  - `function resolveTheme(p: ThemePalette): ThemeColors`
  - `function makeShared(c: ThemeColors): <StyleSheet>` with keys `screen, scrollContent, card, row, sectionTitle, heading, bigNumber, muted`
  - `const semantic: { positive: string; negative: string }`
  - `const tints: Record<string, string>` (keyed by `semantic` hex)
  - `const categoryPalette: string[]` (8 multi-hue entries)
  - `spacing`, `radius` unchanged
  - **Back-compat (temporary):** `colors` (original object, unchanged) and `shared` (now `= makeShared(resolveTheme(themes.warmSlate))`)

- [ ] **Step 1: Rewrite `src/utils/theme.ts`**

```ts
import { StyleSheet } from 'react-native';

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 10, md: 16, lg: 20, pill: 999 };

export type ThemeName =
  | 'warmSlate' | 'nordic' | 'seaGlass' | 'duskBlue' | 'sky' | 'lilac';

/** The values a theme actually picks. Everything else is derived. */
export type ThemePalette = {
  accent: string;
  onAccent: string; // text/icon on an accent fill (button labels)
  ink: string;
  inkSoft: string;
  muted: string;
  bg: string;
  card: string;
  border: string;
  shadowColor: string;
};

/** Resolved palette = stored choice points + derived fields. */
export type ThemeColors = ThemePalette & {
  primary: string; // = accent
  accentSoft: string; // = accent @ 16% alpha
  track: string; // = border
};

export const themes: Record<ThemeName, ThemePalette> = {
  warmSlate: { accent: '#c4663a', onAccent: '#ffffff', ink: '#2b2b33', inkSoft: '#5a564e', muted: '#9a9488', bg: '#f7f4ef', card: '#ffffff', border: '#ece9e2', shadowColor: '#3a3530' },
  nordic:    { accent: '#445162', onAccent: '#ffffff', ink: '#1f2933', inkSoft: '#52606d', muted: '#9aa4ad', bg: '#f5f7f8', card: '#ffffff', border: '#e3e8ea', shadowColor: '#2a3340' },
  seaGlass:  { accent: '#3f8c8a', onAccent: '#ffffff', ink: '#1c2b2a', inkSoft: '#4b5c5a', muted: '#8fa3a1', bg: '#f2f7f6', card: '#ffffff', border: '#dde9e7', shadowColor: '#1e3433' },
  duskBlue:  { accent: '#5a6bb0', onAccent: '#ffffff', ink: '#1e2233', inkSoft: '#525879', muted: '#9499b0', bg: '#f5f6fb', card: '#ffffff', border: '#e2e5f0', shadowColor: '#222a4a' },
  sky:       { accent: '#5b9bd5', onAccent: '#1f3346', ink: '#243747', inkSoft: '#5b7184', muted: '#7f97a9', bg: '#f5faff', card: '#ffffff', border: '#e2ecf5', shadowColor: '#243747' },
  lilac:     { accent: '#8470c8', onAccent: '#241f3a', ink: '#2b2740', inkSoft: '#5f5878', muted: '#938aa8', bg: '#f9f7fe', card: '#ffffff', border: '#e9e3f7', shadowColor: '#2b2740' },
};

const withAlpha = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export function resolveTheme(p: ThemePalette): ThemeColors {
  return { ...p, primary: p.accent, accentSoft: withAlpha(p.accent, 0.16), track: p.border };
}

// Theme-independent: standard pure gain/loss, shared by all themes.
export const semantic = { positive: '#16a34a', negative: '#dc2626' };

export const tints: Record<string, string> = {
  [semantic.positive]: 'rgba(22,163,74,0.13)',
  [semantic.negative]: 'rgba(220,38,38,0.12)',
};

// Multi-hue category palette (asset categories must be easy to tell apart).
export const categoryPalette = [
  '#4f86c6', '#e8a33d', '#57b08a', '#cc6f8e',
  '#8b7fc7', '#e0823f', '#4cb1bf', '#b0a04e',
];

/** Themed version of the old `shared` StyleSheet. */
export function makeShared(c: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    scrollContent: { padding: spacing.lg },
    card: {
      backgroundColor: c.card,
      borderRadius: radius.lg,
      padding: spacing.lg,
      marginBottom: spacing.md,
      shadowColor: c.shadowColor,
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    row: { flexDirection: 'row', alignItems: 'center' },
    sectionTitle: { fontSize: 11, fontWeight: '600', color: c.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
    heading: { fontSize: 20, fontWeight: '700', color: c.ink, marginBottom: spacing.md },
    bigNumber: { fontSize: 34, fontWeight: '800', color: c.ink, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
    muted: { color: c.muted },
  });
}

// ─── Back-compat during migration (REMOVED in the final task) ──────────────
// Unconverted components still import these. They render the default theme.
export const colors = {
  primary: '#c4663a',
  accent: '#c4663a',
  accentSoft: 'rgba(196,102,58,0.12)',
  positive: '#16a34a',
  negative: '#dc2626',
  ink: '#2b2b33',
  inkSoft: '#5a564e',
  muted: '#9a9488',
  bg: '#f7f4ef',
  card: '#ffffff',
  border: '#ece9e2',
  track: '#eceae4',
};

export const shared = makeShared(resolveTheme(themes.warmSlate));
```

Note: the back-compat `colors.positive/negative` are set to the **new** pure red/green so the interim look already matches once `useSemanticColors` is repointed in Step 2.

- [ ] **Step 2: Repoint `useSemanticColors` to `semantic`**

In `src/hooks/SettingsContext.tsx`, change the import and the hook:

```ts
// at top, replace `import { colors } from '../utils/theme';`
import { semantic } from '../utils/theme';
```

```ts
export function useSemanticColors() {
  const { gainColor } = useContext(SettingsContext);
  return {
    gain: gainColor === 'red' ? semantic.negative : semantic.positive,
    loss: gainColor === 'red' ? semantic.positive : semantic.negative,
  };
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: passes. (`colors` is still exported, so unconverted files compile.)

- [ ] **Step 4: Commit**

```bash
git add src/utils/theme.ts src/hooks/SettingsContext.tsx
git commit -m "feat(theme): add themes record, resolveTheme, makeShared; decouple semantic red/green"
```

---

### Task 2: Theme state + styling hooks in `SettingsContext`

**Files:**
- Modify: `src/hooks/SettingsContext.tsx`

**Interfaces:**
- Consumes: `ThemeName`, `ThemeColors`, `themes`, `resolveTheme`, `makeShared` (Task 1)
- Produces:
  - context fields `theme: ThemeName`, `setTheme(name: ThemeName): Promise<void>`
  - `function useTheme(): ThemeColors`
  - `function useThemedStyles<T>(factory: (c: ThemeColors) => T): T`
  - `function useShared(): ReturnType<typeof makeShared>`

- [ ] **Step 1: Add imports + types**

At the top of `src/hooks/SettingsContext.tsx`, extend the theme import:

```ts
import { useMemo } from 'react'; // add to the existing 'react' import list
import {
  semantic,
  themes,
  resolveTheme,
  makeShared,
  type ThemeColors,
  type ThemeName,
} from '../utils/theme';
```

Add to `SettingsContextValue`:

```ts
  theme: ThemeName;
  setTheme: (name: ThemeName) => Promise<void>;
```

Add the default constant near the other defaults:

```ts
const DEFAULT_THEME: ThemeName = 'warmSlate';
```

Add to the `createContext` default object:

```ts
  theme: DEFAULT_THEME,
  setTheme: async () => {},
```

- [ ] **Step 2: Add state, bootstrap load, updater**

In `SettingsProvider`, add state:

```ts
const [theme, setThemeState] = useState<ThemeName>(DEFAULT_THEME);
```

Inside the bootstrap `useEffect`'s async block (alongside the other `getSetting` calls):

```ts
const storedTheme = await getSetting('theme');
if (storedTheme && storedTheme in themes) {
  setThemeState(storedTheme as ThemeName);
}
```

Add the updater near the other `update*` callbacks:

```ts
const updateTheme = useCallback(async (name: ThemeName) => {
  await setSetting('theme', name);
  setThemeState(name);
}, []);
```

Add `theme` and `setTheme: updateTheme` to the provider's `value={{ ... }}`.

- [ ] **Step 3: Add the hooks (bottom of file)**

```ts
export function useTheme(): ThemeColors {
  const { theme } = useContext(SettingsContext);
  return useMemo(() => resolveTheme(themes[theme]), [theme]);
}

/**
 * Memoizes a themed StyleSheet. `factory` MUST be a module-scope const —
 * defining it inside a component re-creates it each render and defeats the memo.
 *
 *   const makeStyles = (c: ThemeColors) => StyleSheet.create({ ... });
 *   const styles = useThemedStyles(makeStyles);
 */
export function useThemedStyles<T>(factory: (c: ThemeColors) => T): T {
  const c = useTheme();
  return useMemo(() => factory(c), [c, factory]);
}

export function useShared() {
  return useThemedStyles(makeShared);
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/SettingsContext.tsx
git commit -m "feat(theme): theme state + useTheme/useThemedStyles/useShared hooks"
```

---

## Conversion pattern (applies to Tasks 3–6)

Every consumer is converted the same mechanical way. **Worked example — `MetricCard.tsx`** (do this exact transform in Task 3, then apply the same shape to every other file):

Before:
```ts
import { colors, shared, spacing } from '../utils/theme';
// ...
const styles = StyleSheet.create({
  card: { flex: 1, marginBottom: 0, padding: spacing.md + 2 },
  label: { fontSize: 11, fontWeight: '600', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.xs + 1 },
  value: { fontSize: 18, fontWeight: '700', color: colors.ink, fontVariant: ['tabular-nums'] },
});
```

After:
```ts
import { spacing, type ThemeColors } from '../utils/theme';
import { useShared, useThemedStyles } from '../hooks/SettingsContext';
// ...inside the component:
const shared = useShared();
const styles = useThemedStyles(makeStyles);
// ...module scope (bottom of file):
const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: { flex: 1, marginBottom: 0, padding: spacing.md + 2 },
    label: { fontSize: 11, fontWeight: '600', color: c.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: spacing.xs + 1 },
    value: { fontSize: 18, fontWeight: '700', color: c.ink, fontVariant: ['tabular-nums'] },
  });
```

Rules for every file:
1. Drop `colors` (and `shared`) from the `utils/theme` import; keep `spacing`/`radius`. Add `type ThemeColors`.
2. Add `import { useShared, useThemedStyles } from '<rel>/hooks/SettingsContext'` (only the parts used; `useShared` only if the file used `shared.*`).
3. Rename the module-scope `const styles = StyleSheet.create({...})` to `const makeStyles = (c: ThemeColors) => StyleSheet.create({...})`, and replace every `colors.X` inside with `c.X`.
4. Inside the component body add `const styles = useThemedStyles(makeStyles);` and, if `shared.*` is used, `const shared = useShared();`.
5. Replace inline JSX `colors.X` (e.g. `color={colors.primary}`) with a value from `const c = useTheme();` (add that line and the `useTheme` import when a file uses colors outside the stylesheet).
6. `tints[...]` stays imported from `utils/theme` (it's a constant). On-accent text literals (`'white'`/`'#fff'`) become `c.onAccent`.

Verify each task: `npx tsc --noEmit && npm run lint`. Because `colors`/`shared` still exist, a missed ref compiles — so after each file, grep it: `grep -nE "\bcolors\.|[^.]\bshared\b" <file>` should show nothing (except the new import lines / `useShared`).

---

### Task 3: Convert shared components

**Files (Modify):**
- `src/components/MetricCard.tsx` — `colors.muted`, `colors.ink`; `shared.card`. (Worked example above.)
- `src/components/ChangePill.tsx` — see full transform below (uses `tints` + `useSemanticColors`).
- `src/components/SectionCard.tsx`
- `src/components/AssetEntryCard.tsx`
- `src/components/MonthSelector.tsx`
- `src/components/YearCalendar.tsx`
- `src/components/CloudSyncSection.tsx`

For each file apply the conversion pattern. `ChangePill.tsx` is the one non-trivial case:

- [ ] **Step 1: Convert `ChangePill.tsx`**

```ts
import { StyleSheet, Text, View } from 'react-native';

import { useFormat, useSemanticColors, useThemedStyles } from '../hooks/SettingsContext';
import { radius, spacing, tints, type ThemeColors } from '../utils/theme';

type Props = {
  value: number;
  percent?: number | null;
  caption?: string;
};

export function ChangePill({ value, percent, caption }: Props) {
  const { fmtSigned } = useFormat();
  const { gain, loss } = useSemanticColors();
  const styles = useThemedStyles(makeStyles);

  const positive = value >= 0;
  const color = positive ? gain : loss;
  const bg = tints[color] ?? 'transparent';

  const pctText =
    percent == null ? '' : ` · ${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;

  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color }]}>
        {fmtSigned(value)}
        {pctText}
      </Text>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: spacing.sm + 2, borderRadius: radius.pill, gap: spacing.xs },
    text: { fontSize: 12.5, fontWeight: '700', fontVariant: ['tabular-nums'] },
    caption: { fontSize: 12, color: c.muted, fontWeight: '500' },
  });
```

(`bg` now falls back to `'transparent'` instead of the old `colors.accentSoft`; the pill color always matches a semantic tint key, so the fallback never triggers in practice.)

- [ ] **Step 2: Convert the remaining six files in the list** using the conversion pattern. For each, move its `StyleSheet.create` into `makeStyles(c)`, swap `colors.X`→`c.X`, swap `shared.*` to `useShared()`, and any inline `colors.X` to a `useTheme()` value.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Then per file: `grep -nE "\bcolors\." src/components/*.tsx` → expect no matches.

- [ ] **Step 4: Commit**

```bash
git add src/components/*.tsx
git commit -m "refactor(theme): convert shared components to useThemedStyles"
```

---

### Task 4: Convert chart components

**Files (Modify):** `src/components/charts/AllocationBarList.tsx`, `AssetBarChart.tsx`, `AssetLineChart.tsx`, `CategoryBars.tsx`, `NetWorthTrendChart.tsx`, `Sparkline.tsx`, `pointer.tsx`.

Most are the standard conversion. The two with **module-scope default params referencing `colors`** need the param default dropped and resolved inside the component (a default param cannot call a hook):

- [ ] **Step 1: Fix `Sparkline.tsx`**

Change the prop default and resolve inside:

```ts
import { useTheme } from '../../hooks/SettingsContext';
// remove the `import { colors } from '../../utils/theme';`

export function Sparkline({
  values,
  width = 80,
  height = 32,
  color,            // was: color = colors.primary
  area = false,
}: Props) {
  const c = useTheme();
  const lineColor = color ?? c.primary;
  // ...then use `lineColor` everywhere the body currently uses `color`
  //    (the <LineChart color={...}>, startFillColor, endFillColor).
```

Keep `Props.color?: string` as-is (already optional).

- [ ] **Step 2: Fix `AssetLineChart.tsx`** the same way

Drop `color = colors.primary` from the destructured props, add `const c = useTheme();` and `const lineColor = color ?? c.primary;`, and replace body uses of the defaulted `color` with `lineColor`. Convert its `StyleSheet.create` (if any) per the pattern.

- [ ] **Step 3: Convert the other five chart files** with the standard pattern. `categoryPalette` and `semantic` are constants — keep importing them from `utils/theme` unchanged.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Then: `grep -nE "\bcolors\." src/components/charts/*.tsx` → expect no matches.

- [ ] **Step 5: Commit**

```bash
git add src/components/charts/*.tsx
git commit -m "refactor(theme): convert charts to useThemedStyles; fix module-scope color defaults"
```

---

### Task 5: Convert tab screens + tab bar tint

**Files (Modify):** `app/(tabs)/index.tsx`, `app/(tabs)/assets.tsx`, `app/(tabs)/transactions.tsx`, `app/(tabs)/analysis.tsx`, `app/(tabs)/_layout.tsx`.

> Reconciliation note (master vs original plan): the original survey ran on an old feature branch. On master the 5th tab `app/(tabs)/analysis.tsx` exists and is converted here. `CompositionDonut.tsx` (its chart) was folded into Task 4.

- [ ] **Step 1: Convert `_layout.tsx` (tab bar tint via hook)**

`screenOptions` is built at module scope; move the color into the component:

```ts
import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { HapticTab } from '@/components/haptic-tab';
import { useTheme } from '../../src/hooks/SettingsContext';

export default function TabLayout() {
  const { t } = useTranslation();
  const c = useTheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: c.accent,
        headerShown: true,
        tabBarButton: HapticTab,
        tabBarLabelStyle: { flexShrink: 0 },
      }}>
      {/* ...unchanged <Tabs.Screen> entries... */}
    </Tabs>
  );
}
```

- [ ] **Step 2: Convert `index.tsx`, `assets.tsx`, `transactions.tsx`** with the standard pattern (`makeStyles(c)` + `useThemedStyles`, `useShared()` for `shared.*`, `useTheme()` for inline colors).

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Then: `grep -nE "\bcolors\." "app/(tabs)/index.tsx" "app/(tabs)/assets.tsx" "app/(tabs)/transactions.tsx" "app/(tabs)/_layout.tsx"` → no matches.

- [ ] **Step 4: Commit**

```bash
git add "app/(tabs)/index.tsx" "app/(tabs)/assets.tsx" "app/(tabs)/transactions.tsx" "app/(tabs)/_layout.tsx"
git commit -m "refactor(theme): convert tab screens + themed tab bar tint"
```

---

### Task 6: Convert detail, trends, modals, and settings base

**Files (Modify):** `app/asset/[id].tsx`, `app/modals/add-record.tsx`, `app/modals/add-transaction.tsx`, `app/modals/edit-asset.tsx`, `app/modals/manage-accounts.tsx`, `app/(tabs)/settings.tsx`.

> Reconciliation note: `app/trends.tsx` and `app/modals/erase-data.tsx` were listed from the old feature branch and do NOT exist on master — dropped from scope.

- [ ] **Step 1: Convert each file** with the standard pattern.

For `settings.tsx` specifically:
- Move `GAIN_COLOR_OPTIONS` off module-scope `colors`: change its colors to `semantic.positive` / `semantic.negative` (import `semantic`).
- Replace active-chip text literals `{ color: 'white' }` with `{ color: c.onAccent }` (add `const c = useTheme();`).
- Replace `color={colors.primary}` on the `ActivityIndicator` and `color: colors.negative` on the destructive `Row` with `c.primary` / `semantic.negative`.
- Move the module-scope `styles` into `makeStyles(c)` (the chip borders/backgrounds use `c.border`, `c.primary`, `c.muted`). Note `Row` is a separate component in this file — it also needs `const styles = useThemedStyles(makeStyles)` and `const shared = useShared()` / `const c = useTheme()`.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Then: `grep -nE "\bcolors\." "app/asset/[id].tsx" app/modals/*.tsx "app/(tabs)/settings.tsx"` → no matches.

- [ ] **Step 3: Commit**

```bash
git add "app/asset/[id].tsx" app/modals/*.tsx "app/(tabs)/settings.tsx"
git commit -m "refactor(theme): convert detail/trends/modals/settings to useThemedStyles"
```

---

### Task 7: Theme picker UI + i18n

**Files:**
- Modify: `app/(tabs)/settings.tsx`
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/zh.json`

**Interfaces:**
- Consumes: `theme`, `setTheme` from `useSettings()`; `themes`, `type ThemeName` from `utils/theme`.

- [ ] **Step 1: Add i18n strings**

In `src/i18n/locales/zh.json`, inside `settings`, add:

```json
    "theme": "主题",
    "themeHelp": "选择应用配色",
    "themeWarmSlate": "暖石板",
    "themeNordic": "极简灰",
    "themeSeaGlass": "海玻璃",
    "themeDuskBlue": "暮蓝",
    "themeSky": "天青白",
    "themeLilac": "藕荷白",
```

In `src/i18n/locales/en.json`, inside `settings`, add:

```json
    "theme": "Theme",
    "themeHelp": "Choose the app color palette",
    "themeWarmSlate": "Warm Slate",
    "themeNordic": "Nordic",
    "themeSeaGlass": "Sea Glass",
    "themeDuskBlue": "Dusk Blue",
    "themeSky": "Sky",
    "themeLilac": "Lilac",
```

- [ ] **Step 2: Add the picker section to `settings.tsx`**

Add to the destructured `useSettings()`: `theme, setTheme`. Add imports:

```ts
import { themes, type ThemeName } from '../../src/utils/theme';
```

Add a name map near the other option constants:

```ts
const THEME_LABEL_KEYS: Record<ThemeName, string> = {
  warmSlate: 'settings.themeWarmSlate',
  nordic: 'settings.themeNordic',
  seaGlass: 'settings.themeSeaGlass',
  duskBlue: 'settings.themeDuskBlue',
  sky: 'settings.themeSky',
  lilac: 'settings.themeLilac',
};
```

Insert this card after the language card (`c` is the `useTheme()` value added in Task 6):

```tsx
<View style={shared.card}>
  <Text style={styles.rowTitle}>{t('settings.theme')}</Text>
  <Text style={shared.muted}>{t('settings.themeHelp')}</Text>
  <View style={styles.themeGrid}>
    {(Object.keys(themes) as ThemeName[]).map((name) => {
      const p = themes[name];
      const active = theme === name;
      return (
        <TouchableOpacity
          key={name}
          onPress={() => setTheme(name)}
          style={[
            styles.themeSwatch,
            { backgroundColor: p.bg, borderColor: active ? p.accent : c.border },
            active && styles.themeSwatchActive,
          ]}>
          <View style={[styles.themeDot, { backgroundColor: p.accent }]}>
            {active ? <Text style={[styles.themeCheck, { color: p.onAccent }]}>{'✓'}</Text> : null}
          </View>
          <Text style={[styles.themeLabel, { color: p.ink }]}>{t(THEME_LABEL_KEYS[name])}</Text>
        </TouchableOpacity>
      );
    })}
  </View>
</View>
```

Add to `makeStyles(c)` (2×3 grid, ≥44pt targets, selected ring):

```ts
    themeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    themeSwatch: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
    themeSwatchActive: { borderWidth: 2 },
    themeDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    themeCheck: { fontSize: 13, fontWeight: '800', lineHeight: 15 },
    themeLabel: { fontSize: 14, fontWeight: '600' },
```

(Add `radius` to the `utils/theme` import in this file if not already present.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Then run the web target (`npm run web`), open Settings, and tap each of the 6 swatches — the whole app must re-theme instantly and the active swatch shows the ring + checkmark.

- [ ] **Step 4: Commit**

```bash
git add "app/(tabs)/settings.tsx" src/i18n/locales/en.json src/i18n/locales/zh.json
git commit -m "feat(settings): theme picker with 6 light palettes"
```

---

### Task 8: Remove back-compat exports + final verification

**Files:**
- Modify: `src/utils/theme.ts` (delete the back-compat `colors` object and the static `shared` export)

- [ ] **Step 1: Confirm no remaining consumers**

Run:
```bash
grep -rnE "\bcolors\b" src app --include=*.tsx --include=*.ts | grep -v "src/utils/theme.ts"
grep -rnE "[^.]\bshared\b" src app --include=*.tsx | grep -vE "useShared|const shared"
```
Expected: no output. If anything prints, convert that file with the standard pattern first, then re-run.

- [ ] **Step 2: Delete the back-compat block**

In `src/utils/theme.ts`, remove the entire `// ─── Back-compat during migration ───` section (the `colors` object and `export const shared = ...`).

- [ ] **Step 3: Type-check, lint, grep**

Run: `npx tsc --noEmit && npm run lint`
Expected: passes. Any missed conversion now fails to compile (`colors`/`shared` are gone).
Then: `grep -rnE "\bcolors\.(ink|inkSoft|muted|bg|card|border|track|accent|accentSoft|primary)\b" src app` → no matches.

- [ ] **Step 4: Manual run-through (all targets reachable from web)**

Run `npm run web`. For each of the 6 themes, confirm:
- Instant re-theme across Home / Assets / Transactions / Settings / asset detail / a modal.
- Gain/loss stays pure green/red and is visibly distinct from the accent.
- Allocation bars show distinct hues; the orange category does not read as the loss red.
- Sky and Lilac button/label text is legible (dark `onAccent`, not white).
- No screen is half-themed (background changed but text/cards did not).

- [ ] **Step 5: Commit**

```bash
git add src/utils/theme.ts
git commit -m "refactor(theme): remove back-compat colors/shared exports"
```

---

## Self-Review

**Spec coverage:**
- 6 themes + hex → Task 1 `themes` record. ✓
- `onAccent` + contrast rule → Task 1 palettes; applied in Tasks 6–7 (`c.onAccent`). ✓
- Derived `primary`/`accentSoft`/`track` via `resolveTheme` → Task 1. ✓
- `shadowColor` per theme, shape in `makeShared` → Task 1. ✓
- Shared pure red/green decoupled (`semantic`) + repointed `useSemanticColors` → Task 1. ✓
- Multi-hue `categoryPalette` with coral→orange → Task 1. ✓
- `tints` rekeyed to semantic hex → Task 1; consumed in Task 3 (ChangePill). ✓
- Context state + `useTheme`/`useThemedStyles`/`useShared` (single mechanism) → Task 2. ✓
- Module-scope `makeStyles` requirement → conversion pattern + Task 2 JSDoc. ✓
- Module-scope color refs (chart defaults, tab bar) → Tasks 4 & 5. ✓
- Settings picker derived from `themes`, 2×3 grid, selected affordance, ≥44pt → Task 7. ✓
- Remove old exports + grep/tsc/lint/manual verification → Task 8. ✓
- Adding-a-theme touch points → covered by record-driven picker (Task 7) + i18n (Task 7). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; the conversion pattern is stated once with a complete worked example and applied by explicit per-file rules (not "similar to Task N").

**Type consistency:** `ThemeName`, `ThemePalette`, `ThemeColors`, `resolveTheme`, `makeShared`, `useTheme`, `useThemedStyles`, `useShared`, `semantic`, `tints`, `categoryPalette` are used with identical names/signatures across Tasks 1–8.
