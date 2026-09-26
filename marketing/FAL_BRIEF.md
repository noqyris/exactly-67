# fal.ai openers — what to generate, and where they belong

Rewritten after the research pass. Reasoning and sources:
[`PRODUCTION_BRIEF.md`](PRODUCTION_BRIEF.md) §5.

## The headline change: openers are a *paid* asset now

**Do not put an AI opener on an organic post.** Around half of viewers disengage
from content they read as AI, and seconds 0-2 are exactly where the swipe
happens — an AI shot there spends the only window that decides distribution on
non-product footage.

In **paid / Spark** creative the same technique is the strongest lever in the
category, so keep generating them; just route them to the boosted variants. The
`*-scale.mp4` files already built are paid creatives, not posts.

**Never generate gameplay.** That is still absolute — the gameplay is recorded,
exact, and free to re-render.

## Model

**`fal-ai/pixverse/v6/transition`** — the only endpoint combining a 1-second
minimum, a **seed**, *both* start- and end-frame control, 9:16 and 1080p.
About **$0.18 per 2s opener**; 20 openers at 3 takes each is roughly $11.

```json
{
  "duration": 2,
  "aspect_ratio": "9:16",
  "resolution": "1080p",
  "generate_audio_switch": false,
  "thinking_type": "disabled",
  "seed": 670067,
  "first_image_url": "<master brand still>",
  "end_image_url": "<frame 0 of the gameplay post>"
}
```

**Fire one test call before queueing twenty** — the v5.5 docs say 1080p is 5 or
8s only while the v6 schema advertises 1-15s. One call settles it. Fallback is
720p at half the price; the platforms recompress hard anyway.

| Disqualified | Why it matters |
|---|---|
| Kling v3, LTX-2.3, Grok Imagine, Luma Ray, Hailuo 2.3 | **No seed** — you can never iterate on a shot that worked |
| Veo 3.1 (4s), Seedance 2.0 (4s), LTX-2.3 (6s), Hailuo (6s) | Minimum duration — you pay 2-3x for footage you throw away |

`scale-01.mp4` came back 5.06s at 496x864, which is what a 4-5s-minimum model
does. Regenerate it at 1080p/2s.

**Turn native audio off explicitly.** Seedance, LTX, Kling v3 pro and Veo 3.1 all
default to generating audio, which collides with the real SFX at the cut point.

**Kill silent prompt rewriting** — the single biggest cause of a 20-clip series
drifting apart: `thinking_type:"disabled"` (PixVerse), `enable_prompt_expansion:false`
(Wan), `prompt_optimizer:false` (Hailuo), `auto_fix:false` (Veo).

## Making twenty generations look like one series

1. **Lock ONE master still** — the brass scale, pastel candy blocks, dark 67
   block, cream backdrop from `openers/scale-01.mp4`. *That still is the look;
   the prompt is not.*
2. Generate ~20 **variants of that still** with an image model (~$0.04 each):
   different block counts, angles, weights. The master carries palette, lighting
   and materials for free.
3. Feed each variant to `/transition` with an **identical prompt scaffold and a
   fixed seed**. Never write a fresh text-to-video prompt per opener. Log the
   seed with every keeper.
4. **Pin the last frame to the gameplay's first frame:**
   ```bash
   ffmpeg -i marketing/posts/N1.mp4 -vframes 1 -q:v 2 marketing/stills/frame0-N1.png
   ```
   Upload that as `end_image_url`. This is what makes twenty openers cut cleanly
   without hand-matching.
5. **Settle the style preset once** — three cheap 540p takes with `style` unset,
   `"clay"` and `"3d_animation"`. The winner becomes a fixed field for all twenty.

**Skip LoRA.** Locked master still + fixed seed gets the same consistency at zero
training cost. Revisit past ~50 openers.

## Prompt scaffold — fixed; vary only the middle clause

```
<SUBJECT MOTION> + <CAMERA MOVEMENT> + keep stable: cream background, brass scale,
pastel block colours, dark 67 block, locked horizon
```

**1. The impossible scale** — the game's own object, made physical
```
Cinematic close-up of an oversized brass balance scale on a plain cream
backdrop, one pan stacked with chunky candy-coloured weight blocks, the other
holding a single dark block reading 67. The beam wobbles and slams down hard.
Shallow depth of field, soft studio light, pastel palette, no text.
```

**2. Balloon lift** — sells the game's one twist in a second
```
A cluster of pink helium balloons yanks a heavy iron weight off a table and
into the air. Bright cream background, playful pastel colour grade, slow
motion at the moment it lifts, no text, no people.
```

**3. Hand slam** — pure kinetic, cuts beautifully into a drag
```
Top-down shot of a hand slamming a chunky blue number block onto a wooden
table. Cream backdrop, everything on the table jumps. Crisp, punchy, 2 seconds.
```

**4. The dead-meme joke** — pairs with the self-aware hooks
```
A single deflating pink balloon slowly sinking to the floor of an empty
classroom, late afternoon light through blinds, melancholy, cinematic, no text.
```

**5. Overhead scatter**
```
Overhead shot of dozens of glossy candy-coloured number tiles scattering across
a cream surface in slow motion, bouncing and settling. Soft pastel light.
```


**6. Domino collapse — the one that breaks the mechanic**
```
A wall of pastel candy blocks collapses like a domino run across a cream floor, the
last block landing upright and reading 67. Camera tracks sideways with the collapse
then snaps to a halt, locked horizon, no roll.
Keep stable: cream background, pastel block colours, dark 67 block. No text, no people,
no devices.
```

The paid winners in this category are often absurdist and unrelated to the
mechanic, so test 5-8 concepts against the *same* gameplay body rather than
confining yourself to literal scale imagery.

*(The old "UGC talking head" prompt is deleted — a synthetic presenter gives a
multi-project studio account a fake-brand feel across every game it ever ships.)*

## Device safety — a mechanical reject check

Apple permits **photography of a real device** but prohibits renderings and
simulations. An AI-generated iPhone is a simulation. Since a device adds nothing
to the hook anyway, the rule is simply: **no device in frame, ever.**

Negative-prompt every generation for:
```
iPhone, Apple, phone, smartphone, screen, home button, notch, sensor housing,
Dynamic Island, camera bump, side buttons, mute switch, logo
```
Reject on any of those — plus the rounded-corner slab silhouette and any
iOS-looking UI chrome, which Apple's list doesn't name but which reads as an
iPhone anyway. `scale-01.mp4` was checked frame by frame and is device-free.

## Labelling

Self-toggle the AI-generated content switch on any post containing AI frames.
Pre-emptive labels are reach-neutral; **retroactive auto-labels are associated
with severe reach collapse**, and platforms now auto-detect via C2PA credentials
that fal output may carry. Keeping the openers stylised rather than photoreal
also keeps them outside the mandatory-realism trigger.

## Splicing

Put downloads in **`marketing/openers/`** (gitignored), then:

```bash
python3 tools/splice-opener.py --opener-dir marketing/openers --post P1-fail
```

It conforms any resolution/framerate, adds a silent track if there is none, keeps
the **last 2 seconds**, and transitions into the gameplay **through the shared
cream background** rather than cutting or cross-dissolving — which is why the
"keep stable: cream background" clause in every prompt above matters. If a
generated opener comes back on a different backdrop, the transition will show a
colour jump.

That transition re-encodes both halves, so an opener variant costs the gameplay a
second generation (CRF 17 absorbs it). The no-opener posts are untouched.
