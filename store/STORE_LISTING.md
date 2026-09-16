# App Store listing — Exactly 67

> **Internal mirror, not the source of truth.** The listing text `fastlane deliver` pushes lives in
> [`ios/App/fastlane/metadata/`](../ios/App/fastlane/metadata/) — edit it there, never here. This
> file records those values in brief, plus the answers fastlane does **not** manage (in-app
> purchases, App Privacy), which are set in the App Store Connect UI. Last synced 16 September 2026
> (1.2.1). The earlier copy in this file (72 levels, "no ads", AdMob-era privacy answers) is in git
> history only.

---

## Text fields (fastlane-managed)

| Field | Limit | Current value, or the file that holds it |
|---|---|---|
| Name | 30 | `Exactly 67: Number Puzzle` (25) — `metadata/en-US/name.txt`. The home-screen name stays `Exactly 67` (`CFBundleDisplayName`). |
| Subtitle | 30 | `Balance scale brain teaser` (26) — `subtitle.txt` |
| Keywords | 100 | `math,logic,iq,weights,offline,zen,mental,riddle,sums,addition,mind,tricky,solve,relax,nowifi` (92) — `keywords.txt` |
| Promotional text | 170 | `promotional_text.txt` (165; editable any time without review) |
| Description | 4000 | `description.txt` |
| What's New | 4000 | `release_notes.txt` (1.2.1) |
| Privacy Policy URL | — | `https://noqyris.github.io/exactly-67/privacy.html` — `privacy_url.txt`, served by GitHub Pages from [`docs/privacy.html`](../docs/privacy.html) |
| Support / Marketing URL | — | `https://noqyris.github.io/exactly-67/` |
| Categories | — | Games → Puzzle, and Board (`metadata/primary_*.txt`) |

Keyword rules: never repeat a word already in the name or subtitle (Apple indexes those), use
singular forms, commas with no spaces.

What the description promises about ads and data, which the app and the privacy policy must keep
true: a banner and an occasional full-screen ad between levels, never mid-puzzle; hint videos are
optional; "No ads" removes the banner and the ads between levels, hints not included, and the
optional hint videos stay available; "Unlimited hints" gives unlimited hints and no ads; the game
asks how data may be used for ads and the choice can be changed under *Privacy choices*; the
puzzles play offline, ads need a connection. The in-app Store card and `release_notes.txt` say the
same about "No ads".

**Screenshots** (`ios/App/fastlane/screenshots/en-US/`, pushed by `fastlane screenshots`) are stale:
they date from the 72-level build (the map chip reads `83/216`, the win card has no Share button),
while the description advertises 600 levels, sharing and the Daily Challenge. Re-capture them from
an ads-off build before 1.2.1 goes to review — see the pre-release checklist in
[`docs/RELEASE.md`](../docs/RELEASE.md#0-before-you-start--the-pre-release-checklist).

**Age rating** is set in App Store Connect; the `Deliverfile` deliberately pushes no rating config.
The app is **4+**, and guideline 2.5.18 requires ads to be appropriate for that rating, so the Unity
Ad Controls age limit is part of the pre-release checklist in
[`docs/RELEASE.md`](../docs/RELEASE.md#0-before-you-start--the-pre-release-checklist).

---

## In-app purchases (App Store Connect UI)

| Product (what it delivers) | ASC display name (last recorded) | Type | Price | Product id |
|---|---|---|---|---|
| 10 hints | 10 Hints | Consumable | $0.99 | `com.noqyris.exactly67.hints10` |
| 30 hints | 30 Hints | Consumable | $1.99 | `com.noqyris.exactly67.hints30` |
| 100 hints | 100 Hints | Consumable | $2.99 | `com.noqyris.exactly67.hints100` |
| No ads: removes the banner and the ads between levels; hints not included; the optional hint videos stay | No Ads | Non-Consumable | $0.99 | `com.noqyris.exactly67.noads` |
| Unlimited hints + no ads | **Remove Ads** — rename before 1.2.1 | Non-Consumable | **$4.99** | `com.noqyris.exactly67.removeads` (the original 1.1.0 "Remove Ads" id) |

The display names are the ones this file last recorded, not re-read from App Store Connect. They
matter because StoreKit's purchase sheet and the player's purchase history show the **ASC display
name**, never the in-app label: a player who taps the $4.99 *Unlimited hints* card is asked to
confirm "Remove Ads", next to a separate $0.99 "No Ads" — a buyer who only wanted ads gone can
believe they paid five times the price for the same thing (a 2.3 / 3.1.1 accurate-metadata risk,
and refunds). **Before 1.2.1 goes to review**, rename `removeads`'s en-US localization (e.g.
*Unlimited Hints + No Ads*) with a matching description (e.g. *Unlimited hints, and no banner or
between-level ads, forever.*), make `noads`'s description say the hint videos stay, and update this
column with the names App Store Connect actually holds.

The three packs and `noads` are first-time products in 1.2.1 and go into review **with** the version
(see [`docs/RELEASE.md`](../docs/RELEASE.md)).

> **The ladder is load-bearing.** The $4.99 unlock grants unlimited hints, so it must stay priced
> *above* the largest pack; at its old $0.99 it strictly dominated every pack. Keep
> `unlock > largest pack`, or delete the packs. Detail: [`docs/MONETIZATION.md`](../docs/MONETIZATION.md).

---

## App Privacy

Set in the App Store Connect UI at app level; fastlane does not manage it.

The published label declares **Identifiers**, **Location** and **Usage Data** as *used to track
you*, plus **Diagnostics**. It was written for AdMob and needs **no change** for Unity LevelPlay:
the label is network-agnostic, and the data *types* the ad SDK collects did not change. It agrees
with [`docs/privacy.html`](../docs/privacy.html): the ad SDK (Unity LevelPlay with Unity Ads) may
collect the advertising identifier (only with ATT permission), the IDFV, the IP address, device and
system information and ad interaction data, and it starts only after the player accepts the
consent prompt. Our own on-device data (progress, settings, purchases, hint balance) never leaves
the device and is not "collected" in the label's sense. Re-check the label only if a network is
added.

`ios/App/App/PrivacyInfo.xcprivacy` declares `NSPrivacyTracking = false` and no collected data for
**the app's own code**; the ad SDKs ship their own manifests. The comment in that file explains why
(KVIZKO's ITMS-91064 rejection).
