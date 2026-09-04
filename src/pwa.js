/* ============================================================================
   Ultra Headcount Manager — installation and offline shell.
   ========================================================================== */
const PWA = (() => {
  'use strict';
  let promptEvent = null;
  let initialized = false;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  async function install() {
    if (isStandalone()) return { installed: true };
    if (!promptEvent) return { installed: false, reason: 'not-ready' };
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    promptEvent = null;
    return { installed: choice.outcome === 'accepted', outcome: choice.outcome };
  }

  function installButton() {
    if (typeof DESKTOP !== 'undefined' && DESKTOP.available) return null;
    if (isStandalone() || !promptEvent) return null;
    return UI.el('button', {
      class: 'btn',
      onclick: async () => {
        const result = await install();
        UI.toast(result.installed ? 'App installed' : 'Installation dismissed', result.installed ? 'ok' : '');
        UI.APP.render();
      }
    }, 'Install app');
  }

  async function init() {
    if (typeof DESKTOP !== 'undefined' && DESKTOP.available) return;
    if (initialized) return;
    initialized = true;
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      promptEvent = event;
      if (UI.APP.ready) UI.APP.render();
    });
    window.addEventListener('appinstalled', () => {
      promptEvent = null;
      UI.toast('Ultra Headcount Manager is installed', 'ok');
    });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      try { await navigator.serviceWorker.register('./sw.js', { scope: './' }); }
      catch (error) { console.warn('Service worker registration failed', error); }
    }
  }

  return { init, install, installButton, isStandalone };
})();
