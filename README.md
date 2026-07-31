# Prime Video Ad Skipper

A small, dependency-free Manifest V3 browser extension that skips or accelerates Amazon Prime Video ads locally.

The default build is **Prime-only**. A separate optional build also includes best-effort YouTube ad handling.

## Privacy

The extension has:

- No telemetry or analytics.
- No background worker.
- No browser storage or sync.
- No remote API calls.
- No dynamically downloaded code.
- No permissions outside the explicitly matched video pages.

Everything runs locally as content scripts.

## Prime Video behavior

- Detects visible Prime Video ad timers and skip controls.
- Clicks skip controls immediately.
- Mutes and accelerates timed ads while attempting a precise seek to roughly 0.75 seconds remaining.
- Restores playback immediately when the ad signal disappears.
- Selects the active visible player rather than blindly changing the first video element.
- Observes the Prime player subtree instead of the entire page once the player is available.
- Restores playback during tab hiding, page navigation, and player replacement.

Idle Prime Video checks run twice per second. Rapid 50 ms checks are used only while an ad signal is active or during the brief post-ad polling grace period.

## Builds

Node.js 18 or newer is required. There are no npm dependencies.

```bash
npm run verify
```

This creates:

```text
dist/extension/
dist/extension-with-youtube/
dist/prime-video-ad-skipper-v2.1.0.zip
dist/prime-video-ad-skipper-v2.1.0.sha256
dist/prime-video-ad-skipper-v2.1.0-with-youtube.zip
dist/prime-video-ad-skipper-v2.1.0-with-youtube.sha256
```

`dist/extension` is the recommended Prime-only build. `dist/extension-with-youtube` adds YouTube support.

## Install in Chrome or Edge

1. Run `npm run build`.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Select **Load unpacked**.
5. Choose `dist/extension` for Prime-only, or `dist/extension-with-youtube` for the combined build.

## Install temporarily in Firefox

1. Run `npm run build`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on**.
4. Choose the desired build's `manifest.json`.

## Testing

`npm run verify` runs:

- Manifest and privacy assertions.
- JavaScript syntax validation.
- Prime Video state-machine tests.
- Active-player selection tests.
- Ad entry and immediate restoration tests.
- Skip-only and malformed-timer tests.
- Blocked-seek fallback tests.
- Player replacement, navigation, and visibility cleanup tests.
- Prime-only and combined build validation.
- PNG icon dimensions and manifest reference checks.
- Deterministic ZIP content checks.
- SHA-256 checksum verification.

## YouTube build

The optional combined build clicks known skip buttons, closes overlays, removes common promoted page elements, and accelerates in-player ads. YouTube frequently changes its player and ad delivery, so this remains best-effort.

## Scope

This fork intentionally removes Netflix, Disney+, Crunchyroll, Max, Paramount+, ratings, profiles, statistics, settings UI, translations, mobile user-agent changes, the original build system, and all third-party dependencies.

The repository was originally forked from `Dreamlinerm/Netflix-Prime-Auto-Skip` and remains licensed under GPLv3.
