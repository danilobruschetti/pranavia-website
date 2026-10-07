/* Pranavia — reveal.js
   Soft fade / few-pixel translate on scroll (CSS does the animation, see components.css).
   Content is fully visible without JS, with reduced motion, or if IntersectionObserver is missing. */
(function () {
  'use strict';

  var items = document.querySelectorAll('[data-reveal]');
  if (!items.length) return;

  var showAll = function () {
    for (var i = 0; i < items.length; i++) items[i].classList.add('is-visible');
  };

  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    showAll();
    return;
  }

  /* A ".reveal-shoji" photo starts fully clipped (clip-path), and Chrome measures the intersection of the clipped
     area — zero — so it would never open. Those photos are revealed when their parent enters the viewport. */
  var groups = new Map();
  for (var i = 0; i < items.length; i++) {
    var trigger = items[i].classList.contains('reveal-shoji') && items[i].parentElement ? items[i].parentElement : items[i];
    if (!groups.has(trigger)) groups.set(trigger, []);
    groups.get(trigger).push(items[i]);
  }

  var io = new IntersectionObserver(function (entries, observer) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        groups.get(entry.target).forEach(function (el) { el.classList.add('is-visible'); });
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  groups.forEach(function (_, trigger) { io.observe(trigger); });
})();
