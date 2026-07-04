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

### ios build_only

```sh
[bundle exec] fastlane ios build_only
```

Build + sign the store IPA only (no app record / upload needed)

### ios release

```sh
[bundle exec] fastlane ios release
```

Full pipeline: create app record, build+sign, upload build, push metadata+screenshots, submit for review

### ios finish

```sh
[bundle exec] fastlane ios finish
```

Upload the already-built IPA + metadata + screenshots, wait for processing, submit for review

### ios submit

```sh
[bundle exec] fastlane ios submit
```

Set age rating + attach the processed build + submit for review (text/screenshots already pushed)

### ios screenshots

```sh
[bundle exec] fastlane ios screenshots
```

Upload only the screenshots (metadata/text pushed separately via API)

### ios metadata

```sh
[bundle exec] fastlane ios metadata
```

Upload only metadata + screenshots (no build, no submit) — safe dry-ish run to validate the listing

### ios build_and_upload

```sh
[bundle exec] fastlane ios build_and_upload
```

Build + upload the binary only (no metadata, no submit) — lands a build in TestFlight

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
