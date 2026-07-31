(() => {
  "use strict";

  const CHECK_INTERVAL_MS = 150;
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

  function handleAd() {
    const timer = firstVisible(AD_TIMER_SELECTORS);
    const skipButton = findSkipButton();
    const adDetected = Boolean(timer || skipButton);

    if (!adDetected) {
      restoreVideo();
      return;
    }

    if (skipButton) {
      skipButton.click();
    }

    const video = findVideo();
    if (!video) return;
    enterAdMode(video);

    const remaining = parseRemainingSeconds(timer?.textContent || "");
    const now = Date.now();
    if (remaining && remaining > 1 && now - lastSeekAt > 700) {
      const skipSeconds = Math.min(MAX_SEEK_SECONDS, Math.max(1, remaining - 1));
      try {
        video.currentTime += skipSeconds;
        lastSeekAt = now;
        return;
      } catch {
        // Fall back to accelerating the ad.
      }
    }

    video.muted = true;
    if (video.playbackRate < 16) video.playbackRate = 16;
  }

  const observer = new MutationObserver(handleAd);

  function start() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(handleAd, CHECK_INTERVAL_MS);
    handleAd();
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
