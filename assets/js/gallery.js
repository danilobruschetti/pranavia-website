/* Pranavia — gallery.js
   Lightbox for the photo mosaics: <a data-lightbox="group" href="big.webp"> around a <picture>.
   Without JavaScript the links simply open the larger photo. Arrow keys, swipe, Esc and the buttons work;
   the dialog is a native modal <dialog> (focus is trapped and returned to the photo that opened it). */
(function () {
  'use strict';

  var links = document.querySelectorAll('a[data-lightbox]');
  if (!links.length || typeof HTMLDialogElement === 'undefined') return;

  var icon = function (name) {
    return '<svg class="icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#i-' + name + '"></use></svg>';
  };

  var dlg = document.createElement('dialog');
  dlg.className = 'lightbox';
  dlg.setAttribute('aria-label', 'Galleria fotografica');
  dlg.innerHTML =
    '<div class="lightbox__stage" data-lb-stage></div>' +
    '<p class="lightbox__count" data-lb-count aria-live="polite"></p>' +
    '<button class="lightbox__btn lightbox__close" type="button" data-lb-close aria-label="Chiudi">' + icon('close') + '</button>' +
    '<button class="lightbox__btn lightbox__prev" type="button" data-lb-prev aria-label="Foto precedente">' + icon('prev') + '</button>' +
    '<button class="lightbox__btn lightbox__next" type="button" data-lb-next aria-label="Foto successiva">' + icon('next') + '</button>';
  document.body.appendChild(dlg);

  var stage = dlg.querySelector('[data-lb-stage]');
  var count = dlg.querySelector('[data-lb-count]');
  var list = [];
  var index = 0;
  var opener = null;

  /* the photos of one gallery, in display order (data-i) even when the layout splits them into columns */
  function groupOf(group) {
    return Array.prototype.filter.call(links, function (a) { return a.getAttribute('data-lightbox') === group; })
      .sort(function (a, b) { return (+a.getAttribute('data-i') || 0) - (+b.getAttribute('data-i') || 0); });
  }

  function show(i) {
    index = (i + list.length) % list.length;
    var pic = list[index].querySelector('picture');
    if (!pic) return;
    var clone = pic.cloneNode(true);
    var img = clone.querySelector('img');
    var ar = (parseInt(img.getAttribute('width'), 10) || 3) / (parseInt(img.getAttribute('height'), 10) || 2);
    /* the browser picks the rendition that matches the space the photo really gets */
    var sizes = 'min(92vw, ' + (86 * ar).toFixed(1) + 'vh)';
    var sources = clone.querySelectorAll('source');
    for (var s = 0; s < sources.length; s++) sources[s].setAttribute('sizes', sizes);
    img.setAttribute('sizes', sizes);
    img.removeAttribute('loading');
    img.className = 'lightbox__img';
    stage.replaceChildren(clone);
    count.textContent = (index + 1) + ' / ' + list.length;
    var one = list.length < 2;
    dlg.querySelector('[data-lb-prev]').hidden = one;
    dlg.querySelector('[data-lb-next]').hidden = one;
  }

  function open(group, start, trigger) {
    list = groupOf(group);
    opener = trigger;
    show(start);
    if (!dlg.open) dlg.showModal();
    document.documentElement.classList.add('lb-open');
  }

  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;      // let "open in new tab" work
      e.preventDefault();
      var group = this.getAttribute('data-lightbox');
      open(group, groupOf(group).indexOf(this), this);
    });
  }

  dlg.querySelector('[data-lb-close]').addEventListener('click', function () { dlg.close(); });
  dlg.querySelector('[data-lb-prev]').addEventListener('click', function () { show(index - 1); });
  dlg.querySelector('[data-lb-next]').addEventListener('click', function () { show(index + 1); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target === stage) dlg.close(); });
  dlg.addEventListener('close', function () {
    document.documentElement.classList.remove('lb-open');
    stage.replaceChildren();
    if (opener) opener.focus();
  });
  dlg.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
  });

  /* swipe */
  var x0 = null, y0 = 0;
  stage.addEventListener('pointerdown', function (e) { x0 = e.clientX; y0 = e.clientY; });
  stage.addEventListener('pointerup', function (e) {
    if (x0 === null) return;
    var dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
  });
  stage.addEventListener('pointercancel', function () { x0 = null; });
})();
