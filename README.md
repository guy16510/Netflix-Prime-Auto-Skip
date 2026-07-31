# Prime Video + YouTube Ad Skipper

A small, dependency-free browser extension focused on two jobs:

- Skip or accelerate ads on Amazon Prime Video.
- Skip, accelerate, mute, and hide common YouTube ad formats.

## Privacy

The extension has:

- No telemetry or analytics.
- No background worker.
- No browser storage or sync.
- No remote API calls.
- No dynamically downloaded code.
- No access outside the listed Prime Video and YouTube pages.

Everything runs locally as content scripts.

## Install in Chrome or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Select **Load unpacked**.
4. Choose this repository folder.

## Install temporarily in Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on**.
3. Choose `manifest.json`.

## Behavior

### Prime Video

The extension watches for Prime Video ad timers and skip controls. It first clicks an available skip button. For timed ads, it seeks ahead in conservative chunks. If seeking is blocked, it mutes and accelerates the ad until playback returns to the program.

### YouTube

The extension clicks known skip buttons, closes overlays, removes promoted page elements, and accelerates in-player ads. YouTube changes its player frequently, so this is best-effort and may require selector updates. It does not use network request blocking because YouTube often serves ads and video from shared delivery infrastructure, making broad request rules brittle and likely to break playback.

## Scope

This fork intentionally removes Netflix, Disney+, Crunchyroll, Max, Paramount+, ratings, profiles, statistics, settings UI, translations, mobile user-agent changes, build tooling, and all third-party dependencies.

The repository was originally forked from `Dreamlinerm/Netflix-Prime-Auto-Skip`. The current implementation is a minimal rewrite focused on Prime Video and YouTube.
