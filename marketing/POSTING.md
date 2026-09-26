# Posting sheet — copy-paste

Everything that goes around the video. Files are in [`posts/`](posts/).

---

## Getting people from the post into the App Store

Ranked by how many taps it costs the viewer:

| Route | Taps | Needs |
|---|---|---|
| **Link button on the post** ("Add link") | **1** | Business account **and** the feature being live in your region |
| **Bio link** | **2** | Business account (Creator needs 1,000 followers) |
| Paid / Spark CTA button | 1 | ad spend |
| **Search by name** | 3–4 | nothing |

A URL in a caption or comment is **not clickable** on TikTok or Reels, so those
are not routes at all. On YouTube Shorts the description link *does* work.

**The link:**

```
https://apps.apple.com/app/id6787536995
```

Short form on purpose — it redirects to the viewer's own storefront, so traffic
from outside the US still lands on a buyable page. Never the `/us/app/…?uo=4` form.

**Add the campaign token before trusting install numbers.** Get your provider
token from App Store Connect → App Analytics:

```
https://apps.apple.com/app/id6787536995?pt=<YOUR_TOKEN>&ct=tiktok&mt=8
```

Without `pt=`, `ct=` does not attribute and everything reads as organic.

### Which end card to build

The card must never promise a route that does not exist — a dead "link in bio"
loses the viewer entirely.

```bash
# You have a working bio link:
python3 tools/make-posts.py

# You do not (no Business account yet) — the safe default:
E67_ENDCARD=endcard-search.mp4 python3 tools/make-posts.py
```

The search variant says `search "Exactly 67"` instead. It costs a couple of taps
more, but the name is unique enough that store search lands on it, and it is
never a lie. Re-run the first command the day the bio link works.

---

## Pinned comment — post it right after uploading

On TikTok and Reels a URL here is **not** clickable, so the comment's job is to
point at the bio, not to be a link:

```
free on the App Store — link's in the bio
```

Pinning is still worth doing: pinned comments are a weighted positive signal and
they answer "where do I get it" before anyone has to ask. The trademark credit
line is already burned into the end card, so it does not need repeating.

On **YouTube Shorts** put the real URL in the description instead — it works
there.

---

## Hashtags

**Four, never five.** Past four the return collapses and it starts to read as
reach-chasing. The real keywords belong in the caption prose, which is weighted
more heavily than tags.

```
#puzzlegame #satisfying #mobilegame #indiedev
```

For the ASMR / long-chain posts:

```
#asmr #satisfying #puzzlegame #mobilegame
```

**Do not use** `#67`, `#sixseven`, `#fyp`, `#viral`, `#foryou`. The first two now
read as try-hard; the last three do nothing and have not for years.

---

## Captions

Every one ends in a question. That is worth more comments than the entire
hashtag effect — and comments are what keep a post alive past day one.

| Post | Caption |
|---|---|
| `LONG` | sixteen levels, no talking. the beam has to land on exactly 67 every time. which level lost you? |
| `N1` | it climbs to 125 before three balloons drag it back. how long would this take you? |
| `N2` | 72 of 72. it peaks at 181 and four balloons bring it home. would you have found it? |
| `N3` | 129 down to 67 in three moves. spot the one that fixes it? |
| `N4` | two pieces. 142 down to 67. faster than you? |
| `N5` | the blocks are the easy part. which balloons finish it? |
| `N6` | every single weight has to go on. it peaks at 242 before it lands on 67. would you trust that? |
| `N7` | a four-piece budget and it still overshoots to 135. which four? |
| `N8` | ten on the tray, only four may land. 131 down to 67. your pick? |
| `N9` | no leaving anything out. it hits 211 on the way. does that look solvable to you? |
| `N10` | 115, then a single balloon. can you see which one before it drops? |
| `N11` | 120 over the line and only four pieces allowed. where would you start? |
| `N12` | halfway through the game and it already needs five. how many would you have used? |
| `N13` | seven weights, all compulsory, peaking at 183. which order would you go in? |
| `N14` | the shortest solve in the pack. did you get it before the second piece landed? |
| `N15` | nothing locked, nothing capped, and it is still four exact pieces. yours? |

All lowercase, no emoji, no "link in bio" in the caption — the end card already
says it and repeating it in text reads as an ad.

Every number in these captions is real, pulled from the solver via
[`CINEMATIC_LEVELS.md`](CINEMATIC_LEVELS.md). Nothing in a caption can be
contradicted by the footage under it.

---

## Per platform

**TikTok** — caption as above + 4 hashtags. Retype the hook line as a **native
text element** over the first ~1s: burned-in text is invisible to the classifier,
so the burned version carries the muted watch and the native version gets you
indexed. Both, every time.

**Instagram Reels** — same caption. Put the hashtags in the first comment rather
than the caption. Reels favours shorter cuts, so lead with `N4`, `N10`, `N14`.

**YouTube Shorts** — search keeps surfacing these for months, so the description
does real work here. Template:

```
Exactly 67 — Level <N>. Fill the right pan so it totals exactly 67. Weights push
the pan down, balloons pull it up. 72 hand-made levels.

Free on the App Store: https://apps.apple.com/app/id6787536995

#puzzlegame #satisfying #mobilegame #indiedev
```

Title: `Exactly 67 — Level <N>` and nothing else. That is the query people type.

---

## Apple wording rules — these are binding

| Never write | Write instead |
|---|---|
| `iOS` | `iPhone`, or just "free" |
| `Apple App Store`, `iTunes App Store` | `the App Store` |
| `at the App Store` | `on the App Store` |
| `app store`, `App store` | `App Store` — both capitals, always after "the" |
| `iPhone Exactly 67` | `Exactly 67 for iPhone` |
| `IPHONE` in a caps headline | `iPhone` — lowercase i even at line start, never all-caps, never plural |
| `App Store®`, `Apple™` | no symbol at all — they are a US-only requirement and wrong on a global feed |

Never put the Apple logo in your own artwork. The end card shows it only inside
Apple's official badge, fetched unmodified from their marketing toolbox — that is
the one sanctioned route. Details in
[`PRODUCTION_BRIEF.md`](PRODUCTION_BRIEF.md) §1.

---

## Sound — one-shot, do not miss it

On the **very first post**, rename the original sound to:

```
Exactly 67 — balance SFX
```

It cannot be renamed afterwards. It becomes a permanent, tappable, game-branded
search surface, and every video anyone else makes with it links back to your
profile. Never add a trending sound to a gameplay post.

---

## The one post that is not for organic

`P1-fail.mp4` lands on 68 and never resolves. Paid/Spark only — a near-miss with
no payoff reads as engagement bait organically, and high completion followed by
no positive action is a dissatisfaction signal.
