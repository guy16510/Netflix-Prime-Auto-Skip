(() => {
  "use strict";

  const CHECK_INTERVAL_MS = 100;
  const SKIP_BUTTON_SELECTORS = [
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button-container button",
    "button[class*='ytp-ad-skip']"
  ];
  const CLOSE_OVERLAY_SELECTORS = [
    ".ytp-ad-overlay-close-button",
    ".ytp-ad-image-overlay-close-button",
    "button[aria-label='Close ad']"
  ];
  const PAGE_AD_SELECTORS = [
    "ytd-display-ad-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-video-renderer",
    "ytd-ad-slot-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-banner-promo-renderer",
    "masthead-ad"
  ];

  let activeVideo = null;
  let savedPlaybackRate = 1;
  let savedMuted = false;
  let savedVolume = 1;
  let lastPageCleanupAt = 0;

  function isVisible(element) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function clickVisible(selectors) {
    let clicked = false;
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (isVisible(element)) {
          element.click();
          clicked = true;
        }
      }
    }
    return clicked;
  }

  function removePageAds() {
    const now = Date.now();
    if (now - lastPageCleanupAt < 1000) return;
    lastPageCleanupAt = now;
    for (const selector of PAGE_AD_SELECTORS) {
      document.querySelectorAll(selector).forEach((element) => element.remove());
    }
  }

  function adIsPlaying() {
    const player = document.querySelector("#movie_player");
    if (player?.classList.contains("ad-showing")) return true;
    return Array.from(
      document.querySelectorAll(".video-ads .ytp-ad-player-overlay, .video-ads .ytp-ad-text")
    ).some(isVisible);
  }

  function enterAdMode(video) {
    if (activeVideo === video) return;
    restoreVideo();
    activeVideo = video;
    savedPlaybackRate = video.playbackRate || 1;
    savedMuted = video.muted;
    savedVolume = video.volume;
  }

  function restoreVideo() {
    if (!activeVideo) return;
    try {
      activeVideo.playbackRate = savedPlaybackRate;
      activeVideo.muted = savedMuted;
      activeVideo.volume = savedVolume;
    } catch {
      // YouTube frequently replaces the video element during navigation.
    }
    activeVideo = null;
  }

  function accelerateAd(video) {
    enterAdMode(video);
    video.muted = true;
    video.volume = 0;
    if (video.playbackRate < 16) video.playbackRate = 16;

    if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.25) {
      try {
        video.currentTime = Math.max(video.currentTime, video.duration - 0.1);
      } catch {
        // Some YouTube ad formats block seeking. Playback acceleration remains active.
      }
    }
  }

  function handleYouTube() {
    removePageAds();
    clickVisible(CLOSE_OVERLAY_SELECTORS);
    clickVisible(SKIP_BUTTON_SELECTORS);

    if (!adIsPlaying()) {
      restoreVideo();
      return;
    }

    const video = document.querySelector("video.html5-main-video, video");
    if (video instanceof HTMLVideoElement) accelerateAd(video);
  }

  function installAdStyles() {
    const style = document.createElement("style");
    style.textContent = `
      .ytp-ad-overlay-container,
      .ytp-ad-player-overlay,
      ytd-display-ad-renderer,
      ytd-promoted-sparkles-web-renderer,
      ytd-promoted-video-renderer,
      ytd-ad-slot-renderer,
      ytd-in-feed-ad-layout-renderer,
      ytd-banner-promo-renderer,
      masthead-ad {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  const observer = new MutationObserver(handleYouTube);

  function start() {
    installAdStyles();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(handleYouTube, CHECK_INTERVAL_MS);
    handleYouTube();
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
