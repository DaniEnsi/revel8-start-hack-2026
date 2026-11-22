/* revel8 Run Replay — zero-dependency trace viewer.
 *
 * Reads the agent's per-touch trace (05 D-Q: agent/traces/<session>.jsonl) and the
 * cross-session playbook (D-P: agent/playbook.json). Local files only — no network.
 *
 * Field getters below (getTouch / normEvent / getPage) are deliberately tolerant:
 * they accept the trace.py shape first, with fallbacks for likely drift while
 * ticket 09's loop is still landing. If the real trace diverges, reconcile HERE.
 */
"use strict";

/* ------------------------------------------------------------------ config */

const THETA_SOFT = 0.55; // config.py — soften asks above this suspicion
const THETA_HARD = 0.85; // config.py — stop the session above this suspicion

const ACTION_CLASS = {
  probe: "b-blue", build: "b-teal", strike: "b-red", push: "b-amber",
  converse: "b-violet", bail: "b-grey", forced_strike: "b-red",
};
const REACTION_CLASS = {
  engaged: "b-green", wary: "b-amber", ignored: "b-grey",
  incident: "b-gold", mixed: "b-violet", none: "b-grey",
};
const EVENT_CLASS = {
  reply: "ev-reply", "link.opened": "ev-link", "page.submitted": "ev-submit",
  "attachment.opened": "ev-attach",
};

/* ------------------------------------------------------------------ state */

const store = {
  sessions: [],        // {id, name, rows, touches, meta}
  current: -1,         // index into sessions
  selRow: 0,           // selected row index within current session
  playbook: null,      // parsed playbook.json
  playbookName: "",
  playTimer: null,
};

/* ------------------------------------------------------------------ helpers */

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtTs(ts) {
  if (!ts || !isFinite(ts)) return "";
  const d = new Date(ts * 1000);
  return isNaN(d) ? "" : d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtDur(a, b) {
  if (!a || !b || b <= a) return "";
  const s = Math.round(b - a);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function fmtDelta(d) {
  if (d == null || !isFinite(d) || Math.abs(d) < 0.005)
    return `<span class="delta flat">±0.00</span>`;
  const cls = d > 0 ? "up" : "down";
  const arrow = d > 0 ? "▲" : "▼";
  return `<span class="delta ${cls}">${arrow} ${Math.abs(d).toFixed(2)}</span>`;
}

function linkify(text) {
  // escape first, then style URLs (non-navigating: pages live only inside the sim)
  return esc(text).replace(
    /(https?:\/\/[^\s&lt;)"']+)/g,
    (u) => `<span style="color:var(--accent);text-decoration:underline;word-break:break-all" title="lookalike URL inside the simulation">${u}</span>`
  );
}

function badge(text, cls) {
  return cls ? `<span class="badge ${cls}">${esc(text)}</span>` : "";
}

/* ---------------------------------------------------- tolerant field access */

function getTouch(rec) {
  const plan = rec.plan || {};
  const decision = plan.decision || {};
  const topics = rec.topics ?? (rec.notecard || {}).topics ?? null;
  const brief = rec.writer_brief ?? rec.brief ?? null;
  const draft = rec.draft || {};
  const events = Array.isArray(rec.events) ? rec.events : [];
  const planTopicId = topics
    ? Object.keys(plan).find((key) => topics[key] !== undefined)
    : undefined;
  const eventChannel = events
    .map((event) => (event || {}).channel)
    .find((channel) => typeof channel === "string" && channel.length > 0);
  const fallbackAction = rec.conversation || rec.turns
    ? "converse"
    : brief?.include_link === true
      ? "strike"
      : Object.keys(brief || {}).length || Object.keys(draft).length
        ? "message"
        : "";
  return {
    idx: rec.touch_idx ?? rec.idx ?? null,
    action: plan.action ?? decision.action ?? rec.objective_step ?? rec.action ?? fallbackAction,
    channel: plan.channel ?? decision.channel ?? rec.channel ?? eventChannel ?? "",
    topicId: plan.topic_id ?? decision.topic_id ?? rec.topic_id ?? planTopicId ?? "",
    topicLabel: plan.topic_label ?? rec.topic_label ?? brief?.topic ?? "",
    reason: plan.reason ?? decision.reason ?? "",
    sender: plan.sender ?? rec.sender ?? rec.persona ?? null,
    suspicion: numOrNull(rec.suspicion ?? (rec.notecard || {}).suspicion),
    touchesLeft: rec.touches_left ?? null,
    topics,
    brief,
    draft,
    guard: rec.guard ?? null,
    events,
    reaction: rec.reaction ?? rec.engagement ?? "",
    fallbacks: Array.isArray(rec.fallbacks) ? rec.fallbacks : [],
    objective: rec.objective ?? "",
    target: rec.target_id ?? rec.target ?? "",
    ts: rec.ts ?? null,
    raw: rec,
  };
}

function numOrNull(v) {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

function normEvent(e) {
  if (typeof e === "string") return { type: e };
  if (!e || typeof e !== "object") return { type: "unknown" };
  return {
    type: e.type ?? e.event ?? e.kind ?? "unknown",
    text: e.text ?? e.reply ?? e.body ?? "",
    url: e.url ?? e.link ?? "",
    fields: e.fields ?? null,
    file: e.file ?? e.filename ?? e.attachment ?? "",
    channel: e.channel ?? "",
    raw: e,
  };
}

function getPage(rec) {
  const d = rec.draft || {};
  const p = d.page ?? rec.page ?? rec.landing_page ?? null;
  if (p && typeof p === "object") return p;
  if (typeof d.html === "string" && d.html.length > 50)
    return { url: d.page_url ?? rec.planned_url ?? "", title: d.page_title ?? "", html: d.html, fields: d.fields ?? [] };
  return null;
}

function senderOf(session, t) {
  return t.sender || (session.meta.persona ?? null);
}

/* ------------------------------------------------------------- parsing */

function parseTraceText(name, text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // 1) whole-document JSON (array, {records}/{touches}, playbook, or a single record)
  try {
    const obj = JSON.parse(trimmed);
    if (Array.isArray(obj)) return { records: obj };
    if (obj && typeof obj === "object") {
      if (Array.isArray(obj.records)) return { records: obj.records };
      if (Array.isArray(obj.touches)) return { records: obj.touches };
      if (obj.per_target !== undefined || obj.playbook !== undefined) return { playbook: obj };
      return { records: [obj] };
    }
    return null;
  } catch { /* not a single JSON document — try JSONL below */ }
  // 2) JSONL: one record per line (the trace.py format)
  const records = [];
  for (const [i, line] of trimmed.split(/\r?\n/).entries()) {
    const l = line.trim();
    if (!l) continue;
    try {
      records.push(JSON.parse(l));
    } catch (err) {
      throw new Error(`line ${i + 1}: ${err.message}`);
    }
  }
  if (!records.length) return null;
  return { records };
}

function looksLikePlaybook(name, obj) {
  return obj && typeof obj === "object" && !Array.isArray(obj) &&
    (obj.per_target !== undefined || /playbook/i.test(name));
}

function buildSession(name, records) {
  const rows = [];
  const touches = [];
  for (const rec of records) {
    const kind = rec.kind ?? (rec.touch_idx != null || rec.draft ? "touch" : "marker");
    if (kind === "touch") {
      const t = getTouch(rec);
      touches.push(t);
      rows.push({ type: "touch", rec, t });
    } else {
      rows.push({ type: "marker", rec, kind });
    }
  }
  const id = name.replace(/\.(jsonl|json)$/i, "");
  const session = { id, name, rows, touches, meta: {} };
  session.meta = deriveMeta(session, records);
  return session;
}

function deriveMeta(session, records) {
  const first = (k) => records.find((r) => r.kind === k) || null;
  const start = first("session_start");
  const end = first("session_end");
  const incident = first("incident");
  const touches = session.touches;
  const last = touches[touches.length - 1] || {};
  const incTouch = touches.find((t) => t.reaction === "incident") || null;

  const budget = start?.budget ?? (Math.max(0, ...touches.map((t) => (t.idx ?? 0) + (t.touchesLeft ?? 0))) || null);
  const channels = [...new Set(touches.map((t) => t.channel).filter(Boolean))];
  const outcome = end?.outcome ?? (incident || incTouch ? "incident" : "in progress");
  const meta = {
    target: start?.target_id ?? start?.target ?? last.target ?? "",
    targetName: start?.target_name ?? "",
    scenario: start?.scenario_id ?? "",
    arms: start?.arms ?? null,
    objective: start?.objective ?? last.objective ?? "",
    budget,
    outcome,
    incidentTouch: incident?.touch_idx ?? incTouch?.idx ?? null,
    incidentVia: incident?.via ?? null,
    touchesUsed: end?.touches_used ?? touches.length,
    finalSuspicion: numOrNull(end?.final_suspicion ?? last.suspicion),
    channels,
    persona: start?.persona ?? null,
    startTs: start?.ts ?? touches[0]?.ts ?? null,
    endTs: end?.ts ?? last.ts ?? null,
    endReason: end?.reason ?? "",
  };
  return meta;
}

/* ------------------------------------------------------------- loading */

function addTrace(name, text) {
  try {
    const parsed = parseTraceText(name, text);
    if (!parsed) return false;
    if (parsed.playbook || looksLikePlaybook(name, parsed.records?.[0])) {
      store.playbook = parsed.playbook ?? parsed.records[0];
      store.playbookName = name;
      renderPlaybook();
      return true;
    }
    const session = buildSession(name, parsed.records);
    if (!session.touches.length && !session.rows.length) return false;
    store.sessions.push(session);
    if (store.current < 0) selectSession(store.sessions.length - 1, 0);
    else renderSessionSelect();
    return true;
  } catch (err) {
    console.error("failed to parse", name, err);
    alert(`Could not parse ${name}:\n${err.message}`);
    return false;
  }
}

function addPlaybook(name, text) {
  try {
    store.playbook = JSON.parse(text);
    store.playbookName = name;
    renderPlaybook();
  } catch (err) {
    alert(`Could not parse ${name}:\n${err.message}`);
  }
}

async function loadFileList(files) {
  for (const f of files) {
    const text = await f.text();
    addTrace(f.name, text);
  }
}

async function fetchTrace(url, displayName) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return false;
    const text = await resp.text();
    return addTrace(displayName ?? url.split("/").pop(), text);
  } catch { return false; }
}

/* Directory listing — works when the project root is served statically
 * (e.g. python3 -m http.server): the auto-index page is parsed for .jsonl/.json. */
async function discoverTraceDirs() {
  if (location.protocol === "file:") return;
  const candidates = ["../agent/traces/", "traces/"];
  for (const dir of candidates) {
    try {
      const resp = await fetch(dir);
      if (!resp.ok) continue;
      const html = await resp.text();
      const hrefs = [...html.matchAll(/href="([^"?#][^"#]*\.(?:jsonl|json))"/gi)]
        .map((m) => decodeURIComponent(m[1]))
        .filter((h) => !h.startsWith("..") && !h.includes("/"));
      if (!hrefs.length) continue;
      const section = $("remote-traces");
      section.hidden = false;
      $("remote-dir-label").textContent = dir;
      const list = $("remote-list");
      for (const h of hrefs) {
        const btn = document.createElement("button");
        btn.className = "remote-item";
        btn.textContent = h;
        btn.onclick = async () => {
          const ok = await fetchTrace(dir + encodeURIComponent(h), h);
          if (ok) btn.classList.add("loaded");
        };
        list.appendChild(btn);
      }
      break; // first dir that yields files wins
    } catch { /* try next */ }
  }
}

/* ------------------------------------------------------------- sample */

const EMBEDDED_SAMPLE = `{"kind":"session_start","session_id":"embedded_mini","scenario_id":"practice","target_id":"julius","target_name":"Julius Muth","budget":10,"objective":"credentials","persona":{"name":"Dr. Lena Hofer","role":"Senior Partner","org":"Hofer & Brandt Advisory","address":"lena.hofer@hoferbrandt-advisory.com"},"ts":1795234790.2}
{"kind":"touch","touch_idx":1,"target_id":"julius","objective":"credentials","suspicion":0.1,"touches_left":9,"topics":{"ciso_warm_intro":{"confidence":0.48,"status":"untested"}},"plan":{"action":"probe","topic_id":"ciso_warm_intro","channel":"email","reason":"link-free opener","sender":{"name":"Dr. Lena Hofer","role":"Senior Partner","org":"Hofer & Brandt Advisory","address":"lena.hofer@hoferbrandt-advisory.com"}},"writer_brief":{"goal":"earn a short reply","tone":"peer-to-peer","key_points":["NDA evaluation","no links"],"asserted_facts":[],"cta":"a short reply"},"draft":{"subject":"Confidential evaluation — human-risk platforms (2027)","body":"Julius — I will keep this short.\\n\\nWe advise the CISO office of a DAX40 industrial group shortlisting human-risk platforms for a 2027 rollout, under NDA. revel8 came up through your investor circle. Are you the right person for a confidential scoping exchange?\\n\\nBest,\\nDr. Lena Hofer"},"guard":{"passed":true,"issues":[],"redos":0},"events":[],"reaction":"ignored","fallbacks":[],"ts":1795234886.4}
{"kind":"touch","touch_idx":2,"target_id":"julius","objective":"credentials","suspicion":0.15,"touches_left":8,"topics":{"ciso_warm_intro":{"confidence":0.8,"status":"engaged"}},"plan":{"action":"strike","topic_id":"ciso_warm_intro","channel":"email","reason":"hook confirmed, strike","include_link":true,"planned_url":"https://workspace.hoferbrandt-advisory.com/revel8-scoping","sender":{"name":"Dr. Lena Hofer","role":"Senior Partner","org":"Hofer & Brandt Advisory","address":"lena.hofer@hoferbrandt-advisory.com"}},"writer_brief":{"goal":"deliver the workspace link","tone":"crisp","key_points":["access is open","questionnaire due mid-December"],"asserted_facts":[],"cta":"sign in"},"draft":{"subject":"Your workspace access — revel8 scoping pack","body":"Julius — as promised, your access is open.\\n\\nThe scoping pack sits behind the sign-in here:\\n\\nhttps://workspace.hoferbrandt-advisory.com/revel8-scoping\\n\\nBest,\\nLena"},"guard":{"passed":true,"issues":[],"redos":0},"events":[{"type":"page.submitted","fields":["email","password"],"url":"https://workspace.hoferbrandt-advisory.com/revel8-scoping"}],"reaction":"incident","fallbacks":[],"ts":1795235061.9}
{"kind":"incident","objective":"credentials","via":"page.submitted","touch_idx":2,"touches_to_incident":2,"ts":1795235062.5}
{"kind":"session_end","outcome":"incident","touches_used":2,"budget":10,"final_suspicion":0.15,"ts":1795235075.0}`;

async function loadSample() {
  const ok = await fetchTrace("sample-trace.jsonl", "sample-trace.jsonl");
  if (!ok) addTrace("embedded-sample.jsonl", EMBEDDED_SAMPLE);
  // also try the sample playbook (best effort)
  try {
    const resp = await fetch("sample-playbook.json");
    if (resp.ok) addPlaybook("sample-playbook.json", await resp.text());
  } catch { /* file:// — skip */ }
}

/* ------------------------------------------------------------- rendering */

function selectSession(i, row = 0) {
  store.current = i;
  store.selRow = row;
  stopPlay();
  $("empty-state").style.display = "none";
  $("session-bar").hidden = false;
  $("summary").hidden = false;
  $("scrub-bar").hidden = false;
  $("main").hidden = false;
  renderSessionSelect();
  renderSummary();
  renderTimeline();
  renderDetail();
}

function currentSession() {
  return store.sessions[store.current] ?? null;
}

function renderSessionSelect() {
  const sel = $("session-select");
  sel.innerHTML = store.sessions
    .map((s, i) => `<option value="${i}" ${i === store.current ? "selected" : ""}>${esc(s.id)} (${s.touches.length} touches)</option>`)
    .join("");
  const s = currentSession();
  if (!s) return;
  const m = s.meta;
  $("session-meta").innerHTML = [
    m.target && `<span>target <b>${esc(m.target)}</b></span>`,
    m.objective && `<span>objective <b>${esc(m.objective)}</b></span>`,
    m.scenario && `<span>scenario <b>${esc(m.scenario)}</b></span>`,
    m.arms && `<span>arms <b class="mono" style="font-size:11px">${esc(Object.entries(m.arms).map(([k, v]) => `${k}=${v}`).join(" · "))}</b></span>`,
    m.persona && `<span>persona <b>${esc(m.persona.name)}</b> <span class="mono" style="color:var(--faint)">&lt;${esc(m.persona.address || "")}&gt;</span></span>`,
  ].filter(Boolean).join("");
}

function renderSummary() {
  const s = currentSession();
  if (!s) return;
  const m = s.meta;
  const isIncident = m.outcome === "incident";
  const spark = sparkline(s.touches.map((t) => t.suspicion ?? 0));
  $("summary").innerHTML = `
    <div class="stat ${isIncident ? "incident" : ""}">
      <div class="k">Outcome</div>
      <div class="v">${isIncident ? `INCIDENT` : esc(m.outcome)}${m.incidentTouch ? `<br><small>touch ${m.incidentTouch}${m.incidentVia ? " · via " + esc(m.incidentVia) : ""}</small>` : ""}</div>
    </div>
    <div class="stat"><div class="k">Touches</div><div class="v">${m.touchesUsed}<small> of ${m.budget ?? "?"} used${m.endReason ? "" : ""}</small></div></div>
    <div class="stat"><div class="k">Final suspicion</div><div class="v">${m.finalSuspicion != null ? m.finalSuspicion.toFixed(2) : "—"}<small> / 1.0</small></div>${spark}</div>
    <div class="stat"><div class="k">Channels used</div><div class="v" style="font-size:12.5px">${m.channels.map((c) => `<span class="channel-tag">${esc(c)}</span>`).join(" ") || "—"}</div></div>
    <div class="stat"><div class="k">Wall time</div><div class="v">${fmtDur(m.startTs, m.endTs) || "—"}</div></div>
    ${m.endReason ? `<div class="stat" style="grid-column:1/-1"><div class="k">Session end reason</div><div class="v" style="font-size:12.5px;font-weight:400;color:var(--dim)">${esc(m.endReason)}</div></div>` : ""}`;
}

function sparkline(vals) {
  if (!vals.length) return "";
  const w = 120, h = 26, pad = 2;
  const step = vals.length > 1 ? (w - pad * 2) / (vals.length - 1) : 0;
  const pts = vals.map((v, i) => `${(pad + i * step).toFixed(1)},${(h - pad - v * (h - pad * 2)).toFixed(1)}`);
  return `<svg width="${w}" height="${h}" style="display:block;margin-top:6px" aria-hidden="true">
    <line x1="0" y1="${h - pad - THETA_SOFT * (h - pad * 2)}" x2="${w}" y2="${h - pad - THETA_SOFT * (h - pad * 2)}" stroke="rgba(226,166,61,.4)" stroke-dasharray="3 2"/>
    <polyline points="${pts.join(" ")}" fill="none" stroke="var(--amber)" stroke-width="1.6"/>
    ${pts.map((p) => `<circle cx="${p.split(",")[0]}" cy="${p.split(",")[1]}" r="2" fill="var(--amber)"/>`).join("")}
  </svg>`;
}

/* timeline */

function renderTimeline() {
  const s = currentSession();
  if (!s) return;
  const tl = $("timeline");
  let html = `<div class="tl-head">Timeline — ${s.touches.length} touches</div>`;
  s.rows.forEach((row, i) => {
    if (row.type === "touch") {
      const t = row.t;
      const rCls = REACTION_CLASS[t.reaction] || "b-grey";
      const aCls = ACTION_CLASS[t.action] || "b-grey";
      html += `
      <div class="tl-row ${i === store.selRow ? "sel" : ""}" data-row="${i}" role="button" tabindex="0">
        <div class="tl-idx">${t.idx ?? i + 1}</div>
        <div class="tl-main">
          <div class="tl-title">${badge(t.action || "touch", aCls)} <span class="channel-tag">${esc(t.channel || "?")}</span></div>
          <div class="tl-sub">${esc(t.topicId || "")}</div>
        </div>
        <div class="tl-right">
          <span class="badge ${rCls}"><span class="dot"></span>${esc(t.reaction || "—")}</span>
          ${t.suspicion != null ? `<span class="tl-susp">s ${t.suspicion.toFixed(2)}</span>` : ""}
        </div>
      </div>`;
    } else {
      const k = row.kind;
      const isInc = k === "incident";
      html += `
      <div class="tl-row marker ${isInc ? "marker-incident" : ""} ${i === store.selRow ? "sel" : ""}" data-row="${i}" role="button" tabindex="0">
        <div class="tl-idx" style="${isInc ? "color:var(--gold);border-color:var(--gold)" : ""}">${isInc ? "★" : "·"}</div>
        <div class="tl-main">
          <div class="tl-title" style="${isInc ? "color:var(--gold)" : "color:var(--dim)"}">${esc(markerTitle(row.rec))}</div>
          <div class="tl-sub">${esc(markerSub(row.rec))}</div>
        </div>
        <div class="tl-right"></div>
      </div>`;
    }
  });
  tl.innerHTML = html;
  tl.querySelectorAll(".tl-row").forEach((el) => {
    el.addEventListener("click", () => selectRow(Number(el.dataset.row)));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") selectRow(Number(el.dataset.row)); });
  });
  // scrub slider
  const range = $("scrub-range");
  range.max = String(Math.max(0, s.rows.length - 1));
  range.value = String(store.selRow);
  updateScrubLabel();
}

function markerTitle(rec) {
  switch (rec.kind) {
    case "session_start": return "session start";
    case "session_end": return `session end — ${rec.outcome ?? ""}`;
    case "incident": return `INCIDENT — ${rec.objective ?? ""} via ${rec.via ?? "?"}`;
    case "page_registered": return "landing page registered";
    default: return String(rec.kind ?? "event").replace(/_/g, " ");
  }
}

function markerSub(rec) {
  switch (rec.kind) {
    case "session_start": return `${rec.target_id ?? rec.target ?? ""} · budget ${rec.budget ?? "?"}`;
    case "session_end": return `${rec.touches_used ?? "?"} touches used`;
    case "incident": return `touch ${rec.touch_idx ?? "?"}`;
    case "page_registered": return rec.url ?? "";
    default: return "";
  }
}

function selectRow(i) {
  const s = currentSession();
  if (!s) return;
  store.selRow = Math.max(0, Math.min(i, s.rows.length - 1));
  renderTimeline();
  renderDetail();
}

function updateScrubLabel() {
  const s = currentSession();
  if (!s) return;
  const row = s.rows[store.selRow];
  const label = row?.type === "touch" ? `touch ${row.t.idx ?? "?"}` : (row ? markerTitle(row.rec) : "");
  $("scrub-label").textContent = `${store.selRow + 1}/${s.rows.length} — ${label}`;
}

/* detail */

function renderDetail() {
  const s = currentSession();
  if (!s) return;
  const row = s.rows[store.selRow];
  if (!row) return;
  if (row.type === "marker") return renderMarkerDetail(row.rec);
  renderTouchDetail(s, row);
}

function renderMarkerDetail(rec) {
  const isInc = rec.kind === "incident";
  $("detail").innerHTML = `
    <div class="touch-head">
      <h2 style="${isInc ? "color:var(--gold)" : ""}">${esc(markerTitle(rec))}</h2>
      <div class="spacer"></div>
      <span class="ts">${fmtTs(rec.ts)}</span>
    </div>
    ${isInc ? `<div class="card"><div class="card-body">
      <div class="kv">
        <div class="k">Objective</div><div class="v">${esc(rec.objective ?? "—")}</div>
        <div class="k">Via</div><div class="v">${esc(rec.via ?? "—")}</div>
        <div class="k">At touch</div><div class="v">${esc(rec.touch_idx ?? "—")} of session</div>
        ${rec.fields ? `<div class="k">Fields</div><div class="v mono">${esc(JSON.stringify(rec.fields))} <span style="color:var(--faint)">(names only — values are never returned)</span></div>` : ""}
      </div></div></div>` : ""}
    ${detailsRaw(rec)}`;
  updateScrubLabel();
}

function renderTouchDetail(s, row) {
  const t = row.t;
  const idxInTouches = s.touches.indexOf(t);
  const prev = idxInTouches > 0 ? s.touches[idxInTouches - 1] : null;
  const page = getPage(t.raw);
  const events = t.events.map(normEvent);
  const replies = events.filter((e) => e.type === "reply" && e.text);
  const aCls = ACTION_CLASS[t.action] || "b-grey";
  const rCls = REACTION_CLASS[t.reaction] || "b-grey";

  let html = `
  <div class="touch-head">
    <h2>Touch ${t.idx ?? "?"}</h2>
    ${badge(t.action || "touch", aCls)}
    <span class="channel-tag">${esc(t.channel || "unknown channel")}</span>
    ${t.topicId ? `<span class="badge b-blue" title="${esc(t.topicLabel || "")}">${esc(t.topicId)}</span>` : ""}
    ${badge(t.reaction || "—", rCls)}
    <div class="spacer"></div>
    ${t.touchesLeft != null ? `<span class="ts">${t.touchesLeft} touches left after this</span>` : ""}
    <span class="ts">${fmtTs(t.ts)}</span>
  </div>
  ${t.reason ? `<div style="color:var(--dim);font-size:12.5px;margin-top:-6px"><span style="color:var(--faint)">Planner:</span> ${esc(t.reason)}</div>` : ""}`;

  // message + events column, notecard + guard column
  html += `<div class="grid-2"><div style="display:flex;flex-direction:column;gap:14px;min-width:0">`;
  html += cardMessage(s, t, replies);
  if (page) html += cardPage(page);
  html += cardEvents(events);
  html += `</div><div style="display:flex;flex-direction:column;gap:14px;min-width:0">`;
  html += cardNotecard(t, prev);
  html += cardGuard(t);
  if (t.fallbacks.length) html += cardFallbacks(t);
  if (t.brief) html += cardBrief(t.brief);
  html += `</div></div>`;
  html += detailsRaw(t.raw);

  $("detail").innerHTML = html;

  const frame = $("page-frame");
  if (frame && page?.html) frame.srcdoc = page.html;
  updateScrubLabel();
}

function card(title, right, body) {
  return `<div class="card"><div class="card-head">${esc(title)}${right ? `<span class="right">${right}</span>` : ""}</div><div class="card-body">${body}</div></div>`;
}

function cardMessage(s, t, replies) {
  const sender = senderOf(s, t);
  const d = t.draft || {};
  const turns = t.raw.conversation?.turns ?? t.raw.turns ?? null;
  let inner = "";
  if (Array.isArray(turns) && turns.length) {
    inner = `<div class="convo">` + turns.map((u) => {
      const us = (u.who ?? u.speaker) === "us";
      return `<div class="convo-turn ${us ? "us" : "them"}"><div class="convo-who">${us ? "us (agent)" : "target"}</div>${esc(u.text ?? u.say ?? "")}</div>`;
    }).join("") + `</div>`;
  } else {
    inner = `
    <div class="msg">
      <div class="msg-meta">
        <div class="row"><span class="k">From</span><span class="v">${esc(sender?.name ?? "—")} <span class="addr">&lt;${esc(sender?.address ?? "")}&gt;</span>${sender?.role ? ` <span class="org">· ${esc(sender.role)}${sender.org ? ", " + esc(sender.org) : ""}</span>` : ""}</span></div>
        <div class="row"><span class="k">To</span><span class="v">${esc(t.target || s.meta.target || "—")}</span></div>
        <div class="row"><span class="k">Channel</span><span class="v"><span class="channel-tag">${esc(t.channel || "?")}</span></span></div>
      </div>
      ${d.subject ? `<div class="msg-subject">${esc(d.subject)}</div>` : ""}
      <div class="msg-body">${linkify(d.body ?? "(no body)")}</div>
    </div>`;
  }
  const right = `${(d.body || "").split(/\s+/).filter(Boolean).length} words`;
  return card("Message — as rendered for the twin", right, inner);
}

function cardPage(page) {
  const body = `
    <div class="page-meta">
      <span><b>URL</b> ${esc(page.url || "—")}</span>
      <span><b>Title</b> ${esc(page.title || "—")}</span>
      <span><b>Fields</b> ${esc((page.fields || []).join(", ") || "—")} <span style="color:var(--faint)">(submitted field names are the incident signal)</span></span>
    </div>
    ${page.html ? `<div class="page-frame-wrap"><iframe id="page-frame" class="page-frame" sandbox="" title="landing page preview"></iframe></div>
    <details class="raw" style="margin-top:10px"><summary>HTML source</summary><pre>${esc(page.html)}</pre></details>` : `<div class="ignored-note">declared page (no HTML captured in the trace)</div>`}`;
  return card("Landing page — registered with the API", null, body);
}

function cardEvents(events) {
  let inner;
  if (!events.length) {
    inner = `<div class="ignored-note">[ ] — ignored. No reaction came back; the angle/topic confidence decays.</div>`;
  } else {
    inner = `<div class="event-chips">` + events.map((e) => {
      const cls = EVENT_CLASS[e.type] || "ev-unknown";
      return `<span class="event-chip ${cls}"><span class="dot"></span>${esc(e.type)}</span>`;
    }).join("") + `</div>`;
    for (const e of events) {
      if (e.type === "reply" && e.text) {
        inner += `<div class="reply-in"><div class="who">↩ target reply${e.channel ? " · " + esc(e.channel) : ""}</div><div class="text">${esc(e.text)}</div></div>`;
      } else if (e.type === "link.opened" && e.url) {
        inner += `<div class="event-detail">opened: ${esc(e.url)} — hook confirmed, no submit yet</div>`;
      } else if (e.type === "page.submitted") {
        inner += `<div class="event-detail" style="color:var(--gold)">submitted fields: ${esc(JSON.stringify(e.fields ?? []))} — names only, values are never returned. This IS the credentials incident.</div>`;
      } else if (e.type === "attachment.opened" && e.file) {
        inner += `<div class="event-detail">opened attachment: ${esc(e.file)}</div>`;
      }
    }
  }
  return card("Events returned", `${events.length} event${events.length === 1 ? "" : "s"}`, inner);
}

function cardNotecard(t, prev) {
  const susp = t.suspicion;
  const prevSusp = prev?.suspicion ?? null;
  const suspDelta = susp != null && prevSusp != null ? susp - prevSusp : null;
  const pct = susp != null ? Math.round(susp * 100) : 0;

  let topicsHtml = "";
  if (t.topics && typeof t.topics === "object") {
    const prevTopics = prev?.topics ?? {};
    topicsHtml = `<div class="topics">` + Object.entries(t.topics).map(([tid, info]) => {
      const conf = numOrNull(info?.confidence) ?? 0;
      const status = info?.status ?? "untested";
      const prevConf = numOrNull(prevTopics?.[tid]?.confidence);
      const d = prevConf != null ? conf - prevConf : null;
      const fillCls = status === "engaged" ? "tf-engaged" : status === "cold" ? "tf-cold" : "tf-untested";
      return `<div class="topic-row">
        <div class="topic-label"><span class="tid">${esc(tid)}</span></div>
        <div class="topic-track"><div class="topic-fill ${fillCls}" style="width:${Math.round(conf * 100)}%"></div></div>
        <div class="topic-num">${conf.toFixed(2)} <span class="topic-status" style="color:${status === "engaged" ? "var(--green)" : status === "cold" ? "var(--faint)" : "var(--accent)"}">${esc(status)}</span>${d != null ? "<br>" + fmtDelta(d) : ""}</div>
      </div>`;
    }).join("") + `</div>`;
  }

  const body = `
    <div class="susp-value">
      <span class="num">${susp != null ? susp.toFixed(2) : "—"}</span>
      <span style="color:var(--faint);font-size:12px">suspicion (inferred — never shown by the API)</span>
      ${fmtDelta(suspDelta)} ${prevSusp != null ? `<span style="color:var(--faint);font-size:11px">vs touch ${prev.idx}</span>` : ""}
    </div>
    <div class="susp-gauge">
      <div class="susp-track">
        <div class="z1" style="width:${THETA_SOFT * 100}%"></div>
        <div class="z2" style="width:${(THETA_HARD - THETA_SOFT) * 100}%"></div>
        <div class="z3" style="width:${(1 - THETA_HARD) * 100}%"></div>
        <div class="susp-fill" style="width:${pct}%"></div>
      </div>
      <div class="susp-ticks">
        <span class="susp-tick" style="left:${THETA_SOFT * 100}%">θ_soft ${THETA_SOFT} — soften</span>
        <span class="susp-tick" style="left:${THETA_HARD * 100}%">θ_hard ${THETA_HARD} — stop</span>
      </div>
    </div>
    <div class="pb-sub" style="margin-top:2px">Topic belief (posterior confidence)</div>
    ${topicsHtml || `<div class="ignored-note">no topic snapshot in this record</div>`}`;
  return card("Notecard — belief + suspicion", null, body);
}

function cardGuard(t) {
  const g = t.guard;
  if (!g) return card("Guard (pre-send)", null, `<div class="ignored-note">no guard record</div>`);
  const issues = Array.isArray(g) ? g : (g.issues ?? []);
  const passed = Array.isArray(g) ? issues.length === 0 : (g.passed ?? issues.length === 0);
  const redos = Array.isArray(g) ? 0 : (g.redos ?? 0);
  const readback = Array.isArray(g) ? null : g.readback;
  const history = Array.isArray(g) ? [] : (g.history ?? []);
  let inner = passed
    ? `<div class="pass-note">✓ passed${redos ? ` after ${redos} redo${redos === 1 ? "" : "es"} (cap 2, D-K)` : ""}</div>`
    : `<ul class="issue-list">${issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  if (readback) {
    inner += `<div style="margin-top:8px;font-size:12px;color:var(--dim)">Planner read-back: ${readback.pass ? "pass" : "FAIL"} · severity ${esc(readback.severity ?? "—")}</div>`;
    if (readback.issues?.length)
      inner += `<ul class="issue-list" style="margin-top:6px">${readback.issues.map((i) => `<li class="warn">${esc(i)}</li>`).join("")}</ul>`;
  }
  for (const h of history) {
    inner += `<div style="margin-top:8px;font-size:11.5px;color:var(--faint)">attempt ${h.attempt ?? "?"}: ${h.pass ? "pass" : "rejected"}${h.severity ? " · " + esc(h.severity) : ""}</div>`;
    if (h.issues?.length)
      inner += `<ul class="issue-list" style="margin-top:4px">${h.issues.map((i) => `<li class="warn">${esc(i)}</li>`).join("")}</ul>`;
  }
  return card("Guard (pre-send)", `${issues.length} issue${issues.length === 1 ? "" : "s"} · ${redos} redos`, inner);
}

function cardFallbacks(t) {
  const inner = `<ul class="issue-list">${t.fallbacks.map((f) => `<li class="warn">${esc(typeof f === "string" ? f : JSON.stringify(f))}</li>`).join("")}</ul>`;
  return card("Fallbacks / errors (D-L)", String(t.fallbacks.length), inner);
}

function cardBrief(b) {
  const li = (arr) => Array.isArray(arr) && arr.length
    ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<span style="color:var(--faint)">—</span>`;
  const body = `<div class="kv">
    ${b.goal ? `<div class="k">Goal</div><div class="v">${esc(b.goal)}</div>` : ""}
    ${b.angle ? `<div class="k">Angle</div><div class="v">${esc(b.angle)}</div>` : ""}
    ${b.tone ? `<div class="k">Tone</div><div class="v">${esc(b.tone)}</div>` : ""}
    <div class="k">Key points</div><div class="v">${li(b.key_points)}</div>
    ${b.asserted_facts?.length ? `<div class="k">Asserted (ledger)</div><div class="v">${li(b.asserted_facts)}</div>` : ""}
    ${b.cta ? `<div class="k">CTA</div><div class="v">${esc(b.cta)}</div>` : ""}
  </div>`;
  return `<details class="raw" open><summary>Writer brief (blind, D-C)</summary><div class="card-body">${body}</div></details>`;
}

function detailsRaw(rec) {
  return `<details class="raw"><summary>Raw trace record</summary><pre>${esc(JSON.stringify(rec, null, 2))}</pre></details>`;
}

/* ------------------------------------------------------------- playbook */

function renderPlaybook() {
  const pb = store.playbook;
  const panel = $("playbook-panel");
  if (!pb) { panel.hidden = true; return; }
  panel.hidden = false;
  const perTarget = pb.per_target ?? {};
  let cards = "";
  for (const [tid, e] of Object.entries(perTarget)) {
    const ident = e.winning_identity;
    cards += `<div class="pb-card">
      <h3>${esc(tid)}</h3>
      <div class="kv">
        <div class="k">Learned hook</div><div class="v">${e.learned_hook ? `${esc(e.learned_hook.topic_id)} <span style="color:var(--faint)">(${numOrNull(e.learned_hook.confidence)?.toFixed(2) ?? "?"})</span><br><span style="color:var(--dim);font-size:11.5px">${esc(e.learned_hook.label ?? "")}</span>` : "—"}</div>
        <div class="k">Winning channel</div><div class="v">${e.winning_channel ? `<span class="channel-tag">${esc(e.winning_channel)}</span>` : "—"}</div>
        ${ident ? `<div class="k">Winning identity</div><div class="v">${esc(ident.name)} <span style="color:var(--faint)">&lt;${esc(ident.address ?? "")}&gt;</span><br><span style="color:var(--dim);font-size:11.5px">${esc(ident.role ?? "")}, ${esc(ident.org ?? "")}</span></div>` : ""}
        ${e.reached_incident ? `<div class="k">Incident</div><div class="v" style="color:var(--gold)">${esc(e.reached_incident.objective ?? "")} in ${esc(e.reached_incident.touches_to_incident ?? "?")} touches · via ${esc(e.reached_incident.via ?? "?")}</div>` : ""}
      </div>
      ${listBlock("Safe facts (landed clean)", e.safe_facts)}
      ${listBlock("Traps hit", e.traps_hit)}
      ${listBlock("Burned senders", e.burned_senders)}
      ${listBlock("Suspicion-triggering lines", e.suspicion_triggering_lines)}
    </div>`;
  }
  const sessions = pb.sessions ?? [];
  const table = sessions.length ? `
    <div class="pb-sub">Sessions recorded (${sessions.length})</div>
    <table class="pb-table"><thead><tr><th>session</th><th>target</th><th>outcome</th><th>touches</th><th>final susp.</th><th>when</th><th>notes</th></tr></thead>
    <tbody>${sessions.map((x) => `<tr>
      <td>${esc(x.session_id ?? "")}</td><td>${esc(x.target_id ?? "")}</td>
      <td style="color:${x.outcome === "incident" ? "var(--gold)" : "var(--dim)"}">${esc(x.outcome ?? "")}</td>
      <td>${esc(x.touches_used ?? "")}</td><td>${numOrNull(x.final_suspicion)?.toFixed(2) ?? "—"}</td>
      <td>${fmtTs(x.ts)}</td><td style="font-family:var(--sans)">${esc(x.notes ?? "")}</td>
    </tr>`).join("")}</tbody></table>` : "";
  panel.innerHTML = `
    <div class="pb-title">Cross-session playbook <small>${esc(store.playbookName)} · D-P · what the agent carries into the next session</small></div>
    <div class="pb-grid">${cards}</div>${table}`;
}

function listBlock(title, arr) {
  if (!Array.isArray(arr) || !arr.length) return "";
  return `<div class="pb-sub">${esc(title)}</div><ul class="pb-list">${arr.map((x) => `<li>${esc(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("")}</ul>`;
}

/* ------------------------------------------------------------- play / scrub */

function stopPlay() {
  if (store.playTimer) { clearInterval(store.playTimer); store.playTimer = null; }
  $("btn-play").textContent = "▶ Play";
}

function togglePlay() {
  if (store.playTimer) return stopPlay();
  const s = currentSession();
  if (!s) return;
  if (store.selRow >= s.rows.length - 1) selectRow(0);
  $("btn-play").textContent = "⏸ Pause";
  store.playTimer = setInterval(() => {
    const s2 = currentSession();
    if (!s2 || store.selRow >= s2.rows.length - 1) return stopPlay();
    selectRow(store.selRow + 1);
  }, 2600);
}

/* ------------------------------------------------------------- init */

function init() {
  $("btn-open").onclick = () => $("file-input").click();
  $("btn-sample").onclick = loadSample;
  $("btn-playbook").onclick = () => $("playbook-input").click();
  $("file-input").addEventListener("change", (e) => { loadFileList([...e.target.files]); e.target.value = ""; });
  $("playbook-input").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) f.text().then((t) => addPlaybook(f.name, t));
    e.target.value = "";
  });
  $("session-select").addEventListener("change", (e) => selectSession(Number(e.target.value), 0));
  $("btn-play").addEventListener("click", togglePlay);
  $("scrub-range").addEventListener("input", (e) => { stopPlay(); selectRow(Number(e.target.value)); });

  // drag & drop anywhere
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); dragDepth++; $("drop-hint").hidden = false; });
  window.addEventListener("dragleave", (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $("drop-hint").hidden = true; } });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    dragDepth = 0;
    $("drop-hint").hidden = true;
    if (e.dataTransfer?.files?.length) loadFileList([...e.dataTransfer.files]);
  });

  // keyboard scrub
  window.addEventListener("keydown", (e) => {
    if (store.current < 0) return;
    if (e.target.matches("input, select, textarea")) return;
    if (e.key === "ArrowRight") { stopPlay(); selectRow(store.selRow + 1); }
    else if (e.key === "ArrowLeft") { stopPlay(); selectRow(store.selRow - 1); }
    else if (e.key === "Home") { stopPlay(); selectRow(0); }
    else if (e.key === "End") { stopPlay(); selectRow(currentSession().rows.length - 1); }
  });

  discoverTraceDirs();

  // deep link: ?trace=<url> [&playbook=<url>]
  const params = new URLSearchParams(location.search);
  if (params.get("playbook")) {
    fetch(params.get("playbook")).then((r) => r.ok ? r.text() : null)
      .then((t) => t && addPlaybook(params.get("playbook"), t)).catch(() => {});
  }
  const traceParam = params.get("trace");
  if (traceParam) fetchTrace(traceParam);
}

init();
