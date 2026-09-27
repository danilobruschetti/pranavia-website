/* Pranavia Dojo — reveal.js
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

  var io = new IntersectionObserver(function (entries, observer) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  for (var i = 0; i < items.length; i++) io.observe(items[i]);
})();
