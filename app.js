(() => {
  "use strict";

  // S3 JSON URL
  const DATA_URL = "https://gda-outputs-760321902186-eu-central-1.s3.eu-central-1.amazonaws.com/latest/answer.json";

  // Elements
  const lastUpdatedEl = document.getElementById("last-updated");
  const freshnessEl = document.getElementById("freshness");
  const statusEl = document.getElementById("status");
  const cardsEl = document.getElementById("cards");
  const sourcesDetails = document.getElementById("sources");
  const sourcesListEl = document.getElementById("sources-list");

  // LocalStorage keys
  const LS = {
    etag: "aureus:etag",
    body: "aureus:body",          // full top-level JSON string
    checked: "aureus:lastCheckedISO", // ISO timestamp of last successful fetch
    lastMod: "aureus:lastModified"    // HTTP Last-Modified header (fallback)
  };

  // Helpers
  const utcDayKey = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const formatUtc = (ts) => { try { return new Date(ts).toUTCString(); } catch { return "—"; } };
  const setStatus = (msg, cls = "") => { statusEl.className = `status ${cls}`.trim(); statusEl.textContent = msg; };

  // Normalize ETag to a quoted-string as per RFC.
  function normalizeEtag(v) {
    if (!v || typeof v !== "string") return null;
    const s = v.trim();
    if ((s.startsWith('W/"') && s.endsWith('"')) || (s.startsWith('"') && s.endsWith('"'))) return s;
    return `"${s.replace(/^W\//, "")}"`;
  }

  function setBusy(isBusy) {
    const main = document.querySelector("main#app");
    if (main) main.setAttribute("aria-busy", isBusy ? "true" : "false");
  }

  function relFreshness(fromIso) {
    if (!fromIso) return "";
    const now = Date.now();
    const then = Date.parse(fromIso);
    if (Number.isNaN(then)) return "";
    const diffMs = Math.max(0, now - then);
    const mins = Math.floor(diffMs / 60000);
    if (diffMs < 30 * 1000) return "Refreshed just now";
    if (mins < 60) return `last checked ${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `last checked ${hrs}h ago`;
  }

  function safeHref(u) {
    try {
      const url = new URL(String(u));
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    } catch (_) { }
    return null;
  }

  function renderCard(label, payload) {
    const article = document.createElement("article");
    article.className = "card";
    article.setAttribute("role", "listitem");
    article.setAttribute("aria-label", `${label} outlook`);

    const head = document.createElement("header");
    head.className = "card-head";

    const h3 = document.createElement("h3");
    h3.className = "card-title";
    h3.textContent = label;

    const decision = (payload && typeof payload.decision === "string") ? payload.decision.toUpperCase() : "—";
    const badge = document.createElement("span");
    const badgeClass = decision === "BUY" ? "buy" : (decision === "WAIT" ? "wait" : "");
    badge.className = `badge ${badgeClass}`.trim();
    badge.textContent = decision;
    badge.setAttribute("title", "Decision");
    badge.setAttribute("aria-label", `Decision: ${decision}`);

    head.append(h3, badge);
    article.append(head);

    const scoreP = document.createElement("p");
    scoreP.className = "score";
    const scoreVal = (payload && typeof payload.score === "number") ? payload.score.toFixed(2) : "—";
    scoreP.innerHTML = `Score: <strong>${scoreVal}</strong>`;
    article.append(scoreP);

    const ul = document.createElement("ul");
    ul.className = "points";
    const points = Array.isArray(payload?.key_points) ? payload.key_points.slice(0, 4) : [];
    if (points.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No key points.";
      ul.append(li);
    } else {
      for (const p of points) {
        const li = document.createElement("li");
        li.textContent = String(p);
        ul.append(li);
      }
    }
    article.append(ul);
    return article;
  }

  function upsertAssessmentDate(dateUtc) {
    const existing = document.getElementById("assessment-date");
    if (existing) existing.remove();
    if (!dateUtc) return;
    const p = document.createElement("p");
    p.id = "assessment-date";
    p.className = "status";
    p.textContent = `Assessment date (UTC): ${dateUtc}`;
    const parent = cardsEl.parentElement;
    parent.insertBefore(p, cardsEl);
  }

  function renderFromTop(top) {
    try {
      // Last updated
      lastUpdatedEl.textContent = `Last updated: ${top?.timestamp_utc ? formatUtc(top.timestamp_utc) : "—"}`;

      // Parse nested response (string -> object)
      let payload = top?.response;
      if (typeof payload === "string") payload = JSON.parse(payload);
      else if (!payload || typeof payload !== "object") throw new Error('Missing "response" payload');

      // Render cards
      cardsEl.innerHTML = "";
      const horizons = [
        ["Short-term", payload.short_term],
        ["Mid-term", payload.mid_term],
        ["Long-term", payload.long_term],
      ];
      for (const [label, obj] of horizons) cardsEl.append(renderCard(label, obj ?? {}));

      // Sources
      sourcesListEl.innerHTML = "";
      const sources = Array.isArray(payload.top_sources) ? payload.top_sources : [];
      let shown = 0;
      for (const s of sources) {
        const href = safeHref(s);
        if (!href) continue;
        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer nofollow";
        a.textContent = href.replace(/^https?:\/\//, "").replace(/\/$/, "");
        li.append(a); sourcesListEl.append(li); shown++;
      }
      sourcesDetails.hidden = shown === 0;

      // Date inside response
      upsertAssessmentDate(payload?.date_utc);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }

  async function fetchWithTimeout(url, { headers } = {}, timeoutMs = 8000, retries = 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException("Timeout", "AbortError")), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: ctrl.signal,
        credentials: "omit",
        mode: "cors",
        cache: "no-store"
      });
      clearTimeout(timer);
      // Accept 200–299 and 304
      if ((res.status >= 200 && res.status < 300) || res.status === 304) return res;
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      clearTimeout(timer);
      if (retries > 0) {
        await new Promise(r => setTimeout(r, 900));
        return fetchWithTimeout(url, { headers }, timeoutMs, retries - 1);
      }
      throw err;
    }
  }

  function showEmptyState(msg) {
    setStatus(msg, "error");
    cardsEl.innerHTML = `
      <article class="card"><header class="card-head"><h3 class="card-title">Short-term</h3><span class="badge">—</span></header><p class="score">Score: <strong>—</strong></p><ul class="points"><li>Data unavailable.</li></ul></article>
      <article class="card"><header class="card-head"><h3 class="card-title">Mid-term</h3><span class="badge">—</span></header><p class="score">Score: <strong>—</strong></p><ul class="points"><li>Data unavailable.</li></ul></article>
      <article class="card"><header class="card-head"><h3 class="card-title">Long-term</h3><span class="badge">—</span></header><p class="score">Score: <strong>—</strong></p><ul class="points"><li>Data unavailable.</li></ul></article>
    `;
    sourcesDetails.hidden = true;
    upsertAssessmentDate(null);
  }

  function updateFreshnessLabel() {
    const iso = localStorage.getItem(LS.checked);
    freshnessEl.textContent = relFreshness(iso);
  }

  async function loadData() {
    setBusy(true);
    setStatus("Checking for updates…", "loading");

    // Early paint from cache if available (good for perceived speed)
    const cachedTopStr = localStorage.getItem(LS.body);
    if (cachedTopStr) {
      try { renderFromTop(JSON.parse(cachedTopStr)); } catch { }
      updateFreshnessLabel();
    }

    const params = new URLSearchParams(location.search);
    const useMock = params.get("mock") === "1";
    const baseUrl = useMock ? "./mock/answer.json" : DATA_URL;
    const url = useMock ? baseUrl : `${baseUrl}?d=${utcDayKey()}`;

    const headers = {};
    const etagPrev = normalizeEtag(localStorage.getItem(LS.etag));
    const lastModPrev = localStorage.getItem(LS.lastMod);
    if (etagPrev) headers["If-None-Match"] = etagPrev;
    if (lastModPrev) headers["If-Modified-Since"] = lastModPrev;
    try { console.debug("Requesting", url, { etagPrev, lastModPrev }); } catch {}

    try {
      const res = await fetchWithTimeout(url, { headers }, 8000, 1);

      if (res.status === 304) {
        // Not modified — ensure we have cached body
        const cached = localStorage.getItem(LS.body);
        if (cached) {
          setStatus("Up to date.");
          localStorage.setItem(LS.checked, new Date().toISOString());
          updateFreshnessLabel();
          return; // already rendered above (or keep current view)
        } else {
          // Fallback: fetch without conditional headers
          const res2 = await fetchWithTimeout(url, {}, 8000, 0);
          const text = await res2.text();
          localStorage.setItem(LS.body, text);
          const etag2 = normalizeEtag(res2.headers.get("ETag"));
          if (etag2) localStorage.setItem(LS.etag, etag2);
          const lastMod2 = res2.headers.get("Last-Modified");
          if (lastMod2) localStorage.setItem(LS.lastMod, lastMod2);
          const top = JSON.parse(text);
          renderFromTop(top);
          setStatus("Loaded.");
          localStorage.setItem(LS.checked, new Date().toISOString());
          updateFreshnessLabel();
          return;
        }
      }

      // Status 200–299
      const text = await res.text();
      // Store body + ETag if provided (CORS must expose ETag)
      localStorage.setItem(LS.body, text);
      const etag = normalizeEtag(res.headers.get("ETag"));
      if (etag) localStorage.setItem(LS.etag, etag);
      const lastMod = res.headers.get("Last-Modified");
      if (lastMod) localStorage.setItem(LS.lastMod, lastMod);

      const top = JSON.parse(text);
      renderFromTop(top);
      setStatus("Loaded.");
      localStorage.setItem(LS.checked, new Date().toISOString());
      updateFreshnessLabel();
      try { console.debug("Response", res.status, { etag, lastMod }); } catch {}

    } catch (err) {
      console.error(err);
      if (cachedTopStr) {
        setStatus("Offline or server unreachable — showing cached data.", "error");
      } else {
        let msg = "Error loading data.";
        if (err?.name === "AbortError") msg = "Network timeout. Please retry.";
        else if (String(err).includes("HTTP 403")) msg = "Access denied (403). Check bucket policy & CORS.";
        else if (String(err).includes("HTTP 404")) msg = "Data not found (404).";
        showEmptyState(msg);
      }
    }
    finally {
      setBusy(false);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadData();
    // Update freshness every minute
    updateFreshnessLabel();
    setInterval(updateFreshnessLabel, 60 * 1000);
  });
})();
