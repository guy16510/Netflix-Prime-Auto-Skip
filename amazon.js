(() => {
  "use strict";

  const IDLE_CHECK_INTERVAL_MS = 500;
  const ACTIVE_CHECK_INTERVAL_MS = 50;
  const MUTATION_DEBOUNCE_MS = 25;
  const SEEK_RETRY_MS = 200;
  const AD_EXIT_GRACE_MS = 750;
  const TARGET_REMAINING_SECONDS = 0.75;
  const MAX_SEEK_SECONDS = 90;
  const AD_TIMER_SELECTORS = [
    ".dv-player-fullscreen .atvwebplayersdk-ad-timer-remaining-time",
    ".dv-player-fullscreen .atvwebplayersdk-adtimeindicator-text",
    ".atvwebplayersdk-ad-timer-remaining-time",
    ".atvwebplayersdk-adtimeindicator-text",
    "[class*='ad-timer-remaining']",
    "[class*='adtimeindicator']"
  ];
  const VIDEO_SELECTORS = [
    ".dv-player-fullscreen video",
    "#dv-web-player video",
    "video"
  ];
  const SKIP_BUTTON_SELECTORS = [
    ".fu4rd6c.f1cw2swo",
    "button[class*='skip-ad']",
    "button[aria-label*='Skip Ad' i]",
    "button[aria-label*='Skip advertisement' i]"
  ];
  const SKIP_BUTTON_TEXT = /^(skip ad|skip advertisement|skip promo|skip trailer|ad überspringen|werbung überspringen|omitir anuncio|saltar anuncio|passer l['’]annonce)$/i;

  let activeVideo = null;
  let savedPlaybackRate = 1;
  let savedMuted = false;
  let lastSeekAt = 0;
  let lastAdSignalAt = 0;
  let nextCheckTimer = null;
  let immediateCheckTimer = null;

  function isVisible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function firstVisible(selectors) {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (isVisible(element)) return element;
      }
    }
    return null;
  }

  function findVideo() {
    for (const selector of VIDEO_SELECTORS) {
      const video = document.querySelector(selector);
      if (video instanceof HTMLVideoElement) return video;
    }
    return null;
  }

  function parseRemainingSeconds(text) {
    if (!text) return null;
    const match = text.match(/(?:\d{1,2}:){1,2}\d{2}/);
    if (!match) return null;
    const parts = match[0].split(":").map(Number);
    if (parts.some(Number.isNaN)) return null;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  function computeSeekSeconds(remaining) {
    if (!Number.isFinite(remaining) || remaining <= TARGET_REMAINING_SECONDS) return 0;
    return Math.min(MAX_SEEK_SECONDS, Math.max(0, remaining - TARGET_REMAINING_SECONDS));
  }

  function findSkipButton() {
    const selected = firstVisible(SKIP_BUTTON_SELECTORS);
    if (selected instanceof HTMLButtonElement) return selected;

    for (const button of document.querySelectorAll("button")) {
      if (!isVisible(button)) continue;
      const label = (button.getAttribute("aria-label") || button.textContent || "").replace(/\s+/g, " ").trim();
      if (SKIP_BUTTON_TEXT.test(label)) return button;
    }
    return null;
  }

  function enterAdMode(video) {
    if (activeVideo === video) return;
    restoreVideo();
    activeVideo = video;
    savedPlaybackRate = video.playbackRate || 1;
    savedMuted = video.muted;
  }

  function restoreVideo() {
    if (!activeVideo) return;
    try {
      activeVideo.playbackRate = savedPlaybackRate;
      activeVideo.muted = savedMuted;
    } catch {
      // The video element may have been replaced during navigation.
    }
    activeVideo = null;
  }

  function seekNearAdEnd(video, remaining, now) {
    if (now - lastSeekAt < SEEK_RETRY_MS) return;
    const skipSeconds = computeSeekSeconds(remaining);
    if (skipSeconds <= 0) return;

    let targetTime = video.currentTime + skipSeconds;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      targetTime = Math.min(targetTime, Math.max(0, video.duration - 0.05));
    }

    try {
      if (typeof video.fastSeek === "function") video.fastSeek(targetTime);
      else video.currentTime = targetTime;
      lastSeekAt = now;
    } catch {
      // Muting and accelerated playback remain active as the fallback.
    }
  }

  function handleAd() {
    const now = Date.now();
    const timer = firstVisible(AD_TIMER_SELECTORS);
    const skipButton = findSkipButton();
    const adDetected = Boolean(timer || skipButton);

    if (adDetected) lastAdSignalAt = now;

    if (!adDetected && now - lastAdSignalAt > AD_EXIT_GRACE_MS) {
      restoreVideo();
      return false;
    }

    if (skipButton) skipButton.click();

    const video = findVideo();
    if (!video) return adDetected;
    enterAdMode(video);

    // Silence and accelerate immediately, then attempt to seek near the ad boundary.
    video.muted = true;
    if (video.playbackRate < 16) video.playbackRate = 16;

    const remaining = parseRemainingSeconds(timer?.textContent || "");
    if (remaining !== null) seekNearAdEnd(video, remaining, now);

    return true;
  }

  function scheduleNextCheck(active) {
    if (nextCheckTimer !== null) clearTimeout(nextCheckTimer);
    nextCheckTimer = setTimeout(() => {
      nextCheckTimer = null;
      scheduleNextCheck(handleAd());
    }, active ? ACTIVE_CHECK_INTERVAL_MS : IDLE_CHECK_INTERVAL_MS);
  }

  function queueImmediateCheck() {
    if (immediateCheckTimer !== null) return;
    immediateCheckTimer = setTimeout(() => {
      immediateCheckTimer = null;
      if (nextCheckTimer !== null) {
        clearTimeout(nextCheckTimer);
        nextCheckTimer = null;
      }
      scheduleNextCheck(handleAd());
    }, MUTATION_DEBOUNCE_MS);
  }

  const observer = new MutationObserver(queueImmediateCheck);

  function start() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    queueImmediateCheck();
  }

  if (globalThis.__PRIME_AD_SKIPPER_TEST__ === true) {
    globalThis.__primeAdSkipperTest = {
      parseRemainingSeconds,
      computeSeekSeconds,
      constants: {
        IDLE_CHECK_INTERVAL_MS,
        ACTIVE_CHECK_INTERVAL_MS,
        MUTATION_DEBOUNCE_MS,
        SEEK_RETRY_MS,
        TARGET_REMAINING_SECONDS,
        MAX_SEEK_SECONDS
      }
    };
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
