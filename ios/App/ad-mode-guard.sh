#!/bin/sh
# EXACTLY 67 ad-mode archive guard: an Xcode Run Script phase, FIRST in the App
# target, so it runs on every build (Run, Archive, xcodebuild, fastlane).
#
# Needs ENABLE_USER_SCRIPT_SANDBOXING = NO on the App target (set explicitly in
# both configs of project.pbxproj): it reads ${SRCROOT}/ad-mode-guard.sh,
# App/public/assets/*.js, App/capacitor.config.json, App/Info.plist and
# App/SceneDelegate.swift, none of them declared inputs. Xcode's "Update to
# recommended settings" turns sandboxing on, and then every build fails here
# with "Sandbox: bash deny file-read-data". Do not accept that recommendation,
# and never answer the denial by deleting this phase.
#
# WHY. The npm chains gate a bundle twice (scripts/check-ad-mode.mjs before the
# sync, scripts/check-native-sync.mjs after it) and the fastlane `archive` lane
# gates once more (verify_ad_mode!). Product > Archive in Xcode, a bare
# `xcodebuild archive` and `npx cap run ios` skip all three and compile whatever
# `App/public` holds, hours later, after any `vite build` at all. Real-ads builds
# reaching TestFlight, where the owner opened them and tapped his own ads, is how
# Google terminated this app's AdMob publisher account on 2026-08-18. So the
# binary itself refuses to build from a bundle nobody declared.
#
# THE MARKERS (baked into the JS bundle, each exactly once):
#   ADMODE:live | ADMODE:test      VITE_AD_MODE (src/services/providers/levelplay.ts)
#   ADS:on | ADS:off | ADS:mock    VITE_ADS     (src/services/adProvider.ts)
#   UNLOCKALL:1, or absent         VITE_UNLOCK_ALL (src/services/buildFlags.ts)
#
# On Unity LevelPlay, ADMODE:test is NOT test inventory: `isTesting` only
# unlocks the Test Suite, so EVERY ADS:on bundle serves the real waterfall.
# ADS:off is the only bundle that serves nothing: the ad layer never starts.
# And ADS:on is what a plain `npm run build` bakes (VITE_ADS unset), so it is
# the bundle most easily synced by accident; `npm run ios:sync` is the ads-off
# dev default.
#
# AD_TARGET says what the build is meant to be. Set it in the environment
# (`AD_TARGET=test npx cap run ios`) or pass it to xcodebuild as a build setting
# (`xcodebuild ... AD_TARGET=live`); the fastlane lanes forward their own
# AD_TARGET that way.
#   live  the App Store build N         ADMODE:live + ADS:on, no UNLOCKALL:1
#   off   the TestFlight build N+1      ADMODE:test + ADS:off (UNLOCKALL:1 allowed)
#   test  a dev Run, never archived     ADMODE:test + ADS:on  (REAL ads)
#   mock  the fake-ads TestFlight build ADMODE:test + ADS:mock (UNLOCKALL:1 allowed):
#         ads we draw in the web view, no ad network — safe to tap
#   unset an ordinary Run or Archive of the ads-off dev default (ADS:off)
#
# Xcode sets ACTION=install for Archive and ACTION=build for Build/Run. The rules:
#   - App/Info.plist without the UIScene manifest naming SceneDelegate, or a
#     missing App/SceneDelegate.swift, never builds: iOS 27 would not launch it;
#   - App/capacitor.config.json carrying server.url never builds: the app would
#     load a dev server (a leftover of `cap run -l`), not the bundle proven here;
#   - a bundle whose markers are missing or doubled never builds: it cannot be
#     proven (every AdMob-era bundle of this app is such a bundle);
#   - ADMODE:live builds only under AD_TARGET=live, never with ADS:off/mock,
#     and never with UNLOCKALL:1;
#   - AD_TARGET=live never builds UNLOCKALL:1 (all 600 levels for every player);
#   - ADS:mock (our own drawn fake ads) Runs with no target, and is archived
#     only under a stated AD_TARGET=mock (the fake-ads TestFlight build, which
#     `submit` refuses); any other stated target refuses it, and AD_TARGET=mock
#     refuses every bundle that is not ADS:mock;
#   - ADS:off never builds under AD_TARGET=live or test; AD_TARGET=off demands it;
#   - an ADS:on TEST bundle is the real waterfall wearing a test label: it Runs
#     only under an explicit AD_TARGET=test, and is never archived, whatever the
#     target (the fastlane archive lane refuses AD_TARGET=test the same way; an
#     Organizer archive is one "Distribute App" click from TestFlight).
#
# The marker counts read the same files as scripts/check-native-sync.mjs: the
# top-level App/public/assets/*.js. Exit 1 fails the build with a red error.
set -eu

tag="EXACTLY 67 ad-mode guard"
app="${SRCROOT:?SRCROOT is not set: run this from an Xcode build phase}/App"
public="$app/public/assets"
target="${AD_TARGET:-}"
action="${ACTION:-build}"

refuse() {
  echo "error: $tag: $*"
  exit 1
}

case "$target" in
  ""|live|test|off|mock) ;;
  *) refuse "AD_TARGET='$target' is not a target. Use live (App Store), off (TestFlight / ads-off), mock (fake-ads TestFlight) or test (a dev Run only), or leave it unset for the ads-off dev default." ;;
esac

# The UIScene manifest (1.3.0). iOS 27 will not launch an app built with its SDK
# that has no scene manifest, and Xcode 27 is the only toolchain on the release
# machine. The manifest lives in the SOURCE Info.plist, which the post-sync
# `git checkout ios/App/App/Info.plist` (the capacitor:sync:after hook drops the
# file's comments) resets to whatever is COMMITTED: while the manifest is not
# committed, that routine checkout takes it out without a word, and the binary
# still compiles, signs and uploads, then never launches. Not an ad rule, but
# this phase is the one thing every build runs, so it is proven here, together
# with the SceneDelegate the manifest names.
plist="$app/Info.plist"
scene_class='$(PRODUCT_MODULE_NAME).SceneDelegate'
scene_key=':UIApplicationSceneManifest:UISceneConfigurations:UIWindowSceneSessionRoleApplication:0:UISceneDelegateClassName'
scene_fix="Commit the manifest (UIApplicationSceneManifest, Capacitor 8.5's template, see docs/RELEASE.md) so the post-sync 'git checkout ios/App/App/Info.plist' keeps it, or restore Info.plist from a copy saved before the sync; never answer this by deleting the guard phase."
if [ ! -f "$plist" ]; then
  refuse "$plist does not exist. $scene_fix"
fi
if ! scene_got=$(/usr/libexec/PlistBuddy -c "Print $scene_key" "$plist" 2>/dev/null); then
  scene_got=''
fi
if [ "$scene_got" != "$scene_class" ]; then
  refuse "App/Info.plist carries no UIScene manifest naming $scene_class (found: '${scene_got:-nothing}'). iOS 27 does not launch this app without it. $scene_fix"
fi
if [ ! -f "$app/SceneDelegate.swift" ]; then
  refuse "App/Info.plist names $scene_class but App/SceneDelegate.swift is missing: the app would have no window. Restore it from git (Capacitor 8.5's template, plus the cold-launch reminder route)."
fi

# A live-reload leftover. `npx cap run ios -l` writes server.url into this file
# and takes it out again only on Ctrl+C; close the terminal instead and every
# later Run or Archive loads JavaScript from that dev server, whose default
# bundle is ADS:on, while App/public (what is proven below) goes unused. An
# archive made then ships a binary pointing at a LAN address. plutil reads JSON;
# if it cannot parse the file at all (a JSON null, say), a plain text search for
# a "url" key decides instead, so an unreadable file never passes by accident.
cfg="$app/capacitor.config.json"
if [ -f "$cfg" ]; then
  if /usr/bin/plutil -convert xml1 -o /dev/null "$cfg" >/dev/null 2>&1; then
    if /usr/bin/plutil -extract server.url raw -o - "$cfg" >/dev/null 2>&1; then
      refuse "App/capacitor.config.json carries server.url (a leftover of 'cap run -l'): the app would load a dev server, not App/public, so nothing here can be proven. Run an npm sync chain (npm run ios:sync is the ads-off dev default), which rewrites the file from capacitor.config.ts."
    fi
  elif grep -a -q '"url"' "$cfg"; then
    refuse "App/capacitor.config.json cannot be parsed and mentions a \"url\": it may point the app at a dev server instead of App/public. Run an npm sync chain (npm run ios:sync), which rewrites the file from capacitor.config.ts."
  fi
fi

if [ ! -d "$public" ]; then
  refuse "$public does not exist. Run an npm sync chain first (npm run ios:sync, ios:testflight or ios:appstore)."
fi

set -- "$public"/*.js
if [ ! -e "$1" ]; then
  refuse "$public holds no JavaScript. Run an npm sync chain first."
fi

# Occurrences, not matching lines: a minified bundle is one very long line.
# `-a` because macOS BSD grep turns binary on a NUL byte and then reports one
# "Binary file matches" line however many markers there are: a doubled marker
# (a stale chunk beside a fresh one) would count as one and pass.
count() {
  cat "$@" | grep -a -oF -- "$marker" | wc -l | tr -d ' '
}
has() {
  cat "$@" | grep -a -qF -- "$marker"
}

# An AdMob-era bundle: it carries the terminated publisher's unit ids.
marker='ca-app-pub-'
if has "$@"; then
  refuse "App/public carries AdMob unit ids: an AdMob-era bundle from a terminated publisher. Nothing may build from it. Run an npm sync chain."
fi

# Boot-mode entries from the portfolio (Test Suite, ad-id capture). Exactly 67
# has neither today and every npm gate refuses them; if one is ever ported,
# it may be Run on the owner's own phone and never archived.
for marker in 'TESTSUITE:1' 'ADIDCAPTURE:1'; do
  if has "$@"; then
    if [ "$action" = "install" ]; then
      refuse "App/public holds a $marker boot-mode build, not the game. It must never be archived."
    fi
    if [ -n "$target" ]; then
      refuse "AD_TARGET=$target but App/public holds a $marker boot-mode build, not the game. Unset AD_TARGET for a Run."
    fi
    echo "note: $tag: $marker boot-mode build: Run only, never archive or upload it. Any ad it shows is LIVE: look, never tap."
    exit 0
  fi
done

marker='ADMODE:live'; n_live=$(count "$@")
marker='ADMODE:test'; n_test=$(count "$@")
marker='ADS:on';      n_on=$(count "$@")
marker='ADS:off';     n_off=$(count "$@")
marker='ADS:mock';    n_mock=$(count "$@")
marker='UNLOCKALL:1'; n_unlock=$(count "$@")
echo "note: $tag: ACTION=$action AD_TARGET=${target:-(unset)}; markers ADMODE:live x$n_live ADMODE:test x$n_test ADS:on x$n_on ADS:off x$n_off ADS:mock x$n_mock UNLOCKALL:1 x$n_unlock"

if [ $((n_live + n_test)) -ne 1 ]; then
  if [ $((n_live + n_test)) -eq 0 ]; then
    refuse "App/public carries no ADMODE marker. It predates the LevelPlay migration or the seam moved; it cannot be proven safe. Run an npm sync chain."
  fi
  refuse "App/public carries more than one ADMODE marker: a stale chunk sits beside a fresh one. It cannot be proven safe. Run an npm sync chain."
fi
if [ $((n_on + n_off + n_mock)) -ne 1 ]; then
  if [ $((n_on + n_off + n_mock)) -eq 0 ]; then
    refuse "App/public carries no ADS marker (ADS:on / ADS:off / ADS:mock). It cannot be proven. Run an npm sync chain."
  fi
  refuse "App/public carries more than one ADS marker: a stale chunk sits beside a fresh one. Run an npm sync chain."
fi
if [ "$n_unlock" -gt 1 ]; then
  refuse "App/public carries UNLOCKALL:1 $n_unlock times: a stale chunk or a second seam. Run an npm sync chain."
fi

mode=test; [ "$n_live" -eq 1 ] && mode=live
ads=on; [ "$n_off" -eq 1 ] && ads=off; [ "$n_mock" -eq 1 ] && ads=mock

# The FAKE store (services/providers/mockIap) hands out every product for free.
# It belongs to fake-ads bundles only; scripts/check-iap-mock-off.mjs keeps it out
# of every other npm chain, and this keeps it out of every other binary.
marker='IAP:mock'; n_iapmock=$(count "$@")
if [ "$n_iapmock" -gt 0 ] && [ "$ads" != mock ]; then
  refuse "App/public carries the FAKE store (IAP:mock) in an ADS:$ads bundle: every purchase would be free. Run the npm sync chain for this target."
fi

# Contradictions baked into the bundle itself, whatever anybody states.
if [ "$mode" = "live" ] && [ "$ads" != "on" ]; then
  refuse "App/public carries ADMODE:live with ADS:$ads: a store build that never loads a real ad is a contradiction, not a mode. Rebuild without VITE_ADS (npm run ios:appstore)."
fi
if [ "$n_unlock" -eq 1 ] && { [ "$mode" = "live" ] || [ "$target" = "live" ]; }; then
  refuse "App/public unlocks EVERY level (UNLOCKALL:1, the TestFlight-only VITE_UNLOCK_ALL flag) and this is a live build. On the App Store it gives all 600 levels to every player. Rebuild without VITE_UNLOCK_ALL (npm run ios:appstore)."
fi

# The FAKE-ads build. It carries ADMODE:test like an ordinary test build and
# would otherwise pass as one; shipping it means players watching rectangles we
# drew ourselves while the app earns nothing, and everything LOOKS fine.
if [ "$ads" = "mock" ]; then
  if [ "$target" = "mock" ]; then
    echo "note: $tag: FAKE-ADS build (ADS:mock), AD_TARGET=mock stated: ads drawn in the web view, no ad network, nothing billed. TestFlight only; fastlane submit refuses it."
    exit 0
  fi
  if [ "$action" = "install" ]; then
    refuse "App/public holds a FAKE-ADS build (ADS:mock): our own drawn ads, zero revenue. It is archived only under AD_TARGET=mock (the fake-ads TestFlight build). Otherwise rebuild with 'npm run ios:testflight' (ads off) or 'npm run ios:appstore' (live)."
  fi
  if [ -n "$target" ]; then
    refuse "AD_TARGET=$target but App/public holds a FAKE-ADS build (ADS:mock). State AD_TARGET=mock for it, unset AD_TARGET for a Run, or rebuild the bundle the target names."
  fi
  echo "note: $tag: FAKE-ADS build (ADS:mock): no ad network is called, nothing is billed."
  exit 0
fi
if [ "$target" = "mock" ]; then
  refuse "AD_TARGET=mock but App/public carries ADS:$ads, not the fake-ads bundle. Run 'npm run ios:testflight:mock' first."
fi

if [ "$mode" = "live" ]; then
  if [ "$target" != "live" ]; then
    refuse "App/public carries a LIVE-ads bundle (ADMODE:live) and nobody said so. This binary would serve REAL ads. For the App Store build run 'AD_TARGET=live fastlane archive' (or pass AD_TARGET=live to xcodebuild) and follow it IMMEDIATELY with the ads-off build N+1 (npm run ios:testflight, AD_TARGET=off). For anything else run 'npm run ios:testflight' or 'npm run ios:sync' first."
  fi
  echo "warning: $tag: building a LIVE-ads bundle on purpose (AD_TARGET=live). REAL ads. Two-build rule: upload the ads-off build N+1 right after this one, and never open this build from TestFlight."
  exit 0
fi

# mode=test from here on.
if [ "$target" = "live" ]; then
  refuse "AD_TARGET=live but App/public carries a TEST bundle (ADMODE:test): a store build that earns nothing. Run 'npm run ios:appstore' first, or drop AD_TARGET."
fi

if [ "$ads" = "off" ]; then
  if [ "$target" = "test" ]; then
    refuse "AD_TARGET=test but App/public carries an ads-off bundle (ADS:off). An ads-off bundle never passes as the test build; if it is meant, state AD_TARGET=off."
  fi
  echo "note: $tag: ads-off bundle (ADS:off): the ad layer never initialises; nothing loads, nothing to tap. Safe for TestFlight; not a store build.$([ "$n_unlock" -eq 1 ] && echo ' All levels unlocked (TestFlight).')"
  exit 0
fi

# mode=test, ads=on: the real waterfall under a reassuring name. A plain
# `npm run build` bakes exactly this, and `npx cap run ios` hides xcodebuild's
# output, so a warning here would never be read: without a stated
# AD_TARGET=test it does not build at all.
if [ "$target" = "off" ]; then
  refuse "AD_TARGET=off but App/public carries ADS:on: this bundle loads the LIVE waterfall. Run 'npm run ios:testflight' first, or drop AD_TARGET."
fi
if [ "$action" = "install" ]; then
  refuse "App/public carries an ADS:on TEST bundle and this is an Archive. On LevelPlay that is the REAL waterfall, and an archive is one Organizer click from TestFlight, so it is never archived, whatever AD_TARGET says. The TestFlight build must be ads-off ('npm run ios:testflight', AD_TARGET=off); for dev integration Run it instead."
fi
if [ "$target" != "test" ]; then
  refuse "App/public carries an ADS:on TEST bundle: on LevelPlay that is the REAL waterfall (isTesting only unlocks the Test Suite), which is what a plain 'npm run build' bakes. For everyday work run 'npm run ios:sync' first: it syncs the ads-off dev default. For ad integration on purpose, state AD_TARGET=test (in the environment for xcodebuild or 'npx cap run ios', or as a local user-defined build setting in Xcode, never committed) and never tap an ad."
fi
echo "warning: $tag: ADS:on TEST bundle, AD_TARGET=test stated: on LevelPlay this serves REAL ads (isTesting only unlocks the Test Suite). Dev integration only: never archive or upload it, and never tap an ad, on any build, on any phone."
exit 0
