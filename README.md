# Spotter: prototype

A shared iPad station for single-arm bicep curls. You tap in, the camera counts your reps and sets on the device and shows only an abstract figure, you enter weight once, you tap out, and you see your history on your phone.

## Run it

The station is a static app in `public/` (plain HTML, CSS and ES modules), served at `/` by a Next.js shell. That way the beta can add API routes and a real database in the same Vercel project.

```bash
npm install
npm run dev
```

Open http://localhost:3000 in Chrome or Safari. The camera works on `localhost` without HTTPS.

**On an iPad:** open the Vercel deployment URL (it's HTTPS, which iPad Safari needs before it allows the camera), then use Share → Add to Home Screen so it runs full screen. Mount the iPad about 2 m away at chest height, with the curling arm toward it.

## The flow

1. **Check in.** Tap a member card (simulated NFC), or add a new member.
2. **Consent (first visit only).** Choose camera + figure, camera with count only, or no camera (tap +1 yourself).
3. **Weight + arm.** Entered once. It pre-fills from last time.
4. **Track.** Reps are counted from the elbow angle. A set ends after 8 s with no reps, and the rest timer starts. Use −/+ to correct the current set or past sets.
5. **Check out.** You get a summary, a comparison with last time, and a QR code for the phone view. The station goes back to idle after 30 s. If nobody does anything for 3 min, it checks out automatically and the camera turns off.
6. **Phone history** (`#/history/<member-id>`). Shows a trend chart and sessions, and lets you delete a session or export a CSV.

## Real vs simulated

| Piece | Status | What the beta needs |
|---|---|---|
| Pose tracking (MediaPipe Pose Landmarker, on-device, `numPoses: 1`) | **Real** | Tune thresholds with real users (speeds, positions, body sizes) |
| Rep counting, sets ending on their own, corrections | **Real** | Validate accuracy against hand counts |
| Silhouette-only display (camera frames never drawn) | **Real** | — |
| NFC check-in/out | **Simulated** (member picker). Real Web NFC is used on Android Chrome if present | iPad can't read NFC from the web: use NFC tags/stickers that open a check-in URL on the member's phone, or a USB NFC reader |
| Cloud sync to phone | **Simulated** (browser `localStorage`) | Swap `js/store.js` for Supabase/Firebase keyed by tag ID, plus auth |
| Simulated camera | Demo aid | Turn it on from the **Prototype** badge when there's no camera |

## Files

- `next.config.ts`: rewrites `/` to `public/index.html`

- `public/js/app.js`: screens and session logic
- `public/js/reps.js`: elbow-angle curl counter (thresholds at the top)
- `public/js/pose.js`: camera + MediaPipe source, simulated source, silhouette renderer
- `public/js/store.js`: data layer (swap this for a real backend)
