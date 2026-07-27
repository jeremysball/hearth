# Animated day/night showcase clips for the marketing site

## Problem

`site/index.html`'s "Day / night · same log" showcase section shows two static
screenshots of the hero card (light theme, dark theme). Static screenshots
don't convey what using the app actually feels like — the two-tap logging
flow, the awake timer ticking. Replace them with short, looping, silent video
clips captured from the real app.

## Content

Two clips, one per existing plate:

- **Day clip** (`plate-day`, replaces `screenshots/readme-hero-light.png`):
  the two-tap bottle-log flow in light theme — tap the log button, tap
  Bottle, tap Save, see the confetti/save moment. Matches the existing
  caption "Logging a bottle takes two taps."
- **Night clip** (`plate-night`, replaces `screenshots/readme-hero-dark.png`):
  the hero awake timer ticking with the nap-window prediction visible, in
  dark theme. Matches the existing caption "Night · offline log."

Each clip loops seamlessly, ~4–6 seconds, no audio.

## Format

Deliver as looping muted `<video>`, not literal `.gif` files — visually
identical (autoplay, loop, no controls, no sound) but 5–10x smaller and
cheaper to decode, which matters on a page judged on load speed.

```html
<video class="plate-video" autoplay muted loop playsinline
       poster="screenshots/readme-hero-light.png">
  <source src="videos/showcase-day.webm" type="video/webm">
  <source src="videos/showcase-day.mp4" type="video/mp4">
</video>
```

- Two `<source>`s per clip: webm (VP9, primary) and mp4 (H.264, Safari/iOS
  fallback — Safari does not reliably support webm).
- `poster` is the current static screenshot for that theme, reused as-is.
  It's also what renders while the video loads and what `prefers-reduced-motion`
  users see (see below).
- Target size: under ~1.5MB per clip after transcoding.
- Files live in `site/videos/`.

## Accessibility / reduced motion

The site already branches on `prefers-reduced-motion` for its scroll-linked
motion (see the `reduceMotion` check around line 1010 of `site/index.html`).
Extend the same check: when reduced motion is preferred, don't autoplay —
render the `poster` frame only (native behavior when `autoplay` is omitted/
suppressed), so motion-sensitive visitors get the same static screenshot
experience as today.

## Capture pipeline

A Playwright script drives the real dev server (the app already has a
light/dark theme toggle):

1. Boot the Go dev server (see the `run` skill) and seed enough state that
   the hero timer and nap-window prediction render meaningfully.
2. For each theme:
   - Set the theme, navigate to the home view.
   - Start `page.video()` recording.
   - Day: perform the tap-log → tap-Bottle → tap-Save flow.
   - Night: just let the hero timer/scene render for the clip duration (no
     interaction needed).
   - Stop recording.
3. `ffmpeg` trims each recording to a clean loop point and transcodes to
   both webm (VP9) and mp4 (H.264), writing into `site/videos/`.

This is a one-off authoring script (e.g. `scripts/capture-showcase-clips.js`
or similar), not part of the app or CI — it's run manually when the clips
need to be regenerated (e.g. after a UI redesign).

## Out of scope

- No new site section — this replaces the two existing static images in
  place, same section, same captions, same layout (`.plates`, `.plate-day`,
  `.plate-night` CSS classes and hover/parallax behavior stay as-is).
- No changes to the in-app changelog (marketing site, not the app itself —
  matches the existing exemption for site-only changes).
- No audio.
