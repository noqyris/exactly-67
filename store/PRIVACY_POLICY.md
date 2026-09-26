# Privacy Policy — Exactly 67 (internal summary)

> **Not the published policy — never publish this file.** The policy players read is
> [`docs/privacy.html`](../docs/privacy.html), served at
> <https://noqyris.github.io/exactly-67/privacy.html>: the URL in the store listing and in the
> in-app consent prompt. Edit that file. This is a short summary of it, last synced to its
> 26 September 2026 version (1.3.0).
>
> The draft that used to live here (4 July 2026) said the app collects nothing, contains no
> advertising and makes no network connections. That stopped being true when ads arrived in 1.1.0;
> the draft survives only in git history.

- **Advertising.** A banner, an occasional full-screen ad between levels, and optional reward
  videos (extra hints, a streak freeze, …; each names its reward), through **Unity LevelPlay**
  (Unity Technologies, formerly ironSource) with **Unity Ads** demand. The ad software sends data
  to Unity, not to us, under Unity's own privacy policy.
- **What Unity and its partners may collect:** the advertising identifier (IDFA, only if the
  player allows tracking), the IDFV, the IP address, device and system information, ad
  interaction data, and performance/diagnostic data about the ad software — to choose, cap and measure ads, to personalise them (only with consent and,
  for the IDFA, tracking permission), and to detect fraud.
- **Choices.** The ad software does not start at launch. After the splash (on a brand-new
  install, only after Level 1 is finished or the player goes to the main menu) the app asks for
  ATT, then shows the "Ads and your data" consent prompt. **Decline** means the ad software never
  starts: no ads, no reward videos, every level still plays. *Privacy choices* on the main menu
  (also in Settings) re-opens the prompt; a withdrawal removes the banner at once, stops
  full-screen ads, reward videos and new ad loads, tells the ad service not to sell or share, and
  keeps the ad software off from the next launch (a later yes in the same session brings ads
  back). `docs/privacy.html` says the same.
  - The first launch after updating to 1.2.1 clears any consent record left over from 1.2.0's
    Google consent form, once, so the prompt is shown again rather than a Google-era answer being
    reused.
- **In-app purchases.** Hint packs (10 / 30 / 100); the one-time **Welcome pack** (25 hints,
  offered only while nothing has been bought on this device, in place of the 10-pack; gone once
  anything is bought); **No ads** (removes the banner and the ads between levels; hints are not
  included and the reward videos stay available, so the ad software still runs if consent was
  given); **Unlimited hints** (no ads, the ad software never starts). Processed by Apple (Google
  Play on Android); we receive no personal information. *Restore purchases* re-applies No ads /
  Unlimited hints only; bought hints (Welcome pack included) are not restored.
- **Daily reminders.** Off unless the player turns them on (the win card's *Remind me daily*,
  offered at most a few times, or *Daily reminder* in Settings); only then does iOS ask for
  notification permission, and nothing is scheduled without it. **Local notifications** scheduled
  on the device: no push server, nothing sent to us. Written from on-device state (streak, daily
  gift, next level), timed from the last few (up to 7) launch times kept on the device, planned for
  09:00–21:00 local, no ads or prices, silent after a month away. A reminder tap that cold-launches
  the app leaves the screen to open on the device, deleted at start. Off: *Daily reminder* in
  Settings (cancels pending ones) or iOS Settings → Notifications.
- **Stored on the device only:** level progress (pack medals derive from it) and the last Daily
  Challenge date; the Daily calendar (~2 months of solved days), monthly trophies and the streak
  (current / best, its dates, freezes held, a repairable broken streak); hint balance, Star Jar
  stars and which packs' one-time bonus was paid; the daily-gift day and its days-in-a-row count
  (an upgraded install also keeps 1.2.x's free-hint date, unused after the update); today's
  rewarded-video count per placement; sound / music / haptics / reminder settings; owned purchases,
  whether anything was ever bought and whether the Welcome pack was; the ad-spacing clear count;
  full-screen ads seen, app launches, and how often / when the No-ads suggestion was shown; whether
  the rating prompt was shown; how often / when reminders were offered and the last few launch
  times; the stored consent choice, and whether the one-time consent reset has run. None of it is
  sent to us (it is in the device's backups, like any app data).
- **Ratings and sharing.** Apple's rating prompt, at most once; the share text holds no personal
  data.
- **Network.** The puzzles play offline. The network is used only for ads (after consent),
  purchases and restores through Apple, and Apple's rating prompt. Reminders use no network.
- **Children.** A general-audience game, not directed at children under 13; the ad software is told
  the app is not child-directed.
- **Contact:** subotic.djo@gmail.com
