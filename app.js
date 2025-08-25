(() => {
  "use strict";

  // Public S3 JSON produced by Lambda (private for now; we handle errors/CORS gracefully)
  const DATA_URL = "https://gda-outputs-760321902186-eu-central-1.s3.eu-central-1.amazonaws.com/latest/answer.json";

  const lastUpdatedEl   = document.getElementById("last-updated");
  const statusEl        = document.getElementById("status");
  const cardsEl         = document.getElementById("cards");
  const sourcesDetails  = document.getElementById("sources");
  const sourcesListEl   = document.getElementById("sources-list");

  function utcDayKey(){ return new Date().toISOString().slice(0,10); } // YYYY-MM-DD (UTC)
  function formatUtc(ts){ try { return new Date(ts).toUTCString(); } catch { return "—"; } }
  function setStatus(msg, cls=""){ statusEl.className = `status ${cls}`.trim(); statusEl.textContent = msg; }

  function safeHref(u){
    try {
      const url = new URL(String(u));
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    } catch(_){}
    return null;
  }

  function renderCard(label, payload){
    const article = document.createElement("article");
    article.className = "card";
    article.setAttribute("role","listitem");
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
    const points = Array.isArray(payload?.key_points) ? payload.key_points.slice(0,4) : [];
    if (points.length === 0){
      const li = document.createElement("li");
      li.textContent = "No key points.";
      ul.append(li);
    } else {
      for (const p of points){
        const li = document.createElement("li");
        li.textContent = String(p);
        ul.append(li);
      }
    }
    article.append(ul);
    return article;
  }

  async function fetchWithTimeout(url, options={}, timeoutMs=8000, retries=1){
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException("Timeout","AbortError")), timeoutMs);
    try{
      const res = await fetch(url, {
        ...options,
        signal: options.signal ?? ctrl.signal,
        // keep it explicit on static hosting
        cache: "no-store",
        credentials: "omit",
        mode: "cors"
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err){
      clearTimeout(timer);
      if (retries > 0){
        await new Promise(r => setTimeout(r, 1000));
        return fetchWithTimeout(url, options, timeoutMs, retries - 1);
      }
      throw err;
    }
  }

  function upsertAssessmentDate(dateUtc){
    // idempotent insertion above the cards grid
    const existing = document.getElementById("assessment-date");
    if (existing) existing.remove();
    if (!dateUtc) return;
    const p = document.createElement("p");
    p.id = "assessment-date";
    p.className = "status";
    p.textContent = `Assessment date (UTC): ${dateUtc}`;
    const cardsParent = cardsEl.parentElement;
    cardsParent.insertBefore(p, cardsEl);
  }

  async function loadData(){
    setStatus("Loading…", "loading");
    cardsEl.innerHTML = "";
    sourcesDetails.hidden = true;
    sourcesListEl.innerHTML = "";

    const params = new URLSearchParams(location.search);
    const useMock = params.get("mock") === "1";
    const baseUrl = useMock ? "./mock/answer.json" : DATA_URL;
    const url = useMock ? baseUrl : `${baseUrl}?d=${utcDayKey()}`;

    try{
      const res = await fetchWithTimeout(url, {}, 8000, 1);
      const top = await res.json();

      // Last updated from top-level
      const ts = top?.timestamp_utc;
      lastUpdatedEl.textContent = `Last updated: ${ts ? formatUtc(ts) : "—"}`;

      // Parse the nested JSON-string
      let payload = top?.response;
      if (typeof payload === "string"){
        try { payload = JSON.parse(payload); }
        catch { throw new Error('Invalid JSON inside "response" string'); }
      } else if (payload && typeof payload === "object"){
        // acceptable if producer ever switches to object
      } else {
        throw new Error('Missing "response" payload');
      }

      // Render horizons
      const horizons = [
        ["Short-term", payload.short_term],
        ["Mid-term",  payload.mid_term],
        ["Long-term", payload.long_term],
      ];
      for (const [label, obj] of horizons){
        cardsEl.append(renderCard(label, obj ?? {}));
      }

      // Sources
      const sources = Array.isArray(payload.top_sources) ? payload.top_sources : [];
      let shown = 0;
      for (const s of sources){
        const href = safeHref(s);
        if (!href) continue;
        const li = document.createElement("li");
        const a  = document.createElement("a");
        a.href = href;
        a.target = "_blank";
        a.rel   = "noopener noreferrer nofollow";
        a.textContent = href.replace(/^https?:\/\//,"").replace(/\/$/,"");
        li.append(a);
        sourcesListEl.append(li);
        shown++;
      }
      sourcesDetails.hidden = shown === 0;

      // Assessment date from payload
      upsertAssessmentDate(payload?.date_utc);

      setStatus("Loaded.");
    } catch (err){
      console.error(err);
      let msg = "Error loading data.";
      if (err?.name === "AbortError") msg = "Network timeout. Please retry.";
      else if (String(err).includes("HTTP 403")) msg = "Access denied (403). Check bucket policy & CORS.";
      else if (String(err).includes("HTTP 404")) msg = "Data not found (404).";
      else if (err?.message) msg = err.message;

      setStatus(msg, "error");

      // Gentle empty state (keeps layout stable)
      cardsEl.innerHTML = `
        <article class="card"><header class="card-head"><h3 class="card-title">Short-term</h3><span class="badge">—</span></header><p class="score">Score: <strong>—</strong></p><ul class="points"><li>Data unavailable.</li></ul></article>
        <article class="card"><header class="card-head"><h3 class="card-title">Mid-term</h3><span class="badge">—</span></header><p class="score">Score: <strong>—</strong></p><ul class="points"><li>Data unavailable.</li></ul></article>
        <article class="card"><header class="card-head"><h3 class="card-title">Long-term</h3><span class="badge">—</span></header><p class="score">Score: <strong>—</strong></p><ul class="points"><li>Data unavailable.</li></ul></article>
      `;
      sourcesDetails.hidden = true;
      upsertAssessmentDate(null);
    }
  }

  document.addEventListener("DOMContentLoaded", loadData);
})();
