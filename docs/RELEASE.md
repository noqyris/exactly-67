# Build & Release runbook

How to build *Exactly 67* locally and ship it to the **App Store** and **Google
Play**, including the version-number mechanics and the gotchas learned shipping
1.1.0. For the *store-listing* side (screenshots, copy, App content answers) see
[`store/SUBMISSION.md`](../store/SUBMISSION.md) and
[`store/PLAY_LISTING.md`](../store/PLAY_LISTING.md); for ads/IAP go-live see
[`MONETIZATION.md`](MONETIZATION.md).

---

## Prerequisites

| Tool | Version / note |
|---|---|
| **Node** | **≥ 22** for the Capacitor CLI (`cap sync`). Not enforced by the repo (no `engines`/`.nvmrc`) — use `nvm use 22`. |
| **Xcode** | 26.x. iOS build/upload. |
| **fastlane** | On `PATH` (`/opt/homebrew/bin/fastlane`). Run lanes from `ios/App/`. **No Gemfile** — call `fastlane <lane>` directly, *not* `bundle exec`. |
| **JDK** | For the Android Gradle build. Use Android Studio's bundled JBR: `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`. |

**Never commit** App Store keys (`*.p8`, `AuthKey_*.p8`, `ios/App/fastlane/keys/`,
`asc_api_key.json`) or the Android signing keystore (`android/keystore/*.jks`,
`android/keystore.properties`) — all gitignored.

---

## Version numbers — where they live

| Platform | Marketing version | Build number | File |
|---|---|---|---|
| **iOS** | `MARKETING_VERSION` (`1.1.0`) | `CURRENT_PROJECT_VERSION` (bump every upload) | `ios/App/App.xcodeproj/project.pbxproj` (**two occurrences each** — edit both) |
| **Android** | `versionName` (`"1.1.0"`) | `versionCode` (bump every upload) | `android/app/build.gradle` |

- **iOS:** the App Store requires a **unique build number** per upload — bump
  `CURRENT_PROJECT_VERSION` before every `build_and_upload`, even for the same
  marketing version.
- **Android:** Play requires a **higher `versionCode`** per upload.

---

## npm scripts

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server (browser). |
| `npm test` / `test:watch` | Vitest logic + content gate. |
| `npm run build` | `tsc --noEmit && vitest run && vite build` → `dist/`. **Hard content gate.** |
| `npm run ios:sync` | `npm run build && cap sync ios` (Node ≥ 22). |
| `npm run ios:open` | Open the Xcode project. |

---

## iOS release

### 1. Build + upload to TestFlight/ASC

```bash
nvm use 22
npm run build && npx cap sync ios          # web → native project
cd ios/App
fastlane build_and_upload                   # build_ipa + upload_to_testflight (skip_submission)
```

`build_and_upload` (see `ios/App/fastlane/Fastfile`) archives with automatic
signing and uploads via the ASC API key (`fastlane/keys/asc_api_key.json`). It does
**not** create/verify an App Store version, so it works even when the marketing
version already exists.

**Verify the upload landed** (do NOT trust a piped exit code):

```bash
fastlane run latest_testflight_build_number \
  app_identifier:com.noqyris.exactly67 version:1.1.0 \
  api_key_path:fastlane/keys/asc_api_key.json
# → "Result: 9"
```

> ⚠️ **Gotcha:** `fastlane … 2>&1 | tail -40` truncates the real output *and*
> `$?`/`${pipestatus}` reports `tail`'s exit code, not fastlane's — an "exit 0" is
> meaningless. Verify with `latest_testflight_build_number` instead. (Also: this
> shell is **zsh** — `${PIPESTATUS[0]}` is a bashism that returns empty; use
> `${pipestatus[1]}`.)

Apple processes the build for a few minutes before it's selectable in a version.

### 2. Submit the version (App Store Connect UI)

ASC uses the **unified "review submission"** model: the app version **and** any
first-time IAP must be in **one** submission.

1. Version page → set the build (delete the old one, "Add Build" → the new number
   → Save).
2. **"Add for Review"** on the version → creates a draft submission.
3. On the **Remove-Ads IAP** page → **"Add for Review"** → in the dropdown pick the
   **existing draft submission** (not "Create New").
4. Open the draft (App Review → Drafts) → confirm **"2 Items"** (version + IAP) →
   **Submit for Review**.

Release mode is **Manual** — you click **Release** after approval.

> ⚠️ **The submission-tangle gotchas (learned the hard way):**
> - A first-time IAP needs an **App Review screenshot** on the IAP itself or it
>   won't actually enter review — the app then gets a **2.1(b)** rejection ("IAP
>   products have not been submitted for review") even though the app looks fine.
> - If a submission is **rejected**, it gets stuck ("no other items can be
>   accepted"). Recovery: **Cancel Submission** (it goes to "Processing" for
>   ~10–15 min before it fully clears — *wait for it to reach "Removed"* before
>   retrying, or new "Add for Review" attempts throw "unexpected error"), then
>   upload a **new binary**, select it, and create a fresh submission with the
>   version + IAP together.
> - Apple explicitly asks for a **new binary** on a 2.1(b) fix — bump the build
>   number and re-upload.

Optional fastlane lanes exist (`release`, `submit`, `metadata`, `screenshots`) but
the UI flow above is the reliable path for the version+IAP-together case.

---

## Android release

The Android platform is wired (AdMob app id in `AndroidManifest.xml`, live ad
units). Signing config in `android/app/build.gradle` reads the gitignored
`android/keystore.properties` (points at `android/keystore/upload-keystore.jks`).

### Build a signed AAB

```bash
nvm use 22
npm run build && npx cap sync android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
cd android && ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

> ⚠️ Gradle needs a JDK; a plain shell has none ("Unable to locate a Java
> Runtime"). Set `JAVA_HOME` to Android Studio's JBR as above.

### Upload to Play

1. Bump `versionCode` in `android/app/build.gradle` first.
2. Play Console → app → **Production** (or **Internal testing**) → Create release →
   upload `app-release.aab` → "What's new" → review → **rollout** (production
   rollout is public + hard to reverse — stop here and confirm before rolling out).

First production review can take from a few hours to a couple of days.

---

## AdMob go-live

Ads serve **test** fillers until `TESTING = false` in
[`src/services/ads.ts`](../src/services/ads.ts) (already flipped for production).
AdMob approves each app for **live** fill within a few days of it being public in
the store — until then the banner shows empty space, nothing breaks. Test the
build on a **real device** before flipping (test ads don't serve on
simulators/emulators the same way live ones fill). Full detail:
[`MONETIZATION.md`](MONETIZATION.md).

---

## Current release status (1.1.0)

| Item | State |
|---|---|
| **iOS** | Build **9** (1.1.0) + Remove-Ads IAP **submitted to App Review together** (submission `223ea368`). Awaiting review; **Manual** release. |
| **Android** | Signed **AAB versionCode 2** built (`app-release.aab`), ready to upload; internal testing already live. |
| **AdMob** | `TESTING = false`; iOS app approved/serving, Android awaiting public listing. |
| **Blockers (user action)** | (1) **Google Payments profile** (bank + tax) — required before the Play Remove-Ads product can be created. (2) `feat/monetization` branch not pushed (earlier push failed on credentials). |
| **Pending polish** | 5 audit fixes (see [`TESTING.md`](TESTING.md)) are in source, not yet in a build — ship in the next build. |

### Immediate next steps
1. iOS: await Apple's decision on `223ea368` → device-test → **Release**.
2. Android: device-test the internal build → upload the AAB to Production → confirm
   → rollout.
3. Create the Google Payments profile → then the Play products:
   `com.noqyris.exactly67.removeads` (~$4.99) plus the three consumables
   `…hints10/30/100` (~$0.99/$1.99/$2.99) → the Store transacts on Android too.
4. Commit the audit fixes + version bumps; push `feat/monetization`.
