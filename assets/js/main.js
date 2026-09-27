/* Pranavia Dojo — main.js
   Tiny bootstrap: header shadow on scroll. No dependencies. */
(function () {
  'use strict';

  var header = document.querySelector('[data-header]');
  if (header) {
    var ticking = false;
    var update = function () {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
      ticking = false;
    };
    update();
    window.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    }, { passive: true });
  }
})();

/* Opened straight from disk (file://)? A folder link such as ../aikido/ would show the folder listing instead of
   the page, so index.html is added. Does nothing when the site is served over http(s). */
(function () {
  'use strict';
  if (location.protocol !== 'file:') return;
  var links = document.querySelectorAll('a[href]');
  for (var i = 0; i < links.length; i++) {
    var href = links[i].getAttribute('href');
    if (!href || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) continue;
    var m = /^([^?#]*)([?#].*)?$/.exec(href);
    if (m && m[1] && m[1].charAt(m[1].length - 1) === '/') {
      links[i].setAttribute('href', m[1] + 'index.html' + (m[2] || ''));
    }
  }
})();
