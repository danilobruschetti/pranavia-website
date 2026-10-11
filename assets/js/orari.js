/* Pranavia — orari.js
   Fills the dynamic blocks of the pages with the data read by dati-foglio.js (Google Sheet: tabs "Orari", "Avvisi" and "Eventi"):
     - a notice bar on every page and the list of notices   (avvisi)
     - the next events, highlighted (/calendario/)          (eventi)
     - the weekly calendar with filters (/calendario/)      (orari, avvisi)
     - the schedule of one course                           (orari)
     - the week of a place (/dojo/, /studio/)                (orari)
   Every block exists in the HTML with a useful fallback text, which is replaced only when valid data arrives.
   Nothing coming from the sheet is ever written as HTML: only textContent / setAttribute with checked values. */
(function () {
  'use strict';

  var Dati = window.PranaviaDati;
  if (!Dati) return;

  var scriptSrc = document.currentScript && document.currentScript.src ? document.currentScript.src : document.baseURI;
  var siteRoot = new URL('../../', scriptSrc);
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var DAYS = Dati.DAYS;

  /* a link to a page of this site (the file:// preview needs the explicit index.html) */
  function href(path) {
    var u = new URL(path, siteRoot).href;
    if (location.protocol === 'file:' && /\/(#.*)?$/.test(u)) u = u.replace(/\/(#.*)?$/, '/index.html$1');
    return u;
  }

  /* ---------------------------------------------------------------- DOM helpers */
  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function qa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function sr(text) { return h('span', 'visually-hidden', text); }

  /* an icon from the sprite at the top of every page (same markup as the rest of the site) */
  function svg(id) {
    var s = document.createElementNS(SVG_NS, 'svg');
    var attrs = { 'class': 'icon', width: '24', height: '24', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' };
    Object.keys(attrs).forEach(function (k) { s.setAttribute(k, attrs[k]); });
    var u = document.createElementNS(SVG_NS, 'use');
    u.setAttribute('href', '#i-' + id);
    s.appendChild(u);
    return s;
  }

  function setState(block, state) {
    block.setAttribute('data-stato', state);
    block.setAttribute('aria-busy', state === 'caricamento' ? 'true' : 'false');
  }

  function placeClass(ambito) { return ambito === 'dojo' ? 'is-dojo' : ambito === 'studio' ? 'is-studio' : ''; }
  function joinMeta(parts) { return parts.filter(function (p) { return p; }).join(' · '); }

  /* "19:45–21:15", read by a screen reader as "dalle 19:45 alle 21:15" */
  function timeNode(l, cls) {
    var n = h('span', cls);
    var dash = h('span', 'time-dash', '–');
    dash.setAttribute('aria-hidden', 'true');
    add(n, sr('Dalle '), document.createTextNode(Dati.formatTime(l.start)), dash, sr(' alle '), document.createTextNode(Dati.formatTime(l.end)));
    return n;
  }

  /* ---------------------------------------------------------------- store */
  var store = { orari: null, avvisi: null, eventi: null };
  var ui = { filter: 'tutte' };
  var lastKey = '';
  var renderedDay = 0;
  var pending = false;

  function lessons() { return store.orari && store.orari.state === 'ok' ? store.orari.rows : null; }
  function notices() { return store.avvisi && store.avvisi.state === 'ok' ? store.avvisi.rows : []; }

  function scheduleRender() {
    if (pending) return;
    pending = true;
    window.setTimeout(function () { pending = false; renderAll(false); }, 0);   /* a timer, not an animation frame: it also runs in background tabs */
  }

  /* what the sheet got wrong, in plain words, in the browser console (F12) */
  function report(result) {
    if (!window.console || !console.warn || !result) return;
    var name = Dati.config.tabs[result.tab] || result.tab;
    if (result.state === 'errore') console.warn('[pranavia-dati] ' + name + ': impossibile leggere il foglio (' + (result.message || 'errore') + ')');
    else if (result.state === 'header') console.warn('[pranavia-dati] ' + name + ': mancano le colonne ' + result.missing.join(', ') + ' (la scheda ha il nome giusto?)');
    else if (result.state === 'vuoto') console.info('[pranavia-dati] ' + name + ': nessuna riga utilizzabile');
    (result.errors || []).forEach(function (e) { console.warn('[pranavia-dati] ' + name + ' riga ' + e.row + ' scartata: ' + e.message); });
    (result.warnings || []).forEach(function (w) { console.warn('[pranavia-dati] ' + name + ' riga ' + w.row + ': ' + w.message); });
  }

  /* ---------------------------------------------------------------- links written in the sheet */
  var LINK_TEXT = { site: 'Vai alla pagina', mail: 'Scrivici', tel: 'Chiama', external: 'Maggiori informazioni' };

  /* A real, working link: pages of this site open in the same tab, mail and phone open the mail app / the dialler,
     other sites open in a new tab (WhatsApp links are recognised and named). */
  function linkNode(link, cls) {
    var a = h('a', cls);
    var label = LINK_TEXT[link.kind];
    var icon = 'arrow-right';
    a.href = link.kind === 'site' ? href(link.value) : link.value;
    if (link.kind === 'mail') icon = 'mail';
    else if (link.kind === 'tel') icon = 'phone';
    if (link.kind !== 'external') return add(a, document.createTextNode(label + ' '), svg(icon));
    var host = '';
    try { host = new URL(link.value).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ }
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    if (host === 'wa.me' || host === 'api.whatsapp.com' || host === 'whatsapp.com') { label = 'Scrivici su WhatsApp'; icon = 'message'; } else { icon = 'external'; }
    return add(a, document.createTextNode(label + ' '), svg(icon), sr(' (' + host + ', si apre in una nuova scheda)'));
  }

  /* ---------------------------------------------------------------- notices: a slim bar (every page) + a list in the calendar page */
  function noticeId(n) { return Dati.hash(n.testo + '|' + n.dal + '|' + n.al); }
  function dismissed(n) {
    try { return window.sessionStorage.getItem('pranavia:avviso:' + noticeId(n)) === '1'; } catch (e) { return false; }
  }
  function dismiss(n) {
    try { window.sessionStorage.setItem('pranavia:avviso:' + noticeId(n), '1'); } catch (e) { /* ignore */ }
  }

  var barSignature = '';
  function renderNoticeBar(now) {
    var main = document.getElementById('contenuto') || document.querySelector('main');
    if (!main || !main.hasAttribute('data-avviso-home')) return;         /* the strip exists on the home page only */
    /* one strip only: the first notice marked "home" in the sheet; the others are one tap away on the calendar page */
    var all = Dati.homeNotices(notices(), now).filter(function (n) { return !dismissed(n); });
    var n = all[0];
    var extra = all.length - 1;
    var sig = (n ? noticeId(n) + '|' + (n.link ? n.link.value : '') : '') + '+' + extra;
    if (sig === barSignature) return;
    barSignature = sig;
    var old = document.querySelector('[data-notice-bar]');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (!n) return;

    var bar = h('div', 'notice-bar');
    bar.setAttribute('data-notice-bar', '');
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Avvisi');
    var clip = h('div', 'notice-bar__clip');
    var item = h('div', 'notice-bar__item');
    var inner = h('div', 'container--wide notice-bar__inner');
    var body = h('div', 'notice-bar__body');
    add(body, h('p', 'notice-bar__text', n.testo));
    var actions = h('div', 'notice-bar__actions');
    if (n.link) add(actions, linkNode(n.link, 'notice-bar__link'));
    if (extra > 0) {
      var more = h('a', 'notice-bar__more', 'Altri ' + extra + (extra === 1 ? ' avviso' : ' avvisi'));
      more.href = href('calendario/');
      add(actions, more);
    }
    if (actions.firstChild) add(body, actions);
    var close = h('button', 'notice-bar__close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Chiudi l’avviso');
    close.appendChild(svg('close'));
    close.addEventListener('click', function () {
      all.forEach(dismiss);                                              /* closing the strip hides these notices for the rest of the visit */
      bar.classList.remove('is-open');
      window.setTimeout(function () { if (bar.parentNode) bar.parentNode.removeChild(bar); }, 450);
    });
    add(inner, body, close);
    add(item, inner);
    add(clip, item);
    add(bar, clip);
    main.insertBefore(bar, main.firstChild);
    void bar.offsetHeight;                                               /* draw the closed state first, then slide open */
    bar.classList.add('is-open');
  }

  function renderCalloutLists(now) {
    qa('[data-avvisi]').forEach(function (box) {
      var list = Dati.activeNotices(notices(), now);
      clear(box);
      if (!list.length) { box.hidden = true; return; }
      list.forEach(function (n) {
        var c = h('div', 'callout');
        c.setAttribute('role', 'note');
        add(c, h('p', 'callout__text', n.testo));
        if (n.al !== null) {
          var when = n.dal === n.al ? 'Solo il ' + Dati.formatDay(n.al, true)
            : (n.dal !== null ? 'Dal ' + Dati.formatDay(n.dal, true) + ' al ' : 'Fino al ') + Dati.formatDay(n.al, true);
          add(c, h('p', 'callout__dates', when));
        }
        if (n.link) add(c, linkNode(n.link, 'link-arrow callout__link'));
        add(box, c);
      });
      box.hidden = false;
    });
  }

  /* ---------------------------------------------------------------- events: only highlighted, they never change the schedule */
  function renderEvents(now) {
    qa('[data-eventi]').forEach(function (section) {
      var list = section.querySelector('[data-eventi-lista]');
      var rows = store.eventi && store.eventi.state === 'ok' ? store.eventi.rows : null;
      var next = rows ? Dati.upcomingEvents(rows, now, 6) : [];
      if (!list || !next.length) { section.hidden = true; return; }
      clear(list);
      next.forEach(function (e) {
        var p = Dati.keyParts(e.dal);
        var li = h('li', 'event');
        var date = h('time', 'event__date');
        date.setAttribute('datetime', p.y + '-' + (p.m < 10 ? '0' : '') + p.m + '-' + (p.d < 10 ? '0' : '') + p.d);
        add(date, h('span', 'event__day', String(p.d)), h('span', 'event__month', Dati.MONTHS[p.m - 1].slice(0, 3)));
        var body = h('div', 'event__body');
        var meta = h('p', 'event__meta', Dati.formatRange(e.dal, e.al, now.y));
        if (e.dal < now.key) add(meta, document.createTextNode(' '), h('span', 'badge badge--live', 'In corso'));
        add(body, meta, h('h3', 'event__title', e.titolo));
        if (e.dettagli) add(body, h('p', 'event__text', e.dettagli));
        if (e.link) add(body, linkNode(e.link, 'link-arrow event__link'));
        add(li, date, body);
        add(list, li);
      });
      section.hidden = false;
    });
  }

  /* ---------------------------------------------------------------- shared lesson parts */
  function livePast(l, now) {
    if (l.day !== now.dow) return '';
    if (now.minutes >= l.end) return 'past';
    if (now.minutes >= l.start) return 'live';
    return '';
  }

  /* ---------------------------------------------------------------- weekly calendar */
  function filterList(rows) {
    var out = [{ key: 'tutte', label: 'Tutte' }];
    var places = {};
    var slugs = {};
    rows.forEach(function (l) { if (l.ambito) places[l.ambito] = true; if (l.slug) slugs[l.slug] = true; });
    ['dojo', 'studio'].forEach(function (p) { if (places[p]) out.push({ key: p, label: Dati.PLACES[p].label, place: p }); });
    Dati.DISCIPLINES.forEach(function (d) { if (slugs[d.slug]) out.push({ key: d.slug, label: d.short }); });
    return out;
  }

  function lessonItem(l, now) {
    var li = h('li', 'lesson ' + placeClass(l.ambito));
    li.setAttribute('data-day', String(l.day));
    li.setAttribute('data-start', String(l.start));
    li.setAttribute('data-end', String(l.end));
    li.setAttribute('data-slug', l.slug || '');
    li.setAttribute('data-ambito', l.ambito || '');
    var name = h('p', 'lesson__name');
    if (l.slug) { var a = h('a', null, l.titleShort); a.href = href(l.slug + '/'); add(name, a); } else { name.textContent = l.titleShort; }
    add(li, timeNode(l, 'lesson__time'), name);
    var meta = joinMeta([l.dettagli, l.livello, l.insegnante]);
    if (meta) add(li, h('p', 'lesson__meta', meta));
    if (l.ambito) add(li, h('p', 'lesson__place', Dati.PLACES[l.ambito].label));
    var state = livePast(l, now);
    if (state === 'live') {
      var badges = h('p', 'lesson__badges');
      add(badges, h('span', 'badge badge--live', 'In corso'));
      add(li, badges);
    }
    if (state) li.classList.add('is-' + state);
    return li;
  }

  function applyFilter(block) {
    var f = ui.filter;
    var total = 0;
    qa('.lesson', block).forEach(function (li) {
      var match = f === 'tutte' || li.getAttribute('data-ambito') === f || li.getAttribute('data-slug') === f;
      li.hidden = !match;
      if (match) total++;
    });
    qa('.day', block).forEach(function (day) {
      var any = !!day.querySelector('.lesson:not([hidden])');
      day.classList.toggle('is-empty', !any);
      var empty = day.querySelector('.day__empty');
      if (empty) empty.hidden = any;
    });
    qa('.filter', block).forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-filtro') === f ? 'true' : 'false'); });
    block.classList.toggle('is-filtered', f !== 'tutte');
    var count = block.querySelector('.schedule__count');
    if (count) count.textContent = total === 0 ? 'Nessuna lezione' : total === 1 ? '1 lezione' : total + ' lezioni';
  }

  function setFilter(block, key, fromUser) {
    ui.filter = key;
    applyFilter(block);
    if (fromUser && window.history && window.history.replaceState) {
      try { window.history.replaceState(null, '', key === 'tutte' ? location.pathname + location.search : '#' + key); } catch (e) { /* ignore */ }
    }
  }

  function filterFromHash(rows) {
    var key = '';
    try { key = decodeURIComponent((location.hash || '').replace(/^#/, '')); } catch (e) { return null; }   /* a broken address must not break the page */
    if (!key) return null;
    if (key === 'centro') key = 'studio';                              /* links written before the name changed */
    var hit = filterList(rows).filter(function (f) { return f.key === key; })[0];
    return hit ? hit.key : null;
  }

  function renderWeek(block, rows, now) {
    var wanted = filterFromHash(rows);
    if (wanted) ui.filter = wanted;
    if (!filterList(rows).some(function (f) { return f.key === ui.filter; })) ui.filter = 'tutte';
    var focusKey = document.activeElement && block.contains(document.activeElement) ? document.activeElement.getAttribute('data-filtro') : null;
    clear(block);

    var toolbar = h('div', 'schedule__toolbar');
    var group = h('div', 'schedule__filters');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Filtra le lezioni');
    filterList(rows).forEach(function (f) {
      var b = h('button', 'filter' + (f.place ? ' ' + placeClass(f.place) : ''));
      b.type = 'button';
      b.setAttribute('data-filtro', f.key);
      b.setAttribute('aria-pressed', 'false');
      if (f.place) add(b, h('span', 'filter__dot'));
      add(b, document.createTextNode(f.label));
      b.addEventListener('click', function () { setFilter(block, f.key, true); });
      add(group, b);
    });
    var count = h('p', 'schedule__count');
    count.setAttribute('role', 'status');
    add(toolbar, group, count);

    var nav = h('nav', 'daynav');
    nav.setAttribute('aria-label', 'Vai al giorno');
    var days = h('ol', 'schedule__days');
    for (var d = 1; d <= 7; d++) {
      var isToday = d === now.dow;
      var id = 'giorno-' + Dati.DAYS_SHORT[d - 1].toLowerCase();
      var jump = h('a', 'daynav__link' + (isToday ? ' is-today' : ''), Dati.DAYS_MIN[d - 1]);
      jump.href = '#' + id;
      jump.setAttribute('aria-label', DAYS[d - 1]);
      add(nav, jump);
      var day = h('li', 'day' + (isToday ? ' is-today' : ''));
      day.id = id;
      var head = h('div', 'day__head');
      add(head, h('h3', 'day__name', DAYS[d - 1]));
      if (isToday) add(head, h('span', 'day__badge', 'Oggi'));
      var list = h('ul', 'day__list');
      rows.forEach(function (l) { if (l.day === d) add(list, lessonItem(l, now)); });
      add(list, h('li', 'day__empty', 'Nessuna lezione'));       /* shown by applyFilter() when the day has nothing to show */
      add(day, head, list);
      add(days, day);
    }
    add(block, toolbar, nav, days);
    applyFilter(block);
    setState(block, 'ok');
    if (focusKey) { var again = block.querySelector('.filter[data-filtro="' + focusKey + '"]'); if (again) again.focus(); }
  }

  /* ---------------------------------------------------------------- one course */
  function renderCourse(block, now) {
    var slug = block.getAttribute('data-disciplina');
    var rows = (lessons() || []).filter(function (l) { return l.slug === slug; });
    if (!rows.length) { setState(block, 'vuoto'); return; }
    clear(block);
    var ul = h('ul', 'times__list');
    rows.forEach(function (l) {
      var li = h('li', 'times__row');
      li.setAttribute('data-day', String(l.day));
      li.setAttribute('data-start', String(l.start));
      li.setAttribute('data-end', String(l.end));
      if (livePast(l, now) === 'live') li.classList.add('is-live');
      add(li, h('span', 'times__day', DAYS[l.day - 1]), timeNode(l, 'times__time'));
      var meta = joinMeta([l.dettagli, l.livello, l.insegnante]);
      if (meta) add(li, h('span', 'times__meta', meta));
      add(ul, li);
    });
    add(block, ul);
    setState(block, 'ok');
  }

  /* ---------------------------------------------------------------- the week of one place */
  function renderPlace(block, now) {
    var ambito = block.getAttribute('data-ambito');
    var rows = (lessons() || []).filter(function (l) { return l.ambito === ambito; });
    if (!rows.length) { setState(block, 'vuoto'); return; }
    clear(block);
    var strip = h('ol', 'week-strip');
    strip.setAttribute('aria-label', 'Orari settimanali ' + Dati.PLACES[ambito].of);
    add(block, strip);
    for (var d = 1; d <= 7; d++) {
      var items = rows.filter(function (l) { return l.day === d; });
      if (!items.length) continue;
      var li = h('li', 'week-strip__row');
      var title = h('h3', 'week-strip__day', DAYS[d - 1]);
      if (d === now.dow) add(title, h('span', 'week-strip__today', 'Oggi'));
      var ul = h('ul', 'week-strip__items');
      items.forEach(function (l) {
        var item = h('li');
        var a = h(l.slug ? 'a' : 'span', 'week-strip__lesson ' + placeClass(l.ambito));
        if (l.slug) a.href = href(l.slug + '/');
        var time = h('time', null, Dati.formatTime(l.start));
        time.setAttribute('datetime', Dati.formatTime(l.start));
        add(a, sr('Alle '), time, h('span', 'week-strip__name', l.titleShort));
        if (l.dettagli) add(a, h('span', 'week-strip__meta', l.dettagli));
        add(item, a);
        add(ul, item);
      });
      add(li, title, ul);
      add(strip, li);
    }
    setState(block, 'ok');
  }

  /* ---------------------------------------------------------------- orchestration */
  function renderAll(force) {
    var now = Dati.nowParts();
    var key = [store.orari && store.orari.signature, store.avvisi && store.avvisi.signature, store.eventi && store.eventi.signature, now.key].join('|');
    if (!force && key === lastKey) return;
    lastKey = key;
    renderedDay = now.key;

    renderNoticeBar(now);
    renderCalloutLists(now);
    renderEvents(now);

    var rows = lessons();
    qa('[data-orari]').forEach(function (block) {
      var view = block.getAttribute('data-orari');
      if (!store.orari) return;                                  /* still loading: the skeleton stays */
      if (!rows) { setState(block, store.orari.state === 'ok' ? 'vuoto' : store.orari.state); return; }
      if (view === 'settimana') renderWeek(block, rows, now);
      else if (view === 'corso') renderCourse(block, now);
      else if (view === 'luogo') renderPlace(block, now);
    });
    document.documentElement.setAttribute('data-orari-pronto', '');
  }

  /* "In corso" and the faded past lessons follow the clock while the page stays open. Only the classes change, so the
     page is not rebuilt (focus and scroll stay where they are); a new day rebuilds it, to move "Oggi". */
  function refreshLive(now) {
    qa('.lesson, .times__row').forEach(function (li) {
      var l = { day: Number(li.getAttribute('data-day')), start: Number(li.getAttribute('data-start')), end: Number(li.getAttribute('data-end')) };
      var state = livePast(l, now);
      li.classList.toggle('is-live', state === 'live');
      if (li.classList.contains('lesson')) {
        li.classList.toggle('is-past', state === 'past');
        var badges = li.querySelector('.lesson__badges');
        if (state === 'live' && !badges) {
          badges = h('p', 'lesson__badges');
          add(badges, h('span', 'badge badge--live', 'In corso'));
          li.appendChild(badges);
        } else if (state !== 'live' && badges && badges.parentNode) {
          badges.parentNode.removeChild(badges);
        }
      }
    });
  }

  function tick() {
    if (!lessons()) return;
    var now = Dati.nowParts();
    if (now.key !== renderedDay) renderAll(true); else refreshLive(now);
  }

  function init() {
    if (location.protocol === 'file:' && window.console && console.info) {
      console.info('[pranavia-dati] Il sito è aperto direttamente dal file (file:///…): i font non si caricano. Per l’anteprima completa usa AVVIA-ANTEPRIMA.cmd (http://127.0.0.1:8812/).');
    }
    var wanted = ['avvisi'];                                          /* the notice bar is on every page */
    if (qa('[data-orari]').length) wanted.push('orari');
    if (qa('[data-eventi]').length) wanted.push('eventi');

    /* The sheet is read again every time a page opens. After that the page stays up to date by itself: it checks again
       every couple of minutes while it is on screen, and as soon as the visitor comes back to the tab. */
    var lastCheck = Date.now();
    var reported = {};
    function check(initial) {
      lastCheck = Date.now();
      wanted.forEach(function (tab) {
        Dati.load(tab, function (result) {
          if (result.source === 'network' && reported[tab] !== result.state + result.signature) {   /* say it once, not every check */
            reported[tab] = result.state + result.signature;
            report(result);
          }
          store[tab] = result;
          scheduleRender();
        }, { skipCache: !initial });
      });
    }
    check(true);
    window.setInterval(function () { if (!document.hidden) check(false); }, Dati.config.refreshEveryMs);
    function backOnScreen() { if (!document.hidden && Date.now() - lastCheck > Dati.config.refreshGapMs) check(false); }
    document.addEventListener('visibilitychange', backOnScreen);
    window.addEventListener('focus', backOnScreen);
    window.addEventListener('online', function () { check(false); });
    window.addEventListener('pageshow', function (e) { if (e.persisted) check(false); });
    window.addEventListener('hashchange', function () {
      var block = document.querySelector('[data-orari="settimana"]');
      var rows = lessons();
      if (!block || !rows) return;
      var key = filterFromHash(rows);
      if (key) setFilter(block, key, false);                      /* other hashes (the day shortcuts) leave the filter alone */
      else if (!location.hash) setFilter(block, 'tutte', false);
    });
    window.setInterval(function () { if (!document.hidden) tick(); }, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
  }

  init();
})();
