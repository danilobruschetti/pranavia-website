/* Pranavia — main.js
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

/* v012 — threshold bar: underline the place (01 Dojo / 02 Centro) currently on screen. */
(function () {
  'use strict';
  var links = document.querySelectorAll('[data-threshold] a[href^="#"]');
  if (!links.length || !('IntersectionObserver' in window)) return;
  var byId = {};
  var targets = [];
  for (var i = 0; i < links.length; i++) {
    var target = document.getElementById(links[i].getAttribute('href').slice(1));
    if (!target) continue;
    byId[target.id] = links[i];
    targets.push(target);
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var link = byId[entry.target.id];
      if (link) link.classList.toggle('is-active', entry.isIntersecting);
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  targets.forEach(function (t) { io.observe(t); });
})();

/* v012 — mobile action bar ("Lezione di prova" + WhatsApp): appears after the first screen, steps aside near the
   contact band and the footer, while the menu is open and while the privacy notice is on screen. */
(function () {
  'use strict';
  var bar = document.querySelector('[data-action-bar]');
  if (!bar) return;
  var nearEnd = false;
  var ticking = false;

  var update = function () {
    ticking = false;
    var show = window.scrollY > window.innerHeight * 0.7 &&
      !nearEnd &&
      !document.body.classList.contains('is-menu-open') &&
      !document.querySelector('.privacy-notice');
    bar.classList.toggle('is-visible', show);
  };
  var request = function () {
    if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
  };

  if ('IntersectionObserver' in window) {
    var ends = Array.prototype.slice.call(document.querySelectorAll('.band, .site-footer'));
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { entry.target.__inView = entry.isIntersecting; });
      nearEnd = ends.some(function (el) { return el.__inView; });
      request();
    });
    ends.forEach(function (el) { io.observe(el); });
  }
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request, { passive: true });
  document.addEventListener('click', function () { window.setTimeout(request, 50); });
  update();
})();
