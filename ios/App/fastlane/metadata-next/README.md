# metadata-next — the 1.3.0 listing, staged

The App Store copy for the NEXT version (1.3.0: streaks, Star Jar, daily gift,
reminders, new Store, new icon, ASO name/subtitle/keywords from the 2026-09-23
research). It lives OUTSIDE `metadata/` on purpose: 1.2.1 is still waiting for
review, and `fastlane submit`, `release` and `finish` upload `./fastlane/metadata`
— copy that describes features 1.2.1 does not have would be a false listing.

When 1.3.0 is the version being submitted: replace `metadata/` with this folder
(`rm -r metadata && mv metadata-next metadata`), re-read every file, then run the
release. The name change (Exactly 67: Math Puzzle Game) only takes effect with a
version submission.
