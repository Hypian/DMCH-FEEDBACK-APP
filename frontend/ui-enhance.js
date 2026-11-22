/**
 * ui-enhance.js
 * Progressive visual and interaction enhancements for DMCH feedback application.
 * Adds GPU-accelerated scroll-reveal, smooth transitions, and interaction polish
 * without altering any DOM IDs, classes used by tests, or backend logic.
 */
(() => {
  'use strict';

  // Fallback offline / back-online connectivity alert for auth pages (login.html, signup.html)
  // where script.js is not loaded. On index.html, script.js owns the multilingual network banner.
  function initFallbackNetworkStatus() {
    if (window.__dmcNetworkManaged) return;
    window.__dmcNetworkManaged = true;

    let state = 'online';
    let wasOffline = false;
    let hideTimer = null;
    let banner = null;

    function getBanner() {
      if (banner) return banner;
      banner = document.getElementById('network-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'network-banner';
        banner.className = 'net-banner';
        banner.hidden = true;
        document.body.appendChild(banner);
      }
      return banner;
    }

    function render() {
      if (state === 'online') {
        if (!banner) return;
        banner.classList.remove('is-visible', 'is-offline', 'is-online');
        banner.hidden = true;
        banner.innerHTML = '';
        return;
      }
      const el = getBanner();
      const isOffline = state === 'offline';
      el.hidden = false;
      el.setAttribute('role', isOffline ? 'alert' : 'status');
      el.setAttribute('aria-live', isOffline ? 'assertive' : 'polite');
      el.classList.remove(isOffline ? 'is-online' : 'is-offline');
      el.classList.add(isOffline ? 'is-offline' : 'is-online', 'is-visible');
      const iconOffline = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="2" x2="22" y2="22"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>';
      const iconOnline = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>';
      const iconClose = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      el.innerHTML = isOffline
        ? `<div class="net-banner-inner">
            <span class="net-banner-icon" aria-hidden="true">${iconOffline}</span>
            <div class="net-banner-copy">
              <strong>No internet connection</strong>
              <span>Reconnect to sign in or continue.</span>
            </div>
          </div>`
        : `<div class="net-banner-inner">
            <span class="net-banner-icon" aria-hidden="true">${iconOnline}</span>
            <div class="net-banner-copy">
              <strong>You’re back online</strong>
              <span>Internet connection restored.</span>
            </div>
            <button type="button" class="net-banner-close" aria-label="Close">${iconClose}</button>
          </div>`;
      const closeBtn = el.querySelector('.net-banner-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          clearTimeout(hideTimer);
          hideTimer = null;
          state = 'online';
          render();
        }, { once: true });
      }
    }

    function onOffline() {
      clearTimeout(hideTimer);
      hideTimer = null;
      wasOffline = true;
      state = 'offline';
      render();
    }

    function onOnline() {
      if (!wasOffline) return;
      clearTimeout(hideTimer);
      wasOffline = false;
      state = 'restored';
      render();
      hideTimer = setTimeout(() => {
        hideTimer = null;
        if (state === 'restored') {
          state = 'online';
          render();
        }
      }, 4200);
    }

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    if (navigator.onLine === false) onOffline();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFallbackNetworkStatus, { once: true });
  } else {
    initFallbackNetworkStatus();
  }

  // Respect user preference for reduced motion
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motionQuery.matches) return;

  const REVEAL_SELECTOR = '.card, .cohort-card, .export-card, .user-management';

  let observer = null;
  const observedNodes = new WeakSet();

  function initObserver() {
    if (!('IntersectionObserver' in window)) return null;

    return new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    }, {
      root: null,
      rootMargin: '0px 0px -40px 0px',
      threshold: 0.08
    });
  }

  function enhanceElements(container = document) {
    if (!observer) return;

    const elements = container.querySelectorAll(REVEAL_SELECTOR);
    let staggerIndex = 0;

    elements.forEach((el) => {
      if (observedNodes.has(el)) return;
      observedNodes.add(el);

      // Do not hide top hero cards or headers
      if (el.classList.contains('adm-header')) return;

      el.classList.add('reveal');

      // Stagger initial items slightly if multiple appear at once
      if (staggerIndex < 6) {
        el.style.setProperty('--reveal-delay', `${staggerIndex * 35}ms`);
        staggerIndex++;
      }

      // Check if already well within the viewport to prevent flash
      const rect = el.getBoundingClientRect();
      if (rect.top >= 0 && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight)) {
        requestAnimationFrame(() => el.classList.add('is-visible'));
      } else {
        observer.observe(el);
      }
    });
  }

  function initBrandVideos(container = document) {
    const videos = container.querySelectorAll('.brand-reveal-video');
    videos.forEach((video) => {
      if (video.dataset.initDone) return;
      video.dataset.initDone = '1';

      const stage = video.closest('.brand-reveal-stage');
      video.muted = true;
      video.defaultMuted = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');

      const onPlaying = () => {
        if (stage) stage.classList.add('video-playing');
      };
      const onEnded = () => {
        if (stage) stage.classList.remove('video-playing');
        video.style.display = 'none';
      };
      const onError = () => {
        if (stage) stage.classList.remove('video-playing');
        video.style.display = 'none';
      };

      video.addEventListener('playing', onPlaying, { once: true });
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError);

      const p = video.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          // Autoplay blocked by mobile phone (e.g. Low Power Mode / Battery Saver)
          // Keep static SVG logo visible; hide video completely so no play button appears
          if (stage) stage.classList.remove('video-playing');
          video.style.display = 'none';
        });
      }
    });
  }

  function setupMutationObserver() {
    const app = document.getElementById('app');
    if (!app || !('MutationObserver' in window)) return;

    let scheduled = false;
    const mutObserver = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        enhanceElements(app);
        initBrandVideos(app);
      });
    });

    mutObserver.observe(app, { childList: true, subtree: true });
  }

  function setupActiveTouchFeedback() {
    // Improves touch responsiveness on mobile devices
    document.addEventListener('touchstart', () => {}, { passive: true });
  }

  function init() {
    document.documentElement.classList.add('reveal-ready');
    observer = initObserver();
    enhanceElements(document);
    initBrandVideos(document);
    setupMutationObserver();
    setupActiveTouchFeedback();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
