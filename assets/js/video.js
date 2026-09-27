/* Pranavia Dojo — video.js
   Home hero window.
   1. A muted preview loop starts by itself a couple of seconds after the page has finished loading (never with prefers-reduced-motion, Save-Data
      or a slow connection; it pauses off-screen and in a hidden tab; a Pause button is always offered — WCAG 2.2.2).
      The still photo stays underneath, so the page is complete without the video.
   2. A click on the window opens the full video, with its soundtrack, in a modal dialog with the browser's own controls.
   Files: /assets/video/hero-preview.mp4 | hero-preview-sm.mp4 (no audio) · hero-pranavia.mp4 | hero-pranavia-720.mp4 (with audio). */
(function () {
  'use strict';

  var video = document.querySelector('[data-hero-video]');
  var openBtn = document.querySelector('[data-video-open]');
  var pauseBtn = document.querySelector('[data-video-toggle]');
  if (!video || !openBtn) return;

  var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
  var small = window.matchMedia('(max-width: 47.99em)').matches;
  var icon = function (name) {
    return '<svg class="icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#i-' + name + '"></use></svg>';
  };
  var userPaused = false;
  var dialog = null;

  /* ---- 1. preview ------------------------------------------------------------------------------------------------ */
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var slow = /(^|-)2g$/.test(conn.effectiveType || '');
  var previewSrc = small ? video.getAttribute('data-src-sm') : video.getAttribute('data-src');

  function setPause(playing) {
    if (!pauseBtn) return;
    pauseBtn.innerHTML = icon(playing ? 'pause' : 'play');
    pauseBtn.setAttribute('aria-label', playing ? 'Metti in pausa il video' : 'Riproduci il video');
  }

  function startPreview() {
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('preload', 'auto');
    video.src = previewSrc;
    video.addEventListener('canplay', function onCanPlay() {
      video.removeEventListener('canplay', onCanPlay);
      var p = video.play();
      var shown = function () {
        video.classList.add('is-playing');
        if (pauseBtn) { pauseBtn.hidden = false; setPause(true); }
      };
      if (p && p.then) p.then(shown).catch(function () { /* autoplay refused: the photo simply stays */ });
      else shown();
    });
    video.load();
  }

  if (!reduced && !conn.saveData && !slow && previewSrc && video.canPlayType('video/mp4')) {
    /* a moment after the page has finished loading: the photo is already on screen, and the video never competes with it */
    var arm = function () { window.setTimeout(startPreview, 2200); };
    if (document.readyState === 'complete') arm(); else window.addEventListener('load', arm);

    if (pauseBtn) {
      pauseBtn.addEventListener('click', function () {
        if (video.paused) { userPaused = false; video.play(); setPause(true); }
        else { userPaused = true; video.pause(); setPause(false); }
      });
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!video.classList.contains('is-playing') || (dialog && dialog.open)) return;
          if (entry.isIntersecting) { if (!userPaused) video.play().catch(function () {}); }
          else video.pause();
        });
      }, { threshold: 0.15 }).observe(video);
    }
    document.addEventListener('visibilitychange', function () {
      if (!video.classList.contains('is-playing') || (dialog && dialog.open)) return;
      if (document.hidden) video.pause(); else if (!userPaused) video.play().catch(function () {});
    });
  }

  /* ---- 2. full video with sound in a dialog ------------------------------------------------------------------------ */
  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'vdialog';
    dialog.setAttribute('aria-label', 'Video del Pranavia Dojo');
    dialog.innerHTML =
      '<div class="vdialog__stage"><video controls playsinline preload="none"></video></div>' +
      '<button class="lightbox__btn lightbox__close" type="button" aria-label="Chiudi">' + icon('close') + '</button>';
    document.body.appendChild(dialog);
    var player = dialog.querySelector('video');
    dialog.querySelector('.lightbox__close').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', function () {
      player.pause();
      player.removeAttribute('src');
      player.load();
      document.documentElement.classList.remove('lb-open');
      if (video.classList.contains('is-playing') && !userPaused) video.play().catch(function () {});
      openBtn.focus();
    });
    return player;
  }

  openBtn.addEventListener('click', function () {
    var url = (small || conn.saveData) ? openBtn.getAttribute('data-full-sm') : openBtn.getAttribute('data-full');
    if (typeof HTMLDialogElement === 'undefined') { window.location.href = url; return; }
    var player = dialog ? dialog.querySelector('video') : build();
    player.poster = openBtn.getAttribute('data-poster') || '';
    player.src = url;
    video.pause();
    dialog.showModal();
    document.documentElement.classList.add('lb-open');
    var p = player.play();                          /* a click is a user gesture: the sound is allowed */
    if (p && p.catch) p.catch(function () {});
  });
})();
