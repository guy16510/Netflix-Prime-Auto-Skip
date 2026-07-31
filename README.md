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

## Build and test

Node.js 18 or newer is required. There are no npm dependencies.

```bash
npm test
npm run build
```

The build output is written to `dist/extension` and can be loaded directly as an unpacked browser extension.

Run both steps together with:

```bash
npm run verify
```

## Install in Chrome or Edge

1. Run `npm run build`.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable Developer mode.
4. Select **Load unpacked**.
5. Choose `dist/extension`.

## Install temporarily in Firefox

1. Run `npm run build`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on**.
4. Choose `dist/extension/manifest.json`.

## Behavior

### Prime Video

The extension watches for Prime Video ad timers and skip controls. Idle checks run twice per second, while detected ads switch to rapid checks. Once an ad signal appears, it immediately mutes and accelerates playback, clicks an available skip control, and seeks to approximately the final 0.75 seconds of timed ads. If seeking is blocked, muted accelerated playback remains active until the program returns.

### YouTube

The extension clicks known skip buttons, closes overlays, removes promoted page elements, and accelerates in-player ads. YouTube changes its player frequently, so this is best-effort and may require selector updates. It does not use network request blocking because YouTube often serves ads and video from shared delivery infrastructure, making broad request rules brittle and likely to break playback.

## Scope

This fork intentionally removes Netflix, Disney+, Crunchyroll, Max, Paramount+, ratings, profiles, statistics, settings UI, translations, mobile user-agent changes, the original build system, and all third-party dependencies.

The repository was originally forked from `Dreamlinerm/Netflix-Prime-Auto-Skip`. The current implementation is a minimal rewrite focused on Prime Video and YouTube.
