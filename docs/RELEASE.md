# Build & Release runbook

How to build *Exactly 67* and ship it to the **App Store** (and, later, **Google
Play**): the four ad targets and the gates that enforce them, the Xcode guard, the
fastlane lanes with their upload ledger and privacy gate, the pre-release checklist,
the two-build release step by step, version numbers, and the App Store Connect
submission. For the *store-listing* side (copy, in-app purchases, App
Privacy, Play's App content answers) see [`store/STORE_LISTING.md`](../store/STORE_LISTING.md)
(the copy itself lives in `ios/App/fastlane/metadata/`) and
[`store/PLAY_LISTING.md`](../store/PLAY_LISTING.md); for the ad policy, consent and
the LevelPlay dashboard see [`MONETIZATION.md`](MONETIZATION.md).

> ### ⛔ Read this first
> The game serves ads through **Unity LevelPlay**, which has **no test inventory**.
> Every build that loads ads (`ADS:on`, the `test` target included) serves **real
> ads**, and there is no badge, device pin or flag that makes one safe to tap.
> **Never tap an ad, on any build, on any phone.** The only build with nothing to
> tap is the ads-off build (`ADS:off`).
>
> Google closed AdMob publisher account `pub-3307486877162157` on 2026-08-18 after
> real-ads builds reached TestFlight and the owner tapped his own ads. Every rule
> below exists so that cannot happen again.

---

## Prerequisites

| Tool | Version / note |
|---|---|
| **Node** | **≥ 22** for the Capacitor CLI (`cap sync`). Declared in `package.json` `engines` (npm only warns); no `.nvmrc`. Use `nvm use 22`, or prefix commands with `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`. |
| **npm install** | Runs the three `postinstall` patches on `capacitor-levelplay-ads` (pinned exactly `0.1.42`). They **must** apply: without the SPM patch the iOS build links no LevelPlay SDK and silently serves nothing. Each exits 1 on a different plugin version or an unexpected file shape — fix that, never bypass it. iOS resolves Capacitor plugins as SPM packages that `path:`-reference `node_modules/`, so deleting `node_modules` breaks the Xcode build until `npm install` runs again. |
| **Xcode** | 26.x. The App target's first build phase is the **Ad-mode guard** (below). The App target links with **`OTHER_LDFLAGS = -ObjC`** (Debug and Release) — keep it: without it the linker strips the Unity Ads SDK/adapter classes and categories LevelPlay loads by name, and the SDK crashed at `initialize()` (KVIZKO BUG-9). It also sets **`ENABLE_USER_SCRIPT_SANDBOXING = NO`** (Debug and Release): the guard reads files that are not declared inputs, and with sandboxing on every build fails with "Sandbox: bash deny file-read-data". Decline Xcode's "Update to recommended settings" for it, and never delete the guard phase to get past that error. |
| **SPM pins** | `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` holds LevelPlay **9.6.0**, UnityAds adapter **5.11.0**, Unity Ads **4.20.0** and Unity Ad Quality **9.9.0** (transitive) — KVIZKO's App-Store-proven graph. The patched plugin manifest only says `from:`, so the committed `Package.resolved` is the pin: never "Update to Latest Package Versions" or delete it. `check-native-sync.mjs` refuses any other version, and the archive passes `disable_package_automatic_updates`, so a drifted graph fails instead of shipping. Bumping is a deliberate change that starts in `scripts/lib/levelplay-versions.mjs`, then `npm install`, `xcodebuild -resolvePackageDependencies`, and a check that `Package.resolved` landed on **exactly** the new numbers (because the manifest says `from:`, a re-resolve can pick a newer compatible version, which the gate then refuses), then commit it. |
| **fastlane** | On `PATH` (`/opt/homebrew/bin/fastlane`). Run lanes from `ios/App/`. **No Gemfile** — call `fastlane <lane>` directly, *not* `bundle exec`. The lanes run Node gates (`check-levelplay-config`, `check-native-sync`) and find Node through `NODE_BINARY`, then `~/.nvm/versions/node/v22.23.2/bin/node`, then `PATH`; a missing Node is a refusal. Live uploads and `submit` fetch the published privacy page, so they need a network. |
| **JDK** | For the Android Gradle build. Use Android Studio's bundled JBR: `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`. |

**Never commit** App Store keys (`*.p8`, `AuthKey_*.p8`, `ios/App/fastlane/keys/`,
`asc_api_key.json`) or the Android signing keystore (`android/keystore/*.jks`,
`android/keystore.properties`) — all gitignored.

---

## Version numbers — where they live

| Platform | Marketing version | Build number | Files |
|---|---|---|---|
| **iOS** | `1.2.1` | `27` | `ios/App/App.xcodeproj/project.pbxproj` only — `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION`, **two occurrences each** (the App target's Debug and Release configs). `ios/App/App/Info.plist` reads them as `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)`; never put literal numbers back there. |
| **Android** | `versionName "1.2.0"` | `versionCode 2` | `android/app/build.gradle` |

- **iOS:** every upload needs a **unique build number**, even for the same marketing
  version. A release is two uploads, so it uses **two** build numbers (N and N+1).
- **Why `Info.plist` holds no numbers.** `cap sync` rewrites `Info.plist` and drops its
  comments, and the fix is `git checkout ios/App/App/Info.plist`. While the file held
  literal numbers, that checkout silently threw away an uncommitted bump, so the ads-off
  N+1 archive still said N, bounced as a duplicate, and left the real-ads N newest on
  TestFlight. With the variables the checkout is always safe, and the sync hook keeps
  them as they are.
- The fastlane live preflight (`release`, `build_and_upload`) reads the same two
  settings from `project.pbxproj` before archiving. If the Debug and Release values
  disagree it cannot tell a retry of the same build from a new one; the ledger check
  on the finished `.ipa` is the one that decides. Keep them equal.
- **Android:** Play requires a higher `versionCode` per upload.

---

## The four ad targets

Three build-time variables are folded by Vite into literal **markers** in the JS
bundle, and every gate counts them as plain substrings:

| Variable | Marker | Where it is folded |
|---|---|---|
| `VITE_AD_MODE=live` / anything else | `ADMODE:live` / `ADMODE:test` | `providers/levelplay.ts` (`AD_MODE_MARKER`, on the provider's `id`) |
| `VITE_ADS=off` / `mock` / anything else | `ADS:off` / `ADS:mock` / `ADS:on` | `adProvider.ts` (`ADS_MARKER`, on the provider's `id`) |
| `VITE_UNLOCK_ALL=1` / anything else | `UNLOCKALL:1` / *absent* | `buildFlags.ts` (`stampBuildFlags()` → `<html data-build-flags>`) |

The ad mode **fails safe**: only the literal `live` declares an App Store build. A
typo, a stray `vite build` or an Xcode archive of a stale bundle yields
`ADMODE:test`, which the `live` gate refuses.

Each target states an exact count for every marker:

| Target | ADMODE | ADS | UNLOCKALL:1 | Built by | What it is | Uploaded? |
|---|---|---|---|---|---|---|
| **`live`** | `live` ×1 | `on` ×1 | ×0 | `build:live` → `ios:appstore` | App Store build **N**. **Real ads.** Also needs real LevelPlay ids (`check-levelplay-config ios`, checked before the build). | Yes — as build N only |
| **`off`** | `test` ×1 | `off` ×1 | ×0 or ×1 | `build:adsoff` → `ios:sync`; `build:tf` → `ios:testflight` | The ad layer never starts: no consent prompt, no ATT, no banner strip, the hint video grants without an ad. The TestFlight follow-up **N+1** (with all levels unlocked) and the everyday dev default. | Yes — TestFlight |
| **`mock`** | `test` ×1 | `mock` ×1 | ×0 or ×1 | `dev:mock`, `build:mock` → `ios:sync:mock` | Fake ads we draw in the DOM. Tests *our* ad flow; zero network. | **Never** — Run only |
| **`test`** | `test` ×1 | `on` ×1 | ×0 or ×1 | `build:test` → `ios:sync:test` | The real waterfall with `isTesting` (which only unlocks Unity's Test Suite). Dev integration only, as an Xcode Run with `AD_TARGET=test` stated. **Real ads.** | **Never** — not archived either |

Every target also refuses `TESTSUITE:1` / `ADIDCAPTURE:1` (boot-mode markers from the
portfolio; Exactly 67 has neither), a missing or doubled `ADMODE` / `ADS` marker (a
bundle from before the migration, or a stale chunk beside a fresh one), and
`UNLOCKALL:1` more than once. There is deliberately **no** fallback that classifies a
marker-less bundle by AdMob ids: every AdMob-era bundle of this app carries the
terminated publisher's ids, so no target may accept one.

---

## npm scripts

| Script | Command | Does |
|---|---|---|
| `dev` | `vite` | Browser dev server. No ad surface in a browser. |
| `dev:mock` | `VITE_ADS=mock vite` | Browser dev server with fake ads. |
| `test` / `test:watch` | `vitest run` / `vitest` | Logic, the level gate, the ad policy + provider suites. |
| `build` | `tsc --noEmit && vitest run && vite build` | **Hard content gate** → `dist/`. On its own it produces an `ADMODE:test` + `ADS:on` bundle; the release chains below wrap it. |
| `build:adsoff` | `VITE_ADS=off npm run build && node scripts/check-ad-mode.mjs off` | Ads-off bundle, gated `off`. |
| `build:tf` | `VITE_ADS=off VITE_UNLOCK_ALL=1 npm run build && node scripts/check-ad-mode.mjs off` | Ads-off + every level unlocked, gated `off`. |
| `build:live` | `node scripts/check-levelplay-config.mjs ios && VITE_AD_MODE=live npm run build && node scripts/check-ad-mode.mjs live` | The ids first, then the live bundle, gated `live`. Because the id check runs *before* anything is built, a failed check leaves no live bundle in `dist/`. A successful run does — see [Leave the tree safe](#5-leave-the-tree-safe). |
| `build:mock` | `VITE_ADS=mock npm run build && node scripts/check-ad-mode.mjs mock` | Fake-ads bundle, gated `mock`. |
| `build:test` | `npm run build && node scripts/check-ad-mode.mjs test` | Real-waterfall bundle, gated `test`. |
| `ios:sync` | `build:adsoff` → `check-no-google` → `cap sync ios` → `check-native-sync ios off` | The everyday sync. **Ads off.** |
| `ios:testflight` | `build:tf` → `check-no-google` → `cap sync ios` → `check-native-sync ios off` | Build **N+1**. |
| `ios:appstore` | `build:live` → `check-no-google` → `cap sync ios` → `check-native-sync ios live` | Build **N**. The only real-ads App Store chain. |
| `ios:sync:mock` | `build:mock` → … → `check-native-sync ios mock` | Fake ads on a device or simulator. |
| `ios:sync:test` | `build:test` → … → `check-native-sync ios test` | The real waterfall on a device, for integration, as an Xcode Run with `AD_TARGET=test` stated (the guard refuses it otherwise, and always refuses to archive it). Look, never tap, never upload. |
| `ads:check` | `node scripts/check-ad-mode.mjs` | Gate #1 by hand: `npm run ads:check -- live` (optional second arg: a directory). |
| `ads:nogoogle` | `node scripts/check-no-google.mjs` | Gate #2 by hand (`--strict` also fails on the dead publisher id in prose). |
| `ads:config` | `node scripts/check-levelplay-config.mjs` | Gate #3 by hand: `npm run ads:config -- ios`. |
| `postinstall` | the three `patch-levelplay-*` scripts | Automatic after `npm install`. |
| `capacitor:sync:after` | `levelplay-manifest.js` from the plugin | Automatic inside `cap sync`. |
| `ios:open` | `cap open ios` | Open the Xcode project. |

There are **no Android sync or release chains yet** — see [Android](#android-release).

---

## The gates, in the order they run

1. **`scripts/check-levelplay-config.mjs ios`** — `build:live` only, and **first**,
   before `vite build`, so a refusal leaves no live bundle behind. Parses
   `src/services/providers/levelplay.ts`: the iOS app key must match
   `/^[0-9a-f]{9}$/`, the banner / interstitial / rewarded ids `/^[a-z0-9]{16}$/`,
   the three ids must differ, none may equal the Android value, and none may be one
   of KVIZKO's ids. Values must be plain string literals. Passes since 2026-09-16
   (app key `282af3d55`); `android` fails, because Android has no LevelPlay app.
2. **`scripts/check-ad-mode.mjs <target> [dir]`** — counts the markers in
   `dist/assets` (JS, HTML, JSON) against the target table. Exit 2 on usage, 1 on a
   mismatch, so it aborts an `&&` chain.
3. **`scripts/check-no-google.mjs`** — *is Google in the build at all?* Fails on: a
   Google network in `levelplay.networks` or a `levelplay.admob` block; an AdMob
   dependency, or `@capacitor-community/admob` still in `node_modules`; an AdMob
   adapter in the patched plugin `Package.swift`; `GADApplicationIdentifier` or
   AdMob's SKAdNetwork id in `Info.plist`; AdMob config in `capacitor.config.ts`; the
   AdMob app id in `AndroidManifest.xml` or AdMob in the Android Gradle files; the
   dead publisher id or any `ca-app-pub-` id in a non-prose file (Markdown and
   `marketing/` are exempt; `docs/*.html` is **not**, it is the public site); and
   those ids in `dist/assets`. Files `cap sync` generates are only *noted* here,
   because before the sync they still hold the previous build.
4. **`cap sync ios`** — copies `dist/` into `ios/App/App/public`, regenerates
   `CapApp-SPM/Package.swift`, and runs the `capacitor:sync:after` hook, which writes
   the ATT string, SKAdNetwork ids and `LevelPlayCMPProvider` into `Info.plist` **and
   drops the file's comments**. Run `git checkout ios/App/App/Info.plist` afterwards
   (safe at any time: the file holds no version numbers) and treat any other diff
   there — a new SKAdNetwork id, say — as something the hook added.
5. **`scripts/check-native-sync.mjs ios <target>`** — after the sync: the markers in
   `ios/App/App/public/assets` match the target; the native JS file names match
   `dist/` exactly (nothing missing, nothing stale); the generated files carry no
   Google surface; `CapApp-SPM/Package.swift` links `CapacitorLevelplayAds`; and
   `Package.resolved` (parsed as JSON) pins **exactly** the versions in
   `scripts/lib/levelplay-versions.mjs`: `levelplay-swift-package` 9.6.0,
   `levelplay-unityads-adapter-swift-package` 5.11.0, `unity-ads-swift-package` 4.20.0
   and `unity-ad-quality-swift-package` 9.9.0. That holds for **every** iOS target —
   live, off, mock and test — because every binary links the SDK (`VITE_ADS` only
   decides whether the JavaScript starts it), and a graph that drifted in build N+1
   would still be in the tree when the next build N is archived. A missing file,
   unparseable JSON, a branch pin, a missing pin or a different version all fail with
   what was expected and what was found. The fix is `git checkout` of the committed
   `Package.resolved`, never "Update to Latest Package Versions".
6. **The Xcode Ad-mode guard** — see below.
7. **fastlane** — every lane that builds or uploads requires `AD_TARGET` and re-checks
   the bundle; uploads are recorded in the ledger and live ones pass the privacy gate;
   see below.

A green gate proves **which** build it is. It is never permission to tap an ad.

---

## The Xcode Ad-mode guard

`ios/App/ad-mode-guard.sh` is the **first build phase of the App target** ("Ad-mode
guard"), so it runs on every Run, Archive, `xcodebuild` and fastlane build. It closes
the gap the npm chains cannot: Product → Archive, hours later, compiles whatever sits
in `App/public`. It reads the same `App/public/assets/*.js` as `check-native-sync`.

Set the intent in `AD_TARGET` (environment — `AD_TARGET=test npx cap run ios` — or
`xcodebuild … AD_TARGET=live`, or a local user-defined build setting in Xcode that is
never committed; the fastlane lanes pass it for you): `live`, `off`, `test`, or unset
for an ordinary Run of the ads-off (or mock) dev bundle.

It refuses to build when:
- `App/capacitor.config.json` carries a `server.url` key, even an empty one — the
  leftover of `npx cap run ios -l` when its terminal is closed instead of Ctrl+C'd. The
  app would load that dev server (whose default bundle is `ADS:on`) instead of the
  `App/public` bundle proven here, and an archive would ship a LAN address. A file
  `plutil` cannot parse fails if it mentions `"url"` at all. **Live reload therefore
  no longer builds**; re-run an npm sync chain, which rewrites the file;
- `App/public` is missing, holds no JS, or carries any `ca-app-pub-` id (an AdMob-era
  bundle);
- an `ADMODE` or `ADS` marker is missing or doubled, or `UNLOCKALL:1` appears twice
  (counted with `grep -a`, so a NUL byte cannot fold a doubled marker into one match);
- the bundle is `ADMODE:live` without `AD_TARGET=live`, or `ADMODE:live` with
  `ADS:off` / `ADS:mock`;
- `UNLOCKALL:1` meets a live bundle or `AD_TARGET=live` — on Run as well as Archive;
- `ADS:mock` is archived, or built under any stated `AD_TARGET`;
- `AD_TARGET=live` meets a test bundle; `AD_TARGET=live` or `test` meets `ADS:off`;
  `AD_TARGET=off` meets anything but `ADS:off`;
- an `ADS:on` **test** bundle is built without an explicit `AD_TARGET=test` — a plain
  `npm run build` bakes exactly that bundle, and `npx cap run ios` hides Xcode's
  warnings, so a warning would never be read;
- an `ADS:on` test bundle is **archived**, whatever `AD_TARGET` says: an archive sits
  in Organizer one "Distribute App" click from TestFlight;
- `AD_TARGET` is anything other than empty, `live`, `off` or `test`.

It does not check the LevelPlay ids (Xcode's build `PATH` has no nvm `node`); the
fastlane `live` lanes do. Its rules were checked on 2026-09-16 against a 210-case
truth table of markers × `AD_TARGET` × Run/Archive, with no mismatches.

---

## fastlane lanes (`ios/App/fastlane/Fastfile`)

| Lane | Needs | Does |
|---|---|---|
| `ad_gate` | `AD_TARGET` = `live` / `off` | The archive's checks on their own — `capacitor.config.json` (`server.url`), the `App/public` markers, the LevelPlay ids for `live`, and `check-native-sync` — building nothing and contacting nobody. **Refuses `test`.** The privacy page and the ledger are the upload lanes' checks, not this one's. |
| `archive` | `AD_TARGET` = `live` / `off` | Gate (as `ad_gate`) → automatic signing → Release archive + app-store export to `ios/App/build/Exactly67.ipa`, passing `AD_TARGET` into the Xcode guard and `disable_package_automatic_updates` to xcodebuild → gate on the `.ipa` (markers, `server.url` in its `capacitor.config.json`, ids for `live`). **Refuses `test`**: an app-store export of the real waterfall is uploadable from Organizer, Transporter or altool, none of which run a gate. Dev integration is `npm run ios:sync:test` plus an Xcode Run with `AD_TARGET=test`. |
| `build_only` | same | Same as `archive` (old name). |
| `upload_testflight` | `AD_TARGET` = `live` / `off` | Checks the `.ipa` matches, reads its version and build, and for `live` runs the **privacy gate** and the **consecutive-live check**; then uploads with `skip_submission`, without waiting for processing, and **records the upload in the ledger**. **Refuses `test`.** After a `live` upload it prints the N+1 instructions. |
| `build_and_upload` | `AD_TARGET` = `live` / `off` | `archive` + `upload_testflight` in one go. For `live` the privacy gate and the consecutive-live check run **before** the archive (on the `project.pbxproj` numbers) and the ledger check again on the `.ipa`. Recorded. |
| `tf_upload_only` | `AD_TARGET` = `live` / `off` | Upload the existing `.ipa` and **wait** for processing (diagnostic). Same checks as `upload_testflight`; recorded. |
| `submit` | `APP_VERSION`, `BUILD_NUMBER` | **Refuses unless the ledger records `BUILD_NUMBER` of `APP_VERSION` as live only, and a later ads-off upload of the same version with a higher build number.** Then the privacy gate, then attach the processed build, push the metadata and submit for review, manual release. |
| `ledger` | — | Print the upload ledger, oldest first, and say whether the newest upload is live. Local; contacts nobody. |
| `prep_version` | `APP_VERSION` | Create/stage the version and push metadata only, with **manual release** set, so a version submitted later from the ASC UI does not go on sale the moment it is approved. |
| `release` | `AD_TARGET=live` | Privacy gate + consecutive-live check (before the archive) → app record → live archive → ledger check on the `.ipa` → upload + metadata + screenshots → submit (manual release). Recorded. |
| `finish` | `AD_TARGET=live` | `.ipa` check → privacy gate + consecutive-live check → upload the existing live `.ipa` + metadata + screenshots → submit (manual release). Recorded. |
| `metadata` | — | Push listing text and screenshots only, with manual release set (same reason as `prep_version`). |
| `screenshots` | — | Push screenshots only (`overwrite_screenshots`). |
| `tf_latest` | `APP_VERSION` | Latest TestFlight build number for that version. |
| `tf_builds` / `asc_versions` | — | Recent builds with processing state / version records. |
| `create_app` | — | Verify auth and create the App Store Connect record. |

`release`, `finish`, `submit`, `prep_version` and `metadata` all set **manual release**
(`automatic_release: false`): an approved build waits for the owner to press Release.
`SUBMISSION_INFORMATION` declares that the app uses the advertising identifier to serve
ads (LevelPlay).

Note that `archive` always writes the **same** `.ipa` path: upload build N before
archiving N+1.

These lanes were exercised on 2026-09-16 by loading the real `Fastfile` in a harness
with every Apple-facing action stubbed (46 of 46 outcomes as expected, the real ledger
untouched), plus real `fastlane ad_gate` runs for `off` (passes), `test`, `live` against
an ads-off bundle, and unset (each refused).

### The upload ledger

The ad-mode gate proves what **one** binary is. The two-build rule is about the
**order** of binaries, and App Store Connect keeps no copy of the web bundle to check:
after both uploads, builds N and N+1 of the same version look alike in the build picker.
Pick N+1 and the version ships with no ads and every level unlocked; re-run the live
upload from shell history instead of the ads-off one and a second real-ads build sits
newest on TestFlight.

So every successful upload lane appends what it verified inside the `.ipa` —
`{version, build, mode: live|off, at}` — to **`ios/App/build/ad-ledger.json`** (one JSON
array, oldest first, written atomically, gitignored through `ios/.gitignore`). Then:

- **A live upload refuses while the newest entry is live** (no ads-off build has
  followed it). Re-uploading the *same* version and build number is allowed, because
  App Store Connect holds one build per number. `ALLOW_CONSECUTIVE_LIVE=1` overrides,
  with a loud banner — only for a live build that never reached App Store Connect or
  failed processing.
- **`submit` refuses** unless `BUILD_NUMBER` is recorded for `APP_VERSION` as live and
  only live, and an ads-off upload of the same version with a numerically higher build
  number was recorded after it.
- A **live** upload whose lane raises is recorded anyway (`"upload": "raised"`): deliver
  uploads the binary before its metadata, precheck and submit steps, so a later failure
  can still leave real ads on TestFlight. Check with `fastlane tf_builds`. An **ads-off**
  upload that raises is not recorded, because an ads-off entry is what lets `submit`
  through.
- A corrupt ledger, or an entry with an unknown mode, is a refusal — repair it by hand
  (`fastlane tf_builds` lists what App Store Connect holds), never delete it.

Limits worth knowing:
- The ledger is **per machine** and lives in `ios/App/build`, a folder that looks
  disposable (it is also the gym output directory). Never delete it while a release is
  open. Without it `submit` refuses (fails closed), but the consecutive-live check only
  warns that nothing proves the previous upload was ads-off (fails open).
- It starts empty: build 28 is the first upload it will record. Anything uploaded
  before it existed — earlier 1.2.1 builds included — is not in it, cannot be submitted
  through `submit`, and is covered only by checking TestFlight and expiring whatever
  still serves ads.
- **The App Store Connect UI path is not guarded.** When a release is submitted from the
  UI (a first-time IAP forces that — see [Submit](#3-submit-build-n)), run
  `fastlane ledger` first and select the build it records as live, with an ads-off build
  after it.

### The privacy gate

The live build's consent modal ("Ads and your data" → *Privacy policy*), the listing's
`privacy_url.txt` and App Review all send people to
<https://noqyris.github.io/exactly-67/privacy.html>, which GitHub Pages serves from
`main` `/docs` — **not** from the release branch. Until the rewritten `docs/privacy.html`
is merged and deployed, that page still describes Google AdMob and never names Unity
LevelPlay: a false third-party disclosure behind the consent the modal collects.

So every **live** upload (`upload_testflight`, `tf_upload_only`, `build_and_upload`,
`release`, `finish`) and `submit` fetch the published page (following redirects, with
timeouts) and refuse unless it answers HTTP 200, contains `LevelPlay`, and no longer
matches `/AdMob/i`. A network error is a refusal too. `SKIP_PRIVACY_CHECK=1` skips the
check behind a loud banner — only after reading the page yourself. **As of 2026-09-16 the
published page still names AdMob, so every live upload refuses** until `docs/privacy.html`
(and `docs/index.html`) reach `main`; the working-tree `docs/privacy.html` passes.

---

## iOS release — the two-build release

App Store Connect makes every processed build the **newest build on TestFlight**, and
TestFlight offers the newest build first; the internal group's
`hasAccessToAllBuilds` cannot be turned off. A live App Store upload is therefore a
real-ads binary on the owner's phone unless something newer and ad-free follows it at
once. **A real-ads upload is half a release.**

### 0. Before you start — the pre-release checklist
Every item is a precondition for build N, not homework for after it.

- **The privacy policy and support page are published.** Merge `docs/privacy.html`
  **and** `docs/index.html` to `main` — GitHub Pages serves `main` `/docs`, not the
  release branch — wait for Pages to redeploy, and read both live pages:
  `https://noqyris.github.io/exactly-67/privacy.html` must name Unity LevelPlay and not
  AdMob (the [privacy gate](#the-privacy-gate) refuses every live upload until it does),
  and `https://noqyris.github.io/exactly-67/` must no longer say "72 handcrafted levels"
  or "no ads, no tracking" (no gate checks the index page). Do this **before** the live
  upload.
- **Unity Ad Controls fit a 4+ app** (App Store guideline 2.5.18: ads must be
  appropriate for the app's age rating). In the Unity dashboard, Monetization → Ad
  controls → app *Exactly 67: Number Puzzle* → **Age Settings** → Apple App Store: a
  dashboard screenshot from 2026-09-16 shows it changed from *Show all ads* to **Do not
  show ads rated 13+**. The choices are 17+ / 13+ / 9+ / 5+; decide whether a 4+ app
  should go stricter, and confirm the saved value before the live upload. That page
  offers no category filter (its tabs are Ad Review, Advertiser Blocking by store id or
  domain, and Age Settings); if the LevelPlay dashboard offers category blocking for the
  app, block gambling/casino, dating and mature categories there, and block individual
  advertisers under Advertiser Blocking when Ad Review shows one.
- **The $4.99 IAP's App Store Connect name says what it delivers.** StoreKit's purchase
  sheet and the player's purchase history show the ASC display name, not the in-app
  label. `com.noqyris.exactly67.removeads` sells as *Unlimited hints · and no ads,
  forever* in the Store, but its display name was last recorded as **"Remove Ads"**, next
  to the new $0.99 **"No Ads"**. In ASC → In-App Purchases → `removeads` → en-US
  localization, rename it (e.g. *Unlimited Hints + No Ads*) and rewrite its description
  (e.g. *Unlimited hints, and no banner or between-level ads, forever.*). While there,
  make `noads`'s description match what it does: it removes the banner and the ads
  between levels, and the optional hint videos stay. Submit the IAP changes with the
  version, and record the names in
  [`store/STORE_LISTING.md`](../store/STORE_LISTING.md#in-app-purchases-app-store-connect-ui).
- **Screenshots are re-captured.** The set in `ios/App/fastlane/screenshots/en-US/`
  dates from the 72-level build: the map chip reads `83/216` (now `/1800`) and the win
  card has no Share button, while the description advertises 600 levels, sharing and the
  Daily Challenge. Re-capture iPhone 6.9" and iPad 13" from an **ads-off** build
  (`npm run ios:sync`, or the web dev server at the right viewport — never an `ADS:on`
  build), showing the 1800-star chip, the win card with Share and ideally the Daily
  Challenge, then push them with `fastlane screenshots`. The ASC UI path and `submit`
  never upload screenshots; only `screenshots`, `metadata`, `release` and `finish` do.
- The LevelPlay iOS app, its three ad units and the Unity Ads network exist (since
  2026-09-16), and their ids are in `providers/levelplay.ts`:
  `npm run ads:config -- ios` exits 0.
- `Package.resolved` still pins LevelPlay 9.6.0 / UnityAds adapter 5.11.0 / Unity Ads
  4.20.0 / Ad Quality 9.9.0, and the App target still links with `-ObjC` and has
  `ENABLE_USER_SCRIPT_SANDBOXING = NO` (see [Prerequisites](#prerequisites)).
- `npm run build` is green; the working tree is committed on the release branch.
- `cd ios/App && fastlane ledger` — know what this machine has recorded, and that the
  newest upload (if any) is ads-off.
- Any first-time IAP in this release has its App Review screenshot (see
  [Submit](#3-submit-build-n)).

### 1. Build N — real ads
```bash
# bump the build number to N in project.pbxproj (both configs), commit
npm run ios:appstore                      # gates: live, no-google, native-sync live
git checkout ios/App/App/Info.plist       # restore the comments cap sync dropped
cd ios/App
AD_TARGET=live fastlane archive           # guard + gate + ids + native-sync + .ipa check
# say out loud: "build N carries REAL ads"
AD_TARGET=live fastlane upload_testflight # privacy gate + ledger check, then recorded LIVE
```
Do **not** open TestFlight now.

### 2. Build N+1 — ads off, immediately
```bash
# bump the build number to N+1 in project.pbxproj (both configs), commit
npm run ios:testflight                    # gates: off (ADS:off + UNLOCKALL:1)
git checkout ios/App/App/Info.plist
cd ios/App
AD_TARGET=off fastlane archive
AD_TARGET=off fastlane upload_testflight  # recorded OFF: this is what unlocks submit
fastlane ledger                           # newest upload: ads-off
```
Minutes, not hours: the gap between the two uploads is exactly when the owner opens
TestFlight to look at the new version. Never end a session between step 1 and step 2.
N+1 is **ads off**, never the `test` target — `test` serves the real waterfall under a
reassuring name. N+1 also unlocks every level, which is what testers want and why it
must never be the build submitted for review.

**Verify both landed** (do not trust a piped exit code):
```bash
APP_VERSION=1.2.1 fastlane tf_latest     # → N+1
fastlane tf_builds                        # both, with processing state
```
> ⚠️ `fastlane … 2>&1 | tail -40` truncates the output *and* `$?` reports `tail`'s
> exit code. This shell is **zsh**: use `${pipestatus[1]}`, not `${PIPESTATUS[0]}`.

### 3. Submit build N
ASC uses the **unified "review submission"** model: the version **and** any first-time
IAP must be in **one** submission. 1.2.1 introduces the No ads product and the hint
packs, so use the App Store Connect UI unless they are already approved. The UI has no
ledger check, so start from the ledger:

0. `cd ios/App && fastlane ledger` — note the build recorded **LIVE** for this version,
   with a higher ads-off build recorded after it. That live build is N.
1. Version page → select build **N** (never N+1) → Save.
2. Version page → **Version Release** → **Manually release this version** → Save
   (`prep_version` and `metadata` set this too, but check it: an automatic release goes
   on sale the moment it is approved).
3. **Add for Review** on the version → creates a draft submission.
4. On each first-time IAP → **Add for Review** → pick the **existing draft**.
5. App Review → Drafts → confirm the item count → **Submit for Review**.

Without first-time IAPs, `APP_VERSION=1.2.1 BUILD_NUMBER=N fastlane submit` does steps
1, 3 and 5 in one go with manual release set, and pushes `fastlane/metadata`
(description, release notes) with them — after refusing unless the ledger shows N live
with a higher ads-off build after it, and unless the published privacy page passes the
privacy gate.

> ⚠️ **Submission gotchas (learned the hard way):**
> - A first-time IAP needs its own **App Review screenshot** or it never enters review,
>   and the app is rejected under **2.1(b)**.
> - A **rejected** submission gets stuck. Cancel it, wait until it reads **Removed**
>   (~10–15 min in "Processing"; retrying earlier throws "unexpected error"), upload a
>   new binary — which means a new **two-build** pair — and submit version + IAPs
>   together again.
> - Apple asks for a **new binary** on a 2.1(b) fix.
> - `PrivacyInfo.xcprivacy` is validated only on App Store submission, never on
>   TestFlight: keep `NSPrivacyTracking` and `NSPrivacyTrackingDomains` consistent
>   (KVIZKO's first submission was rejected with ITMS-91064). The comment in the file
>   explains the current `false`.

### 4. After approval
- Press **Release** (manual release).
- Once N is `READY_FOR_SALE`, **expire every real-ads build on TestFlight** — N and any
  older `ADS:on` build still installable, not only N (in the ASC UI, or
  `PATCH /v1/builds/{id}` with `{"attributes":{"expired":true}}`). There is no lane for
  it. Expiring touches TestFlight only — verified on `com.noqyris.kvizko` build 51,
  simultaneously `READY_FOR_SALE` and `expired: true`.

### 5. Leave the tree safe
```bash
npm run ios:sync                          # dist/ and App/public back to ads-off
git checkout ios/App/App/Info.plist
```
A live bundle left in `dist/` is a loaded real-ads build for whoever syncs next.

---

## Android release

Android is wired but **not ship-ready for ads**:

- There are **no `android:*` npm chains** and no ads-off Android build, so nothing
  gates what reaches a Play track. Add them (mirroring the iOS chains, with
  `check-native-sync.mjs android <target>`) before any upload.
- The LevelPlay **Android app does not exist**; its `APP_KEYS.android` and
  `UNITS_BY_PLATFORM.android` are empty.
- The untracked generated Android files (`android/app/src/main/assets/public`,
  `capacitor.plugins.json`) still hold an AdMob-era bundle until `cap sync android`
  runs; that sync also injects the LevelPlay adapters into `android/app/build.gradle`
  and writes `res/values/levelplay_cmp.xml`.
- Until the Play app is published, every internal/closed-track build must be
  **ads-off**: Unity's terms treat live ads shown to testers of an unpublished game as
  invalid traffic. After a production rollout, follow it immediately with an ads-off
  build on the internal track (the Play twin of N+1).

The signed-AAB mechanics, once a gated chain exists:

```bash
nvm use 22
# <the gated android sync chain>
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
cd android && ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```
Signing reads the gitignored `android/keystore.properties`
(`android/keystore/upload-keystore.jks`). Bump `versionCode` first. Play Console →
track → Create release → upload → "What's new" → review → rollout (production rollout
is public and hard to reverse: stop and confirm first).

---

## Current release status

| Item | State |
|---|---|
| **App Store** | **1.2.0** live (AdMob-era; its ads stopped with the account on 2026-08-18). |
| **1.2.1** | 600 levels, Daily Challenge, the Store, music, the LevelPlay migration. The migration was done on `feat/monetization`. Project at 1.2.1 / build 27. Not submitted. **Plan:** build **28** live (`npm run ios:appstore` + `AD_TARGET=live`), submitted from the ASC UI for 1.2.1 with **manual release**, together with the four READY_TO_SUBMIT IAPs (`hints10` / `hints30` / `hints100` consumables, `noads` non-consumable); immediately build **29** ads-off (`npm run ios:testflight` + `AD_TARGET=off`) to TestFlight; expire 28 on TestFlight once it is `READY_FOR_SALE`. Build 28 is the first upload the ledger will record. |
| **LevelPlay (iOS)** | Done 2026-09-16: app key `282af3d55`, three ad units, Unity Ads bidding (Game ID `800374923`) — see [`MONETIZATION.md`](MONETIZATION.md#going-live--what-is-left). SPM held at LevelPlay 9.6.0 / adapter 5.11.0 / Unity Ads 4.20.0 / Ad Quality 9.9.0; `-ObjC` on the App target. |
| **Still open before review** | Everything in the [pre-release checklist](#0-before-you-start--the-pre-release-checklist): publish `docs/privacy.html` + `docs/index.html` to `main` (the privacy gate refuses every live upload until then), confirm the Unity Ad Controls age setting, rename the `removeads` IAP in ASC, re-capture the screenshots. App Privacy needs no change (network-agnostic: Identifiers, Location and Usage Data used for tracking, plus Diagnostics). |
| **Consent on upgrade** | The first launch of 1.2.1 resets any stored consent record once (`exactly67.levelplayConsentMigrated`), so **every existing install on an ads-on build** — every player except Unlimited-hints owners — sees ATT (if still undecided) and the "Ads and your data" modal once more, TestFlight testers who already answered it included. Ads-off builds never run the reset. Intended: 1.2.0's Google consent form may have left IAB TCF keys the LevelPlay plugin would read as its own decision. |
| **TestFlight hygiene** | Before 1.2.1 goes out, check which older builds are still installable and expire any that serve ads. |
| **Android** | Last AAB: `versionCode 2` / `1.2.0` (AdMob-era — do not upload). Needs gated Android chains, the LevelPlay Android app, and the Play IAP products (blocked on a Google Payments profile). |
