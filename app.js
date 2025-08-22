(() => {
  'use strict';

  // Public S3 JSON (will be fetched in Phase 3)
  const DATA_URL =
    'https://gda-outputs-760321902186-eu-central-1.s3.eu-central-1.amazonaws.com/latest/answer.json';

  const lastUpdatedEl = document.getElementById('last-updated');
  const statusEl = document.getElementById('status');

  function formatUtc(ts) {
    try {
      return new Date(ts).toUTCString();
    } catch {
      return '—';
    }
  }

  // Phase 2/3 will render cards/data. For now, placeholders:
  lastUpdatedEl.textContent = 'Last updated: —';
  statusEl.textContent = 'Ready.';
  // window.__CONFIG = { DATA_URL }; // Uncomment if you want to poke in DevTools
})();
