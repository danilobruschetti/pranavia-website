/* Pranavia Dojo — avviso privacy/cookie informativo.
   Registra soltanto la presa visione nel browser; non abilita servizi o tracciamenti. */
(function () {
  'use strict';

  var storageKey = 'pranavia_privacy_notice';
  var lifetime = 180 * 24 * 60 * 60 * 1000;
  var now = Date.now();
  var scriptUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : document.baseURI;
  var siteRoot = new URL('../../', scriptUrl);
  var privacyUrl = new URL('privacy/', siteRoot).href;
  var cookiePolicyUrl = new URL('cookie-policy/', siteRoot).href;

  try {
    var storedAt = Number(window.localStorage.getItem(storageKey));
    if (storedAt > 0 && now - storedAt < lifetime) return;
    window.localStorage.removeItem(storageKey);
  } catch (error) {
    /* Se lo storage non è disponibile, l’avviso resta utilizzabile ma potrà ricomparire. */
  }

  var notice = document.createElement('section');
  notice.className = 'privacy-notice';
  notice.setAttribute('role', 'region');
  notice.setAttribute('aria-labelledby', 'privacy-notice-title');
  notice.innerHTML =
    '<div class="privacy-notice__inner">' +
      '<div class="privacy-notice__copy">' +
        '<h2 class="privacy-notice__title" id="privacy-notice-title">Privacy e cookie</h2>' +
        '<p class="privacy-notice__text">Questo sito non usa analytics, pubblicità o cookie di profilazione. ' +
        'Memorizza solo la preferenza tecnica necessaria a ricordare questa scelta. ' +
        '<a href="' + privacyUrl + '">Privacy Policy</a> · ' +
        '<a href="' + cookiePolicyUrl + '">Cookie Policy</a></p>' +
      '</div>' +
      '<button class="btn btn--light privacy-notice__accept" type="button">Accetta</button>' +
    '</div>';

  notice.querySelector('.privacy-notice__accept').addEventListener('click', function () {
    try { window.localStorage.setItem(storageKey, String(Date.now())); } catch (error) {}
    notice.remove();
  });

  document.body.appendChild(notice);
})();
