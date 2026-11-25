// Prompt Studio: build CRM prompt templates with merge fields and run them through Claude.
// Static page, no server. Data lives in this browser (localStorage); the API key lives in
// sessionStorage (or localStorage if the user opts in) and is sent only to api.anthropic.com.
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
  const MAX_CONVO = 200 * 1024;
  const API_URL = "https://api.anthropic.com/v1/messages";
  const API_VERSION = "2026-10-21";
  const MODELS = { quick: "claude-haiku-5-5", default: "claude-sonnet-5-5", complex: "claude-opus-5-5" };
  // Server-side refusal fallback is offered on these models (beta).
  const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);
  const FALLBACK_BETA = "server-side-fallback-2026-07-01";
  const STORE_T = "ps.templates.v1", STORE_C = "ps.conversations.v1", STORE_SEEDED = "ps.seeded.v1", STORE_KEY = "ps.apiKey";

  // ---------- storage helpers (never throw) ----------
  const ls = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  // ---------- API key (memory first, then session/local storage) ----------
  let apiKey = "";
  try { apiKey = sessionStorage.getItem(STORE_KEY) || localStorage.getItem(STORE_KEY) || ""; } catch { /* storage blocked */ }
  function setKey(key, remember) {
    apiKey = key;
    try { sessionStorage.removeItem(STORE_KEY); localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    if (!key) return;
    try { (remember ? localStorage : sessionStorage).setItem(STORE_KEY, key); } catch { /* memory only */ }
  }
  function renderKeyStatus() {
    const s = $("keyStatus");
    s.className = "dot " + (apiKey ? "ok" : "warn");
    s.textContent = apiKey ? "API key added" : "No API key";
    $("keyBanner").hidden = !!apiKey;
    let remembered = false; try { remembered = !!localStorage.getItem(STORE_KEY); } catch { /* ignore */ }
    $("rememberKey").checked = remembered;
    $("keyIn").value = apiKey ? "••••••••" + apiKey.slice(-4) : "";
  }

  // ---------- state ----------
  let templates = ls.get(STORE_T, []);
  let convos = ls.get(STORE_C, []);
  let currentId = null, draft = blankDraft(), dirty = false;
  let runValues = {}, ctl = null, lastOutputText = "", lastJson = null, showRaw = false;
  let view = "library";

  function blankDraft() { return { name: "", object: "", description: "", body: "", format: "text", tier: "complex", inputs: [] }; }
  const TYPES = ["short", "long", "conversation"];
  function cloneData(t) {
    return {
      name: String(t.name || ""), object: String(t.object || ""), description: String(t.description || ""),
      body: String(t.body || ""), format: t.format === "json" ? "json" : "text",
      tier: Object.prototype.hasOwnProperty.call(MODELS, t.tier) ? t.tier : "complex",
      inputs: Array.isArray(t.inputs) ? t.inputs.map(i => ({ key: String(i.key || ""), label: String(i.label || ""), type: TYPES.includes(i.type) ? i.type : "short", sample: String(i.sample ?? "") })) : []
    };
  }
  const humanize = (k) => k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  function keysIn(body) { const out = []; let m; TOKEN.lastIndex = 0; while ((m = TOKEN.exec(body))) if (!out.includes(m[1])) out.push(m[1]); return out; }
  function syncInputs() {
    const prev = Object.fromEntries(draft.inputs.map(i => [i.key, i]));
    draft.inputs = keysIn(draft.body).map(k => prev[k] || { key: k, label: humanize(k), type: /conversation|thread|transcript/i.test(k) ? "conversation" : "short", sample: "" });
  }
  const sortByName = (a, b) => String(a.name).localeCompare(String(b.name));
  function persistTemplates() { templates.sort(sortByName); return ls.set(STORE_T, templates); }
  function persistConvos() { convos.sort(sortByName); return ls.set(STORE_C, convos); }

  // ---------- conversations: parsing ----------
  function parseCSV(text) {
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim()));
  }
  function pick(obj, names) { for (const n of names) for (const k of Object.keys(obj)) if (k.toLowerCase() === n) return obj[k]; return ""; }
  const TIME = ["time", "timestamp", "date", "datetime", "sent_at", "created_at"];
  const FROM = ["from", "sender", "author", "name", "user", "speaker"];
  const BODY = ["text", "message", "body", "content", "msg"];
  function toTranscript(filename, text) {
    const ext = (filename.split(".").pop() || "").toLowerCase();
    if (ext === "json") {
      try {
        let data = JSON.parse(text);
        if (!Array.isArray(data)) data = data.messages || data.conversation || data.items || data;
        if (Array.isArray(data)) return data.map(m => (m && typeof m === "object") ? `[${pick(m, TIME)}] ${pick(m, FROM)}: ${pick(m, BODY)}` : String(m)).join("\n");
      } catch { /* fall through to raw text */ }
    }
    if (ext === "csv") {
      const rows = parseCSV(text);
      if (rows.length > 1) {
        const h = rows[0].map(x => x.trim().toLowerCase());
        const ti = h.findIndex(x => TIME.includes(x)), fi = h.findIndex(x => FROM.includes(x)), bi = h.findIndex(x => BODY.includes(x));
        if (bi >= 0) return rows.slice(1).map(r => `${ti >= 0 ? "[" + r[ti] + "] " : ""}${fi >= 0 ? r[fi] + ": " : ""}${r[bi] || ""}`).join("\n");
      }
    }
    return text;
  }
  const LINE = /^\[([^\]]+)\]\s*([^:]{1,60}):\s*(.*)$/;
  function messagesOf(content) {
    return String(content || "").split(/\r?\n/).map(l => { const m = LINE.exec(l.trim()); return m ? { time: m[1], from: m[2], text: m[3] } : null; }).filter(Boolean);
  }
  function convoStats(c) {
    const msgs = messagesOf(c.content);
    const kb = Math.max(1, Math.round(String(c.content || "").length / 1024));
    if (!msgs.length) return `${kb} KB of text`;
    const span = msgs.length > 1 ? ` · ${msgs[0].time.split(" ")[0]} to ${msgs[msgs.length - 1].time.split(" ")[0]}` : "";
    return `${msgs.length} messages${span}`;
  }
  function bubblesFor(content, limit = 400) {
    const wrap = el("div", "bubbles");
    const msgs = messagesOf(content);
    if (!msgs.length) { wrap.append(el("pre", "raw", String(content || "").slice(0, 4000))); return wrap; }
    const senders = [...new Set(msgs.map(m => m.from))];
    const bizName = senders.find(s => /\(|team|support|sales|agent|rep/i.test(s)) || senders[0];
    for (const m of msgs.slice(0, limit)) {
      const b = el("div", "bubble" + (m.from === bizName ? " biz" : ""));
      b.append(el("span", "who", `${m.from} · ${m.time}`), document.createTextNode(m.text));
      wrap.append(b);
    }
    return wrap;
  }

  // ---------- navigation ----------
  function go(v) {
    view = v;
    $("viewLibrary").hidden = v !== "library"; $("viewEditor").hidden = v !== "editor";
    $("viewConvos").hidden = v !== "convos"; $("viewSettings").hidden = v !== "settings";
    $("navTemplates").setAttribute("aria-current", (v === "library" || v === "editor") ? "page" : "false");
    $("navConvos").setAttribute("aria-current", v === "convos" ? "page" : "false");
    $("navSettings").setAttribute("aria-current", v === "settings" ? "page" : "false");
    window.scrollTo(0, 0);
  }

  // ---------- library ----------
  function renderLibrary() {
    $("countT").textContent = templates.length || "";
    const g = $("tgrid"); g.textContent = "";
    for (const t of templates) {
      const c = el("button", "tcard"); c.type = "button";
      c.append(el("h3", null, t.name || "Untitled template"), el("p", null, t.description || "No description yet."));
      const meta = el("div", "meta");
      if (t.object) meta.append(el("span", "badge acc", t.object));
      meta.append(el("span", "badge", t.format === "json" ? "Fields output" : "Text output"));
      const ins = Array.isArray(t.inputs) ? t.inputs : [];
      meta.append(el("span", "badge", `${ins.length} input${ins.length === 1 ? "" : "s"}`));
      if (ins.some(i => i.type === "conversation")) meta.append(el("span", "badge", "Reads a conversation"));
      c.append(meta);
      c.onclick = () => openTemplate(t.id);
      g.append(c);
    }
    const n = el("button", "tcard new", "+ New template"); n.type = "button"; n.onclick = newTemplate; g.append(n);
  }

  // ---------- editor ----------
  function renderEditor() {
    $("tName").value = draft.name; $("tObject").value = draft.object; $("tDesc").value = draft.description;
    $("tBody").value = draft.body; $("tFormat").value = draft.format; $("tTier").value = draft.tier;
    $("crumbName").textContent = draft.name || "New template";
    renderInputs(); renderRunFields(); renderCompiled(); renderSaved();
    $("delBtn").hidden = !currentId;
  }
  function renderInputs() {
    const box = $("inputsTable"); box.textContent = "";
    $("noInputs").hidden = draft.inputs.length > 0;
    draft.inputs.forEach((inp, idx) => {
      const row = el("div", "irow");
      const key = el("div", "key"); key.append(el("code", "merge", "{{" + inp.key + "}}"));
      const lab = el("input"); lab.type = "text"; lab.id = "lab_" + inp.key; lab.value = inp.label; lab.placeholder = "Label";
      lab.setAttribute("aria-label", "Label for " + inp.key);
      lab.oninput = () => { draft.inputs[idx].label = lab.value; markDirty(); renderRunFields(); };
      const typ = el("select"); typ.id = "typ_" + inp.key; typ.setAttribute("aria-label", "Input type for " + inp.key);
      for (const [v, t] of [["short", "Short text"], ["long", "Long text"], ["conversation", "Conversation file"]]) { const o = el("option", null, t); o.value = v; typ.append(o); }
      typ.value = inp.type;
      typ.onchange = () => { draft.inputs[idx].type = typ.value; delete runValues[inp.key]; markDirty(); renderRunFields(); renderCompiled(); };
      row.append(key, lab, typ); box.append(row);
    });
  }
  function renderRunFields() {
    const box = $("runFields"); box.textContent = "";
    if (!draft.inputs.length) { box.append(el("div", "hint", "No inputs. Add {{merge_fields}} to the prompt, or run it as is.")); return; }
    for (const inp of draft.inputs) {
      if (!(inp.key in runValues)) runValues[inp.key] = inp.sample;
      const f = el("div", "field");
      const l = el("label", null, inp.label || humanize(inp.key)); l.htmlFor = "run_" + inp.key;
      if (inp.type === "conversation") { f.append(l, convoPicker(inp)); box.append(f); continue; }
      const input = inp.type === "long" ? el("textarea") : el("input");
      if (inp.type === "long") input.rows = 4; else input.type = "text";
      input.id = "run_" + inp.key; input.value = runValues[inp.key] ?? "";
      input.oninput = () => { runValues[inp.key] = input.value; renderCompiled(); };
      f.append(l, input); box.append(f);
    }
  }
  function convoPicker(inp) {
    const wrap = el("div", "convo-pick");
    const row = el("div", "row");
    const sel = el("select"); sel.id = "run_" + inp.key;
    const none = el("option", null, convos.length ? "Choose a conversation…" : "No conversations yet"); none.value = ""; sel.append(none);
    for (const c of convos) { const o = el("option", null, c.name + (c.channel ? " (" + c.channel + ")" : "")); o.value = c.id; sel.append(o); }
    sel.value = runValues[inp.key] || "";
    const sf = el("div", "field f200"); sf.append(sel);
    const add = el("button", "btn small", "Add a file"); add.type = "button"; add.onclick = () => go("convos");
    row.append(sf, add); wrap.append(row);
    const c = convos.find(x => x.id === sel.value);
    if (c) { wrap.append(el("div", "convo-meta", convoStats(c))); wrap.append(bubblesFor(c.content, 60)); }
    sel.onchange = () => { runValues[inp.key] = sel.value; renderRunFields(); renderCompiled(); };
    return wrap;
  }
  function valueFor(inp) {
    const v = runValues[inp.key] ?? "";
    if (inp.type === "conversation") { const c = convos.find(x => x.id === v); return c ? String(c.content || "") : ""; }
    return v;
  }
  function compile() {
    const map = Object.fromEntries(draft.inputs.map(i => [i.key, i]));
    return draft.body.replace(TOKEN, (_, k) => { const v = (map[k] ? valueFor(map[k]) : "").trim(); return v || "(not provided)"; });
  }
  function renderCompiled() {
    const p = compile();
    $("compiled").textContent = p || "(The prompt is empty.)";
    const req = { model: MODELS[draft.tier], max_tokens: 16000, messages: [{ role: "user", content: p.length > 1500 ? p.slice(0, 1500) + " …" : p }] };
    $("apiSnippet").textContent =
`# Your CRM fills the merge fields, then sends this request from its server.
# On a server, the API key comes from an environment variable.
# (Long prompts are shortened here for display.)
curl ${API_URL} \\
  -H "x-api-key: $ANTHROPIC_API_KEY" \\
  -H "anthropic-version: ${API_VERSION}" \\
  -H "content-type: application/json" \\
  -d '${JSON.stringify(req, null, 2).replace(/'/g, "'\\''")}'`;
  }
  function renderSaved() {
    const n = $("savedNote");
    n.className = "saved-note" + (dirty ? " dirty" : "");
    n.textContent = dirty ? "Unsaved changes" : (currentId ? "All changes saved" : "");
  }
  function markDirty() { dirty = true; renderSaved(); }

  function openTemplate(id) {
    const t = templates.find(x => x.id === id); if (!t) return;
    currentId = id; draft = cloneData(t); dirty = false; runValues = {};
    disarmDelete(); renderEditor(); clearOutput(); go("editor");
  }
  function newTemplate() {
    currentId = null; draft = blankDraft(); dirty = false; runValues = {};
    disarmDelete(); renderEditor(); clearOutput(); go("editor"); $("tName").focus();
  }
  const slug = (s) => (String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item") + "-" + Math.random().toString(36).slice(2, 7);

  function save() {
    if (!draft.name.trim()) { $("savedNote").textContent = "Name the template first."; $("savedNote").className = "saved-note dirty"; $("tName").focus(); return; }
    draft.inputs.forEach(i => { if (runValues[i.key] !== undefined) i.sample = runValues[i.key]; });
    const id = currentId || slug(draft.name);
    const data = { id, ...cloneData(draft), updatedAt: new Date().toISOString() };
    const i = templates.findIndex(t => t.id === id);
    if (i >= 0) templates[i] = data; else templates.push(data);
    if (!persistTemplates()) { $("savedNote").textContent = "Couldn't save: this browser's storage is full or blocked."; $("savedNote").className = "saved-note dirty"; return; }
    currentId = id; dirty = false;
    renderLibrary(); $("crumbName").textContent = draft.name; $("delBtn").hidden = false; renderSaved();
  }
  let delArmed = false;
  function disarmDelete() { delArmed = false; $("delBtn").classList.remove("armed"); $("delBtn").textContent = "Delete"; }
  function del() {
    if (!currentId) return;
    if (!delArmed) { delArmed = true; $("delBtn").classList.add("armed"); $("delBtn").textContent = "Click again to delete"; return; }
    templates = templates.filter(t => t.id !== currentId); persistTemplates();
    disarmDelete(); currentId = null; renderLibrary(); go("library");
  }

  // ---------- output ----------
  function clearOutput() {
    lastOutputText = ""; lastJson = null; showRaw = false; $("copyBtn").disabled = true; $("rawBtn").hidden = true;
    const b = $("outBody"); b.className = "output-body placeholder"; b.textContent = "Run the template to see Claude's answer here.";
    $("outMeta").textContent = "Result";
  }
  const label = (k) => k.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
  const isShort = (v) => v === null || typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 40);
  const cell = (v) => v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
  function renderStructured(val) {
    const b = $("outBody"); b.textContent = "";
    if (showRaw || val === null || typeof val !== "object") { b.className = "output-body"; b.append(el("pre", "raw", JSON.stringify(val, null, 2))); return; }
    b.className = "output-body structured";
    if (Array.isArray(val)) val = { results: val };
    const entries = Object.entries(val);
    const tiles = el("div", "tiles");
    for (const [k, v] of entries) if (isShort(v)) {
      const t = el("div", "tile"); t.append(el("div", "k", label(k)));
      t.append(v === null ? el("div", "v null", "Not mentioned") : el("div", "v", String(v)));
      tiles.append(t);
    }
    if (tiles.children.length) b.append(tiles);
    for (const [k, v] of entries) {
      if (isShort(v)) continue;
      const s = el("div", "sec"); s.append(el("h4", null, label(k)));
      if (typeof v === "string") s.append(el("p", null, v));
      else if (Array.isArray(v) && v.every(x => x === null || typeof x !== "object")) {
        if (!v.length) s.append(el("p", "hint", "None found."));
        else if (v.every(x => String(x).length <= 40)) { const c = el("div", "chips"); v.forEach(x => c.append(el("span", "chip", String(x)))); s.append(c); }
        else { const ul = el("ul", "plain"); v.forEach(x => ul.append(el("li", null, String(x)))); s.append(ul); }
      } else if (Array.isArray(v)) {
        const cols = [...new Set(v.flatMap(x => x && typeof x === "object" ? Object.keys(x) : []))];
        const wrap = el("div", "tbl-wrap"), tb = el("table"), thead = el("thead"), hr = el("tr");
        cols.forEach(c => hr.append(el("th", null, label(c)))); thead.append(hr); tb.append(thead);
        const body = el("tbody");
        v.forEach(x => { const tr = el("tr"); cols.forEach(c => tr.append(el("td", /evidence|quote/i.test(c) ? "quote" : null, cell(x && x[c])))); body.append(tr); });
        tb.append(body); wrap.append(tb); s.append(wrap);
      } else {
        const wrap = el("div", "tbl-wrap"), tb = el("table"), body = el("tbody");
        Object.entries(v).forEach(([kk, vv]) => { const tr = el("tr"); tr.append(el("th", null, label(kk)), el("td", null, cell(vv))); body.append(tr); });
        tb.append(body); wrap.append(tb); s.append(wrap);
      }
      b.append(s);
    }
  }
  // Tolerant JSON read: whole text, else a ``` fence, else first {/[ to last }/].
  function parseJsonLoose(text) {
    const t = text.trim();
    try { return JSON.parse(t); } catch { /* next */ }
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
    if (fence) { try { return JSON.parse(fence[1]); } catch { /* next */ } }
    const a = t.search(/[{[]/), z = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (a >= 0 && z > a) { try { return JSON.parse(t.slice(a, z + 1)); } catch { /* give up */ } }
    throw { code: "invalid_json" };
  }

  // ---------- Claude API (streaming) ----------
  class ApiError extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } }
  async function callClaude(prompt, model, signal, onText, useFallback = FALLBACK_MODELS.has(model)) {
    const headers = {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
    };
    const body = { model, max_tokens: 16000, stream: true, messages: [{ role: "user", content: prompt }] };
    if (useFallback) { headers["anthropic-beta"] = FALLBACK_BETA; body.fallbacks = "default"; }
    let res;
    try { res = await fetch(API_URL, { method: "POST", headers, body: JSON.stringify(body), signal }); }
    catch (e) { if (e && e.name === "AbortError") throw new ApiError("cancelled", "Stopped"); throw new ApiError("network", "Couldn't reach Anthropic. Check your internet connection."); }
    if (!res.ok) {
      let msg = ""; try { const j = await res.json(); msg = (j && j.error && j.error.message) || ""; } catch { /* no body */ }
      // If the fallback beta is rejected for this key, retry once without it.
      if (res.status === 400 && useFallback && /fallback|beta/i.test(msg)) return callClaude(prompt, model, signal, onText, false);
      const code = { 400: "bad_request", 401: "auth", 403: "forbidden", 404: "not_found", 413: "too_large", 429: "rate_limited", 529: "overloaded" }[res.status] || (res.status >= 500 ? "server" : "other");
      throw new ApiError(code, msg, res.status);
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", text = "", stop = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const dataLine = chunk.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
          if (!dataLine) continue;
          let ev; try { ev = JSON.parse(dataLine); } catch { continue; }
          if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") { text += ev.delta.text; onText && onText(text); }
          else if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
          else if (ev.type === "error") throw new ApiError(ev.error && ev.error.type === "overloaded_error" ? "overloaded" : "server", (ev.error && ev.error.message) || "", 0);
        }
      }
    } catch (e) {
      if (e instanceof ApiError) { e.partial = text; throw e; }
      if (e && e.name === "AbortError") { const x = new ApiError("cancelled", "Stopped"); x.partial = text; throw x; }
      const x = new ApiError("network", "The connection dropped before the answer finished."); x.partial = text; throw x;
    }
    if (stop === "refusal") throw new ApiError("refused", "");
    return { text, truncated: stop === "max_tokens" };
  }
  const ERR = {
    no_key: "Add your Anthropic API key first.",
    auth: "Anthropic didn't accept this API key. Check it on the API key screen.",
    forbidden: "This API key isn't allowed to use that model. Pick another model or check your Anthropic account.",
    not_found: "That model isn't available to this API key. Pick another model.",
    rate_limited: "Too many requests, or this key reached its spending limit. Wait a moment, or check limits in the Anthropic Console.",
    overloaded: "Anthropic is busy right now. Run again in a minute.",
    too_large: "The prompt is too long. Use a shorter conversation or fewer inputs.",
    refused: "Claude declined this prompt. Adjust the instructions or the inputs.",
    invalid_json: "The answer wasn't valid structured data. Spell out the JSON shape in the prompt, then run again.",
    network: "Couldn't reach Anthropic. Check your internet connection and run again.",
  };
  async function run() {
    if (!apiKey) { const b = $("outBody"); b.className = "output-body"; b.textContent = ""; b.append(el("div", "err", ERR.no_key)); const go2 = el("button", "btn small", "Add API key"); go2.type = "button"; go2.onclick = () => go("settings"); b.append(go2); return; }
    const missing = draft.inputs.filter(i => i.type === "conversation" && !valueFor(i));
    if (missing.length) { const b = $("outBody"); b.className = "output-body err"; b.textContent = "Choose a conversation for “" + (missing[0].label || missing[0].key) + "” first."; return; }
    let prompt = compile();
    if (!prompt.trim()) { const b = $("outBody"); b.className = "output-body err"; b.textContent = "The prompt is empty. Write some instructions first."; return; }
    if (draft.format === "json") prompt += "\n\nReply with only one JSON object, no other text.";
    ctl = new AbortController();
    $("runBtn").disabled = true; $("stopBtn").hidden = false; $("copyBtn").disabled = true; $("rawBtn").hidden = true;
    const b = $("outBody"); b.className = "output-body placeholder"; b.textContent = "Thinking…";
    $("outMeta").textContent = "Running on " + MODELS[draft.tier] + "…";
    const t0 = performance.now();
    try {
      const isJson = draft.format === "json";
      const res = await callClaude(prompt, MODELS[draft.tier], ctl.signal, (text) => {
        if (isJson) { b.className = "output-body placeholder"; b.textContent = "Writing structured fields… (" + text.length + " characters)"; }
        else { b.className = "output-body"; b.textContent = text; }
      });
      if (isJson) {
        const val = parseJsonLoose(res.text);
        lastJson = val; lastOutputText = JSON.stringify(val, null, 2); showRaw = false;
        renderStructured(val); $("rawBtn").hidden = false; $("rawBtn").textContent = "Show JSON";
      } else { b.className = "output-body"; b.textContent = res.text; lastOutputText = res.text; }
      $("outMeta").textContent = res.truncated ? "Cut short. Ask for a shorter answer." : "Done in " + ((performance.now() - t0) / 1000).toFixed(1) + " s";
      $("copyBtn").disabled = false;
    } catch (e) {
      const code = e && e.code;
      if (code === "cancelled") {
        $("outMeta").textContent = "Stopped";
        if (e.partial && draft.format !== "json") { b.className = "output-body"; b.textContent = e.partial; lastOutputText = e.partial; $("copyBtn").disabled = false; } else clearOutput();
      } else {
        $("outMeta").textContent = "Didn't finish"; b.className = "output-body"; b.textContent = "";
        if (e && e.partial && draft.format !== "json") b.append(el("div", null, e.partial));
        let msg = ERR[code] || "Something went wrong. Run again in a moment.";
        if (code === "bad_request" && e.message) msg = "Anthropic rejected the request: " + e.message;
        b.append(el("div", "err", msg));
      }
    } finally { $("runBtn").disabled = false; $("stopBtn").hidden = true; ctl = null; }
  }

  // ---------- conversations view ----------
  function renderConvos() {
    $("countC").textContent = convos.length || "";
    const list = $("clist"); list.textContent = "";
    if (!convos.length) list.append(el("div", "empty-state", "No conversations yet. Add an exported text thread above."));
    for (const c of convos) {
      const card = el("div", "ccard");
      const left = el("div"); left.append(el("h3", null, c.name || "Untitled conversation"));
      const meta = el("div", "meta"); if (c.channel) meta.append(el("span", "badge acc", c.channel)); meta.append(el("span", "badge", convoStats(c)));
      left.append(meta);
      const right = el("div", "ws-actions");
      const d = el("button", "btn small danger", "Delete"); d.type = "button";
      let armed = false;
      d.onclick = () => {
        if (!armed) { armed = true; d.classList.add("armed"); d.textContent = "Click again"; return; }
        convos = convos.filter(x => x.id !== c.id); persistConvos(); renderConvos();
      };
      right.append(d);
      const det = el("details", "drawer"); det.append(el("summary", null, "Preview messages"));
      det.addEventListener("toggle", () => { if (det.open && det.children.length === 1) { const inner = el("div", "pad10"); inner.append(bubblesFor(c.content)); det.append(inner); } });
      card.append(left, right, det); list.append(card);
    }
    if (view === "editor") renderRunFields();
  }
  let pending = null;
  function readFile(file) {
    $("upNote").textContent = "";
    if (!file) { pending = null; $("upBtn").disabled = true; return; }
    if (file.size > MAX_CONVO) { $("upNote").textContent = "That file is over 200 KB. Export a shorter date range and try again."; pending = null; $("upBtn").disabled = true; return; }
    const r = new FileReader();
    r.onload = () => {
      const content = toTranscript(file.name, String(r.result || "")).slice(0, MAX_CONVO);
      pending = { content };
      if (!$("upName").value) $("upName").value = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
      $("upNote").textContent = "Ready: " + convoStats({ content }) + ". Choose Add to save it.";
      $("upBtn").disabled = false;
    };
    r.onerror = () => { $("upNote").textContent = "Couldn't read that file. Try a .txt, .csv or .json export."; };
    r.readAsText(file);
  }
  function addConvo() {
    if (!pending) return;
    const name = $("upName").value.trim() || "Untitled conversation";
    convos.push({ id: slug(name), name, channel: $("upChannel").value, content: pending.content, addedAt: new Date().toISOString() });
    if (!persistConvos()) { convos.pop(); $("upNote").textContent = "Couldn't save: this browser's storage is full. Delete a conversation first."; return; }
    pending = null; $("fileIn").value = ""; $("upName").value = ""; $("upBtn").disabled = true;
    $("upNote").textContent = "Added “" + name + "”.";
    renderConvos();
  }

  // ---------- export / import (never includes the API key) ----------
  function exportWorkspace() {
    const data = { app: "prompt-studio", version: 1, exportedAt: new Date().toISOString(), templates, conversations: convos };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "prompt-studio-workspace.json";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importWorkspace(file) {
    const note = $("importNote");
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(String(r.result || ""));
        if (!data || data.app !== "prompt-studio") throw new Error("not ours");
        const ts = Array.isArray(data.templates) ? data.templates.filter(t => t && t.id).map(t => ({ id: String(t.id), ...cloneData(t), updatedAt: t.updatedAt })) : [];
        const cs = Array.isArray(data.conversations) ? data.conversations.filter(c => c && c.id).map(c => ({ id: String(c.id), name: String(c.name || ""), channel: String(c.channel || ""), content: String(c.content || "").slice(0, MAX_CONVO), addedAt: c.addedAt })) : [];
        for (const t of ts) { const i = templates.findIndex(x => x.id === t.id); if (i >= 0) templates[i] = t; else templates.push(t); }
        for (const c of cs) { const i = convos.findIndex(x => x.id === c.id); if (i >= 0) convos[i] = c; else convos.push(c); }
        persistTemplates(); persistConvos(); renderLibrary(); renderConvos();
        note.textContent = `Imported ${ts.length} template${ts.length === 1 ? "" : "s"} and ${cs.length} conversation${cs.length === 1 ? "" : "s"}.`;
      } catch { note.textContent = "That file isn't a Prompt Studio export."; }
      $("importIn").value = "";
    };
    r.readAsText(file);
  }

  // ---------- settings ----------
  function saveKeyFromInput() {
    const v = $("keyIn").value.trim();
    if (!v || v.startsWith("••")) { if (apiKey) { setKey(apiKey, $("rememberKey").checked); $("keyNote").textContent = "Saved."; } else $("keyNote").textContent = "Paste a key first."; renderKeyStatus(); return; }
    if (!/^sk-ant-/.test(v)) { $("keyNote").textContent = "That doesn't look like an Anthropic API key. It should start with sk-ant-."; return; }
    setKey(v, $("rememberKey").checked); renderKeyStatus();
    $("keyNote").textContent = $("rememberKey").checked ? "Key saved on this device." : "Key saved for this tab.";
  }
  async function testKey() {
    const v = $("keyIn").value.trim();
    if (v && !v.startsWith("••")) saveKeyFromInput();
    if (!apiKey) { $("keyNote").textContent = "Paste a key first."; return; }
    $("keyNote").textContent = "Testing…";
    try { await callClaude("Reply with the single word: ok", MODELS.quick, undefined, null); $("keyNote").textContent = "The key works."; }
    catch (e) { $("keyNote").textContent = ERR[e.code] || ("Test failed" + (e.message ? ": " + e.message : ".")); }
  }

  // ---------- wiring ----------
  $("navTemplates").onclick = () => { renderLibrary(); go("library"); };
  $("navConvos").onclick = () => go("convos");
  $("navSettings").onclick = () => go("settings");
  $("keyBannerBtn").onclick = () => go("settings");
  $("backBtn").onclick = () => { renderLibrary(); go("library"); };
  $("newBtn").onclick = newTemplate;
  $("exportBtn").onclick = exportWorkspace;
  $("importIn").onchange = (e) => importWorkspace(e.target.files[0]);
  $("tName").oninput = (e) => { draft.name = e.target.value; $("crumbName").textContent = draft.name || "New template"; markDirty(); };
  $("tObject").oninput = (e) => { draft.object = e.target.value; markDirty(); };
  $("tDesc").oninput = (e) => { draft.description = e.target.value; markDirty(); };
  $("tFormat").onchange = (e) => { draft.format = e.target.value; markDirty(); };
  $("tTier").onchange = (e) => { draft.tier = e.target.value; markDirty(); renderCompiled(); };
  $("tBody").oninput = (e) => {
    draft.body = e.target.value; markDirty();
    const before = draft.inputs.map(i => i.key).join(",");
    syncInputs();
    if (draft.inputs.map(i => i.key).join(",") !== before) { renderInputs(); renderRunFields(); }
    renderCompiled();
  };
  $("saveBtn").onclick = save; $("delBtn").onclick = del; $("runBtn").onclick = run;
  $("stopBtn").onclick = () => ctl && ctl.abort();
  $("resetBtn").onclick = () => { runValues = {}; renderRunFields(); renderCompiled(); };
  $("rawBtn").onclick = () => { showRaw = !showRaw; $("rawBtn").textContent = showRaw ? "Show fields" : "Show JSON"; renderStructured(lastJson); };
  $("copyBtn").onclick = async () => {
    try { await navigator.clipboard.writeText(lastOutputText); $("copyBtn").textContent = "Copied"; }
    catch { const r = document.createRange(); r.selectNodeContents($("outBody")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $("copyBtn").textContent = "Selected, press Ctrl+C"; }
    setTimeout(() => { $("copyBtn").textContent = "Copy"; }, 1800);
  };
  $("fileIn").onchange = (e) => readFile(e.target.files[0]);
  $("upBtn").onclick = addConvo;
  const dz = $("dropZone");
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  $("keyIn").addEventListener("focus", () => { if ($("keyIn").value.startsWith("••")) $("keyIn").value = ""; });
  $("saveKeyBtn").onclick = saveKeyFromInput;
  $("testKeyBtn").onclick = testKey;
  $("forgetKeyBtn").onclick = () => { setKey("", false); renderKeyStatus(); $("keyIn").value = ""; $("keyNote").textContent = "Key removed from this browser."; };

  // ---------- first load: seed examples once ----------
  async function seedOnce() {
    if (ls.get(STORE_SEEDED, false)) return;
    const seeds = window.PS_SEEDS || { templates: [], conversations: [] };
    for (const t of seeds.templates) if (!templates.find(x => x.id === t.id)) templates.push({ id: t.id, ...cloneData(t) });
    for (const c of seeds.conversations) {
      if (convos.find(x => x.id === c.id)) continue;
      try { const r = await fetch(c.file); if (r.ok) convos.push({ id: c.id, name: c.name, channel: c.channel, content: (await r.text()).slice(0, MAX_CONVO) }); } catch { /* opened from disk: skip */ }
    }
    persistTemplates(); persistConvos(); ls.set(STORE_SEEDED, true);
  }

  renderKeyStatus(); renderLibrary(); renderConvos(); renderEditor();
  seedOnce().then(() => { renderLibrary(); renderConvos(); });
})();
