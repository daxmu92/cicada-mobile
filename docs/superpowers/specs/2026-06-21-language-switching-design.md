# Language Switching (i18n) — Design

**Date:** 2026-06-21
**Branch:** `worktree-feat+i18n-language-switch` (based on `origin/master`)
**Status:** Approved design — pending implementation plan

## Goal

Add a language-switching feature to CicadaFinScape Mobile supporting **English** and
**Simplified Chinese (中文)**. The app must detect the device language on first run,
let the user override it in Settings, persist the choice, and apply it live across all
UI text and locale-sensitive number/date formatting.

## Scope

- **Languages:** English (`en`) + Simplified Chinese (`zh`). Architecture stays open to
  adding more locales later (drop-in JSON files), but only these two ship now.
- **First-run default:** auto-detect via `expo-localization`; resolve to `zh` if the
  device locale is Chinese, otherwise `en`. Once the user picks a language in Settings,
  the stored choice always wins.
- **Coverage:** all ~60–80 user-facing strings across screens, modals, and components,
  plus **full locale formatting** (number grouping/decimal separators and date/month
  display follow the active locale).

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Languages | English + Simplified Chinese |
| First-run default | Auto-detect device locale, then manual override |
| Formatting depth | Full locale formatting (separators + date/month formats) |
| Library | `i18next` + `react-i18next` + `expo-localization` |

## Architecture

### Dependencies
- `i18next`, `react-i18next` — translation engine + React bindings.
- `expo-localization` — read device locale for first-run detection.
- Native `Intl` polyfills (`@formatjs/intl-locale`, `@formatjs/intl-numberformat`,
  `@formatjs/intl-datetimeformat` + locale data) **only if** Hermes on Android proves
  to lack adequate locale data (see Risks). Web/PWA/Tauri use the browser's native `Intl`.

### Initialization
- Create `src/i18n/index.ts` that configures and initializes i18next with the `en`/`zh`
  resource bundles, a fallback language of `en`, and i18next's `Intl`-backed `format`
  function for interpolated numbers/dates.
- Initialize i18next once at app startup in `app/_layout.tsx`, before app content renders.
- The active language is driven by the `language` setting (below). On startup, the
  initial language is the stored setting if present, else the auto-detected device locale.

### Settings integration
`language` becomes a new value in `SettingsContext`, mirroring the existing
`currency`/`gainColor` pattern exactly:
1. Default constant + `DEFAULT_LANGUAGE` resolution (device-detected on first run).
2. Field on `SettingsContextValue`: `language: 'en' | 'zh'` and `setLanguage(lang)`.
3. Load from `setting` table via `getSetting('language')` in the loader `useEffect`.
4. `setLanguage` persists via `setSetting('language', lang)` **and** calls
   `i18next.changeLanguage(lang)` so the UI updates live.
5. Expose through the Provider value.

### Translations
- `src/i18n/locales/en.json` and `src/i18n/locales/zh.json`, organized by section
  namespace: `common.*`, `home.*`, `assets.*`, `transactions.*`, `settings.*`,
  `modals.*` (and per-modal sub-keys as needed).
- All hardcoded strings in `app/` and `src/components/` are extracted to keys and
  replaced with `t('key')` via the `useTranslation()` hook (or `i18next.t` in
  non-component modules such as dialog helpers).
- Chinese translations are drafted with finance-appropriate terminology; **user review
  of the `zh.json` content is an explicit part of the work.**

### Locale-sensitive formatting (full)
- `src/utils/format.ts`: replace the hand-rolled thousands/decimal separators with
  `Intl.NumberFormat(locale, …)`. The user-configured **currency symbol stays
  user-controlled** and is prepended; only grouping/decimal separators follow the locale.
  The signed/compact variants keep their existing arrow/compact behavior.
- `src/utils/date.ts`: replace the hardcoded English `MONTH_NAMES` with locale-aware
  month/date display via `Intl.DateTimeFormat`. **Storage keys are unchanged** — the
  `"YYYY-MM"` (snapshot) and `"YYYY-MM-DD"` (transaction) string keys stay ISO; only the
  displayed labels are localized.
- The active locale flows from the `language` setting (read where these utilities are
  consumed, e.g. via the `useFormat()` hook / a locale accessor).

### Settings UI
- Add a "Language" card to `app/(tabs)/settings.tsx` using the existing chip-button
  pattern (as used for currency), with options **English** and **中文**.
- Selecting an option calls `setLanguage(...)`. Because `useTranslation()` subscribes
  components to language changes, screens re-render immediately.

### Re-render behavior
- `react-i18next`'s `useTranslation()` hook drives live re-renders on language change.
- Screens already reload data on focus (`useFocusEffect`); no data-layer changes needed.

## Components / units

| Unit | Responsibility | Depends on |
|------|----------------|------------|
| `src/i18n/index.ts` | Configure & init i18next; expose `t` / instance | i18next, locale JSON, expo-localization |
| `src/i18n/locales/{en,zh}.json` | Translation key → string maps | — |
| `SettingsContext` (`language`, `setLanguage`) | Persist & broadcast active language | setting-repo, i18n instance |
| `src/utils/format.ts` | Locale-aware number/currency formatting | active locale, `Intl` |
| `src/utils/date.ts` | Locale-aware month/date display | active locale, `Intl` |
| Settings "Language" card | UI to choose language | SettingsContext |
| Screens/modals/components | Render via `t('key')` | i18n |

## Risks & notes
- **Native `Intl` locale data:** Hermes supports `Intl` but Android has historically
  shipped limited locale data. Verify number grouping and localized month names on a
  real Android target; add the `@formatjs/intl-*` polyfills + locale data if results are
  wrong. Web/PWA/Tauri rely on native browser `Intl` (no polyfill needed).
- **Translation completeness** is the bulk of the effort; tracked via the JSON key
  inventory. Missing keys fall back to `en` (i18next `fallbackLng`).
- **No test suite** in this repo. Verify with `npx tsc --noEmit` + `npm run lint`, and by
  running the relevant platform (web for quick iteration; an Android target for the
  `Intl` risk above).

## Out of scope
- Languages beyond `en`/`zh` (infrastructure allows them later).
- Localizing data the user enters (account/asset names, categories).
- Right-to-left layout support (not needed for `en`/`zh`).
