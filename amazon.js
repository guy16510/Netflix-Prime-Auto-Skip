(() => {
  "use strict";

  const IDLE_CHECK_INTERVAL_MS = 500;
  const ACTIVE_CHECK_INTERVAL_MS = 50;
  const MUTATION_DEBOUNCE_MS = 25;
  const SEEK_RETRY_MS = 200;
  const AD_EXIT_GRACE_MS = 750;
  const TARGET_REMAINING_SECONDS = 0.75;
  const MAX_SEEK_SECONDS = 90;

  const PLAYER_ROOT_SELECTORS = ["#dv-web-player", ".dv-player-fullscreen"];
  const AD_TIMER_SELECTORS = [
    ".dv-player-fullscreen .atvwebplayersdk-ad-timer-remaining-time",
    ".dv-player-fullscreen .atvwebplayersdk-adtimeindicator-text",
    ".atvwebplayersdk-ad-timer-remaining-time",
    ".atvwebplayersdk-adtimeindicator-text",
    "[class*='ad-timer-remaining']",
    "[class*='adtimeindicator']"
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
  let observedTarget = null;
  let started = false;

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

  function getPlayerRoot() {
    for (const selector of PLAYER_ROOT_SELECTORS) {
      const root = document.querySelector(selector);
      if (root instanceof HTMLElement && root.isConnected) return root;
    }
    return null;
  }

  function findActiveVideo() {
    const candidates = [];
    const seen = new Set();
    const roots = [getPlayerRoot(), document].filter(Boolean);

    for (const root of roots) {
      for (const video of root.querySelectorAll("video")) {
        if (!(video instanceof HTMLVideoElement) || seen.has(video) || !isVisible(video)) continue;
        seen.add(video);
        candidates.push(video);
      }
    }

    let best = null;
    let bestScore = -Infinity;
    for (const video of candidates) {
      const rect = video.getBoundingClientRect();
      let score = rect.width * rect.height;
      if (!video.paused && !video.ended) score += 1_000_000_000;
      if (video.currentSrc || video.src) score += 1_000_000;
      if (typeof video.closest === "function" && video.closest("#dv-web-player, .dv-player-fullscreen")) {
        score += 100_000_000;
      }
      if (score > bestScore) {
        bestScore = score;
        best = video;
      }
    }
    return best;
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
      if (!(button instanceof HTMLButtonElement) || !isVisible(button)) continue;
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
      // Amazon may replace the player during navigation.
    }
    activeVideo = null;
  }

  function seekNearAdEnd(video, remaining, now) {
    if (now - lastSeekAt < SEEK_RETRY_MS) return "throttled";
    const skipSeconds = computeSeekSeconds(remaining);
    if (skipSeconds <= 0) return "not-needed";

    const before = video.currentTime;
    let targetTime = before + skipSeconds;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      targetTime = Math.min(targetTime, Math.max(0, video.duration - 0.05));
    }

    try {
      video.currentTime = targetTime;
      lastSeekAt = now;
      const movedPrecisely = Math.abs(video.currentTime - targetTime) < 1;
      const movedForward = video.currentTime > before + 0.5;
      if (movedPrecisely || movedForward) return "currentTime";
    } catch {
      // Fall through to fastSeek.
    }

    if (typeof video.fastSeek === "function") {
      try {
        video.fastSeek(targetTime);
        lastSeekAt = now;
        return "fastSeek";
      } catch {
        // Muted accelerated playback remains active as the fallback.
      }
    }
    return "blocked";
  }

  function handleAd(now = Date.now()) {
    const timer = firstVisible(AD_TIMER_SELECTORS);
    const skipButton = findSkipButton();
    const adDetected = Boolean(timer || skipButton);

    if (!adDetected) {
      const keepFastPolling = lastAdSignalAt > 0 && now - lastAdSignalAt <= AD_EXIT_GRACE_MS;
      restoreVideo();
      return keepFastPolling;
    }

    lastAdSignalAt = now;

    if (skipButton) skipButton.click();
    if (skipButton && !timer) {
      restoreVideo();
      return true;
    }

    const video = findActiveVideo();
    if (!video) return true;
    enterAdMode(video);

    video.muted = true;
    if (video.playbackRate < 16) video.playbackRate = 16;

    const remaining = parseRemainingSeconds(timer?.textContent || "");
    if (remaining !== null) seekNearAdEnd(video, remaining, now);
    return true;
  }

  function refreshObserverTarget() {
    const target = getPlayerRoot() || document.documentElement;
    if (!target || target === observedTarget) return;
    observer.disconnect();
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "aria-hidden"]
    });
    observedTarget = target;
  }

  function scheduleNextCheck(active) {
    if (!started) return;
    if (nextCheckTimer !== null) clearTimeout(nextCheckTimer);
    nextCheckTimer = setTimeout(() => {
      nextCheckTimer = null;
      refreshObserverTarget();
      scheduleNextCheck(handleAd());
    }, active ? ACTIVE_CHECK_INTERVAL_MS : IDLE_CHECK_INTERVAL_MS);
  }

  function queueImmediateCheck() {
    if (!started || immediateCheckTimer !== null) return;
    immediateCheckTimer = setTimeout(() => {
      immediateCheckTimer = null;
      if (nextCheckTimer !== null) {
        clearTimeout(nextCheckTimer);
        nextCheckTimer = null;
      }
      refreshObserverTarget();
      scheduleNextCheck(handleAd());
    }, MUTATION_DEBOUNCE_MS);
  }

  const observer = new MutationObserver(queueImmediateCheck);

  function start() {
    if (started || !document.documentElement) return;
    started = true;
    refreshObserverTarget();
    queueImmediateCheck();
  }

  function stop() {
    started = false;
    restoreVideo();
    observer.disconnect();
    observedTarget = null;
    if (nextCheckTimer !== null) clearTimeout(nextCheckTimer);
    if (immediateCheckTimer !== null) clearTimeout(immediateCheckTimer);
    nextCheckTimer = null;
    immediateCheckTimer = null;
  }

  function onVisibilityChange() {
    if (document.hidden) {
      restoreVideo();
      return;
    }
    if (!started) start();
    else queueImmediateCheck();
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  globalThis.addEventListener?.("pagehide", stop);
  globalThis.addEventListener?.("beforeunload", stop);
  globalThis.addEventListener?.("pageshow", start);

  if (globalThis.__PRIME_AD_SKIPPER_TEST__ === true) {
    globalThis.__primeAdSkipperTest = {
      parseRemainingSeconds,
      computeSeekSeconds,
      findActiveVideo,
      handleAd,
      restoreVideo,
      seekNearAdEnd,
      refreshObserverTarget,
      start,
      stop,
      getState: () => ({ activeVideo, savedPlaybackRate, savedMuted, lastAdSignalAt, observedTarget, started }),
      resetState: () => {
        stop();
        lastSeekAt = 0;
        lastAdSignalAt = 0;
      },
      constants: {
        IDLE_CHECK_INTERVAL_MS,
        ACTIVE_CHECK_INTERVAL_MS,
        MUTATION_DEBOUNCE_MS,
        SEEK_RETRY_MS,
        AD_EXIT_GRACE_MS,
        TARGET_REMAINING_SECONDS,
        MAX_SEEK_SECONDS
      }
    };
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
