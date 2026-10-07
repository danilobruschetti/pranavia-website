/* Pranavia — navigation.js
   - Mobile menu: opens/closes, ESC closes, focus is trapped, page behind is inert.
   - Desktop place sub-menus (Dojo, Centro): hover / click / keyboard (Arrow Down, ESC).
   Progressive enhancement: without JS the menu is a plain list (see layout.css @media (scripting: none)). */
(function () {
  'use strict';

  var toggle = document.querySelector('[data-nav-toggle]');
  var nav = document.querySelector('[data-nav]');
  var header = document.querySelector('[data-header]');
  if (!toggle || !nav || !header) return;

  var desktop = window.matchMedia('(min-width: 64em)');
  var label = toggle.querySelector('[data-nav-label]');
  var subs = Array.prototype.slice.call(nav.querySelectorAll('[data-sub]'));
  var FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';
  var closeTimer = null;

  function inertTargets() {
    return document.querySelectorAll('main, .site-footer, .skip-link');
  }

  function setSub(li, open) {
    var btn = li.querySelector('[data-sub-toggle]');
    var list = li.querySelector('.site-nav__sub');
    if (!btn || !list) return;
    btn.setAttribute('aria-expanded', String(open));
    list.classList.toggle('is-open', open);
  }

  function closeSubs(except) {
    subs.forEach(function (li) { if (li !== except) setSub(li, false); });
  }

  /* ---- mobile menu ---------------------------------------------------------- */
  function isOpen() { return nav.classList.contains('is-open'); }

  function openMenu() {
    nav.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    if (label) label.textContent = 'Chiudi';
    document.body.classList.add('is-menu-open');
    inertTargets().forEach(function (el) { el.setAttribute('inert', ''); });
    // v012: on phones both places (Dojo, Centro) open already expanded — the hierarchy is visible at a glance
    subs.forEach(function (li) { setSub(li, true); });
  }

  function closeMenu(returnFocus) {
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    if (label) label.textContent = 'Menu';
    document.body.classList.remove('is-menu-open');
    inertTargets().forEach(function (el) { el.removeAttribute('inert'); });
    closeSubs();
    if (returnFocus) toggle.focus();
  }

  toggle.addEventListener('click', function () {
    if (isOpen()) closeMenu(true); else openMenu();
  });

  // links inside the panel close it (in-page anchors, same-page navigation)
  nav.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (a && !desktop.matches && isOpen()) closeMenu(false);
  });

  /* ---- sub-menus -------------------------------------------------------------- */
  subs.forEach(function (li) {
    var btn = li.querySelector('[data-sub-toggle]');
    var list = li.querySelector('.site-nav__sub');
    if (!btn || !list) return;

    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      if (desktop.matches) closeSubs(li);
      setSub(li, open);
    });

    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSub(li, true);
        var first = list.querySelector('a');
        if (first) first.focus();
      }
    });

    li.addEventListener('mouseenter', function () {
      if (!desktop.matches) return;
      window.clearTimeout(closeTimer);
      closeSubs(li);
      setSub(li, true);
    });
    li.addEventListener('mouseleave', function () {
      if (!desktop.matches) return;
      closeTimer = window.setTimeout(function () { setSub(li, false); }, 160);
    });
    li.addEventListener('focusout', function (e) {
      if (!desktop.matches) return;
      if (!e.relatedTarget || !li.contains(e.relatedTarget)) setSub(li, false);
    });
  });

  document.addEventListener('click', function (e) {
    if (desktop.matches && !nav.contains(e.target)) closeSubs();
  });

  /* ---- keyboard: ESC + focus trap ---------------------------------------------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var openSub = subs.filter(function (li) {
        return li.querySelector('[data-sub-toggle]').getAttribute('aria-expanded') === 'true';
      })[0];
      if (desktop.matches && openSub) {
        setSub(openSub, false);
        openSub.querySelector('[data-sub-toggle]').focus();
      } else if (isOpen() && !desktop.matches) {
        closeMenu(true);
      }
      return;
    }
    if (e.key !== 'Tab' || desktop.matches || !isOpen()) return;

    var items = Array.prototype.slice.call(header.querySelectorAll(FOCUSABLE)).filter(function (el) {
      return el.getClientRects().length > 0;
    });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // leaving the mobile layout while the menu is open: reset everything
  var onChange = function () { if (desktop.matches) closeMenu(false); };
  if (desktop.addEventListener) desktop.addEventListener('change', onChange);
  else if (desktop.addListener) desktop.addListener(onChange);
})();
