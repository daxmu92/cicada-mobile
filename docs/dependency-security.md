# Dependency review — 2026-10-09

Official npm audit after the compatible Expo SDK 54 patches reports 32 affected
package entries: 24 high, 8 moderate, no critical. This count includes transitive
parents of a vulnerable package; it is not 32 independent exploitable defects.
The earlier baseline had 53 entries and the 0.2.1 repair had 44.

Resolved compatible branches:

- Updated Expo 54, constants, file-system and updates to versions accepted by
  `expo install --check` without changing the mobile runtime policy.
- Scoped Metro-config PostCSS to the patched 8.x series.
- Scoped xcode UUID to 11.x; the xcode usage is UUID v4 and was checked against
  its real UUID generation method.
- Scoped Metro image-size to 2.x. Metro 0.83 originally passes image paths while
  image-size 2 accepts bytes. `postinstall` backports Metro's image-buffer path;
  it is idempotent and fails clearly if the upstream source changes. Production
  image export and actual browser acceptance pass with this patch.

Do not use `npm audit fix --force`: npm's proposed dependency replacement would
move this project to an incompatible older Expo version. No blanket js-yaml
major override is applied; its callers require separate compatibility review.

Some remaining latest upstream versions have no patched release in the published
advisories, including [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv),
[braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[decode-uri-component](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) and sprintf-js.
Most paths originate in Expo/Metro build tooling; the absence of a runtime path
for one dependency does not prove every alert is harmless. Avoid running build
or conversion tooling against untrusted files. Refresh the audit before release
and track upstream fixes.

A future Expo/RN upgrade should follow the
[official incremental upgrade workflow](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/),
with new mobile builds, native-module compatibility checks and device acceptance.
It is a separate migration rather than a forced transitive dependency swap.
