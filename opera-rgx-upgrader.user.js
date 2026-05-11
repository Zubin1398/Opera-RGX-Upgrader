// ==UserScript==
// @name         Opera-RGX upgrader
// @namespace    https://github.com/Inet-oper/Opera-RGX-upgrader
// @version      0.1.0
// @description  Improves Opera RGX detection for dynamically created VK Video elements.
// @author       -Inet
// @match        *://vk.com/*
// @match        *://*.vk.com/*
// @match        *://vkvideo.ru/*
// @match        *://*.vkvideo.ru/*
// @match        *://m.vkvideo.ru/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function rgxVideoRescanner() {
  "use strict";

  const CONFIG = {
    debug: false,
    scanDebounceMs: 80,
    maxVideosPerScan: 80,
    maxStimulusAttempts: 3,
    stimulusDelayMs: 250,
    liveVideoNudgeCooldownMs: 1500,
    mediaStateLogCooldownMs: 1000,
    mirrorShadowVideoToLightDom: true,
    showMirrorAbovePlayer: true,
    hideMirrorWhileInteracting: true,
    mirrorInteractionHideMs: 3000,
    portalClassName: "rgx-video-rescanner-portal",
    mirrorClassName: "rgx-video-rescanner-mirror",
    observeIframes: true,
    observeShadowRoots: true,
    patchAttachShadow: true,
  };

  const STATE = {
    seenVideos: new WeakSet(),
    seenRoots: new WeakSet(),
    observedIframes: new WeakSet(),
    observedVideoAttributes: new WeakSet(),
    mirroredVideos: new WeakMap(),
    mirrorHideTimers: new WeakMap(),
    lastVideoNudgeAt: new WeakMap(),
    lastMediaLogAt: new WeakMap(),
    pendingRoots: new Set(),
    scanTimer: 0,
    originalCreateElement: Document.prototype.createElement,
    originalCreateElementNS: Document.prototype.createElementNS,
    originalSetAttribute: Element.prototype.setAttribute,
    originalAttachShadow: Element.prototype.attachShadow,
    originalLoad: HTMLMediaElement.prototype.load,
    originalPlay: HTMLMediaElement.prototype.play,
  };

  const VIDEO_EVENTS = [
    "loadstart",
    "durationchange",
    "loadedmetadata",
    "loadeddata",
    "canplay",
    "timeupdate",
  ];

  const CAPTURED_MEDIA_EVENTS = [
    "loadstart",
    "loadedmetadata",
    "loadeddata",
    "canplay",
    "canplaythrough",
    "playing",
    "pause",
    "emptied",
    "stalled",
    "waiting",
    "error",
  ];

  function log(...args) {
    if (CONFIG.debug) {
      console.log("[RGX Video Rescanner]", ...args);
    }
  }

  function warn(...args) {
    if (CONFIG.debug) {
      console.warn("[RGX Video Rescanner]", ...args);
    }
  }

  function isVideo(value) {
    return value && value.nodeName === "VIDEO";
  }

  function isOurMirrorVideo(video) {
    return isVideo(video) && video.getAttribute("data-rgx-video-rescanner") === "mirror";
  }

  function canQuery(root) {
    return root && typeof root.querySelectorAll === "function";
  }

  function dispatchSyntheticEvent(video, type) {
    try {
      video.dispatchEvent(
        new Event(type, {
          bubbles: false,
          cancelable: false,
          composed: false,
        })
      );
    } catch (error) {
      warn("Failed to dispatch event", type, video, error);
    }
  }

  function nudgeVideo(video, attempt) {
    if (!video.isConnected) {
      return;
    }

    VIDEO_EVENTS.forEach((type) => dispatchSyntheticEvent(video, type));

    try {
      if (typeof video.getBoundingClientRect === "function") {
        video.getBoundingClientRect();
      }
    } catch (error) {
      warn("Failed to read video bounds", video, error);
    }

    log("Nudged video", {
      attempt,
      src: video.currentSrc || video.src || "",
      readyState: video.readyState,
      paused: video.paused,
      width: video.videoWidth,
      height: video.videoHeight,
      element: video,
    });
  }

  function canNudgeVideo(video, cooldownMs) {
    const now = Date.now();
    const last = STATE.lastVideoNudgeAt.get(video) || 0;
    if (now - last < cooldownMs) {
      return false;
    }

    STATE.lastVideoNudgeAt.set(video, now);
    return true;
  }

  function stimulateVideo(video) {
    if (!canNudgeVideo(video, CONFIG.liveVideoNudgeCooldownMs)) {
      return;
    }

    for (let attempt = 1; attempt <= CONFIG.maxStimulusAttempts; attempt += 1) {
      window.setTimeout(() => nudgeVideo(video, attempt), CONFIG.stimulusDelayMs * (attempt - 1));
    }
  }

  function observeVideoAttributes(video) {
    if (STATE.observedVideoAttributes.has(video)) {
      return;
    }

    STATE.observedVideoAttributes.add(video);

    try {
      const observer = new MutationObserver((mutations) => {
        const changed = mutations.map((mutation) => mutation.attributeName).filter(Boolean);
        log("Video attributes changed", {
          changed,
          src: video.currentSrc || video.src || "",
          element: video,
        });
        stimulateVideo(video);
      });

      observer.observe(video, {
        attributes: true,
        attributeFilter: ["src", "poster", "style", "class", "controls", "crossorigin"],
      });
    } catch (error) {
      warn("Failed to observe video attributes", video, error);
    }
  }

  function registerVideo(video, reason) {
    if (!isVideo(video) || isOurMirrorVideo(video) || STATE.seenVideos.has(video)) {
      return;
    }

    STATE.seenVideos.add(video);

    log("Found video", {
      reason,
      src: video.currentSrc || video.src || "",
      readyState: video.readyState,
      paused: video.paused,
      muted: video.muted,
      controls: video.controls,
      element: video,
    });

    observeVideoAttributes(video);
    stimulateVideo(video);
  }

  function registerMaybeVideo(value, reason) {
    if (isVideo(value)) {
      registerVideo(value, reason);
    }
  }

  function logMediaState(video, reason) {
    if (!CONFIG.debug || !isVideo(video)) {
      return;
    }

    const now = Date.now();
    const last = STATE.lastMediaLogAt.get(video) || 0;
    if (now - last < CONFIG.mediaStateLogCooldownMs) {
      return;
    }

    STATE.lastMediaLogAt.set(video, now);

    log("Video media state", {
      reason,
      src: video.currentSrc || video.src || "",
      readyState: video.readyState,
      networkState: video.networkState,
      paused: video.paused,
      ended: video.ended,
      duration: Number.isFinite(video.duration) ? video.duration : String(video.duration),
      currentTime: video.currentTime,
      width: video.videoWidth,
      height: video.videoHeight,
      element: video,
    });
  }

  function handleCapturedMediaEvent(event) {
    const video = event.target;
    if (!isVideo(video) || isOurMirrorVideo(video)) {
      return;
    }

    registerVideo(video, `media-event:${event.type}`);
    logMediaState(video, `media-event:${event.type}`);

    if (video.readyState > 0 || video.videoWidth > 0 || video.videoHeight > 0) {
      mirrorVideoToLightDom(video, `media-event:${event.type}`);
      stimulateVideo(video);
    }
  }

  function getShadowHost(video) {
    const root = video.getRootNode ? video.getRootNode() : null;
    if (root && root.nodeType === Node.DOCUMENT_FRAGMENT_NODE && root.host) {
      return root.host;
    }

    return null;
  }

  function findPortalMount(video) {
    const shadowHost = getShadowHost(video);
    if (shadowHost) {
      const vkPlayer = shadowHost.closest && shadowHost.closest("vk-video-player");
      return vkPlayer || shadowHost;
    }

    return video.closest && (
      video.closest("vk-video-player")
      || video.closest(".shadow-root-container")
      || video.closest(".root-container")
      || video.closest(".state-container")
      || video.closest("[data-playback-state]")
    ) || video.parentElement;
  }

  function ensurePortal(mount) {
    let portal = mount.querySelector && mount.querySelector(`:scope > .${CONFIG.portalClassName}`);
    if (portal) {
      return portal;
    }

    portal = document.createElement("div");
    portal.className = CONFIG.portalClassName;
    portal.setAttribute("data-rgx-video-rescanner", "portal");
    portal.style.cssText = [
      "position:absolute",
      "inset:0",
      "width:100%",
      "height:100%",
      "overflow:hidden",
      "pointer-events:none",
      `z-index:${CONFIG.showMirrorAbovePlayer ? "2147483647" : "0"}`,
      "background:transparent",
    ].join(";");

    const mountStyle = window.getComputedStyle ? window.getComputedStyle(mount) : null;
    if (mountStyle && mountStyle.position === "static") {
      mount.style.position = "relative";
    }

    mount.insertBefore(portal, mount.firstChild);
    log("Created light DOM video portal", { mount, portal });
    return portal;
  }

  function syncMirrorVideo(sourceVideo, mirrorVideo) {
    mirrorVideo.playbackRate = sourceVideo.playbackRate;
    mirrorVideo.defaultPlaybackRate = sourceVideo.defaultPlaybackRate;
    mirrorVideo.style.objectFit = sourceVideo.style.objectFit || "contain";

    if (sourceVideo.paused) {
      mirrorVideo.style.opacity = "0";
      mirrorVideo.pause();
      return;
    }

    mirrorVideo.style.opacity = mirrorVideo.dataset.rgxHiddenByInteraction === "true" ? "0" : "1";

    const playResult = mirrorVideo.play();
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch((error) => warn("Mirror video play failed", mirrorVideo, error));
    }
  }

  function setMirrorInteractionHidden(mirrorVideo, hidden) {
    mirrorVideo.dataset.rgxHiddenByInteraction = hidden ? "true" : "false";
    mirrorVideo.style.opacity = hidden ? "0" : "1";
  }

  function temporarilyHideMirrorForControls(mirrorVideo) {
    if (!CONFIG.hideMirrorWhileInteracting) {
      return;
    }

    setMirrorInteractionHidden(mirrorVideo, true);

    const previousTimer = STATE.mirrorHideTimers.get(mirrorVideo);
    if (previousTimer) {
      window.clearTimeout(previousTimer);
    }

    const nextTimer = window.setTimeout(() => {
      if (!mirrorVideo.paused) {
        setMirrorInteractionHidden(mirrorVideo, false);
      }
      STATE.mirrorHideTimers.delete(mirrorVideo);
    }, CONFIG.mirrorInteractionHideMs);

    STATE.mirrorHideTimers.set(mirrorVideo, nextTimer);
  }

  function installMirrorInteractionReveal(mount, mirrorVideo) {
    if (!CONFIG.hideMirrorWhileInteracting) {
      return;
    }

    ["mousemove", "pointermove", "pointerdown", "touchstart", "wheel", "focusin"].forEach((eventName) => {
      mount.addEventListener(eventName, () => temporarilyHideMirrorForControls(mirrorVideo), {
        passive: true,
        capture: true,
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" || event.key === " " || event.key === "ArrowLeft" || event.key === "ArrowRight") {
        temporarilyHideMirrorForControls(mirrorVideo);
      }
    }, true);
  }

  function mirrorVideoToLightDom(video, reason) {
    if (!CONFIG.mirrorShadowVideoToLightDom || STATE.mirroredVideos.has(video) || isOurMirrorVideo(video)) {
      return;
    }

    if (!isVideo(video) || !video.isConnected || video.readyState < 1 || video.videoWidth < 1 || video.videoHeight < 1) {
      return;
    }

    if (typeof video.captureStream !== "function") {
      warn("Video captureStream is not available; cannot create light DOM mirror", video);
      return;
    }

    const mount = findPortalMount(video);
    if (!mount) {
      return;
    }

    let stream;
    try {
      stream = video.captureStream();
    } catch (error) {
      warn("Video captureStream failed", video, error);
      return;
    }

    if (!stream || stream.getVideoTracks().length === 0) {
      warn("Video captureStream returned no video tracks", {
        reason,
        stream,
        src: video.currentSrc || video.src || "",
        video,
      });
      return;
    }

    const portal = ensurePortal(mount);
    const mirrorVideo = document.createElement("video");
    mirrorVideo.className = CONFIG.mirrorClassName;
    mirrorVideo.setAttribute("data-rgx-video-rescanner", "mirror");
    mirrorVideo.muted = true;
    mirrorVideo.autoplay = true;
    mirrorVideo.playsInline = true;
    mirrorVideo.disablePictureInPicture = true;
    mirrorVideo.srcObject = stream;
    mirrorVideo.style.cssText = [
      "position:absolute",
      "inset:0",
      "width:100%",
      "height:100%",
      "display:block",
      "object-fit:contain",
      "pointer-events:none",
      "background:transparent",
      "opacity:1",
      "transition:opacity 120ms linear",
      "transform:translateZ(0)",
      "will-change:transform",
    ].join(";");

    portal.appendChild(mirrorVideo);
    STATE.mirroredVideos.set(video, mirrorVideo);
    installMirrorInteractionReveal(mount, mirrorVideo);

    ["play", "playing", "pause", "ratechange", "volumechange"].forEach((eventName) => {
      video.addEventListener(eventName, () => syncMirrorVideo(video, mirrorVideo), { passive: true });
    });

    syncMirrorVideo(video, mirrorVideo);

    log("Created light DOM mirror video", {
      reason,
      src: video.currentSrc || video.src || "",
      readyState: video.readyState,
      width: video.videoWidth,
      height: video.videoHeight,
      mount,
      portal,
      sourceElement: video,
      mirrorElement: mirrorVideo,
    });

    stimulateVideo(mirrorVideo);
  }

  function scanRoot(root, reason) {
    if (!canQuery(root)) {
      return;
    }

    root.querySelectorAll("video").forEach((video, index) => {
      if (index >= CONFIG.maxVideosPerScan) {
        return;
      }
      registerVideo(video, `${reason}:scan`);
      logMediaState(video, `${reason}:scan`);
      mirrorVideoToLightDom(video, `${reason}:scan`);
    });

    if (CONFIG.observeIframes) {
      root.querySelectorAll("iframe").forEach(observeIframe);
    }
  }

  function flushScheduledScans() {
    const roots = Array.from(STATE.pendingRoots);
    STATE.pendingRoots.clear();
    STATE.scanTimer = 0;

    roots.forEach((root) => scanRoot(root, "scheduled"));
  }

  function scheduleScan(root) {
    if (!root) {
      return;
    }

    STATE.pendingRoots.add(root);
    if (!STATE.scanTimer) {
      STATE.scanTimer = window.setTimeout(flushScheduledScans, CONFIG.scanDebounceMs);
    }
  }

  function observeRoot(root, label) {
    if (!root || STATE.seenRoots.has(root)) {
      return;
    }

    STATE.seenRoots.add(root);
    log("Observing root", label, root);

    try {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            registerMaybeVideo(node, `mutation:add:${label}`);

            if (canQuery(node)) {
              scanRoot(node, `mutation:add:${label}`);
            }

            if (CONFIG.observeShadowRoots && node.shadowRoot) {
              observeRoot(node.shadowRoot, `mutation:add:shadowRoot`);
              scheduleScan(node.shadowRoot);
            }
          });
        }

        scheduleScan(root);
      });

      observer.observe(root, {
        childList: true,
        subtree: true,
      });
    } catch (error) {
      warn("Failed to observe root", label, root, error);
    }

    scanRoot(root, `observe:${label}`);
  }

  function observeIframe(iframe) {
    if (STATE.observedIframes.has(iframe)) {
      return;
    }

    STATE.observedIframes.add(iframe);

    const tryObserve = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) {
          return;
        }

        observeRoot(doc, "iframe:document");
        if (doc.documentElement) {
          observeRoot(doc.documentElement, "iframe:documentElement");
        }
        if (doc.body) {
          observeRoot(doc.body, "iframe:body");
        }
      } catch (error) {
        warn("Cannot observe iframe; likely cross-origin", iframe, error);
      }
    };

    iframe.addEventListener("load", tryObserve, true);
    tryObserve();
  }

  function patchAttachShadow() {
    if (!CONFIG.patchAttachShadow || Element.prototype.attachShadow.__rgxVideoRescannerPatched) {
      return;
    }

    const patchedAttachShadow = function patchedAttachShadow(init) {
      const shadowRoot = STATE.originalAttachShadow.call(this, init);
      observeRoot(shadowRoot, "attachShadow");
      scheduleScan(shadowRoot);
      return shadowRoot;
    };

    Object.defineProperty(patchedAttachShadow, "__rgxVideoRescannerPatched", {
      value: true,
      configurable: false,
    });

    Element.prototype.attachShadow = patchedAttachShadow;
    log("Patched Element.prototype.attachShadow");
  }

  function patchVideoCreation() {
    if (Document.prototype.createElement.__rgxVideoRescannerPatched) {
      return;
    }

    const patchedCreateElement = function patchedCreateElement(tagName, options) {
      const element = STATE.originalCreateElement.call(this, tagName, options);
      registerMaybeVideo(element, `createElement:${String(tagName)}`);
      return element;
    };

    const patchedCreateElementNS = function patchedCreateElementNS(namespace, qualifiedName, options) {
      const element = STATE.originalCreateElementNS.call(this, namespace, qualifiedName, options);
      registerMaybeVideo(element, `createElementNS:${String(qualifiedName)}`);
      return element;
    };

    Object.defineProperty(patchedCreateElement, "__rgxVideoRescannerPatched", {
      value: true,
      configurable: false,
    });

    Object.defineProperty(patchedCreateElementNS, "__rgxVideoRescannerPatched", {
      value: true,
      configurable: false,
    });

    Document.prototype.createElement = patchedCreateElement;
    Document.prototype.createElementNS = patchedCreateElementNS;
    log("Patched document video creation");
  }

  function patchVideoAttributeChanges() {
    if (Element.prototype.setAttribute.__rgxVideoRescannerPatched) {
      return;
    }

    const patchedSetAttribute = function patchedSetAttribute(name, value) {
      const result = STATE.originalSetAttribute.call(this, name, value);
      if (isVideo(this) && String(name).toLowerCase() === "src") {
        registerVideo(this, "setAttribute:src");
        logMediaState(this, "setAttribute:src");
        stimulateVideo(this);
      }
      return result;
    };

    Object.defineProperty(patchedSetAttribute, "__rgxVideoRescannerPatched", {
      value: true,
      configurable: false,
    });

    Element.prototype.setAttribute = patchedSetAttribute;
    log("Patched video src setAttribute tracking");
  }

  function patchMediaMethods() {
    if (HTMLMediaElement.prototype.play.__rgxVideoRescannerPatched) {
      return;
    }

    const patchedLoad = function patchedLoad() {
      registerMaybeVideo(this, "HTMLMediaElement.load");
      logMediaState(this, "HTMLMediaElement.load");
      return STATE.originalLoad.apply(this, arguments);
    };

    const patchedPlay = function patchedPlay() {
      registerMaybeVideo(this, "HTMLMediaElement.play");
      logMediaState(this, "HTMLMediaElement.play");
      const result = STATE.originalPlay.apply(this, arguments);
      if (isVideo(this)) {
        window.setTimeout(() => {
          logMediaState(this, "HTMLMediaElement.play:after");
          mirrorVideoToLightDom(this, "HTMLMediaElement.play:after");
          stimulateVideo(this);
        }, 0);
      }
      return result;
    };

    Object.defineProperty(patchedLoad, "__rgxVideoRescannerPatched", {
      value: true,
      configurable: false,
    });

    Object.defineProperty(patchedPlay, "__rgxVideoRescannerPatched", {
      value: true,
      configurable: false,
    });

    HTMLMediaElement.prototype.load = patchedLoad;
    HTMLMediaElement.prototype.play = patchedPlay;
    log("Patched HTMLMediaElement load/play tracking");
  }

  function observeMediaEvents() {
    CAPTURED_MEDIA_EVENTS.forEach((eventName) => {
      document.addEventListener(eventName, handleCapturedMediaEvent, true);
    });
    log("Listening for captured media events", CAPTURED_MEDIA_EVENTS);
  }

  function observeDocumentWhenReady(doc) {
    observeRoot(doc, "document");

    if (doc.documentElement) {
      observeRoot(doc.documentElement, "documentElement");
    }

    if (doc.body) {
      observeRoot(doc.body, "body");
    } else {
      doc.addEventListener(
        "DOMContentLoaded",
        () => {
          if (doc.body) {
            observeRoot(doc.body, "body:DOMContentLoaded");
          }
          scheduleScan(doc);
        },
        { once: true }
      );
    }
  }

  function exposeDebugApi() {
    window.__rgxVideoRescanner = {
      config: CONFIG,
      scan() {
        scheduleScan(document);
      },
      version: "0.1.0",
    };
  }

  patchAttachShadow();
  patchVideoCreation();
  patchVideoAttributeChanges();
  patchMediaMethods();
  observeMediaEvents();
  observeDocumentWhenReady(document);
  exposeDebugApi();
})();
