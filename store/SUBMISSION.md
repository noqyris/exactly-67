# Shipping Exactly 67 to the App Store

> **⚠️ Historical — the 1.0.0 (build 1) first-submission walkthrough, kept for the record. Do not
> follow it for a release.** Several statements below are no longer true:
> - The app shows ads (Unity LevelPlay since 1.2.1, AdMob before that), so App Privacy is **not**
>   "Data Not Collected" — see [`STORE_LISTING.md`](STORE_LISTING.md#app-privacy).
> - `PrivacyInfo.xcprivacy` covers only the app's own code; the ad SDKs ship their own manifests.
> - The published privacy policy is [`docs/privacy.html`](../docs/privacy.html), not
>   `store/PRIVACY_POLICY.md` (now an internal summary).
> - `npm run ios:sync` + **Product → Archive** now yields an **ads-off** binary: right for the
>   TestFlight build N+1, wrong for the App Store (it earns nothing). The App Store build is
>   `npm run ios:appstore` + `AD_TARGET=live fastlane archive`, always followed at once by the
>   ads-off build.
> - Version and build are far past 1.0.0 / 1, and every release is **two uploads**. The numbers live
>   only in `project.pbxproj`; `Info.plist` reads them as build-setting variables.
> - **Product → Archive → Distribute App** (step 6) skips the fastlane upload ledger and privacy
>   gate, so `fastlane submit` can never accept a build uploaded that way. The Xcode Ad-mode guard
>   still runs: it refuses to archive a live bundle without `AD_TARGET=live`, and any `ADS:on` test
>   bundle at all. Release uploads go through the lanes in `docs/RELEASE.md`.
>
> The current runbook is [`docs/RELEASE.md`](../docs/RELEASE.md).

This is the full path from here to "Waiting for Review". Everything that can be prepared in the
repo **is already done** (✅). The remaining steps (🔐) need your Apple Developer account and can
only be done by you — signing in with your credentials is not something the build can do for you.

---

## Already done for you ✅
- ✅ Native iOS project (`ios/`), bundle id **com.noqyris.exactly67**, display name **Exactly 67**.
- ✅ Portrait-locked (iPhone + iPad), iPad-optimized layout, safe-area aware, retina-crisp.
- ✅ App icon (all sizes generated from `store/icon-1024.png`), branded splash / no white launch flash.
- ✅ `PrivacyInfo.xcprivacy` — no tracking, no data collected, UserDefaults reason declared.
- ✅ Marketing version **1.0.0**, build **1**.
- ✅ App Store screenshots at the required sizes in `store/screenshots/`
  (iPhone 6.9" = 1320×2868, iPad 13" = 2064×2752).
- ✅ Listing text, keywords, categories, age rating → `store/STORE_LISTING.md`.
- ✅ Hostable privacy policy → `store/PRIVACY_POLICY.md`.

---

## 1. Apple Developer Program 🔐
- Enroll at <https://developer.apple.com/programme/> ($99/year) if you haven't. Individual or
  Organization — Organization needs a D-U-N-S number and takes longer.

## 2. Create the app record in App Store Connect 🔐
- <https://appstoreconnect.apple.com> → **Apps → +** → New App.
- Platform **iOS**, name from `STORE_LISTING.md`, primary language, bundle id
  **com.noqyris.exactly67** (register it first under *Certificates, Identifiers & Profiles* if the
  dropdown is empty), SKU e.g. `exactly67`.

## 3. Signing in Xcode 🔐
```bash
cd ios/App && open App.xcodeproj   # or: npm run ios:open
```
- Select the **App** target → **Signing & Capabilities**.
- Tick **Automatically manage signing**, choose your **Team**. Xcode creates the certificate and
  provisioning profile. (Until you pick a team, device/archive builds won't sign — the simulator
  build needs no signing, which is why it already runs.)

## 4. Host the privacy policy + a support page 🔐
- Publish `store/PRIVACY_POLICY.md` somewhere public (GitHub Pages, Notion, your site) and note the URL.
- Have any reachable support URL (a page, or a simple contact page).

## 5. Fill in the listing 🔐
- In App Store Connect, paste everything from `store/STORE_LISTING.md` (name, subtitle, keywords,
  description, promo text, what's new, categories, age rating, price = Free).
- Upload screenshots from `store/screenshots/iphone-6.9` and `store/screenshots/ipad-13`.
- **App Privacy:** choose *Data Not Collected*.
- Paste the Privacy Policy URL and Support URL.

## 6. Archive & upload the build 🔐
In Xcode:
- Top bar device selector → **Any iOS Device (arm64)** (not a simulator).
- **Product → Archive**. When the Organizer opens: **Distribute App → App Store Connect → Upload**.
- Let it finish; the build appears in App Store Connect under **TestFlight** after processing
  (a few minutes to ~an hour).

> Rebuild the web layer first if you've changed anything since:
> ```bash
> nvm use 22 && npm run ios:sync
> ```

## 7. Attach the build & submit 🔐
- In the app version, under **Build**, pick the uploaded build.
- Answer the **Export Compliance** question: the app uses only standard OS encryption (HTTPS/none),
  so you can answer **"No"** to using non-exempt encryption. (You can pre-set this by adding
  `ITSAppUsesNonExemptEncryption = NO` to `Info.plist` — see note below.)
- **Add for Review → Submit for Review.**

## 8. After submission
- Review typically takes ~24–48h. You'll get email on status changes.
- If rejected, address the note and resubmit — nothing here requires re-doing the prep above.

---

### Optional: skip the encryption prompt on every build
Add this to `ios/App/App/Info.plist` so App Store Connect stops asking:
```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

### Bump version for future updates
- Marketing version (user-visible) and build number live in the Xcode target
  (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`). Increase the **build** for every upload,
  and the **version** for every public release.
