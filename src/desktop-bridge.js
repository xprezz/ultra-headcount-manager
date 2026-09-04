/* ============================================================================
   Ultra Headcount Manager — narrow bridge to the native Windows host.
   The browser build leaves this unavailable and continues to work independently.
   ========================================================================== */
const DESKTOP = (() => {
  'use strict';

  const webview = typeof window !== 'undefined' && window.chrome && window.chrome.webview;
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  if (webview) {
    webview.addEventListener('message', event => {
      const message = event.data || {};
      if (message.event) {
        (listeners.get(message.event) || []).forEach(fn => {
          try { fn(message.payload); } catch (error) { console.error(error); }
        });
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.result);
      else {
        const error = new Error(message.error && message.error.message || 'The Windows app could not complete that action.');
        error.code = message.error && message.error.code || 'desktop_error';
        error.status = message.error && message.error.status;
        request.reject(error);
      }
    });
  }

  function invoke(method, payload) {
    if (!webview) return Promise.reject(new Error('The Windows desktop host is not available.'));
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      webview.postMessage({ id, method, payload: payload || {} });
    });
  }

  function on(event, fn) {
    const current = listeners.get(event) || [];
    current.push(fn);
    listeners.set(event, current);
    return () => listeners.set(event, (listeners.get(event) || []).filter(item => item !== fn));
  }

  return { available: Boolean(webview), invoke, on };
})();

if (typeof window !== 'undefined') window.UHM_DESKTOP = DESKTOP.available;
