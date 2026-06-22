# Theme settings — switchable color palettes

**Date:** 2026-06-22
**Status:** Approved design (revised after multi-agent review), pending implementation plan

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

Define a `ThemeColors` type and a `themes` record keyed by `ThemeName`. The record
stores only the **choice points** a designer actually picks; everything derivable is
derived (see below), so there are fewer values to keep in sync.

```ts
export type ThemeName =
  | 'warmSlate' | 'nordic' | 'seaGlass' | 'duskBlue' | 'sky' | 'lilac';

// Stored per theme (the choice points):
export type ThemePalette = {
  accent: string;
  onAccent: string;   // text/icon color on top of an accent fill (button label)
  ink: string; inkSoft: string; muted: string;
  bg: string; card: string; border: string;
  shadowColor: string;
};

// Resolved at runtime = ThemePalette + derived fields:
export type ThemeColors = ThemePalette & {
  primary: string;     // = accent
  accentSoft: string;  // = accent @ ~16% alpha (selected/chip backgrounds)
  track: string;       // = border (bar/chart track)
};
```

A small `resolveTheme(p: ThemePalette): ThemeColors` fills in the derived fields
(`primary = accent`, `accentSoft = accent` at 0.16 alpha, `track = border`). Storing
them was redundant and drift-prone (review finding).

Theme palettes:

| Theme (name) | accent | onAccent | ink | inkSoft | muted | bg | card | border | shadowColor |
|---|---|---|---|---|---|---|---|---|---|
| 暖石板 `warmSlate` (default) | `#c4663a` | `#ffffff` | `#2b2b33` | `#5a564e` | `#9a9488` | `#f7f4ef` | `#ffffff` | `#ece9e2` | `#3a3530` |
| 极简灰 `nordic` | `#445162` | `#ffffff` | `#1f2933` | `#52606d` | `#9aa4ad` | `#f5f7f8` | `#ffffff` | `#e3e8ea` | `#2a3340` |
| 海玻璃 `seaGlass` | `#3f8c8a` | `#ffffff` | `#1c2b2a` | `#4b5c5a` | `#8fa3a1` | `#f2f7f6` | `#ffffff` | `#dde9e7` | `#1e3433` |
| 暮蓝 `duskBlue` | `#5a6bb0` | `#ffffff` | `#1e2233` | `#525879` | `#9499b0` | `#f5f6fb` | `#ffffff` | `#e2e5f0` | `#222a4a` |
| 天青白 `sky` | `#5b9bd5` | `#1f3346` | `#243747` | `#5b7184` | `#7f97a9` | `#f5faff` | `#ffffff` | `#e2ecf5` | `#243747` |
| 藕荷白 `lilac` | `#8470c8` | `#241f3a` | `#2b2740` | `#5f5878` | `#938aa8` | `#f9f7fe` | `#ffffff` | `#2b2740` |

**Contrast rule (review finding):** primary buttons render `onAccent` text on an
`accent` fill. The four dark-accent themes pass WCAG AA with white text. The two pale
themes (`sky`, `lilac`) keep their light accent for identity but use a **dark
`onAccent`** so button labels stay legible. Components must use `c.onAccent` for
on-accent text — **never a literal `#fff`**. (`sky`/`lilac` `muted` was also nudged
darker so labels clear AA on the near-white bg.)

### 2. Theme-independent constants (`src/utils/theme.ts`)

Shared by all themes:

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
  '#e0823f', // 橙 (was coral #e0795a — shifted toward orange so it doesn't read
             //     as the negative red #dc2626; review finding)
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
- `useTheme(): ThemeColors` — returns `resolveTheme(themes[theme])`, memoized on `theme`.
- `useThemedStyles(factory)` — the single styling hook:
  `useMemo(() => factory(useTheme()), [theme])`.
- `useShared()` — convenience = `useThemedStyles(makeShared)`, where `makeShared(c)`
  rebuilds the `shared` StyleSheet (card/heading/bigNumber/etc.) from the active
  `ThemeColors`. Not a parallel mechanism — just a pre-bound instance of the one hook.
- `useSemanticColors()` — **must change** to read from the constant `semantic`
  (decoupled from accent) instead of the old `colors.positive/negative`, which will no
  longer exist. Green/red convention via `gainColor` is otherwise unchanged. Skipping
  this update compiles but breaks at runtime.

### 4. Per-component conversion pattern

For every component whose module-level `StyleSheet.create` references colors:

```ts
// ✅ factory MUST be module-scope const — defining it inside the component
//    re-creates it every render and defeats useThemedStyles' memoization.
const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({ label: { color: c.muted, ... } });

export function MetricCard() {
  const styles = useThemedStyles(makeStyles); // stable factory → memoized per theme
  ...
}
```

`shared.card` usages become `useShared().card`. `spacing`/`radius` keep their static
imports — only color-bearing values move into the factory. `useThemedStyles` carries a
JSDoc note about the module-scope requirement.

**Module-scope color references that the hook can't reach** (review finding) — handle
explicitly, do not leave as stale `colors.*`:

- `src/components/charts/AssetLineChart.tsx` & `Sparkline.tsx`: default param
  `color = colors.primary`. Drop the default; pass the color from the parent (which has
  `useTheme()`), or default to `undefined` and resolve inside the component body.
- `app/(tabs)/_layout.tsx`: `tabBarActiveTintColor: colors.accent` lives in a
  module-scope `screenOptions`. Move the options into the component body and build them
  with `useTheme()` (memoized).

Charts otherwise take colors as props or read `useTheme()` directly; series colors come
from `categoryPalette` / `semantic` as today.

### 5. Settings UI (`app/(tabs)/settings.tsx`)

Add a **主题 / Theme** section, styled like the existing gain-color / language pickers.

- Render swatches by iterating the `themes` record (`Object.keys(themes)`), each swatch
  derived from that theme's `accent` + `bg` + i18n display name — **do not re-list hex
  values in the component** (single source of truth).
- Layout: a **2×3 grid** of swatches (6 wraps badly in one row on phones).
- **Selected state:** the active theme gets a clear affordance — a 2pt ring in its own
  `accent` plus a checkmark — matching whatever the existing pickers use.
- Tap targets ≥ 44×44pt; pressed/focus feedback on web/desktop.
- Selecting a swatch calls `setTheme(name)`; the whole app re-themes instantly.
- Add i18n strings for the section title and the 6 theme display names.

## Scope / files touched

~28 files import from `utils/theme`. The change is large but mechanical:
- `src/utils/theme.ts` — palettes, `resolveTheme`, constants, `makeShared`, types.
  **Remove the old static `colors` and `shared` exports** once migration is done, so
  stale references fail to compile instead of silently drifting (review finding).
- `src/hooks/SettingsContext.tsx` — theme state, `useTheme`/`useThemedStyles`/
  `useShared`, updated `useSemanticColors`.
- `app/(tabs)/settings.tsx` — theme picker UI + i18n.
- `app/(tabs)/_layout.tsx` — tab bar tint via `useTheme()`.
- `src/i18n/*` — theme section + 6 names.
- The remaining ~24 components/screens — convert module-level `StyleSheet.create`
  (and `shared.x` / `tints` usages) to the hook pattern. No logic changes.

### Adding a future theme (enumerated touch points)

1. `ThemeName` union + a row in the `themes` record (`src/utils/theme.ts`).
2. Display name in each i18n file (`src/i18n/*`).
3. Nothing in the settings UI (it iterates the record) and nothing in `useTheme`.
   Default theme only changes if you edit the `'warmSlate'` fallback.

## Out of scope (YAGNI)

- **Dark mode.** All six themes are light. The structure extends cleanly later (a theme
  could grow a `dark` variant, or `ThemeName` gains dark entries) — no dark assumptions
  are baked in beyond the white `card`, which a future dark theme would simply override.
- **Custom/user-defined colors.** Fixed curated set only.
- **Per-platform theme overrides.** One theme applies everywhere.

## Verification

No test runner exists. Verify with:

1. `npx tsc --noEmit` + `npm run lint` — with the old `colors`/`shared` exports removed,
   any missed conversion fails to compile.
2. Greppable completeness check — should return nothing outside `theme.ts`:
   ```bash
   grep -rE "\bcolors\.(ink|inkSoft|muted|bg|card|border|track|accent|accentSoft|primary)\b" src app
   ```
3. Run the web target and switch through all six themes, confirming: instant re-theme;
   gain/loss stays pure red/green and distinct from accent; allocation bars show
   distinct hues with orange not read as loss; sky/lilac button labels legible; and no
   screen left half-themed (background changed but text not).
