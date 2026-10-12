/* Pranavia — dati-foglio.js
   Data layer for the dynamic pages (calendar, course schedules, notices, prices, events).
   The content lives in a public Google Sheet that the owner edits like a normal spreadsheet:
   one tab per kind of data (Orari, Avvisi, Eventi). This file downloads each tab as CSV,
   checks every cell and hands clean, typed rows to orari.js. It never builds HTML.

   - Everything coming from the sheet is untrusted text: it is cleaned and validated here, and orari.js only
     ever writes it into the page with textContent.
   - Only https://docs.google.com is contacted, without cookies and without referrer.
   - Every time a page opens the sheet is read again (the browser is told not to reuse an old answer). A copy of the
     last answer is kept in sessionStorage (cleared when the tab is closed) only so that something can be shown
     instantly while the fresh data is on its way.
   - Classic script (no ES modules): the site also opens from disk. The same file can be loaded from Node
     (module.exports) by the tests and by the sheet checker in _dev-orari/. No dependencies. */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.PranaviaDati = api;
})(typeof window !== 'undefined' ? window : null, function (win) {
  'use strict';

  /* ==========================================================================
     Settings — the only place to touch when the sheet changes
     ========================================================================== */
  var config = {
    /* ID of the Google Sheet (the long code in its address). It is public by design: the file must only ever
       contain information that is already shown on the website. */
    sheetId: '1Jn0LdoYdqVl0x0IffrBIs3LX5iIxg-_XD4keaUmMRmg',
    /* tab names, exactly as written in the sheet (capital letters count) */
    tabs: { orari: 'Orari', avvisi: 'Avvisi', eventi: 'Eventi' },
    /* optional: { Orari: '123456789' } reads that tab by its gid (the number after #gid= in the address)
       instead of by name, which keeps working if the tab is renamed */
    gids: {},
    timezone: 'Europe/Rome',
    cacheMaxAgeMs: 30 * 60 * 1000,   /* a saved copy older than this is not even shown while waiting for the fresh data */
    refreshEveryMs: 2 * 60 * 1000,   /* a page that stays open checks the sheet again this often (only while it is on screen) */
    refreshGapMs: 20 * 1000,         /* … and when the visitor comes back to the tab, if the last check is older than this */
    timeoutMs: 6000,
    retries: 1,
    maxBytes: 300 * 1024,
    maxRows: 400
  };

  var CACHE_PREFIX = 'pranavia:foglio:v1:';

  var DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
  var DAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
  var DAYS_MIN = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'];
  var MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
  var MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

  var PLACES = {
    dojo: { slug: 'dojo', label: 'Dojo', of: 'del Dojo', hint: 'Arti marziali' },
    studio: { slug: 'studio', label: 'Studio', of: 'dello Studio', hint: 'Yoga e Pilates' }
  };

  /* The six disciplines of the site. "aliases" are what people may type in the sheet (compared without capital
     letters, accents or punctuation); an alias can also fix the course name ("Hatha Yoga" is Yoga). */
  var DISCIPLINES = [
    { slug: 'aikido', label: 'Aikido', short: 'Aikido', ambito: 'dojo', kanji: '合気道',
      aliases: { 'aikido': '' } },
    { slug: 'karate', label: 'Karate', short: 'Karate', ambito: 'dojo', kanji: '空手道',
      aliases: { 'karate': '', 'ushiro karate': '', 'karate ushiro': '', 'soshinkan ushiro karate': '' } },
    { slug: 'judo', label: 'Judo', short: 'Judo', ambito: 'dojo', kanji: '柔道',
      aliases: { 'judo': '' } },
    { slug: 'cqc-pencak-silat-kali-escrima', label: 'CQC / Pencak Silat / Kali Escrima', short: 'CQC · Silat · Kali', ambito: 'dojo', motif: 'sticks',
      aliases: { 'cqc pencak silat kali escrima': '', 'cqc silat kali': '', 'cqc': 'CQC', 'cqc pencak silat': '',
        'pencak silat': 'Pencak Silat', 'silat': 'Pencak Silat', 'kali escrima': 'Kali Escrima', 'kali': 'Kali Escrima',
        'escrima': 'Kali Escrima', 'eskrima': 'Kali Escrima' } },
    { slug: 'yoga', label: 'Yoga', short: 'Yoga', ambito: 'studio', motif: 'lotus',
      aliases: { 'yoga': '', 'hatha yoga': 'Hatha Yoga' } },
    { slug: 'pilates', label: 'Pilates', short: 'Pilates', ambito: 'studio', motif: 'waves',
      aliases: { 'pilates': '', 'pilates matwork': 'Pilates Matwork', 'matwork': 'Pilates Matwork', 'mat pilates': 'Pilates Matwork', 'pilates suspension': 'Pilates Suspension' } }
  ];

  /* ==========================================================================
     Small helpers
     ========================================================================== */
  var RE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
  /* zero-width characters, byte-order mark and text-direction overrides (they can make a link look like another) */
  var RE_BIDI = /[\u061C\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

  function cleanText(value, max) {
    var s = value === null || value === undefined ? '' : String(value);
    s = s.replace(/[\r\n\t]+/g, ' ').replace(RE_CONTROL, '').replace(RE_BIDI, '').replace(/\s+/g, ' ').replace(/^ | $/g, '');
    if (max && s.length > max) {
      s = s.slice(0, max - 1);
      var last = s.charCodeAt(s.length - 1);
      if (last >= 0xD800 && last <= 0xDBFF) s = s.slice(0, -1);   /* do not cut an emoji in half */
      s = s.replace(/\s+$/, '') + '…';
    }
    return s;
  }

  /* lower case, no accents, letters and digits separated by single spaces: used only to COMPARE text */
  function fold(value) {
    var s = value === null || value === undefined ? '' : String(value).toLowerCase();
    if (typeof s.normalize === 'function') s = s.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
    return s.replace(/[^a-z0-9]+/g, ' ').replace(/^ | $/g, '');
  }

  function warn(list, row, message) { list.push({ row: row, message: message }); }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* ==========================================================================
     CSV
     ========================================================================== */
  /* RFC 4180: quotes, doubled quotes, line breaks inside cells, CRLF / LF / CR, BOM. Returns an array of arrays. */
  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = '';
    var quoted = false;
    var i = 0;
    var n = text.length;
    var c;
    if (n && text.charCodeAt(0) === 0xFEFF) i = 1;
    for (; i < n; i++) {
      c = text.charAt(i);
      if (quoted) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i++; } else { quoted = false; }
        } else {
          field += c;
        }
      } else if (c === '"' && field === '') {
        quoted = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text.charAt(i + 1) === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function isBlankRow(row) {
    for (var i = 0; i < row.length; i++) if (String(row[i]).replace(/\s+/g, '') !== '') return false;
    return true;
  }

  /* ==========================================================================
     Parsers for single values
     ========================================================================== */
  var DAY_WORDS = {
    lunedi: 1, lun: 1, lu: 1, martedi: 2, mar: 2, mart: 2, ma: 2, mercoledi: 3, mer: 3, merc: 3, me: 3,
    giovedi: 4, gio: 4, giov: 4, gi: 4, venerdi: 5, ven: 5, ve: 5, sabato: 6, sab: 6, sa: 6, domenica: 7, dom: 7, do: 7
  };

  /* returns 1 (Monday) … 7 (Sunday) or null */
  function parseDay(value) {
    var f = fold(value).replace(/ /g, '');
    return DAY_WORDS.hasOwnProperty(f) ? DAY_WORDS[f] : null;
  }

  /* "9:30", "09:30", "9.30", "09:30:00" (what Sheets gives in an Italian sheet), "6:30 PM"; returns minutes after
     midnight (0–1439) or null */
  function parseTime(value) {
    var s = value === null || value === undefined ? '' : String(value).trim().toLowerCase();
    if (!s) return null;
    var m = /^(\d{1,2})(?:\s*[:.,h]\s*(\d{2})(?:\s*[:.]\s*(\d{2}))?)?\s*(?:([ap])\.?\s*m\.?)?$/.exec(s);
    if (!m) return null;
    var h = Number(m[1]);
    var min = m[2] === undefined ? 0 : Number(m[2]);
    var sec = m[3] === undefined ? 0 : Number(m[3]);
    if (min > 59 || sec > 59) return null;
    if (m[4]) {
      if (h < 1 || h > 12) return null;
      h = h % 12 + (m[4] === 'p' ? 12 : 0);
    } else if (h > 23) {
      return null;
    }
    return h * 60 + min;
  }

  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysInMonth(y, m) { return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
  function validCivil(y, m, d) { return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m); }

  var MONTH_WORDS = {
    gennaio: 1, gen: 1, febbraio: 2, feb: 2, marzo: 3, mar: 3, aprile: 4, apr: 4, maggio: 5, mag: 5, giugno: 6, giu: 6,
    luglio: 7, lug: 7, agosto: 8, ago: 8, settembre: 9, set: 9, sett: 9, ottobre: 10, ott: 10, novembre: 11, nov: 11, dicembre: 12, dic: 12
  };

  /* A day, written the way people write it: "2026-12-24", "24/12/2026", "24/12/26", "24-12-2026", "24 dicembre 2026",
     "sab 24 dic 2026". Always day first, never month first, and the year is always required (nothing is guessed).
     Returns a number such as 20261224, or null. */
  function parseDate(value) {
    var s = value === null || value === undefined ? '' : String(value).trim();
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s);
    var y;
    var mo;
    var d;
    if (m) {
      y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
    } else if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})$/.exec(s))) {
      d = Number(m[1]); mo = Number(m[2]); y = Number(m[3]);
      if (y < 100) y += 2000;
    } else if ((m = /^(?:[A-Za-z\u00C0-\u00FF]+\.?,?\s+)?(\d{1,2})\s*[ .\-]\s*([A-Za-z\u00C0-\u00FF]+)\.?\s*[ .\-,]\s*(\d{4})$/.exec(s))) {
      d = Number(m[1]); y = Number(m[3]);
      var word = fold(m[2]);
      if (!MONTH_WORDS.hasOwnProperty(word)) return null;
      mo = MONTH_WORDS[word];
    } else {
      return null;
    }
    return validCivil(y, mo, d) ? y * 10000 + mo * 100 + d : null;
  }

  var TRUE_WORDS = { si: 1, s: 1, yes: 1, y: 1, true: 1, vero: 1, ok: 1, x: 1, '1': 1 };
  var FALSE_WORDS = { no: 1, n: 1, false: 1, falso: 1, '0': 1 };

  /* {value, invalid}: an empty cell takes the default; an unknown word takes the default and is reported */
  function parseBool(value, def) {
    var raw = value === null || value === undefined ? '' : String(value).trim();
    if (!raw) return { value: def, invalid: false };
    if (raw === '✓' || raw === '✔') return { value: true, invalid: false };
    var f = fold(raw).replace(/ /g, '');
    if (TRUE_WORDS.hasOwnProperty(f)) return { value: true, invalid: false };
    if (FALSE_WORDS.hasOwnProperty(f)) return { value: false, invalid: false };
    return { value: def, invalid: true };
  }

  var NOT_A_DOMAIN = /\.(html?|php|pdf|jpe?g|png|webp|gif|js|css|txt)$/i;

  /* What a person may write in a "link" cell, made into something the page can safely use:
       https://www.example.com/page  (or just  www.example.com  /  example.com/page)  → external link
       contatti, /calendario/, yoga/ , calendario#eventi                                → a page of this site
       info@example.com                                                                 → e-mail
       +39 351 733 8222                                                                 → phone call
     Returns {kind: 'external'|'site'|'mail'|'tel', value} or null when it is none of these (nothing else is ever linked:
     no javascript:, data: and so on). */
  function parseLink(value) {
    var s = cleanText(value, 300);
    if (!s || /\s/.test(s) && !/^(tel:|\+?\d)/i.test(s)) return null;
    var m;
    var u;
    if (/^https?:\/\//i.test(s)) {
      try { u = new URL(s); } catch (e) { return null; }
      if (!u.hostname || u.hostname.indexOf('.') === -1 || u.username || u.password) return null;
      u.protocol = 'https:';
      return { kind: 'external', value: u.href };
    }
    var mail = s.replace(/^mailto:/i, '');
    if (/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(mail)) return { kind: 'mail', value: 'mailto:' + mail };
    var tel = s.replace(/^tel:/i, '');
    if (/^\+?\d[\d\s().\/\-]{5,}$/.test(tel)) {
      var digits = tel.replace(/[^\d+]/g, '');
      var count = digits.replace(/\D/g, '').length;
      if (count < 7 || count > 15) return null;
      if (digits.charAt(0) !== '+' && /^3\d{9}$/.test(digits)) digits = '+39' + digits;     /* an Italian mobile number */
      return { kind: 'tel', value: 'tel:' + digits };
    }
    if (/^(?:www\.)?[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+(?:[\/?#]\S*)?$/.test(s) && !NOT_A_DOMAIN.test(s.split(/[\/?#]/)[0])) {
      try { u = new URL('https://' + s); } catch (e2) { return null; }
      return u.hostname.indexOf('.') === -1 ? null : { kind: 'external', value: u.href };
    }
    if ((m = /^\/?([A-Za-z][A-Za-z0-9_\-]*(?:\/[A-Za-z0-9_\-]+)*(?:\.[A-Za-z0-9]{2,5})?)\/?(#[A-Za-z0-9_\-]+)?$/.exec(s))) {
      var path = m[1];
      var isFile = /\.[A-Za-z0-9]{2,5}$/.test(path);
      return { kind: 'site', value: path.toLowerCase() + (isFile ? '' : '/') + (m[2] || '') };
    }
    return null;
  }

  /* ==========================================================================
     Disciplines
     ========================================================================== */
  var aliasIndex = null;
  function buildAliasIndex() {
    aliasIndex = {};
    DISCIPLINES.forEach(function (d) {
      Object.keys(d.aliases).forEach(function (a) { aliasIndex[a] = { discipline: d, corso: d.aliases[a] }; });
      aliasIndex[fold(d.label)] = aliasIndex[fold(d.label)] || { discipline: d, corso: '' };
    });
  }

  /* what the person typed → the discipline (or null) */
  function resolveDiscipline(value) {
    if (!aliasIndex) buildAliasIndex();
    var f = fold(value);
    if (!f || !aliasIndex.hasOwnProperty(f)) return null;
    var hit = aliasIndex[f];
    var d = hit.discipline;
    return { slug: d.slug, label: d.label, short: d.short, ambito: d.ambito, kanji: d.kanji || '', motif: d.motif || '', corso: hit.corso };
  }

  function disciplineBySlug(slug) {
    for (var i = 0; i < DISCIPLINES.length; i++) if (DISCIPLINES[i].slug === slug) return DISCIPLINES[i];
    return null;
  }

  /* ==========================================================================
     Tables: header check + one validator per tab
     ========================================================================== */
  function columnKey(header) { return fold(header).replace(/ /g, '_'); }

  var SCHEMAS = {
    orari: {
      required: ['disciplina', 'giorno', 'inizio', 'fine'],
      columns: {
        disciplina: ['disciplina'], corso: ['corso', 'variante'], giorno: ['giorno'], inizio: ['inizio', 'ora_inizio'],
        fine: ['fine', 'ora_fine'], dettagli: ['dettagli', 'dettaglio'], sala: ['sala'], livello: ['livello'],
        insegnante: ['insegnante', 'maestro'], note: ['note', 'nota'], visibile: ['visibile', 'attivo']
      }
    },
    avvisi: {
      required: ['testo'],
      columns: {
        attivo: ['attivo', 'visibile'], home: ['home', 'in_home', 'homepage'], dal: ['dal', 'da', 'dalla_data'],
        al: ['al', 'fino_al', 'scade_il', 'alla_data'], testo: ['testo', 'avviso'], link: ['link', 'url', 'collegamento']
      }
    },
    eventi: {
      required: ['titolo', 'dal'],
      columns: {
        attivo: ['attivo', 'visibile'], dal: ['dal', 'da', 'data', 'dalla_data'], al: ['al', 'fino_al', 'alla_data'],
        titolo: ['titolo', 'evento'], dettagli: ['dettagli', 'dettaglio', 'descrizione'], link: ['link', 'url', 'collegamento']
      }
    }
  };

  /* each validator gets one raw row (strings) and returns {value, warnings:[…]} | {hidden:true} | {error:'…'} */
  function normalizeLesson(r) {
    var w = [];
    if (!cleanText(r.disciplina)) return { error: 'manca la disciplina' };
    var d = resolveDiscipline(r.disciplina);
    var day = parseDay(r.giorno);
    if (day === null) return { error: 'giorno non valido: “' + cleanText(r.giorno, 24) + '”' };
    var start = parseTime(r.inizio);
    if (start === null) return { error: 'ora di inizio non valida: “' + cleanText(r.inizio, 24) + '”' };
    var end = parseTime(r.fine);
    if (end === null) return { error: 'ora di fine non valida: “' + cleanText(r.fine, 24) + '”' };
    if (end <= start) return { error: 'la fine (' + cleanText(r.fine, 12) + ') deve essere dopo l’inizio (' + cleanText(r.inizio, 12) + ')' };
    var vis = parseBool(r.visibile, true);
    if (vis.invalid) w.push('“visibile” non riconosciuto (“' + cleanText(r.visibile, 16) + '”): scrivi si oppure no');
    if (!vis.value) return { hidden: true };
    var corso = cleanText(r.corso, 60) || (d ? d.corso : '');
    if (d && fold(corso) === fold(d.label)) corso = '';
    if (!d) w.push('disciplina non riconosciuta: “' + cleanText(r.disciplina, 40) + '” (compare solo nel calendario)');
    var lesson = {
      slug: d ? d.slug : null,
      label: d ? d.label : cleanText(r.disciplina, 40),
      short: d ? d.short : cleanText(r.disciplina, 40),
      ambito: d ? d.ambito : null,
      kanji: d ? d.kanji : '',
      motif: d ? d.motif : '',
      unknown: !d,
      corso: corso,
      day: day,
      start: start,
      end: end,
      sala: cleanText(r.sala, 24),
      dettagli: cleanText(r.dettagli, 120),
      livello: cleanText(r.livello, 60),
      insegnante: cleanText(r.insegnante, 60),
      note: cleanText(r.note, 160)
    };
    lesson.title = lessonTitle(lesson, false);
    lesson.titleShort = lessonTitle(lesson, true);
    return { value: lesson, warnings: w };
  }

  /* "Judo Bambini" already says Judo; "Bambini" alone does not */
  function lessonTitle(l, short) {
    var base = short ? l.short : l.label;
    if (!l.corso) return base;
    var fc = fold(l.corso);
    if (l.slug) {
      var d = disciplineBySlug(l.slug);
      var names = Object.keys(d.aliases);
      for (var i = 0; i < names.length; i++) if (fc.indexOf(names[i]) !== -1) return l.corso;
    } else if (fc.indexOf(fold(l.label)) !== -1) {
      return l.corso;
    }
    return base + ' · ' + l.corso;
  }

  /* the three things every notice and event can have: on/off, from, to */
  function readWindow(r, w, label) {
    var out = { dal: null, al: null };
    var on = parseBool(r.attivo, true);
    if (on.invalid) w.push('“attivo” non riconosciuto (“' + cleanText(r.attivo, 16) + '”): scrivi si oppure no');
    out.attivo = on.value;
    var names = { dal: 'dal', al: 'al' };
    for (var k in names) {
      if (names.hasOwnProperty(k) && cleanText(r[k])) {
        out[k] = parseDate(r[k]);
        if (out[k] === null) return { error: '“' + names[k] + '” non è una data valida: “' + cleanText(r[k], 24) + '” (scrivi ad esempio 24/12/2026)' };
      }
    }
    if (out.dal !== null && out.al !== null && out.al < out.dal) return { error: '“al” è prima di “dal”' };
    return out;
  }

  function readLink(r, w) {
    if (!cleanText(r.link)) return null;
    var link = parseLink(r.link);
    if (!link) w.push('il link non è riconosciuto: scrivi un indirizzo (https://…), una pagina del sito (ad esempio contatti), una mail o un telefono');
    return link;
  }

  function normalizeNotice(r) {
    var w = [];
    var testo = cleanText(r.testo, 220);
    if (!testo) return { error: 'manca il testo' };
    var win = readWindow(r, w);
    if (win.error) return win;
    if (!win.attivo) return { hidden: true };
    var home = parseBool(r.home, false);                              /* empty = no: the notice stays in the calendar page only */
    if (home.invalid) w.push('“home” non riconosciuto (“' + cleanText(r.home, 16) + '”): scrivi si oppure no');
    return { value: { testo: testo, home: home.value, dal: win.dal, al: win.al, link: readLink(r, w) }, warnings: w };
  }

  function normalizeEvent(r) {
    var w = [];
    var titolo = cleanText(r.titolo, 80);
    if (!titolo) return { error: 'manca il titolo' };
    if (!cleanText(r.dal)) return { error: 'manca la data (colonna “dal”)' };
    var win = readWindow(r, w);
    if (win.error) return win;
    if (!win.attivo) return { hidden: true };
    return { value: { titolo: titolo, dal: win.dal, al: win.al, dettagli: cleanText(r.dettagli, 200), link: readLink(r, w) }, warnings: w };
  }

  var NORMALIZERS = { orari: normalizeLesson, avvisi: normalizeNotice, eventi: normalizeEvent };

  function sortLessons(a, b) {
    return a.day - b.day || a.start - b.start || a.end - b.end || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  }

  /* Turns the CSV text of one tab into {state, rows, warnings, errors, missing}.
     state: 'ok' | 'vuoto' (no usable rows) | 'header' (columns missing: wrong tab?) */
  function readTable(tab, csv) {
    var schema = SCHEMAS[tab];
    var out = { tab: tab, state: 'vuoto', rows: [], warnings: [], errors: [], missing: [], discarded: 0, hidden: 0 };
    if (!schema) { out.state = 'header'; return out; }
    if (typeof csv !== 'string' || !/\S/.test(csv)) return out;

    var matrix = parseCSV(csv);
    var head = matrix[0] || [];
    var index = {};            /* schema key → column number */
    var i;
    var k;
    for (i = 0; i < head.length; i++) {
      var key = columnKey(head[i]);
      if (!key) continue;
      for (k in schema.columns) {
        if (schema.columns.hasOwnProperty(k) && schema.columns[k].indexOf(key) !== -1) {
          if (index.hasOwnProperty(k)) warn(out.warnings, 1, 'colonna “' + k + '” ripetuta: conta solo la prima');
          else index[k] = i;
          break;
        }
      }
    }
    for (i = 0; i < schema.required.length; i++) if (!index.hasOwnProperty(schema.required[i])) out.missing.push(schema.required[i]);
    if (out.missing.length) { out.state = 'header'; return out; }

    var normalize = NORMALIZERS[tab];
    var seen = {};
    var rowCount = 0;
    for (i = 1; i < matrix.length; i++) {
      var cells = matrix[i];
      if (isBlankRow(cells)) continue;
      if (++rowCount > config.maxRows) { warn(out.warnings, i + 1, 'troppe righe: oltre ' + config.maxRows + ' vengono ignorate'); break; }
      var raw = {};
      for (k in index) if (index.hasOwnProperty(k)) raw[k] = cells[index[k]] === undefined ? '' : cells[index[k]];
      var res = normalize(raw);
      if (res.error) { out.errors.push({ row: i + 1, message: res.error }); out.discarded++; continue; }
      if (res.hidden) { out.hidden++; continue; }
      (res.warnings || []).forEach(function (m) { warn(out.warnings, i + 1, m); });
      var v = res.value;
      v.row = i + 1;
      if (tab === 'orari') {
        var dupe = [v.slug || v.label, v.day, v.start, v.end, v.sala, v.corso, v.dettagli, v.livello, v.insegnante].join('|');
        if (seen[dupe]) { warn(out.warnings, i + 1, 'riga doppia (uguale alla riga ' + seen[dupe] + '): ignorata'); out.discarded++; continue; }
        seen[dupe] = i + 1;
      }
      out.rows.push(v);
    }
    if (tab === 'orari') out.rows.sort(sortLessons);
    out.state = out.rows.length ? 'ok' : 'vuoto';
    return out;
  }

  /* ==========================================================================
     Dates and times in Rome (independent of the visitor's own time zone)
     ========================================================================== */
  function dateKey(y, m, d) { return y * 10000 + m * 100 + d; }
  function keyParts(key) { return { y: Math.floor(key / 10000), m: Math.floor(key / 100) % 100, d: key % 100 }; }
  function utcDay(y, m, d) { return Date.UTC(y, m - 1, d); }
  function addDays(y, m, d, n) {
    var t = new Date(utcDay(y, m, d) + n * 86400000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  function addDaysKey(key, n) {
    var p = keyParts(key);
    var r = addDays(p.y, p.m, p.d, n);
    return dateKey(r.y, r.m, r.d);
  }
  function isoDow(y, m, d) { return (new Date(utcDay(y, m, d)).getUTCDay() + 6) % 7 + 1; }

  var WEEKDAY_EN = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  var romeFormat = null;

  /* {y, m, d, minutes, dow, key} for a moment in time (default: now) */
  function nowParts(date) {
    var dev = devHooks();
    if (!date && dev && dev.now) {
      var m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(dev.now);
      if (m) {
        var fy = Number(m[1]);
        var fm = Number(m[2]);
        var fd = Number(m[3]);
        return { y: fy, m: fm, d: fd, minutes: m[4] ? Number(m[4]) * 60 + Number(m[5]) : 12 * 60, dow: isoDow(fy, fm, fd), key: dateKey(fy, fm, fd) };
      }
    }
    var when = date || new Date();
    try {
      if (!romeFormat) {
        romeFormat = new Intl.DateTimeFormat('en-GB', {
          timeZone: config.timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', weekday: 'short'
        });
      }
      var p = {};
      romeFormat.formatToParts(when).forEach(function (x) { p[x.type] = x.value; });
      var y = Number(p.year);
      var mo = Number(p.month);
      var d = Number(p.day);
      return { y: y, m: mo, d: d, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), dow: WEEKDAY_EN[p.weekday] || isoDow(y, mo, d), key: dateKey(y, mo, d) };
    } catch (e) {
      return { y: when.getFullYear(), m: when.getMonth() + 1, d: when.getDate(), minutes: when.getHours() * 60 + when.getMinutes(),
        dow: isoDow(when.getFullYear(), when.getMonth() + 1, when.getDate()), key: dateKey(when.getFullYear(), when.getMonth() + 1, when.getDate()) };
    }
  }

  function formatTime(minutes) { return pad2(Math.floor(minutes / 60)) + ':' + pad2(minutes % 60); }

  /* 20261224 → "24 dic"  /  "24 dicembre" */
  function formatDay(key, long) {
    var p = keyParts(key);
    return p.d + ' ' + (long ? MONTHS : MONTHS_SHORT)[p.m - 1];
  }

  /* 20261224 → "Gio 24 dic" */
  function formatWeekdayDay(key) {
    var p = keyParts(key);
    return DAYS_SHORT[isoDow(p.y, p.m, p.d) - 1] + ' ' + formatDay(key, false);
  }

  /* date of weekday `dow` in the week that starts `weekOffset` weeks after the current one → date key */
  function dateOfWeekday(now, weekOffset, dow) {
    var monday = addDays(now.y, now.m, now.d, -(now.dow - 1) + weekOffset * 7);
    var t = addDays(monday.y, monday.m, monday.d, dow - 1);
    return dateKey(t.y, t.m, t.d);
  }

  /* ==========================================================================
     Rules that combine lessons, notices and the clock
     ========================================================================== */
  /* a notice or an event is "current" on a day when that day is inside its dal–al window (an empty end is open) */
  function inWindow(item, key) {
    if (item.dal !== null && key < item.dal) return false;
    if (item.al !== null && key > item.al) return false;
    return true;
  }

  /* notices on screen today, in the order of the sheet (the first one is the one shown in the bar) */
  function activeNotices(notices, now) {
    return notices.filter(function (n) { return inWindow(n, now.key); });
  }

  /* the notices that also go in the strip of the home page (column "home" = si), in the order of the sheet */
  function homeNotices(notices, now) {
    return activeNotices(notices, now).filter(function (n) { return n.home; });
  }

  /* events that have not finished yet, soonest first */
  function upcomingEvents(events, now, limit) {
    return events.filter(function (e) { return (e.al !== null ? e.al : e.dal) >= now.key; })
      .map(function (e, i) { return { e: e, i: i }; })
      .sort(function (a, b) { return a.e.dal - b.e.dal || a.i - b.i; })
      .map(function (x) { return x.e; })
      .slice(0, limit || 6);
  }

  /* "Sabato 24 ottobre", "24–26 ottobre", "28 ottobre – 2 novembre"; the year only when it is not the current one */
  function formatRange(dal, al, currentYear) {
    var a = keyParts(dal);
    var year = function (p) { return p.y !== currentYear ? ' ' + p.y : ''; };
    if (al === null || al === dal) return DAYS[isoDow(a.y, a.m, a.d) - 1] + ' ' + a.d + ' ' + MONTHS[a.m - 1] + year(a);
    var b = keyParts(al);
    if (a.y === b.y && a.m === b.m) return a.d + '–' + b.d + ' ' + MONTHS[b.m - 1] + year(b);
    return a.d + ' ' + MONTHS[a.m - 1] + year(a) + ' – ' + b.d + ' ' + MONTHS[b.m - 1] + year(b);
  }

  /* groups of lessons that share the same room and overlap in time (used by the sheet checker) */
  function findOverlaps(lessons) {
    var out = [];
    for (var i = 0; i < lessons.length; i++) {
      for (var j = i + 1; j < lessons.length; j++) {
        var a = lessons[i];
        var b = lessons[j];
        if (a.day !== b.day || !a.sala || fold(a.sala) !== fold(b.sala)) continue;
        if (a.start < b.end && b.start < a.end) out.push([a, b]);
      }
    }
    return out;
  }

  /* ==========================================================================
     Development hooks: only ever active on localhost, and only when the local preview server (see _dev-orari/)
     has defined window.PranaviaDev. On the real website this returns null.
     ========================================================================== */
  function devHooks() {
    var dev = win && win.PranaviaDev;
    if (!dev || !win.location) return null;
    var h = win.location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' ? dev : null;
  }

  /* ==========================================================================
     Download + cache
     ========================================================================== */
  function endpointUrl(tab) {
    var name = config.tabs[tab] || tab;
    var base = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(config.sheetId);
    if (config.gids && config.gids[name]) return base + '/export?format=csv&gid=' + encodeURIComponent(config.gids[name]);
    return base + '/gviz/tq?tqx=out:csv&headers=1&sheet=' + encodeURIComponent(name);
  }

  function hostAllowed(url) {
    return /^https:\/\/(docs\.google\.com|[a-z0-9-]+\.googleusercontent\.com)\//i.test(url);
  }

  function failure(message, retryable, status) {
    var e = new Error(message);
    e.retryable = !!retryable;
    e.status = status || 0;
    return e;
  }

  function delay(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  /* reads the body but gives up when it is bigger than the limit */
  function readLimited(res, max) {
    var tooBig = function () { return failure('risposta troppo grande', false); };
    if (!res.body || typeof res.body.getReader !== 'function' || typeof TextDecoder !== 'function') {
      return res.text().then(function (t) { if (t.length > max) throw tooBig(); return t; });
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var total = 0;
    var text = '';
    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) return text + decoder.decode();
        total += chunk.value.length;
        if (total > max) { reader.cancel(); throw tooBig(); }
        text += decoder.decode(chunk.value, { stream: true });
        return pump();
      });
    }
    return pump();
  }

  function csvCell(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* ONLY when the page is opened straight from disk (file://): the browser then refuses to read Google's answer
     (no CORS for the "null" origin), but it does accept a <script> from docs.google.com. The answer is Google's own
     JSON table, which is turned back into the same CSV text and goes through the same checks as everything else.
     On the real website (https) this is never used. */
  function fetchViaScript(tab) {
    return new Promise(function (resolve, reject) {
      var handler = '__pranaviaGviz' + tab + Date.now().toString(36);
      var script = document.createElement('script');
      var timer = setTimeout(function () { done(failure('tempo scaduto', false)); }, config.timeoutMs);
      function done(err, text) {
        clearTimeout(timer);
        try { delete win[handler]; } catch (e) { win[handler] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
        if (err) reject(err); else resolve(text);
      }
      win[handler] = function (answer) {
        try {
          if (!answer || answer.status !== 'ok' || !answer.table) throw failure('risposta di Google non valida', false);
          var rows = [answer.table.cols.map(function (c) { return c.label || ''; })];
          answer.table.rows.forEach(function (r) {
            rows.push((r.c || []).map(function (cell) { return cell ? (cell.f !== undefined && cell.f !== null ? cell.f : cell.v) : ''; }));
          });
          var text = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
          if (text.length > config.maxBytes) throw failure('risposta troppo grande', false);
          done(null, text);
        } catch (e) { done(e); }
      };
      script.onerror = function () { done(failure('rete non raggiungibile', true)); };
      script.async = true;
      script.referrerPolicy = 'no-referrer';
      var name = config.tabs[tab] || tab;
      script.src = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(config.sheetId) + '/gviz/tq?tqx=out:json;responseHandler:' + handler +
        '&headers=1&sheet=' + encodeURIComponent(name);
      document.head.appendChild(script);
    });
  }

  function fetchOnce(tab) {
    var dev = devHooks();
    var local = !!(dev && dev.source === 'locale');
    var url = local ? (dev.base || '/__dev/dati-test/') + (config.tabs[tab] || tab) + '.csv' : endpointUrl(tab);
    var pre = Promise.resolve();
    if (dev && dev.latency) pre = delay(Number(dev.latency) || 0);
    if (dev && dev.error === 'rete') return pre.then(function () { throw failure('rete non raggiungibile (simulato)', true); });
    if (dev && dev.error === 'html') return pre.then(function () { throw failure('la risposta non è un file CSV (simulato)', false); });
    if (dev && dev.error === 'vuoto') return pre.then(function () { return ''; });
    if (dev && dev.error === 'header') return pre.then(function () { return 'colonna_a,colonna_b\n1,2\n'; });

    if (!local && win && win.location && win.location.protocol === 'file:') return pre.then(function () { return fetchViaScript(tab); });

    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, config.timeoutMs) : null;
    var options = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };
    if (ctrl) options.signal = ctrl.signal;

    return pre.then(function () { return fetch(url, options); }).then(function (res) {
      if (!res.ok) throw failure('HTTP ' + res.status, res.status >= 500, res.status);
      if (!local && res.url && !hostAllowed(res.url)) throw failure('risposta da un indirizzo non previsto', false);
      var type = (res.headers.get('content-type') || '').toLowerCase();
      if (type && !/^(text\/(csv|plain)|application\/(csv|vnd\.ms-excel|octet-stream))/.test(type)) {
        throw failure('la risposta non è un file CSV (il foglio è pubblico?)', false);
      }
      return readLimited(res, config.maxBytes);
    }).then(function (text) {
      if (timer) clearTimeout(timer);
      return text;
    }, function (err) {
      if (timer) clearTimeout(timer);
      if (err && err.retryable === undefined) err.retryable = err.name === 'AbortError' || err.name === 'TypeError';
      throw err;
    });
  }

  var inflight = {};

  function fetchFresh(tab) {
    if (inflight[tab]) return inflight[tab];
    var attempts = 0;
    function attempt() {
      return fetchOnce(tab).catch(function (err) {
        if (attempts < config.retries && err && err.retryable) {
          attempts++;
          return delay(600).then(attempt);
        }
        throw err;
      });
    }
    var p = attempt().then(function (text) { delete inflight[tab]; return text; }, function (err) { delete inflight[tab]; throw err; });
    inflight[tab] = p;
    return p;
  }

  function storage() {
    try { return win && win.sessionStorage ? win.sessionStorage : null; } catch (e) { return null; }
  }

  function cacheGet(tab) {
    if (devHooks()) return null;
    var s = storage();
    if (!s) return null;
    try {
      var o = JSON.parse(s.getItem(CACHE_PREFIX + config.sheetId + ':' + tab));
      if (!o || typeof o.t !== 'number' || typeof o.csv !== 'string' || o.csv.length > config.maxBytes) return null;
      return o;
    } catch (e) {
      return null;
    }
  }

  function cacheSet(tab, csv) {
    if (devHooks()) return;
    var s = storage();
    if (!s) return;
    try { s.setItem(CACHE_PREFIX + config.sheetId + ':' + tab, JSON.stringify({ t: Date.now(), csv: csv })); } catch (e) { /* storage full or blocked */ }
  }

  function build(tab, csv, source) {
    var r = readTable(tab, csv);
    r.source = source;
    r.signature = hash(JSON.stringify(r.rows));
    return r;
  }

  /* Loads one tab, always asking the sheet again. `onResult` is called with the saved copy first (if there is a recent
     one: it only serves to show something at once) and then with the fresh answer; the page redraws only when the data
     really changed. With {skipCache: true} (periodic checks) only the fresh answer is delivered.
     Returns a promise that settles with the final result (it never rejects). */
  function load(tab, onResult, options) {
    var cached = options && options.skipCache ? null : cacheGet(tab);
    var stale = null;
    function deliver(result) {
      try { if (onResult) onResult(result); } catch (e) { if (win && win.console) win.console.error('[pranavia-dati]', e); }
    }
    if (cached && Date.now() - cached.t < config.cacheMaxAgeMs) { stale = build(tab, cached.csv, 'cache'); deliver(stale); }
    return fetchFresh(tab).then(function (csv) {
      cacheSet(tab, csv);
      var r = build(tab, csv, 'network');
      deliver(r);
      return r;
    }, function (err) {
      if (stale) return stale;                       /* offline or Google unreachable: keep showing what we have */
      var r = { tab: tab, state: 'errore', rows: [], warnings: [], errors: [], missing: [], discarded: 0, hidden: 0, source: 'network', signature: 'err', message: err && err.message ? err.message : 'errore' };
      deliver(r);
      return r;
    });
  }

  /* ==========================================================================
     Public API
     ========================================================================== */
  return {
    version: '1.0.0',
    config: config,
    DAYS: DAYS,
    DAYS_SHORT: DAYS_SHORT,
    DAYS_MIN: DAYS_MIN,
    MONTHS: MONTHS,
    PLACES: PLACES,
    DISCIPLINES: DISCIPLINES,
    SCHEMAS: SCHEMAS,
    cleanText: cleanText,
    fold: fold,
    parseCSV: parseCSV,
    parseDay: parseDay,
    parseTime: parseTime,
    parseDate: parseDate,
    parseBool: parseBool,
    parseLink: parseLink,
    resolveDiscipline: resolveDiscipline,
    disciplineBySlug: disciplineBySlug,
    readTable: readTable,
    endpointUrl: endpointUrl,
    load: load,
    nowParts: nowParts,
    dateKey: dateKey,
    keyParts: keyParts,
    addDaysKey: addDaysKey,
    isoDow: isoDow,
    formatTime: formatTime,
    formatDay: formatDay,
    formatWeekdayDay: formatWeekdayDay,
    dateOfWeekday: dateOfWeekday,
    inWindow: inWindow,
    activeNotices: activeNotices,
    homeNotices: homeNotices,
    upcomingEvents: upcomingEvents,
    formatRange: formatRange,
    findOverlaps: findOverlaps,
    hash: hash
  };
});
