# Privacy Policy — Exactly 67 (internal summary)

> **Not the published policy — never publish this file.** The policy players read is
> [`docs/privacy.html`](../docs/privacy.html), served at
> <https://noqyris.github.io/exactly-67/privacy.html>: the URL in the store listing and in the
> in-app consent prompt. Edit that file. This is a short summary of it, last synced to its
> 16 September 2026 version.
>
> The draft that used to live here (4 July 2026) said the app collects nothing, contains no
> advertising and makes no network connections. That stopped being true when ads arrived in 1.1.0;
> the draft survives only in git history.

- **Advertising.** A banner, an occasional full-screen ad between levels, and optional hint
  videos, through **Unity LevelPlay** (Unity Technologies, formerly ironSource) with **Unity Ads**
  demand. The ad software sends data to Unity, not to us, under Unity's own privacy policy.
- **What Unity and its partners may collect:** the advertising identifier (IDFA, only if the
  player allows tracking), the IDFV, the IP address, device and system information, and ad
  interaction data — to choose, cap and measure ads, to personalise them (only with consent and,
  for the IDFA, tracking permission), and to detect fraud.
- **Choices.** The ad software does not start at launch. After the splash the app asks for ATT,
  then shows the "Ads and your data" consent prompt. **Decline** means the ad software never
  starts: no ads, no hint videos, every level still plays. *Privacy choices* on the main menu
  re-opens the prompt; a withdrawal removes the banner at once, stops full-screen ads, hint videos
  and new ad loads, tells the ad service not to sell or share, and keeps the ad software off from
  the next launch (a later yes in the same session brings ads back). `docs/privacy.html` says the same.
  - The first launch after updating to 1.2.1 clears any consent record left over from 1.2.0's
    Google consent form, once, so the prompt is shown again rather than a Google-era answer being
    reused.
- **In-app purchases.** Hint packs (10 / 30 / 100); **No ads** (removes the banner and the ads
  between levels; hints are not included and the hint videos stay available, so the ad software
  still runs if consent was given); **Unlimited hints** (no ads, the ad software never starts). Processed by Apple (Google Play on Android); we receive no
  personal information.
- **Stored on the device only:** level progress and the last Daily Challenge date, hint balance and
  free-hint date, sound / music / haptics settings, owned purchases, the ad-spacing clear count,
  whether the rating prompt was shown, the stored consent choice, and whether the one-time consent
  reset has run. None of it is sent to us.
- **Ratings and sharing.** Apple's rating prompt, at most once; the share text holds no personal
  data.
- **Network.** The puzzles play offline. The network is used only for ads (after consent),
  purchases and restores through Apple, and Apple's rating prompt.
- **Children.** A general-audience game, not directed at children under 13; the ad software is told
  the app is not child-directed.
- **Contact:** subotic.djo@gmail.com
