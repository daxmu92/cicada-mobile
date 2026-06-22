# Theme settings — switchable color palettes

**Date:** 2026-06-22
**Status:** Approved design, pending implementation plan

## Problem

The app ships a single hard-coded "Warm Slate" palette (terracotta accent over warm
off-white). It reads as muddy/"肉肉的" and there is no way for a user to pick a
fresher look. We want a **Theme** setting that lets the user switch between several
light palettes at runtime, instantly, on all five targets (iOS, Android, web, PWA,
Tauri desktop).

Two existing color problems get fixed in the same pass:

1. **Gain/loss colors were tied to the accent.** Warm Slate's "loss" (`#c4503f`) is
   nearly identical to its accent (`#c4663a`), so red/green didn't read as distinct
   semantic signals. Gain/loss must be a standard, pure red/green that is **shared
   across all themes** and visually distinct from any theme accent.
2. **Category palette was monochromatic.** Allocation bars used tints of one hue, so
   asset categories were hard to tell apart. Replace with one shared **multi-hue**
   palette.

## Core constraint

Every color today is baked into **module-level `StyleSheet.create({...})`** calls
(e.g. `color: colors.muted`). `StyleSheet.create` freezes its values at module load,
so mutating a shared `colors` object at runtime does **not** update already-created
styles. The only clean, cross-platform way to support live theme switching is to
generate color-bearing styles **at render time** from the active theme.

Layout tokens (`spacing`, `radius`) are theme-independent and stay as static imports.

## Approach (chosen: A — Context + `useThemedStyles`)

### 1. Palette definitions (`src/utils/theme.ts`)

Define a `ThemeColors` type and a `themes` record keyed by a `ThemeName`. Each theme
supplies the **surface/text/accent** tokens; the structure mirrors today's `colors`.

```ts
export type ThemeName =
  | 'warmSlate' | 'nordic' | 'seaGlass' | 'duskBlue' | 'sky' | 'lilac';

export type ThemeColors = {
  primary: string; accent: string; accentSoft: string;
  ink: string; inkSoft: string; muted: string;
  bg: string; card: string; border: string; track: string;
  shadow: string;
};
```

Theme tokens (accent / ink / inkSoft / muted / bg / card / border):

| Theme (name) | accent | ink | inkSoft | muted | bg | card | border |
|---|---|---|---|---|---|---|---|
| 暖石板 `warmSlate` (default) | `#c4663a` | `#2b2b33` | `#5a564e` | `#9a9488` | `#f7f4ef` | `#ffffff` | `#ece9e2` |
| 极简灰 `nordic` | `#445162` | `#1f2933` | `#52606d` | `#9aa4ad` | `#f5f7f8` | `#ffffff` | `#e3e8ea` |
| 海玻璃 `seaGlass` | `#3f8c8a` | `#1c2b2a` | `#4b5c5a` | `#8fa3a1` | `#f2f7f6` | `#ffffff` | `#dde9e7` |
| 暮蓝 `duskBlue` | `#5a6bb0` | `#1e2233` | `#525879` | `#9499b0` | `#f5f6fb` | `#ffffff` | `#e2e5f0` |
| 天青白 `sky` | `#5b9bd5` | `#243747` | `#5b7184` | `#9fb4c7` | `#f5faff` | `#ffffff` | `#e2ecf5` |
| 藕荷白 `lilac` | `#8470c8` | `#2b2740` | `#5f5878` | `#ada5c4` | `#f9f7fe` | `#ffffff` | `#e9e3f7` |

- `primary` = `accent`; `accentSoft` = `accent` at 12% alpha; `track` = `border`;
  `shadow` = a theme-appropriate dark (warm `#3a3530` for warmSlate, neutral `#2a3340`
  for the cool/pale themes — keeps card elevation from looking grey-dead on warm bg).
- The default theme's tokens are exactly today's values, so nothing visibly changes
  for an existing user until they pick a different theme.

### 2. Theme-independent constants (`src/utils/theme.ts`)

These are **not** per-theme — shared by all:

```ts
export const semantic = { positive: '#16a34a', negative: '#dc2626' };
export const tints: Record<string, string> = {
  '#16a34a': 'rgba(22,163,74,0.13)',
  '#dc2626': 'rgba(220,38,38,0.12)',
};
export const categoryPalette = [
  '#4f86c6', // 蓝
  '#e8a33d', // 金
  '#57b08a', // 青绿
  '#cc6f8e', // 玫
  '#8b7fc7', // 紫
  '#e0795a', // 珊瑚
  '#4cb1bf', // 湖蓝
  '#b0a04e', // 橄榄
];
```

`spacing` and `radius` are unchanged.

### 3. Context wiring (`src/hooks/SettingsContext.tsx`)

Extend the existing context (do **not** add a separate provider):

- State: `theme: ThemeName`, `setTheme(name): Promise<void>`. Persisted to the
  `setting` table under key `theme`; default `'warmSlate'`. Loaded in the existing
  bootstrap `useEffect` alongside currency/forwardFill/gainColor/language.
- New hook `useTheme(): ThemeColors` — returns `themes[theme]`.
- New hook `useShared()` — returns a memoized themed `shared` StyleSheet (the
  `shared.card`/`heading`/`bigNumber`/etc. currently exported from theme.ts, rebuilt
  from the active `ThemeColors`).
- `useSemanticColors()` stays as-is but now reads from the constant `semantic`
  (decoupled from accent). Its green/red convention via `gainColor` is unchanged.

### 4. Per-component conversion pattern

For every component whose module-level `StyleSheet.create` references colors:

```ts
// before
const styles = StyleSheet.create({ label: { color: colors.muted, ... } });

// after
const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({ label: { color: c.muted, ... } });
// inside component:
const styles = useThemedStyles(makeStyles);
```

`useThemedStyles(factory)` = a tiny hook in `SettingsContext` (or a new
`src/hooks/useThemedStyles.ts`) that does `useMemo(() => factory(theme), [theme])`.
`shared.card` usages become `useShared().card`. `spacing`/`radius` keep their static
imports — only color-bearing values move into the factory.

Charts (`src/components/charts/*`) take colors as props or read `useTheme()` directly;
chart series colors come from `categoryPalette` / `semantic` as today.

### 5. Settings UI (`app/(tabs)/settings.tsx`)

Add a **主题 / Theme** row, styled like the existing gain-color / language pickers: a
labelled group of 6 selectable swatches (accent dot + bg + name). Selecting one calls
`setTheme(name)`; the whole app re-themes instantly. Add i18n strings for the section
title and the 6 theme display names.

## Scope / files touched

~28 files import from `utils/theme`. The change is large but mechanical:
- `src/utils/theme.ts` — palettes, constants, `makeShared` factory, types.
- `src/hooks/SettingsContext.tsx` — theme state, `useTheme`/`useShared`/`useThemedStyles`.
- `app/(tabs)/settings.tsx` — theme picker UI + i18n.
- `src/i18n/*` — theme section + 6 names.
- The remaining ~24 components/screens — convert module-level `StyleSheet.create`
  (and `shared.x` / `tints` usages) to the hook pattern. No logic changes.

## Out of scope (YAGNI)

- **Dark mode.** All six themes are light. A dark theme can reuse this exact
  machinery later but is not part of this work.
- **Custom/user-defined colors.** Fixed curated set only.
- **Per-platform theme overrides.** One theme applies everywhere.

## Verification

No test runner exists. Verify with `npx tsc --noEmit` + `npm run lint`, then run the
web target and switch through all six themes confirming: instant re-theme, gain/loss
stays pure red/green and distinct from accent, allocation bars show distinct hues,
and no screen is left half-themed (background changed but text not).
