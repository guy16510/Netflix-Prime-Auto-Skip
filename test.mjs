import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const primeManifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const combinedManifest = JSON.parse(readFileSync("manifest.with-youtube.json", "utf8"));
const amazonSource = readFileSync("amazon.js", "utf8");
const youtubeSource = readFileSync("youtube.js", "utf8");

function validateManifest(manifest) {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background, undefined, "background worker must remain absent");
  assert.equal(manifest.permissions, undefined, "extension must not request general permissions");
  assert.equal(manifest.host_permissions, undefined, "host permissions must remain content-script scoped");
  assert.equal(manifest.update_url, undefined, "custom update URLs are not allowed");
  for (const size of [16, 32, 48, 128]) {
    assert.equal(manifest.icons[String(size)], `icons/icon${size}.png`);
    assert.equal(manifest.action.default_icon[String(size)], `icons/icon${size}.png`);
  }
}

validateManifest(primeManifest);
validateManifest(combinedManifest);
assert.equal(primeManifest.version, combinedManifest.version);
assert.equal(primeManifest.version, "2.1.0");

const primeMatches = primeManifest.content_scripts.flatMap((entry) => entry.matches ?? []);
const combinedMatches = combinedManifest.content_scripts.flatMap((entry) => entry.matches ?? []);
assert(primeMatches.some((match) => match.includes("primevideo.com")));
assert(!primeMatches.some((match) => match.includes("youtube.com")), "default manifest must be Prime-only");
assert(combinedMatches.some((match) => match.includes("youtube.com")), "combined manifest must include YouTube");

for (const [name, source] of [["amazon.js", amazonSource], ["youtube.js", youtubeSource]]) {
  execFileSync(process.execPath, ["--check", name], { stdio: "inherit" });
  for (const forbidden of ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "browser.storage", "chrome.storage"]) {
    assert(!source.includes(forbidden), `${name} contains forbidden outbound or storage API: ${forbidden}`);
  }
}

class ElementStub {
  constructor({ width = 100, height = 100, visible = true, textContent = "", label = "" } = {}) {
    this.isConnected = true;
    this.width = width;
    this.height = height;
    this.visible = visible;
    this.textContent = textContent;
    this.label = label;
    this.clicked = 0;
    this.queryMap = new Map();
    this.closestPlayer = false;
  }

  getBoundingClientRect() {
    return { width: this.width, height: this.height };
  }

  querySelectorAll(selector) {
    return this.queryMap.get(selector) ?? [];
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  closest() {
    return this.closestPlayer ? this : null;
  }

  getAttribute(name) {
    return name === "aria-label" ? this.label : null;
  }

  click() {
    this.clicked += 1;
  }
}

class VideoStub extends ElementStub {
  constructor(options = {}) {
    super(options);
    this.playbackRate = options.playbackRate ?? 1;
    this.muted = options.muted ?? false;
    this.paused = options.paused ?? false;
    this.ended = options.ended ?? false;
    this.currentSrc = options.currentSrc ?? "video.mpd";
    this.src = options.src ?? "";
    this.duration = options.duration ?? 120;
    this._currentTime = options.currentTime ?? 0;
    this.blockCurrentTime = options.blockCurrentTime ?? false;
    this.throwCurrentTime = options.throwCurrentTime ?? false;
    this.fastSeekCalls = 0;
    this.closestPlayer = options.closestPlayer ?? true;
  }

  get currentTime() {
    return this._currentTime;
  }

  set currentTime(value) {
    if (this.throwCurrentTime) throw new Error("seek blocked");
    if (!this.blockCurrentTime) this._currentTime = value;
  }

  fastSeek(value) {
    this.fastSeekCalls += 1;
    this._currentTime = value;
  }
}

class ButtonStub extends ElementStub {}

function createRuntime() {
  const documentListeners = new Map();
  const globalListeners = new Map();
  const selectorMap = new Map();
  const documentElement = new ElementStub({ width: 1920, height: 1080 });
  const observed = [];

  const document = {
    hidden: false,
    documentElement: null,
    addEventListener(name, handler) {
      documentListeners.set(name, handler);
    },
    querySelector(selector) {
      return (selectorMap.get(selector) ?? [])[0] ?? null;
    },
    querySelectorAll(selector) {
      return selectorMap.get(selector) ?? [];
    }
  };

  const sandbox = {
    __PRIME_AD_SKIPPER_TEST__: true,
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    RegExp,
    Boolean,
    Set,
    HTMLElement: ElementStub,
    HTMLVideoElement: VideoStub,
    HTMLButtonElement: ButtonStub,
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe(target, options) {
        observed.push({ target, options });
      }
      disconnect() {}
    },
    getComputedStyle(element) {
      return element.visible
        ? { display: "block", visibility: "visible", opacity: "1" }
        : { display: "none", visibility: "hidden", opacity: "0" };
    },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    document,
    addEventListener(name, handler) {
      globalListeners.set(name, handler);
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(amazonSource, sandbox, { filename: "amazon.js" });
  const api = sandbox.__primeAdSkipperTest;
  assert(api, "Prime Video test helpers were not exposed");

  function setPlayer(root, videos) {
    root.queryMap.set("video", videos);
    selectorMap.set("#dv-web-player", [root]);
    selectorMap.set(".dv-player-fullscreen", []);
    selectorMap.set("video", videos);
  }

  function setTimer(timer) {
    const selectors = [
      ".dv-player-fullscreen .atvwebplayersdk-ad-timer-remaining-time",
      ".dv-player-fullscreen .atvwebplayersdk-adtimeindicator-text",
      ".atvwebplayersdk-ad-timer-remaining-time",
      ".atvwebplayersdk-adtimeindicator-text",
      "[class*='ad-timer-remaining']",
      "[class*='adtimeindicator']"
    ];
    for (const selector of selectors) selectorMap.set(selector, timer ? [timer] : []);
  }

  function setSkipButton(button) {
    const selectors = [
      ".fu4rd6c.f1cw2swo",
      "button[class*='skip-ad']",
      "button[aria-label*='Skip Ad' i]",
      "button[aria-label*='Skip advertisement' i]"
    ];
    for (const selector of selectors) selectorMap.set(selector, button ? [button] : []);
    selectorMap.set("button", button ? [button] : []);
  }

  return {
    api,
    document,
    documentElement,
    documentListeners,
    globalListeners,
    selectorMap,
    observed,
    setPlayer,
    setTimer,
    setSkipButton
  };
}

{
  const { api } = createRuntime();
  assert.equal(api.parseRemainingSeconds("Ad 00:30"), 30);
  assert.equal(api.parseRemainingSeconds("01:02:03 remaining"), 3723);
  assert.equal(api.parseRemainingSeconds("Advertisement"), null);
  assert.equal(api.computeSeekSeconds(30), 29.25);
  assert.equal(api.computeSeekSeconds(0.75), 0);
  assert.equal(api.computeSeekSeconds(120), 90);
  assert.equal(api.constants.TARGET_REMAINING_SECONDS, 0.75);
  assert(api.constants.IDLE_CHECK_INTERVAL_MS > api.constants.ACTIVE_CHECK_INTERVAL_MS);
  assert(api.constants.ACTIVE_CHECK_INTERVAL_MS <= 50);
}

{
  const runtime = createRuntime();
  const root = new ElementStub({ width: 1920, height: 1080 });
  const hiddenPlaying = new VideoStub({ width: 1920, height: 1080, visible: false, paused: false });
  const largePaused = new VideoStub({ width: 1600, height: 900, paused: true });
  const activePlaying = new VideoStub({ width: 800, height: 450, paused: false });
  runtime.setPlayer(root, [hiddenPlaying, largePaused, activePlaying]);
  assert.equal(runtime.api.findActiveVideo(), activePlaying, "playing visible video should win");
}

{
  const runtime = createRuntime();
  const root = new ElementStub();
  const video = new VideoStub({ currentTime: 10, duration: 100, playbackRate: 1.25, muted: false });
  const timer = new ElementStub({ textContent: "Ad 00:30" });
  runtime.setPlayer(root, [video]);
  runtime.setTimer(timer);
  runtime.setSkipButton(null);

  assert.equal(runtime.api.handleAd(1000), true);
  assert.equal(video.muted, true);
  assert.equal(video.playbackRate, 16);
  assert.equal(video.currentTime, 39.25);
  assert.equal(video.fastSeekCalls, 0, "precise currentTime seek should be preferred");

  runtime.setTimer(null);
  assert.equal(runtime.api.handleAd(1100), true, "grace period should retain only fast polling");
  assert.equal(video.muted, false, "normal content must be unmuted immediately");
  assert.equal(video.playbackRate, 1.25, "normal content must restore immediately");
  assert.equal(runtime.api.getState().activeVideo, null);
}

{
  const runtime = createRuntime();
  const root = new ElementStub();
  const video = new VideoStub({ currentTime: 4, playbackRate: 1.5, muted: false });
  const button = new ButtonStub({ label: "Skip Ad" });
  runtime.setPlayer(root, [video]);
  runtime.setTimer(null);
  runtime.setSkipButton(button);

  runtime.api.handleAd(1000);
  assert.equal(button.clicked, 1);
  assert.equal(video.playbackRate, 1.5, "skip-only signals must not accelerate content");
  assert.equal(video.muted, false, "skip-only signals must not mute content");
}

{
  const runtime = createRuntime();
  const root = new ElementStub();
  const firstVideo = new VideoStub({ currentTime: 0, playbackRate: 1.25, muted: false });
  const secondVideo = new VideoStub({ currentTime: 0, playbackRate: 1.1, muted: true });
  const timer = new ElementStub({ textContent: "Ad 00:10" });
  runtime.setPlayer(root, [firstVideo]);
  runtime.setTimer(timer);
  runtime.setSkipButton(null);

  runtime.api.handleAd(1000);
  runtime.setPlayer(root, [secondVideo]);
  runtime.api.handleAd(1300);
  assert.equal(firstVideo.playbackRate, 1.25, "replaced video must be restored");
  assert.equal(firstVideo.muted, false);
  assert.equal(secondVideo.playbackRate, 16);

  runtime.setTimer(null);
  runtime.api.handleAd(1400);
  assert.equal(secondVideo.playbackRate, 1.1);
  assert.equal(secondVideo.muted, true);
}

{
  const runtime = createRuntime();
  const root = new ElementStub();
  const video = new VideoStub({ currentTime: 7 });
  runtime.setPlayer(root, [video]);
  runtime.setTimer(new ElementStub({ textContent: "Advertisement" }));
  runtime.setSkipButton(null);

  runtime.api.handleAd(1000);
  assert.equal(video.currentTime, 7, "malformed timer must not seek");
  assert.equal(video.muted, true);
  assert.equal(video.playbackRate, 16);
}

{
  const runtime = createRuntime();
  const root = new ElementStub();
  const video = new VideoStub({ currentTime: 5, blockCurrentTime: true });
  runtime.setPlayer(root, [video]);
  runtime.setTimer(new ElementStub({ textContent: "Ad 00:20" }));
  runtime.setSkipButton(null);

  runtime.api.handleAd(1000);
  assert.equal(video.fastSeekCalls, 1, "fastSeek must be fallback only");
  assert.equal(video.currentTime, 24.25);
}

{
  const runtime = createRuntime();
  const root = new ElementStub();
  const video = new VideoStub({ playbackRate: 1.25, muted: false });
  runtime.setPlayer(root, [video]);
  runtime.setTimer(new ElementStub({ textContent: "Ad 00:05" }));
  runtime.setSkipButton(null);
  runtime.document.documentElement = runtime.documentElement;

  runtime.api.start();
  assert.equal(runtime.observed.at(-1).target, root, "observer should scope itself to Prime player");
  runtime.api.handleAd(1000);
  runtime.globalListeners.get("pagehide")();
  assert.equal(video.playbackRate, 1.25);
  assert.equal(video.muted, false);
  assert.equal(runtime.api.getState().started, false);
}

{
  const runtime = createRuntime();
  const root = new ElementStub();
  const video = new VideoStub({ playbackRate: 1.3, muted: false });
  runtime.setPlayer(root, [video]);
  runtime.setTimer(new ElementStub({ textContent: "Ad 00:05" }));
  runtime.setSkipButton(null);
  runtime.api.handleAd(1000);

  runtime.document.hidden = true;
  runtime.documentListeners.get("visibilitychange")();
  assert.equal(video.playbackRate, 1.3);
  assert.equal(video.muted, false);
}

console.log("All runtime and manifest tests passed");
