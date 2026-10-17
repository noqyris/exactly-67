// Fixes six consent defects in capacitor-levelplay-ads 0.1.42 (the `custom`
// consent provider Exactly 67 uses — package.json → levelplay.consentProvider),
// in fifteen places. Wired via package.json "postinstall"; idempotent;
// ALL-OR-NOTHING — nothing is written unless every patch applies — and it fails
// LOUDLY (exit 1) when the plugin's source no longer has the shape these patches
// were written against: a silently un-applied consent patch is worse than none.
//
// The PATCHES table is the canonical one (mobile-game-playbook/scripts/
// patch-levelplay-consent.mjs, from KVIZKO at fa97a8a, 2026-10-12), byte for
// byte, less its parts 6 (PATCHED-ANSWERS-PINNED) and 7 (PATCHED-TEST-LAB):
// both Android only, and Exactly 67 ships no Android build. The canonical
// numbering is kept, so the parts here are 1–5 and 8. This file adds Exactly
// 67's plugin locator (scripts/lib/levelplay-plugin.mjs: the app root from this
// file's own location, the exact 0.1.42 pin) and reads every written file back.
//
// 1. PATCHED-CONSENT-ORDER — TcfPrefs (iOS TcfPrefs.swift, Android TcfPrefs.java)
//    turned a REFUSAL into consent from the second launch onward:
//
//      writeStub(granted:)  →  gdprApplies = 0        // SAME for accept and decline
//                              purposeConsents = granted ? "1111111111" : "0000000000"
//      isGranted()          →  if gdprApplies == 0 { return true }   // short-circuits
//
//    The `gdprApplies == 0` shortcut is not itself wrong — "GDPR does not apply" —
//    but it was checked BEFORE the explicit decision the player made. The patch
//    only reorders the two checks: a recorded purposeConsents string wins;
//    otherwise the original gdprApplies heuristic. Exactly 67 shipped this one
//    alone from 1.2.1 to 1.3.0. Reported behaviour, not a preference — do not revert.
//
// 2. PATCHED-CUSTOM-STATUS — in custom mode the plugin's consent status read the
//    IABTCF_* keys FIRST and its own recorded answer (levelplay_consent_status /
//    consent_status) only as a fallback. Any other CMP leaves those keys behind —
//    Google UMP did in Exactly 67 1.0–1.2.0 (AdMob, until the account was closed
//    on 2026-08-18) — so an upgrader could be read back as GRANTED or DENIED on
//    an answer given to a different network, and never see this prompt. Now only
//    the app's own recorded answer counts; no answer is UNKNOWN. (The JS side
//    also cleared the stale keys once — the one-time resetConsent() behind
//    `exactly67.levelplayConsentMigrated` in src/services/ads.ts; this is the
//    native belt to that brace.) Accept/Decline write that key on both
//    platforms (storeConsent() / store()), so a real answer is never lost.
//
// 3. PATCHED-GDPR-FRESH — iOS applyUserConsent() wrote gdprConsents["all"] only
//    while its in-memory map was empty, then re-sent that stale map through the
//    deprecated setGDPRConsents. The first answer of a process stuck: Accept,
//    then Decline in Settings → "Privacy & ads", kept {all:true}, and the
//    reverse started the SDK with consent false. Every decision now overwrites
//    "all" and also calls the documented global LPMPrivacySettings.setGDPRConsent(_:).
//    Android needs no such patch: PrivacyExecutor.setUserConsent() already calls
//    LevelPlay.setConsent(granted) on every decision.
//
// 4. PATCHED-EQUAL-BUTTONS — the native alert dressed Decline as .cancel, which
//    iOS sets apart (bold, its own slot at the bottom): one answer styled apart
//    from the other is the nudge the consent rules forbid (EDPB 03/2022 §57,
//    CNIL). Both are .default now, with no preferredAction. Its policy link was a
//    hardcoded English "Privacy policy" on both platforms; it now reads
//    options.privacyButtonText. (Owner's option A, 2026-10-11 —
//    hq/projects/games/ads-consent-option-a.md.)
//
// 5. PATCHED-NO-TCF-STUB — every answer was mirrored into a fake IAB TCF record
//    with IABTCF_gdprApplies = 0: "GDPR does not apply", to every SDK that reads
//    TCF, for players in the EEA too, from a CMP nobody registered. The answer
//    now lives under the plugin's own key alone and reaches the networks through
//    LevelPlay's GDPR flag; the IABTCF_* keys are cleared on every answer and
//    whenever a stored answer is applied, which also wipes the stub an older
//    build (every Exactly 67 answer given in 1.2.1–1.3.0) left behind.
//
// 8. PATCHED-QUIET-REFUSAL — a refusal is not told to an SDK that is not
//    running. The plugin handed every answer to LevelPlay's privacy settings the
//    moment it was given or re-read: a Decline, and the stored Decline again at
//    every launch (init() in providers/levelplay.ts calls requestConsentInfo(),
//    which applies a stored answer). The SDK is never initialised after a no —
//    and still it acts on being told. Captured in KVIZKO on the iOS Simulator on
//    2026-10-11 (this plugin with parts 1–5, IronSourceSDK 9.6.0.0, the SDK
//    Exactly 67 pins): at the Decline tap, and at every later launch with a
//    stored no, one DNS lookup of init.supersonicads.com and two event records
//    appended to NSUserDefaults (com.supersonic.events.events) —
//    applyUserConsent → LPMPrivacySettings.setGDPRConsent(s) → ISEventsEngine →
//    SCNetworkReachabilityCreateWithName("init.supersonicads.com"). No
//    connection and no bytes to an ad host, but it is the ad SDK acting after a
//    refusal, and docs/privacy.html says that without consent the ad system
//    never starts. Now the answer is stored exactly as before, the plugin's own
//    per-network map is kept exactly as before, and only the SDK calls wait.
//    "Running" means the plugin's initialize() has got as far as handing the
//    start to the SDK in this process — a static flag set there and never
//    cleared. Not `initialized` / `initializing`: both are false again after a
//    start that FAILED, and an SDK started with a yes may still finish on its
//    own, so a withdrawal has to reach it. A yes is forwarded as before, ahead
//    of init; a refusal while running (a yes withdrawn in Settings → "Privacy &
//    ads") is forwarded as before; and initialize() itself tells the SDK a
//    stored refusal right before the start, so the SDK can never start without
//    it. Four places, one marker: iOS LevelPlayAdsImpl.swift — the flag with
//    initialize(), and one line of applyUserConsent() written INSIDE the body of
//    part 3 (`inside`, below); Android PrivacyExecutor.setUserConsent() and one
//    line of LevelPlayAdsPlugin.initialize().
//
// The release gates refuse a tree without these bodies' markers, at the counts
// the patched files carry: scripts/check-native-sync.mjs (every iOS and Android
// sync chain, and the fastlane archive and ad_gate lanes, which re-run it) and
// ios/App/ad-mode-guard.sh (every Xcode build). scripts/patchLevelplayConsent.test.ts
// fails the build while any of the fifteen bodies is missing from the installed
// plugin. A targeted `npm install <pkg>` can skip postinstall: re-run
// `node scripts/patch-levelplay-consent.mjs` (or a bare `npm install`).
import { readFileSync, realpathSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { locatePlugin } from './lib/levelplay-plugin.mjs'

const TAG = 'patch-levelplay-consent'
const IOS = 'ios/Sources/LevelPlayAdsPlugin'
const ANDROID = 'android/src/main/java/com/capacitor/plugins/levelplay'

/** Every patch, in the order it is applied. `old` is the known-defective upstream
 *  body, `new` the patched one; both are matched byte for byte.
 *
 *  A part is frozen once it has shipped: a body that changes could not be
 *  recognised in a plugin that already carries the earlier text, so it could not
 *  be upgraded in place. A later part that has to change a line INSIDE an
 *  earlier part's body therefore names that part — `inside: <its label>` — and
 *  is written against its body: its `old` is text of the earlier `new`. The
 *  earlier part is then recognised in either form — as written, or with the
 *  later part applied to it (`settled`, below). */
export const PATCHES = [
  {
    marker: 'PATCHED-CONSENT-ORDER',
    label: 'iOS TcfPrefs.swift isGranted()',
    file: `${IOS}/TcfPrefs.swift`,
    old: `    static func isGranted() -> Bool {
        let d = UserDefaults.standard
        let gdprApplies = d.object(forKey: gdprApplies) as? Int
        if gdprApplies == 0 { return true }
        let purposes = d.string(forKey: purposeConsents) ?? ""
        return purposes.first == "1"
    }`,
    new: `    // PATCHED-CONSENT-ORDER (scripts/patch-levelplay-consent.mjs)
    // An explicit recorded decision outranks the "GDPR does not apply" shortcut.
    // Upstream checks gdprApplies FIRST, and writeStub() writes gdprApplies=0 for
    // BOTH outcomes — so a decline read back as GRANTED on every later launch.
    static func isGranted() -> Bool {
        let d = UserDefaults.standard
        let purposes = d.string(forKey: purposeConsents) ?? ""
        if !purposes.isEmpty { return purposes.first == "1" }
        let gdprApplies = d.object(forKey: gdprApplies) as? Int
        return gdprApplies == 0
    }`,
  },
  {
    marker: 'PATCHED-CONSENT-ORDER',
    label: 'Android TcfPrefs.java isGranted()',
    file: `${ANDROID}/consent/TcfPrefs.java`,
    old: `    public static boolean isGranted(Context ctx) {
        SharedPreferences p = prefs(ctx);
        int gdprApplies = p.getInt(KEY_GDPR_APPLIES, -1);
        if (gdprApplies == 0) return true;
        String purposes = p.getString(KEY_PURPOSE_CONSENTS, "");
        return purposes != null && purposes.length() > 0 && purposes.charAt(0) == '1';
    }`,
    new: `    // PATCHED-CONSENT-ORDER (scripts/patch-levelplay-consent.mjs)
    // An explicit recorded decision outranks the "GDPR does not apply" shortcut.
    // Upstream checks gdprApplies FIRST, and writeStub() writes gdprApplies=0 for
    // BOTH outcomes — so a decline read back as GRANTED on every later launch.
    public static boolean isGranted(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String purposes = p.getString(KEY_PURPOSE_CONSENTS, "");
        if (purposes != null && purposes.length() > 0) return purposes.charAt(0) == '1';
        int gdprApplies = p.getInt(KEY_GDPR_APPLIES, -1);
        return gdprApplies == 0;
    }`,
  },
  {
    marker: 'PATCHED-CUSTOM-STATUS',
    label: 'iOS LevelPlayAdsImpl.swift consentStatus()',
    file: `${IOS}/LevelPlayAdsImpl.swift`,
    old: `        // custom: the rich modal writes the IABTCF_* keys (source of truth);
        // the legacy alert writes the boolean consentKey.
        if TcfPrefs.hasDecision() {
            return TcfPrefs.isGranted() ? "GRANTED" : "DENIED"
        }
        return UserDefaults.standard.string(forKey: consentKey) ?? "UNKNOWN"
    }`,
    new: `        // PATCHED-CUSTOM-STATUS (scripts/patch-levelplay-consent.mjs)
        // custom: ONLY this app's own recorded answer counts — storeConsent()
        // writes consentKey on every Accept/Decline. IABTCF_* keys left behind by
        // another CMP (Google UMP, in an app's AdMob years) are not an answer to
        // this prompt; upstream read them first and skipped the prompt entirely.
        if let recorded = UserDefaults.standard.string(forKey: consentKey),
           recorded == "GRANTED" || recorded == "DENIED" {
            return recorded
        }
        return "UNKNOWN"
    }`,
  },
  {
    marker: 'PATCHED-GDPR-FRESH',
    label: 'iOS LevelPlayAdsImpl.swift applyUserConsent()',
    file: `${IOS}/LevelPlayAdsImpl.swift`,
    old: `    public func applyUserConsent(granted: Bool, networks: [String]) {
#if canImport(IronSource)
        for network in networks where !network.isEmpty {
            gdprConsents[network] = NSNumber(value: granted)
        }
        if gdprConsents.isEmpty {
            gdprConsents["all"] = NSNumber(value: granted)
        }
        LPMPrivacySettings.setGDPRConsents(gdprConsents)
#endif
    }`,
    new: `    // PATCHED-GDPR-FRESH (scripts/patch-levelplay-consent.mjs)
    // Upstream set "all" only while the map was empty, so the first answer of a
    // process stuck (Accept, then Decline in Settings, kept {all:true}). Every
    // decision now overwrites it, and the global flag goes through the
    // non-deprecated setGDPRConsent(_:) as well.
    public func applyUserConsent(granted: Bool, networks: [String]) {
#if canImport(IronSource)
        for network in networks where !network.isEmpty {
            gdprConsents[network] = NSNumber(value: granted)
        }
        gdprConsents["all"] = NSNumber(value: granted)
        LPMPrivacySettings.setGDPRConsents(gdprConsents)
        LPMPrivacySettings.setGDPRConsent(granted)
#endif
    }`,
  },
  {
    marker: 'PATCHED-CUSTOM-STATUS',
    label: 'Android CustomModalConsentProvider.java getStatus()',
    file: `${ANDROID}/consent/CustomModalConsentProvider.java`,
    old: `    @Override
    public ConsentStatus getStatus() {
        // The rich modal persists its decision via the IABTCF_* keys, which are
        // the source of truth; the legacy alert's boolean is the fallback.
        if (TcfPrefs.hasDecision(context)) {
            return TcfPrefs.isGranted(context) ? ConsentStatus.GRANTED : ConsentStatus.DENIED;
        }
        String s = prefs().getString(KEY_STATUS, null);`,
    new: `    // PATCHED-CUSTOM-STATUS (scripts/patch-levelplay-consent.mjs)
    // Only this app's own recorded answer counts. IABTCF_* keys left behind by
    // another CMP (Google UMP, in an app's AdMob years) are not an answer to
    // this prompt; upstream read them first and skipped the prompt entirely.
    @Override
    public ConsentStatus getStatus() {
        String s = prefs().getString(KEY_STATUS, null);`,
  },
  {
    marker: 'PATCHED-EQUAL-BUTTONS',
    label: 'iOS LevelPlayAdsImpl.swift showConsentModal() buttons',
    file: `${IOS}/LevelPlayAdsImpl.swift`,
    old: `            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: acceptText, style: .default) { [weak self] _ in
                self?.storeConsent(granted: true)
                onDecision(true)
            })
            alert.addAction(UIAlertAction(title: declineText, style: .cancel) { [weak self] _ in
                self?.storeConsent(granted: false)
                onDecision(false)
            })
            if let urlString = privacyUrl, let url = URL(string: urlString) {
                alert.addAction(UIAlertAction(title: "Privacy policy", style: .default) { [weak self] _ in`,
    new: `            // PATCHED-EQUAL-BUTTONS (scripts/patch-levelplay-consent.mjs)
            // Accept and Decline carry the SAME style. Upstream gave Decline
            // .cancel, which iOS sets apart (bold, its own slot at the bottom):
            // one answer dressed differently from the other is the nudge consent
            // rules forbid (EDPB 03/2022 §57, CNIL). No preferredAction either.
            // The policy link takes its title from options.privacyButtonText, so
            // it speaks the app's language instead of a hardcoded English one.
            let privacyText = options["privacyButtonText"] as? String ?? "Privacy policy"
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: acceptText, style: .default) { [weak self] _ in
                self?.storeConsent(granted: true)
                onDecision(true)
            })
            alert.addAction(UIAlertAction(title: declineText, style: .default) { [weak self] _ in
                self?.storeConsent(granted: false)
                onDecision(false)
            })
            if let urlString = privacyUrl, let url = URL(string: urlString) {
                alert.addAction(UIAlertAction(title: privacyText, style: .default) { [weak self] _ in`,
  },
  {
    marker: 'PATCHED-EQUAL-BUTTONS',
    label: 'Android CustomModalConsentProvider.java privacy button',
    file: `${ANDROID}/consent/CustomModalConsentProvider.java`,
    old: `                    b.setNeutralButton("Privacy policy", (d, w) -> {`,
    new: `                    // PATCHED-EQUAL-BUTTONS (scripts/patch-levelplay-consent.mjs)
                    // The policy link takes its title from options.privacyButtonText,
                    // so it speaks the app's language. Accept and Decline are already
                    // equal here: AlertDialog draws both as the same text button.
                    b.setNeutralButton(opts.getString("privacyButtonText", "Privacy policy"), (d, w) -> {`,
  },
  {
    marker: 'PATCHED-NO-TCF-STUB',
    label: 'iOS LevelPlayAdsImpl.swift storeConsent()',
    file: `${IOS}/LevelPlayAdsImpl.swift`,
    old: `    private func storeConsent(granted: Bool) {
        UserDefaults.standard.set(granted ? "GRANTED" : "DENIED", forKey: consentKey)
        // Mirror to TCF stub so mediation adapters see consistent state.
        TcfPrefs.writeStub(granted: granted)
    }`,
    new: `    // PATCHED-NO-TCF-STUB (scripts/patch-levelplay-consent.mjs)
    // Upstream mirrored every answer into a fake IAB TCF record whose
    // IABTCF_gdprApplies = 0 tells every SDK that reads TCF that GDPR does not
    // apply, to players in the EEA as well, with no registered CMP behind it.
    // The answer reaches the networks through LevelPlay's own GDPR flag
    // (applyUserConsent → setGDPRConsent), so it is recorded under consentKey
    // alone and every IABTCF_* key is cleared instead.
    private func storeConsent(granted: Bool) {
        UserDefaults.standard.set(granted ? "GRANTED" : "DENIED", forKey: consentKey)
        TcfPrefs.clear()
    }`,
  },
  {
    marker: 'PATCHED-NO-TCF-STUB',
    label: 'iOS LevelPlayAdsImpl.swift requestConsent() stored decision',
    file: `${IOS}/LevelPlayAdsImpl.swift`,
    old: `        let status = consentStatus()
        if status != "UNKNOWN" {
            applyUserConsent(granted: status == "GRANTED", networks: networks)
            completion(true, nil)
            return
        }`,
    new: `        let status = consentStatus()
        if status != "UNKNOWN" {
            // PATCHED-NO-TCF-STUB (scripts/patch-levelplay-consent.mjs)
            // An answer stored by an older build still has the fake TCF stub
            // (IABTCF_gdprApplies = 0) beside it: drop it whenever a stored
            // decision is applied. The GDPR flag carries the answer.
            TcfPrefs.clear()
            applyUserConsent(granted: status == "GRANTED", networks: networks)
            completion(true, nil)
            return
        }`,
  },
  {
    marker: 'PATCHED-NO-TCF-STUB',
    label: 'Android CustomModalConsentProvider.java store()',
    file: `${ANDROID}/consent/CustomModalConsentProvider.java`,
    old: `        // Mirror the decision into the IAB TCF keys so mediation adapters
        // see consistent state even without a real CMP. This is a stub —
        // it sets gdprApplies=0 so adapters fall back to non-GDPR flow.
        TcfPrefs.writeStub(context, granted);
    }`,
    new: `        // PATCHED-NO-TCF-STUB (scripts/patch-levelplay-consent.mjs)
        // Upstream mirrored the answer into a fake IAB TCF record whose
        // gdprApplies=0 tells every SDK that reads TCF that GDPR does not apply,
        // to players in the EEA as well. The answer reaches the networks through
        // PrivacyExecutor (LevelPlay.setConsent), so the TCF keys are cleared.
        TcfPrefs.clear(context);
    }`,
  },
  {
    marker: 'PATCHED-NO-TCF-STUB',
    label: 'Android CustomModalConsentProvider.java requestConsent() stored decision',
    file: `${ANDROID}/consent/CustomModalConsentProvider.java`,
    old: `        if (current != ConsentStatus.UNKNOWN) {
            // Honor the existing decision without re-prompting.
            callback.onDecision(current == ConsentStatus.GRANTED);`,
    new: `        if (current != ConsentStatus.UNKNOWN) {
            // PATCHED-NO-TCF-STUB (scripts/patch-levelplay-consent.mjs)
            // An answer stored by an older build still has the fake TCF stub
            // beside it: drop it whenever a stored decision is applied.
            TcfPrefs.clear(context);
            // Honor the existing decision without re-prompting.
            callback.onDecision(current == ConsentStatus.GRANTED);`,
  },
  {
    marker: 'PATCHED-QUIET-REFUSAL',
    label: 'iOS LevelPlayAdsImpl.swift initialize() marks the SDK started',
    file: `${IOS}/LevelPlayAdsImpl.swift`,
    old: `    public var isInitialized: Bool { initialized }

    public func initialize(appKey: String, userId: String?, isTesting: Bool,
                           completion: @escaping (Bool, String?) -> Void) {
#if canImport(IronSource)
        if initialized { completion(true, nil); return }
        if initializing { completion(false, "LevelPlay is already initializing."); return }
        initializing = true
`,
    new: `    public var isInitialized: Bool { initialized }

    // PATCHED-QUIET-REFUSAL (scripts/patch-levelplay-consent.mjs)
    // True once initialize() has handed the start to the SDK in this process,
    // and never false again — also after a start that failed: the SDK was given
    // a yes and may still finish on its own. \`initialized\` and \`initializing\`
    // cannot say that: both are false again after a failure. While this is
    // false a refusal is not told to the SDK at all (applyUserConsent) — told,
    // an SDK that nothing ever initialised looks up its init host and writes
    // event records.
    private static var adSdkStarted = false

    public func initialize(appKey: String, userId: String?, isTesting: Bool,
                           completion: @escaping (Bool, String?) -> Void) {
#if canImport(IronSource)
        if initialized { completion(true, nil); return }
        if initializing { completion(false, "LevelPlay is already initializing."); return }
        initializing = true
        // From here on a refusal goes to the SDK as it always did. One that was
        // kept from it — stored by an earlier launch, or given a moment ago — is
        // told now, so the SDK never starts without it.
        LevelPlayAdsImpl.adSdkStarted = true
        if consentStatus() == "DENIED" { applyUserConsent(granted: false, networks: []) }
`,
  },
  {
    marker: 'PATCHED-QUIET-REFUSAL',
    label: 'iOS LevelPlayAdsImpl.swift applyUserConsent() keeps a refusal from an idle SDK',
    file: `${IOS}/LevelPlayAdsImpl.swift`,
    // The body of part 3 (PATCHED-GDPR-FRESH), which stays as it shipped.
    inside: 'iOS LevelPlayAdsImpl.swift applyUserConsent()',
    old: `        gdprConsents["all"] = NSNumber(value: granted)
        LPMPrivacySettings.setGDPRConsents(gdprConsents)
        LPMPrivacySettings.setGDPRConsent(granted)
`,
    new: `        gdprConsents["all"] = NSNumber(value: granted)
        // PATCHED-QUIET-REFUSAL (scripts/patch-levelplay-consent.mjs)
        // A refusal is not told to an SDK that is not running: the answer is
        // stored (storeConsent) and the map above is kept, and that is all.
        // Told, the SDK logs events and looks up its init host though nothing
        // ever initialised it. A yes passes; so does a refusal once initialize()
        // has started the SDK in this process — which tells it a stored one.
        if !granted && !LevelPlayAdsImpl.adSdkStarted { return }
        LPMPrivacySettings.setGDPRConsents(gdprConsents)
        LPMPrivacySettings.setGDPRConsent(granted)
`,
  },
  {
    marker: 'PATCHED-QUIET-REFUSAL',
    label: 'Android PrivacyExecutor.java setUserConsent() keeps a refusal from an idle SDK',
    file: `${ANDROID}/privacy/PrivacyExecutor.java`,
    old: `    public void setUserConsent(boolean granted, List<String> networks) {
        // Global GDPR flag — forwarded to LevelPlay core and every adapter.
        LevelPlay.setConsent(granted);

        if (networks != null) {
            for (String network : networks) {
                if (network != null && !network.isEmpty()) {
                    gdprConsents.put(network, granted);
                }
            }
        }
        if (!gdprConsents.isEmpty()) {
            // Re-send the full canonical map — partial maps would wipe the rest.
            LevelPlayPrivacySettings.setGDPRConsents(new HashMap<>(gdprConsents));
        }
    }
`,
    new: `    public void setUserConsent(boolean granted, List<String> networks) {
        // PATCHED-QUIET-REFUSAL (scripts/patch-levelplay-consent.mjs)
        // A refusal is not told to an SDK that is not running: the answer is
        // stored (the consent provider did that) and the map below is kept, and
        // that is all. Told, the SDK logs "setConsent" and queues an event though
        // nothing ever initialised it. A yes is told; so is a refusal once the
        // plugin has started the SDK in this process (adSdkStarting()).
        final boolean tell = granted || adSdkStarted;
        // Global GDPR flag — forwarded to LevelPlay core and every adapter.
        if (tell) LevelPlay.setConsent(granted);

        if (networks != null) {
            for (String network : networks) {
                if (network != null && !network.isEmpty()) {
                    gdprConsents.put(network, granted);
                }
            }
        }
        if (tell && !gdprConsents.isEmpty()) {
            // Re-send the full canonical map — partial maps would wipe the rest.
            LevelPlayPrivacySettings.setGDPRConsents(new HashMap<>(gdprConsents));
        }
    }

    /**
     * True once the plugin has handed initialize() to the SDK in this process,
     * and never false again — also after a start that failed: the SDK was given
     * a yes and may still finish on its own. Static, because the SDK is: a
     * re-created Activity gets a new plugin object over the same running SDK.
     */
    private static volatile boolean adSdkStarted = false;

    /**
     * Called by the plugin right before it hands initialize() to the SDK. From
     * here on a refusal goes to the SDK as it always did. One that was kept from
     * it — stored by an earlier launch, or given a moment ago — is told now, so
     * the SDK never starts without it.
     */
    public void adSdkStarting(boolean storedRefusal) {
        adSdkStarted = true;
        if (storedRefusal) setUserConsent(false, null);
    }
`,
  },
  {
    marker: 'PATCHED-QUIET-REFUSAL',
    label: 'Android LevelPlayAdsPlugin.java initialize() marks the SDK started',
    file: `${ANDROID}/LevelPlayAdsPlugin.java`,
    old: `        Boolean isTesting = call.getBoolean("isTesting", false);

        coreImplementation.initialize(
`,
    new: `        Boolean isTesting = call.getBoolean("isTesting", false);

        // PATCHED-QUIET-REFUSAL (scripts/patch-levelplay-consent.mjs)
        // From this line the SDK counts as running, whatever comes of the call
        // below, and a refusal goes to it as it always did. Until this line a
        // refusal was only stored (PrivacyExecutor); a stored one is told now.
        privacyExecutor.adSdkStarting(consentProvider.getStatus() == ConsentStatus.DENIED);
        coreImplementation.initialize(
`,
  },
]

/** A part's body as a fully patched file holds it: with every later part that
 *  was written inside it (`inside`) applied. For every other part, its `new`. */
export function settled(p) {
  return PATCHES.filter((q) => q.inside === p.label).reduce((body, q) => body.replace(q.old, q.new), p.new)
}

const count = (src, needle) => src.split(needle).length - 1

function fail(lines) {
  for (const line of lines) console.error(line)
  process.exit(1)
}

function main() {
  // Exits 1 itself when package.json declares the plugin but Node cannot find
  // it, or when either the pin or the installed version is not 0.1.42: the
  // bodies below were verified against that tarball and nothing else. Null
  // only when the app does not depend on the plugin at all.
  const pkgDir = locatePlugin(TAG)
  if (!pkgDir) return

  // Group by file so a file with several patches is read and written once.
  const byFile = new Map()
  for (const p of PATCHES) {
    if (!byFile.has(p.file)) byFile.set(p.file, [])
    byFile.get(p.file).push(p)
  }

  // Phase 1 checks every patch in memory; nothing is written unless ALL of them
  // apply, so a shape failure never leaves the plugin half-patched.
  const writes = []
  const applied = []
  let already = 0
  for (const [rel, patches] of byFile) {
    const file = join(pkgDir, rel)
    if (!existsSync(file)) {
      fail([
        `[${TAG}] MISSING ${rel} — the plugin layout changed.`,
        '  Re-verify the consent defects by hand before shipping; do not assume they are fixed. Nothing was written.',
      ])
    }
    const before = readFileSync(file, 'utf8')
    let src = before
    for (const p of patches) {
      // In place — as written, or with a later part applied inside it.
      const body = src.includes(p.new) ? p.new : src.includes(settled(p)) ? settled(p) : null
      if (body) {
        // Patched — exactly once, and with no defective copy left beside it. A
        // doubled body or a leftover original is a file edited by hand.
        if (count(src, body) !== 1 || src.includes(p.old)) {
          fail([
            `[${TAG}] ${p.label}: carries the patched body twice, or beside the defective one.`,
            '  Reinstall the plugin (rm -rf node_modules/capacitor-levelplay-ads && npm install) and read the result.',
          ])
        }
        already++
        continue
      }
      // A marker without the exact patched body means someone edited it, or an
      // older/newer patch text is in place — neither is proven. Read from the
      // file as it is ON DISK: a marker with several places in one file is
      // written into `src` by the first of them, and the next place, if its
      // upstream shape is gone, would be reported as an edited patch.
      if (before.includes(`${p.marker} (scripts/patch-levelplay-consent.mjs)`) && !src.includes(p.old)) {
        fail([
          `[${TAG}] ${p.label}: carries ${p.marker} but not the expected patched body.`,
          '  Reinstall the plugin (rm -rf node_modules/capacitor-levelplay-ads && npm install) and read the result.',
        ])
      }
      if (!src.includes(p.old)) {
        fail([
          `[${TAG}] ${p.label} no longer matches the known-defective form.`,
          '  Upstream may have fixed it, or changed it in some other way. Read it before shipping —',
          '  a silently un-applied consent patch is worse than no patch. Nothing was written.',
        ])
      }
      // replace() patches the FIRST match only: a body found twice would leave
      // the second copy defective while the run reported success.
      if (count(src, p.old) > 1) {
        fail([
          `[${TAG}] ${p.label} matches more than once — the plugin changed shape.`,
          '  Read it before shipping; nothing was written.',
        ])
      }
      src = src.replace(p.old, p.new)
      applied.push(p)
    }
    if (src !== before) writes.push([file, src])
  }

  // Phase 2: every patch is known to apply. Then read every file back: a write
  // that did not land (a read-only tree, a sync tool racing it) must stop the
  // build here, not ship an unpatched consent dialog. A written file now holds
  // every one of its parts in its final form — a part another one was written
  // inside as `settled(p)`, whether it was applied now or already in place.
  for (const [file, src] of writes) writeFileSync(file, src)
  const written = new Set(writes.map(([file]) => file))
  for (const p of PATCHES.filter((x) => written.has(join(pkgDir, x.file)))) {
    const src = readFileSync(join(pkgDir, p.file), 'utf8')
    if (count(src, settled(p)) !== 1 || src.includes(p.old)) {
      fail([`[${TAG}] ${p.label}: wrote the patch but cannot read it back. Do not build.`])
    }
  }
  for (const p of applied) console.log(`[${TAG}] ✅ ${p.label} (${p.marker})`)
  if (already && !applied.length) console.log(`[${TAG}] already patched (${already} patches)`)
  else if (already) console.log(`[${TAG}] ${already} of ${PATCHES.length} patches were already in place`)
}

// Run only as a script — the test imports PATCHES without patching anything.
// Compared by realpath: argv[1] keeps a symlinked path (/tmp → /private/tmp)
// while import.meta.url does not, and a guard that silently skipped main()
// would be exactly the un-applied consent patch this file exists to prevent.
const invokedAs = (() => {
  try {
    return process.argv[1] ? realpathSync(process.argv[1]) : ''
  } catch {
    return ''
  }
})()
if (invokedAs === realpathSync(fileURLToPath(import.meta.url))) main()
