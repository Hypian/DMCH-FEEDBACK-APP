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
    setupMutationObserver();
    setupActiveTouchFeedback();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
