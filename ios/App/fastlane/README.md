fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## iOS

### ios create_app

```sh
[bundle exec] fastlane ios create_app
```

Verify auth + create the App Store Connect app record only

### ios ad_gate

```sh
[bundle exec] fastlane ios ad_gate
```

Run the archive's ad-mode gate alone, building nothing and contacting nobody — AD_TARGET=live|off

### ios archive

```sh
[bundle exec] fastlane ios archive
```

Archive + export a signed App Store .ipa to build/Exactly67.ipa — AD_TARGET=live|off

### ios build_only

```sh
[bundle exec] fastlane ios build_only
```

Same as archive (kept for old muscle memory) — AD_TARGET=live|off

### ios upload_testflight

```sh
[bundle exec] fastlane ios upload_testflight
```

Upload build/Exactly67.ipa to TestFlight (no App Store version, no submit) and record it in the ledger — AD_TARGET=live|off

### ios release

```sh
[bundle exec] fastlane ios release
```

Full pipeline: app record, LIVE archive, upload, metadata + screenshots, submit for review (manual release) — AD_TARGET=live

### ios finish

```sh
[bundle exec] fastlane ios finish
```

Upload the already-built LIVE IPA + metadata + screenshots, submit for review (manual release) — AD_TARGET=live

### ios prep_version

```sh
[bundle exec] fastlane ios prep_version
```

Create/stage the APP_VERSION version + push metadata only (no build attach, no submit, manual release) — safe, reversible

### ios submit

```sh
[bundle exec] fastlane ios submit
```

Attach processed LIVE build BUILD_NUMBER to version APP_VERSION + submit for review (manual release); the ledger must show it live, then an ads-off N+1

### ios ledger

```sh
[bundle exec] fastlane ios ledger
```

Print the upload ledger (ios/App/build/ad-ledger.json): which build number went up as which ad mode — local, contacts nobody

### ios screenshots

```sh
[bundle exec] fastlane ios screenshots
```

Upload only the screenshots (metadata/text pushed separately via API)

### ios metadata

```sh
[bundle exec] fastlane ios metadata
```

Upload only metadata + screenshots (no build, no submit, manual release) — safe dry-ish run to validate the listing

### ios build_and_upload

```sh
[bundle exec] fastlane ios build_and_upload
```

Archive + upload to TestFlight in one shot (no App Store version, no submit), recorded in the ledger — AD_TARGET=live|off

### ios tf_latest

```sh
[bundle exec] fastlane ios tf_latest
```

Print the latest TestFlight build number ASC knows about for APP_VERSION

### ios tf_upload_only

```sh
[bundle exec] fastlane ios tf_upload_only
```

Upload the already-built IPA to TestFlight and WAIT for processing (diagnostic), recorded in the ledger — AD_TARGET=live|off

### ios asc_versions

```sh
[bundle exec] fastlane ios asc_versions
```

Print the App Store version records + their states

### ios tf_builds

```sh
[bundle exec] fastlane ios tf_builds
```

List the most recent builds ASC knows about, with processing state

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
