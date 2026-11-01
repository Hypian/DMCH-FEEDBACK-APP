/**
 * ui-enhance.js
 * Progressive visual and interaction enhancements for DMCH feedback application.
 * Adds GPU-accelerated scroll-reveal, smooth transitions, and interaction polish
 * without altering any DOM IDs, classes used by tests, or backend logic.
 */
(() => {
  'use strict';

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
