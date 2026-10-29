/* ---- 00_head ---- */
/* =========================================================
   Fox Drive — interface (front). Les données vivent sur le serveur (Postgres) ;
   les règles métier sont dans lib.js, partagé avec le serveur.
   ========================================================= */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

/* ---------- client API ---------- */
class ApiError extends Error { constructor(m, status) { super(m); this.status = status; } }
const API = {
  async req(method, path, body) {
    let r;
    try {
      r = await fetch("/api" + path, { method, credentials: "same-origin", headers: { "content-type": "application/json", "x-requested-with": "fox" }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) { throw new ApiError("Pas de connexion au serveur. Vérifie ton réseau.", 0); }
    let j = null; try { j = await r.json(); } catch (e) { /* */ }
    if (r.status === 401 && !path.startsWith("/auth/")) { showAuth("login"); throw new ApiError("Connexion requise.", 401); }
    if (!r.ok) throw new ApiError((j && j.error) || "Erreur " + r.status, r.status);
    return j;
  },
  get: p => API.req("GET", p), post: (p, b) => API.req("POST", p, b || {}), patch: (p, b) => API.req("PATCH", p, b || {}), put: (p, b) => API.req("PUT", p, b || {}), del: p => API.req("DELETE", p),
};

let S = null;           // vue de l'état serveur : drivers, contacts, log, imports, pending, config
let ME = null;          // utilisateur connecté
let sigPrev = "";
const ui = { view: "dash", q: "", filter: "all", sort: "due", sel: false, ids: new Set(), vq: "", logFilter: "all", bulk: null, rev: null, folders: [], firstDash: true, busy: 0, chat: [], settings: null, campaigns: null, replies: null };
const isAdmin = () => !ME || ME.role === "admin";
const actives = () => S.drivers.filter(isActive);
const byId = id => S.drivers.find(d => d.id === Number(id));
const waReady = () => !!(S && S.config && S.config.whatsapp);
const agentReady = () => !!(S && S.config && S.config.agent);

function sigOf(v) { return [v.drivers.length, v.log[0] && v.log[0].eid, v.pending.map(p => p.id).join(","), v.imports[0] && v.imports[0].id, JSON.stringify(v.config), v.drivers.map(d => d.status + (d.lastContacted || "") + (d.phone || "") + (d.lastCheckin || "") + (d.lastVerif || "") + d.plate).join("|")].join("#"); }
async function reload(opts) {
  opts = opts || {};
  const v = await API.get("/state");
  const s = sigOf(v);
  const changed = s !== sigPrev;
  S = v; sigPrev = s;
  if (opts.render !== false && (changed || opts.force)) refresh();
  return changed;
}
async function act(fn, okMsg) {   // exécute une action serveur, recharge l'état, affiche un message
  try { const r = await fn(); await reload({ force: true }); if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg); return r; }
  catch (e) { toast(e.message || String(e), true); return null; }
}

/* ---- 05_labels ---- */
const LOG_LABELS = { new: "Nouveau", vehicle: "Véhicule", left: "Départ ?", return: "Retour", phone: "Numéro", verif: "Vérif.", msg: "Message", contact: "Message", reply: "Réponse", rename: "Nom", import: "Synchro", edit: "Modif.", archive: "Archivé", agent: "Assistant" };

/* ---- 10_utils ---- */

const I = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2"/><circle cx="17.5" cy="8" r="2.4"/><path d="M15.5 13.5c2.8.2 5 2.4 5 6.5"/></svg>',
  car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13l1.5-4.5C4.8 7.6 5.6 7 6.6 7h10.8c1 0 1.8.6 2.1 1.5L21 13"/><rect x="2.5" y="13" width="19" height="5.5" rx="1.5"/><circle cx="6.5" cy="18.5" r="1.6"/><circle cx="17.5" cy="18.5" r="1.6"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.5-4.2L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 14.5 4.2L20 15.5"/><path d="M20 20v-4.5h-4.5"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 6.3A8.9 8.9 0 0 0 12 4a9 9 0 0 0-7.8 13.4L3 21l3.7-1.2A9 9 0 0 0 12 21a9 9 0 0 0 5.6-15.7ZM12 19.4a7.4 7.4 0 0 1-3.8-1l-.3-.2-2.5.8.8-2.4-.2-.3A7.4 7.4 0 1 1 19.4 12 7.4 7.4 0 0 1 12 19.4Zm4-5.5c-.2-.1-1.3-.6-1.5-.7s-.4-.1-.5.1-.5.7-.6.8-.2.2-.4.1a5.9 5.9 0 0 1-1.7-1.1 6.6 6.6 0 0 1-1.2-1.5c-.1-.2 0-.3.1-.4l.3-.4.2-.3a.4.4 0 0 0 0-.4c0-.1-.5-1.3-.7-1.7s-.4-.4-.5-.4h-.5a.9.9 0 0 0-.6.3 2.7 2.7 0 0 0-.9 2 4.7 4.7 0 0 0 1 2.5 10.7 10.7 0 0 0 4.1 3.6c.6.2 1 .4 1.4.5a3.3 3.3 0 0 0 1.5.1 2.5 2.5 0 0 0 1.6-1.1 1.9 1.9 0 0 0 .1-1.1c-.1-.1-.2-.2-.4-.3Z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12.5 5 5L20 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/></svg>',
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13l1.5-4.5C4.8 7.6 5.6 7 6.6 7h10.8c1 0 1.8.6 2.1 1.5L21 13"/><rect x="2.5" y="13" width="19" height="5.5" rx="1.5"/><circle cx="6.5" cy="18.5" r="1.6"/><circle cx="17.5" cy="18.5" r="1.6"/></svg>',
};

/* ---- 15_icons ---- */
Object.assign(I, {
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 11h7M8.5 14h4"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4 18-7Z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
  mega: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>',
});

/* ---- 20_ui ---- */
/* ---------- petits utilitaires UI ---------- */
let toastT = 0;
function toast(msg, err) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast show" + (err ? " err" : "");
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = "toast"; }, err ? 6000 : 3800);
}
function modal(html, wide, sticky) {
  closeModal(true);
  const ov = document.createElement("div");
  ov.className = "ov"; ov.id = "ov";
  ov.innerHTML = '<div class="dlg' + (wide ? " wide" : "") + '" role="dialog" aria-modal="true">' + html + "</div>";
  if (!sticky) ov.addEventListener("mousedown", e => { if (e.target === ov) closeModal(); });
  document.body.appendChild(ov);
  const f = ov.querySelector("[data-autofocus]"); if (f) setTimeout(() => f.focus(), 30);
  return ov;
}
function closeModal(silent) {
  const ov = $("#ov"); if (ov) ov.remove();
  if (!silent) { ui.rev = null; }
}
function confirmDlg(title, body, okLabel, onOk, danger) {
  modal('<div class="dlg-h"><h2>' + esc(title) + '</h2></div><div class="sub">' + body + '</div><div class="dlg-f"><button class="btn" data-act="close">Annuler</button><button class="btn ' + (danger ? "btn-danger" : "btn-primary") + '" id="cf-ok">' + esc(okLabel) + "</button></div>");
  $("#cf-ok").addEventListener("click", () => { closeModal(); onOk(); });
}
function badge(tone, label) { return '<span class="badge ' + tone + '"><i></i>' + esc(label) + "</span>"; }

function statusInfo(d) {
  const st = dueStatus(d), n = daysToDue(d);
  if (st === "overdue") return { key: "overdue", tone: "red", label: "En retard · " + (-n) + " j" };
  if (st === "soon") return { key: "soon", tone: "amber", label: n === 0 ? "Aujourd'hui" : "Dans " + n + " j" };
  if (st === "ok") return { key: "ok", tone: "green", label: "À jour" };
  return { key: "unknown", tone: "", label: "Jamais vérifié" };
}
function dueText(d) {
  const due = dueDate(d); if (!due) return { main: "—", sub: "" };
  const n = daysToDue(d);
  return { main: fmtDate(due), sub: n < 0 ? "retard de " + (-n) + " j" : n === 0 ? "aujourd'hui" : "dans " + n + " j" };
}

/* ---- 30_groups ---- */
/* ---------- groupes pour le tableau de bord ---------- */
function computeGroups() {
  const A = actives();
  const byDue = (a, b) => (dueDate(a) - dueDate(b));
  const G = {
    overdue: A.filter(d => dueStatus(d) === "overdue").sort(byDue),
    soon: A.filter(d => dueStatus(d) === "soon").sort(byDue),
    ok: A.filter(d => dueStatus(d) === "ok").sort(byDue),
    unknown: A.filter(d => dueStatus(d) === "unknown").sort((a, b) => a.name.localeCompare(b.name, "fr")),
    nophone: A.filter(d => !d.phone).sort((a, b) => a.name.localeCompare(b.name, "fr")),
    pending: S.drivers.filter(d => d.status === "archived").sort((a, b) => String(b.absentSince || "").localeCompare(String(a.absentSince || ""))),
    news: []
  };
  const seen = new Set(), cutoff = Date.now() - 21 * DAY_MS;
  S.log.forEach(e => {
    if (!["new", "vehicle", "return"].includes(e.type)) return;
    if (new Date(e.ts).getTime() < cutoff) return;
    const k = e.id != null ? e.id : e.name;
    if (seen.has(k)) return; seen.add(k);
    G.news.push(e);
  });
  return G;
}
function autoRelanceTargets() {
  const now = todayDate();
  const all = actives().filter(d => dueStatus(d) === "overdue");
  const withPhone = all.filter(d => d.phone);
  const ready = withPhone.filter(d => !recentlyContacted(d, now));
  return { all, ready, noPhone: all.length - withPhone.length, recent: withPhone.length - ready.length };
}

/* ---- 40_nav ---- */
/* ---------- navigation ---------- */
const VIEWS = [
  { key: "dash", label: "Tableau de bord", short: "Accueil", icon: "home", tab: true },
  { key: "drivers", label: "Chauffeurs", icon: "users", tab: true },
  { key: "vehicles", label: "Véhicules", icon: "car" },
  { key: "sync", label: "Mise à jour", short: "Synchro", icon: "sync" },
  { key: "campaigns", label: "Campagnes", short: "Envois", icon: "mega", tab: true },
  { key: "agent", label: "Assistant", icon: "chat", tab: true },
  { key: "log", label: "Journal", icon: "log" },
  { key: "settings", label: "Réglages", icon: "gear", hideTop: true },
];
const viewOk = v => isAdmin() || !["agent", "settings"].includes(v.key);
function renderNav() {
  const over = computeGroups().overdue.length;
  const pend = (S.pending || []).length;
  const btn = (v, short) => '<button data-act="go" data-v="' + v.key + '"' + (ui.view === v.key ? ' aria-current="page"' : "") + ">" + I[v.icon] + "<span>" + (short && v.short ? v.short : v.label) + "</span>" +
    (v.key === "drivers" && over ? '<span class="cnt">' + over + "</span>" : "") + (v.key === "sync" && pend ? '<span class="cnt">' + pend + "</span>" : "") + "</button>";
  $("#nav").innerHTML = VIEWS.filter(v => viewOk(v) && !v.hideTop).map(v => btn(v, false)).join("");
  const more = VIEWS.some(v => viewOk(v) && !v.tab && ui.view === v.key);
  $("#tabbar").innerHTML = VIEWS.filter(v => viewOk(v) && v.tab).map(v => btn(v, true)).join("") +
    '<button data-act="more"' + (more ? ' aria-current="page"' : "") + ">" + I.more + "<span>Plus</span>" + (pend ? '<span class="cnt">' + pend + "</span>" : "") + "</button>";
  const g = $("#btn-gear"); if (g) g.hidden = !isAdmin(); if (g) g.setAttribute("aria-current", ui.view === "settings" ? "page" : "false");
}
function openMore() {
  modal('<div class="dlg-h"><h2>Menu</h2><button class="iconbtn" data-act="close" aria-label="Fermer">' + I.x + "</button></div>" +
    VIEWS.filter(v => viewOk(v) && !v.tab).map(v => '<button class="opt" data-act="go" data-v="' + v.key + '"><b>' + v.label + "</b></button>").join("") +
    '<button class="opt" data-act="logout"><b>Se déconnecter</b><span>' + esc(ME ? ME.email : "") + "</span></button>");
}
function go(view, opts) {
  opts = opts || {};
  closeModal();
  if (view !== ui.view) { window.scrollTo(0, 0); if (view === "dash") ui.firstDash = true; }
  ui.view = view;
  if (opts.filter) ui.filter = opts.filter;
  if (opts.filter && view === "drivers") ui.q = "";
  try { history.replaceState(null, "", "#" + view); } catch (e) { }
  renderAll();
  if (view === "campaigns") loadCampaigns();
  if (view === "settings") loadSettings();
}
function renderAll() {
  if (!S) return;
  VIEWS.forEach(v => { const s = $("#v-" + v.key); if (s) s.hidden = v.key !== ui.view; });
  renderNav();
  if (ui.view === "dash") renderDash(); else destroyFolders();
  if (ui.view === "drivers") renderDrivers();
  if (ui.view === "vehicles") renderVehicles();
  if (ui.view === "sync") renderSync();
  if (ui.view === "log") renderLog();
  if (ui.view === "campaigns") renderCampaigns();
  if (ui.view === "agent") renderAgent();
  if (ui.view === "settings") renderSettings();
  updateBulkbar();
}
function refresh() { if (!$("#ov") || ui.view === "dash") renderAll(); else { renderNav(); } }

/* ---- 45_dash_head ---- */
/* =========================================================
   TABLEAU DE BORD
   ========================================================= */
function destroyFolders() { ui.folders.forEach(f => f.destroy()); ui.folders = []; }
const sheetReady = () => !!(S.config && S.config.sheet);

function renderDash() {
  destroyFolders();
  const A = actives();
  const G = computeGroups();
  const ar = autoRelanceTargets();
  const st = (S.config && S.config.sync) || {};
  const age = st.lastOkAt ? daysBetween(new Date(st.lastOkAt), new Date()) : null;
  const tone = !sheetReady() ? "" : age == null ? "red" : age <= 1 ? "green" : age <= 3 ? "amber" : "red";
  let dateLong = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  dateLong = dateLong.charAt(0).toUpperCase() + dateLong.slice(1);

  let banners = "";
  (S.pending || []).forEach(p => {
    banners += '<div class="banner"><div class="grow"><b>Une mise à jour attend ta validation</b> — ' + esc(p.reason || (p.kind === "foxdrive" ? "export FoxDrive" : "contacts")) + " (" + esc(p.source || "") + ", " + relTime(p.ts) + ').</div><button class="btn btn-primary btn-sm" data-act="review-pending" data-id="' + p.id + '">Voir et valider</button></div>';
  });
  if (st.lastError) banners += '<div class="banner red"><div class="grow"><b>La dernière lecture de ta feuille a échoué.</b> ' + esc(st.lastError) + '</div><button class="btn btn-sm" data-act="go" data-v="settings">Réglages</button></div>';
  if (!sheetReady()) banners += '<div class="banner warn"><div class="grow"><b>Aucune source de données reliée.</b> Relie ta feuille Google pour que la flotte se mette à jour toute seule (nouveaux chauffeurs, changements de véhicule, départs).</div><button class="btn btn-primary btn-sm" data-act="go" data-v="settings">Relier ma feuille</button></div>';
  if (!waReady() && isAdmin()) banners += '<div class="banner"><div class="grow"><b>WhatsApp Business pas encore relié.</b> En attendant, les messages s\'ouvrent dans WhatsApp, prêts à envoyer.</div><button class="btn btn-sm" data-act="go" data-v="settings">Réglages</button></div>';
  const draft = (ui.campaigns || []).find(c => c.status === "draft" && c.origin !== "user");
  if (draft) banners += '<div class="banner"><div class="grow"><b>' + esc(draft.title) + "</b> — brouillon prêt : " + draft.pending + " message(s) à valider avant envoi.</div>" + '<button class="btn btn-primary btn-sm" data-act="camp-open" data-id="' + draft.id + '">Voir la campagne</button></div>';

  const rec = S.log.slice(0, 8).map(e => '<div class="act-row"><span class="act-time">' + esc(logTimeShort(e.ts)) + '</span><span class="dot ' + e.type + '"></span><span>' + (e.name ? '<b class="who" data-act="open" data-id="' + e.id + '" style="cursor:pointer">' + esc(e.name) + "</b> — " : "") + esc(e.text) + "</span></div>").join("");
  const syncBadge = !sheetReady() ? badge("", "Source non reliée") : badge(tone, st.lastOkAt ? "Feuille Google : synchro " + relTime(st.lastOkAt) : "Feuille Google : jamais lue");

  $("#v-dash").innerHTML =
    '<div class="hero"><div><h1>Suivi de flotte</h1><div class="sub"><span>' + esc(dateLong) + '</span><span class="muted">·</span><span>' + A.length + " chauffeurs actifs</span>" + syncBadge + "</div></div>" +
    '<div class="hero-actions"><button class="btn btn-primary" data-act="sync-now">' + I.sync + (sheetReady() ? " Synchroniser" : " Mettre à jour la flotte") + "</button>" +
    '<button class="btn btn-wa" data-act="auto-relance"' + (ar.ready.length ? "" : " disabled") + ">" + I.wa + " Relancer (" + ar.ready.length + ")</button></div></div>" +
    banners + '<div class="folders" id="folders"></div>' +
    '<div class="section-h"><h2>Activité récente</h2><button class="chipbtn" data-act="go" data-v="log">Tout voir</button></div>' +
    '<div class="panel activity">' + (rec || '<div class="empty">Rien pour l\'instant.</div>') + "</div>";

  buildFolders(G);
  ui.firstDash = false;
}

/* ---- 50_dash_tail ---- */
function logTimeShort(ts) {
  const d = new Date(ts), now = new Date();
  if (toISO(d) === toISO(now)) return "auj. " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  return fmtDate(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function buildFolders(G) {
  const host = $("#folders"); if (!host) return;
  const fw = Math.min(340, Math.max(280, document.documentElement.clientWidth - 40));
  const top = (list) => list.slice(0, 4).reverse();
  const file = (d, chip, tone) => ({ name: d.name, meta: fmtPlate(d.plate), sub: d.vehicle || "", chip, chipTone: tone, onSelect: () => openDriver(d.id) });
  const nb = n => n + " chauffeur" + (n > 1 ? "s" : "");
  const bulkOf = (list) => () => { const ids = list.filter(d => d.phone).map(d => d.id); if (!ids.length) return toast("Aucun numéro dans ce dossier.", true); openChooser(null, ids); };
  const defs = [
    { label: "À relancer", count: G.overdue.length, meta: nb(G.overdue.length), art: "ember", seed: 11, tone: "light", filter: "overdue",
      files: top(G.overdue).map(d => file(d, "Retard " + (-daysToDue(d)) + " j", "red")), menu: [{ label: "Voir la liste complète", onSelect: () => go("drivers", { filter: "overdue" }) }, { label: "Message groupé (avec numéro)", onSelect: bulkOf(G.overdue) }] },
    { label: "Cette semaine", count: G.soon.length, meta: nb(G.soon.length), art: "dusk", seed: 5, tone: "light", filter: "soon",
      files: top(G.soon).map(d => file(d, daysToDue(d) === 0 ? "Aujourd'hui" : "Dans " + daysToDue(d) + " j", "amber")), menu: [{ label: "Voir la liste complète", onSelect: () => go("drivers", { filter: "soon" }) }, { label: "Message groupé (avec numéro)", onSelect: bulkOf(G.soon) }] },
    { label: "À jour", count: G.ok.length, meta: nb(G.ok.length), art: "verdant", seed: 7, tone: "light", filter: "ok",
      files: top(G.ok).map(d => file(d, "Échéance " + fmtDate(dueDate(d)), "green")), menu: [{ label: "Voir la liste complète", onSelect: () => go("drivers", { filter: "ok" }) }] },
    { label: "Jamais vérifié", count: G.unknown.length, meta: nb(G.unknown.length), art: "glacier", seed: 2, tone: "light", filter: "unknown",
      files: top(G.unknown).map(d => file(d, "Aucune vérification", "")), menu: [{ label: "Voir la liste complète", onSelect: () => go("drivers", { filter: "unknown" }) }, { label: "Message groupé (avec numéro)", onSelect: bulkOf(G.unknown) }] },
    { label: "Nouveautés", count: G.news.length, meta: G.news.length + " récent" + (G.news.length > 1 ? "s" : "") + " · 21 j", art: "aurora", seed: 3, tone: "light", filter: null, to: "log",
      files: G.news.slice(0, 4).reverse().map(e => ({ name: e.name, meta: e.type === "new" ? "Nouveau" : e.type === "vehicle" ? "Véhicule" : "Retour", sub: e.text, chip: relTime(e.ts), chipTone: e.type === "new" ? "green" : "", onSelect: () => (e.id != null && byId(e.id)) ? openDriver(e.id) : go("log") })),
      menu: [{ label: "Voir le journal", onSelect: () => go("log") }] },
    { label: "Sans numéro", count: G.nophone.length, meta: nb(G.nophone.length), art: "steel", seed: 4, tone: "dark", filter: "nophone", place: "top-left",
      files: top(G.nophone).map(d => file(d, "Numéro manquant", "red")), menu: [{ label: "Voir la liste complète", onSelect: () => go("drivers", { filter: "nophone" }) }, { label: "Importer des contacts…", onSelect: () => go("sync") }] },
    { label: "Partis", count: G.pending.length, meta: nb(G.pending.length) + " retiré" + (G.pending.length > 1 ? "s" : "") + " du suivi", art: "slate", seed: 9, tone: "dark", filter: "archived", place: "top-left",
      files: top(G.pending).map(d => file(d, d.absentSince ? "Parti le " + fmtDate(parseISO(d.absentSince)) : "Parti", "amber")), menu: [{ label: "Voir la liste complète", onSelect: () => go("drivers", { filter: "archived" }) }] },
  ];
  defs.forEach((df, i) => {
    const cell = document.createElement("div"); cell.className = "fcell";
    const fh = document.createElement("div"); fh.className = "fhost";
    const f = GF.create({
      label: df.label, meta: df.meta, count: df.count, tone: df.tone, art: df.art, seed: df.seed, files: df.files, menu: df.menu,
      labelPlacement: df.place || "bottom-left", width: fw, appear: ui.firstDash, appearDelay: i * 110,
    });
    fh.appendChild(f.el); ui.folders.push(f);
    const cap = document.createElement("button"); cap.className = "fcap";
    cap.textContent = df.count ? "Voir la liste · " + df.count + " →" : "Rien ici pour l'instant";
    if (df.count) cap.addEventListener("click", () => df.to ? go(df.to) : go("drivers", { filter: df.filter })); else cap.disabled = true;
    cell.appendChild(fh); cell.appendChild(cap); host.appendChild(cell);
  });
}

/* ---- 60_lists ---- */
/* =========================================================
   CHAUFFEURS
   ========================================================= */
const FILTERS = [
  ["all", "Tous"], ["overdue", "À relancer"], ["soon", "Cette semaine"], ["ok", "À jour"], ["unknown", "Jamais vérifié"],
  ["nophone", "Sans numéro"], ["notcontacted", "Non contactés"], ["archived", "Partis / archivés"],
];
function filterList(f) {
  const A = actives();
  switch (f) {
    case "overdue": case "soon": case "ok": case "unknown": return A.filter(d => dueStatus(d) === f);
    case "nophone": return A.filter(d => !d.phone);
    case "notcontacted": return A.filter(d => !contactedThisCycle(d) && dueStatus(d) !== "ok");
    case "pending": return S.drivers.filter(d => d.status === "pending");
    case "archived": return S.drivers.filter(d => d.status === "archived");
    default: return A;
  }
}
function sortList(list, mode) {
  const l = list.slice();
  if (mode === "name") return l.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  if (mode === "plate") return l.sort((a, b) => normPlate(a.plate).localeCompare(normPlate(b.plate)));
  return l.sort((a, b) => {   // échéance : les plus en retard d'abord, les inconnus en dernier
    const da = dueDate(a), db = dueDate(b);
    if (!da && !db) return a.name.localeCompare(b.name, "fr");
    if (!da) return 1; if (!db) return -1;
    return da - db || a.name.localeCompare(b.name, "fr");
  });
}
function matchesQuery(d, q) {
  const t = normText(q); if (!t) return true;
  const hay = normText([d.name, d.plate, d.vehicle, d.phone].join(" "));
  return t.split(" ").every(w => hay.includes(w));
}

function rowHtml(d, opts) {
  opts = opts || {};
  const si = statusInfo(d), du = dueText(d);
  const urgent = isActive(d) && si.key === "overdue";
  const pend = d.status === "pending", arch = d.status === "archived";
  const sel = ui.sel;
  const recent = d.lastCheckin && daysBetween(dayOf(d.lastCheckin), todayDate()) < CYCLE_DAYS;
  let acts;
  if (pend) acts = '<button class="btn btn-sm btn-danger" data-act="depart-ok" data-id="' + d.id + '">Départ confirmé</button><button class="btn btn-sm" data-act="still-here" data-id="' + d.id + '">Toujours là</button>';
  else if (arch) acts = '<button class="btn btn-sm" data-act="still-here" data-id="' + d.id + '">Réactiver</button>';
  else acts = (d.phone ? '<button class="iconbtn wa" title="Envoyer un message WhatsApp" data-act="chooser" data-id="' + d.id + '">' + I.wa + "</button>" : "") +
    '<button class="iconbtn' + (recent ? " done" : "") + '" title="Marquer la vérification reçue" data-act="received" data-id="' + d.id + '">' + I.check + "</button>" +
    '<button class="iconbtn" title="Ouvrir la fiche" data-act="open" data-id="' + d.id + '">' + I.more + "</button>";
  const contact = d.lastContacted ? "Contacté " + relTime(d.lastContacted) : "Jamais contacté";
  const status = pend ? badge("amber", "Départ à confirmer") : arch ? badge("", "Archivé") : badge(si.tone, si.label);
  return '<div class="row' + (sel ? " sel-on" : "") + (urgent ? " urgent" : "") + (pend ? " wide" : "") + (arch ? " narrow" : "") + '" data-id="' + d.id + '">' +
    (sel ? '<input class="cbx" type="checkbox" data-chg="sel" data-id="' + d.id + '"' + (ui.ids.has(d.id) ? " checked" : "") + ' aria-label="Sélectionner ' + esc(d.name) + '">' : "") +
    '<button class="row-main" data-act="open" data-id="' + d.id + '"><b>' + esc(d.name) + "</b><span>" + esc(d.vehicle || "—") + (d.manager ? " · " + esc(d.manager) : "") + "</span></button>" +
    '<div class="cell c-plate mono">' + esc(fmtPlate(d.plate) || "—") + "</div>" +
    '<div class="cell c-due"><span class="lbl">Échéance · </span>' + esc(du.main) + (du.sub ? "<small>" + du.sub + "</small>" : "") + "</div>" +
    '<div class="cell c-badge">' + status + "</div>" +
    '<div class="cell c-contact">' + esc(contact) + (d.lastVerif ? "<small>Vérifié le " + fmtDateFull(parseISO(d.lastVerif)) + "</small>" : "") + "</div>" +
    '<div class="cell c-phone">' + (d.phone ? esc(fmtPhone(d.phone)) : '<button class="btn btn-sm" data-act="open" data-id="' + d.id + '" data-focus="f-phone">+ numéro</button>') + "</div>" +
    '<div class="acts">' + acts + "</div></div>";
}

function renderDrivers() {
  const counts = {};
  FILTERS.forEach(([k]) => { counts[k] = filterList(k).length; });
  $("#chips").innerHTML = FILTERS.filter(([k]) => k !== "archived" || counts[k] > 0).map(([k, l]) => '<button class="chipbtn" aria-pressed="' + (ui.filter === k) + '" data-act="filter" data-f="' + k + '">' + l + ' <span class="n">' + counts[k] + "</span></button>").join("");
  if ($("#q").value !== ui.q) $("#q").value = ui.q;
  $("#sort").value = ui.sort;
  const bs = $("#btn-sel"); bs.innerHTML = I.check + "<span>" + (ui.sel ? "Terminer" : "Sélection") + "</span>";
  $("#btn-selall").hidden = !ui.sel;
  let list = filterList(ui.filter).filter(d => matchesQuery(d, ui.q));
  list = sortList(list, ui.sort);
  $("#list").innerHTML = list.length ? list.map(d => rowHtml(d)).join("") : '<div class="empty">Aucun chauffeur ne correspond.</div>';
  ui.shown = list.map(d => d.id);
}

/* =========================================================
   VÉHICULES
   ========================================================= */
function renderVehicles() {
  if ($("#vq").value !== ui.vq) $("#vq").value = ui.vq;
  const bsv = $("#btn-sel-v"); if (bsv) bsv.innerHTML = I.check + "<span>" + (ui.sel ? "Terminer" : "Sélection") + "</span>";
  const list = actives().filter(d => matchesQuery(d, ui.vq));
  if (!list.length) { $("#vlist").innerHTML = '<div class="empty">Aucun véhicule trouvé.</div>'; return; }
  const groups = {};
  list.forEach(d => { const bm = detectBrandModel(d.vehicle); (groups[bm.brand] = groups[bm.brand] || {}); (groups[bm.brand][bm.model] = groups[bm.brand][bm.model] || []).push(d); });
  let html = "";
  Object.keys(groups).sort((a, b) => a.localeCompare(b, "fr")).forEach(br => {
    const total = Object.values(groups[br]).reduce((s, a) => s + a.length, 0);
    html += '<div class="group-h">' + esc(br) + ' <span class="n">' + total + "</span></div>";
    Object.keys(groups[br]).sort((a, b) => a.localeCompare(b, "fr")).forEach(m => {
      html += '<div class="sub-h">' + esc(m) + " · " + groups[br][m].length + "</div><div class=\"list\">" + groups[br][m].sort((a, b) => a.name.localeCompare(b.name, "fr")).map(d => rowHtml(d)).join("") + "</div>";
    });
  });
  $("#vlist").innerHTML = html;
}

/* ---- 65_driver ---- */
/* =========================================================
   FICHE CHAUFFEUR
   ========================================================= */
const MSG_STATUS = { queued: "en attente", sent: "envoyé", delivered: "reçu", read: "lu", failed: "échec", received: "reçu" };
async function openDriver(id, focusId) {
  const d = byId(id); if (!d) return;
  let hist = { events: S.log.filter(e => e.id === d.id).slice(0, 10), messages: [] };
  try { hist = await API.get("/drivers/" + d.id + "/history"); } catch (e) { if (e.status === 401) return; }
  const si = statusInfo(d), due = dueDate(d);
  const arch = d.status === "archived";
  const flags = [];
  if (arch) flags.push(badge("", "Parti · archivé"));
  else flags.push(badge(si.tone, si.label));
  if (!d.phone) flags.push(badge("red", "Pas de numéro"));
  if (isActive(d) && contactedThisCycle(d)) flags.push(badge("blue", "Contacté ce cycle"));
  const pickTxt = d.pickup ? fmtDateFull(parseISO(d.pickup)) + (d.pickupEstimated ? " (date de l'import)" : "") : "—";
  const admin = isAdmin();
  const msgBtns = d.phone
    ? MESSAGE_TYPES.map(t => '<button class="btn btn-sm" data-act="send" data-id="' + d.id + '" data-type="' + t.key + '">' + I.wa + " " + esc(t.label.replace(/ \(.*\)/, "")) + "</button>").join("")
    : '<div class="note">Ajoute un numéro pour envoyer un message.</div>';
  const msgs = (hist.messages || []).slice(0, 6).map(m => '<div class="act-row"><span class="act-time">' + esc(logTimeShort(m.ts)) + '</span><span class="dot msg"></span><span>' + (m.direction === "in" ? "← <b>Réponse</b> : " : "→ ") + esc(String(m.body).replace(/\s+/g, " ").slice(0, 110)) + (m.direction === "out" ? ' <span class="muted small">· ' + (MSG_STATUS[m.status] || m.status) + (m.error ? " — " + esc(m.error) : "") + "</span>" : "") + "</span></div>").join("");
  modal(
    '<div class="dlg-h"><div><h2>' + esc(d.name) + '</h2><div class="sub small">' + esc(d.vehicle || "—") + ' · <span class="mono">' + esc(fmtPlate(d.plate) || "—") + '</span></div></div><button class="iconbtn" data-act="close" aria-label="Fermer">' + I.x + "</button></div>" +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">' + flags.join("") + "</div>" +
    '<div class="kv small"><div><div class="muted">Dernière vérification</div><b>' + (d.lastVerif ? fmtDateFull(parseISO(d.lastVerif)) : "Jamais") + "</b></div>" +
    '<div><div class="muted">Prochaine échéance</div><b>' + (due ? fmtDateFull(due) : "—") + "</b></div>" +
    '<div><div class="muted">Prise du véhicule</div><b>' + pickTxt + "</b></div>" +
    '<div><div class="muted">Dernier message</div><b>' + (d.lastContacted ? relTime(d.lastContacted) : "Aucun") + "</b></div></div>" +
    (admin ? '<div class="sect"><h3>Téléphone</h3><div style="display:flex;gap:8px"><input class="input" id="f-phone" inputmode="tel" placeholder="06 12 34 56 78" value="' + esc(fmtPhone(d.phone)) + '"><button class="btn" data-act="save-phone" data-id="' + d.id + '">Enregistrer</button></div>' +
      '<div class="small muted" style="margin-top:6px">Le numéro est rattaché au chauffeur (par son nom) : il le suit s\'il change de véhicule.</div></div>' : "") +
    (admin && isActive(d) ? '<div class="sect"><h3>Envoyer un message ' + (waReady() ? '<span class="n">WhatsApp Business</span>' : "") + '</h3><div style="display:flex;gap:6px;flex-wrap:wrap">' + msgBtns + "</div></div>" : "") +
    (admin ? '<div class="sect"><h3>Véhicule &amp; dates</h3><div class="kv">' +
      '<div class="field"><label>Plaque</label><input class="input mono" id="f-plate" value="' + esc(fmtPlate(d.plate)) + '"></div>' +
      '<div class="field"><label>Véhicule</label><input class="input" id="f-vehicle" value="' + esc(d.vehicle) + '"></div>' +
      '<div class="field"><label>Prise du véhicule</label><input class="input" type="date" id="f-pickup" value="' + esc(d.pickup || "") + '"></div>' +
      '<div class="field"><label>Dernière vérification</label><input class="input" type="date" id="f-verif" value="' + esc(d.lastVerif || "") + '"></div>' +
      '<div class="field full" style="grid-column:1/-1"><label>Notes</label><textarea class="input" id="f-notes" rows="2">' + esc(d.notes || "") + "</textarea></div>" +
      '<div class="full" style="grid-column:1/-1"><button class="btn" data-act="save-vehicle" data-id="' + d.id + '">Enregistrer</button></div></div></div>' : "") +
    (msgs ? '<div class="sect"><h3>Messages <span class="n">' + hist.messages.length + "</span></h3>" + msgs + "</div>" : "") +
    '<div class="sect"><h3>Historique <span class="n">' + hist.events.length + "</span></h3>" +
    (hist.events.length ? hist.events.slice(0, 10).map(e => '<div class="act-row"><span class="act-time">' + esc(logTimeShort(e.ts)) + '</span><span class="dot ' + e.type + '"></span><span>' + esc(e.text) + "</span></div>").join("") : '<div class="muted small">Aucun événement enregistré.</div>') + "</div>" +
    (admin ? '<div class="dlg-f">' + (arch ? '<button class="btn" data-act="still-here" data-id="' + d.id + '">Réactiver</button>'
      : '<button class="btn btn-danger" data-act="archive" data-id="' + d.id + '">Chauffeur parti</button><button class="btn btn-primary" data-act="received" data-id="' + d.id + '" data-reopen="1">' + I.check + " Vérification reçue</button>") + "</div>" : ""));
  if (focusId) { const el = document.getElementById(focusId); if (el) setTimeout(() => el.focus(), 40); }
}

async function savePhone(id) {
  const d = byId(id), v = $("#f-phone").value.trim();
  const send = (phone, msg) => act(() => API.patch("/drivers/" + id, { phone }), msg).then(r => { if (r) openDriver(id); });
  if (!v) {
    if (!d.phone) return;
    return confirmDlg("Supprimer le numéro ?", "Le numéro de " + esc(d.name) + " sera effacé.", "Supprimer", () => send("", "Numéro supprimé."), true);
  }
  const np = normPhone(v);
  if (!np.phone || !np.ok) { toast("Numéro invalide : « " + v + " ». Format attendu : 06 12 34 56 78 ou +33 6 12 34 56 78.", true); return; }
  const other = actives().find(x => x.id !== d.id && x.phone === np.phone);
  if (other) confirmDlg("Ce numéro existe déjà", "Le " + esc(fmtPhone(np.phone)) + " est déjà attribué à <b>" + esc(other.name) + "</b>. L'enregistrer aussi pour " + esc(d.name) + " ?", "Enregistrer quand même", () => send(np.phone, "Numéro enregistré."));
  else send(np.phone, "Numéro enregistré.");
}
async function saveVehicle(id) {
  const body = { plate: $("#f-plate").value, vehicle: $("#f-vehicle").value, pickup: $("#f-pickup").value || null, lastVerif: $("#f-verif").value || null, notes: $("#f-notes").value };
  const r = await act(() => API.patch("/drivers/" + id, body), "Fiche mise à jour.");
  if (r) openDriver(id);
}

/* =========================================================
   MESSAGES WHATSAPP
   ========================================================= */
async function sendMessage(id, type) {
  const d = byId(id); if (!d || !d.phone) return false;
  const lab = (MESSAGE_TYPES.find(t => t.key === type) || MESSAGE_TYPES[0]).label;
  if (waReady()) {
    await act(() => API.post("/drivers/" + id + "/send", { kind: type }), "Message envoyé à " + firstName(d.name) + " (" + lab.replace(/ \(.*\)/, "") + ").");
    return true;
  }
  // WhatsApp Business pas relié : on ouvre WhatsApp avec le message prêt, et on note le contact
  const msg = encodeURIComponent(buildMessage(d, type));
  try { await API.post("/drivers/" + id + "/action", { action: "contacted", kind: type }); } catch (e) { /* le message part quand même */ }
  window.location.href = "whatsapp://send?phone=" + waNumber(d.phone) + "&text=" + msg;
  setTimeout(() => reload({ force: true }), 800);
  return true;
}
function openChooser(id, ids) {
  const d = id != null ? byId(id) : null;
  if (id != null && (!d || !d.phone)) return;
  ui.chooser = { id, ids };
  const title = d ? "Message à " + esc(firstName(d.name)) : "Quel message envoyer ? (" + ids.length + ")";
  modal('<div class="dlg-h"><h2>' + title + '</h2><button class="iconbtn" data-act="close" aria-label="Fermer">' + I.x + '</button></div><div class="sub small" style="margin-bottom:12px">' + (waReady() ? (d ? "Le message part tout de suite par WhatsApp Business." : "Une campagne est préparée : tu la relis et tu l'envoies en un clic.") : "Choisis le type de message à préparer sur WhatsApp.") + "</div>" +
    MESSAGE_TYPES.map(t => '<button class="opt" data-act="pick-type" data-type="' + t.key + '"><b>' + esc(t.label) + "</b><span>" + esc(t.desc) + "</span></button>").join(""));
}
function pickType(type) {
  const c = ui.chooser; ui.chooser = null;
  if (!c) return;
  if (c.id != null) { closeModal(); sendMessage(c.id, type); }
  else if (waReady()) newCampaign(type, c.ids);
  else startBulk(c.ids, type);
}
function startBulk(ids, type) {
  const list = ids.map(byId).filter(d => d && d.phone).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  if (!list.length) { closeModal(); toast("Aucun chauffeur avec numéro.", true); return; }
  ui.bulk = { queue: list.map(d => d.id), i: 0, type, skipped: ids.length - list.length };
  renderBulk();
}
function renderBulk() {
  const b = ui.bulk; if (!b) return;
  const total = b.queue.length;
  const label = (MESSAGE_TYPES.find(t => t.key === b.type) || MESSAGE_TYPES[0]).label;
  let body;
  if (b.i >= total) {
    body = '<div style="text-align:center;padding:14px 0"><div class="iconbtn done" style="width:52px;height:52px;margin:0 auto 10px;border-radius:50%">' + I.check + "</div><b style=\"font-size:17px\">" + total + " message" + (total > 1 ? "s" : "") + " préparé" + (total > 1 ? "s" : "") + "</b>" +
      (b.skipped ? '<div class="muted small">' + b.skipped + " sans numéro ignoré" + (b.skipped > 1 ? "s" : "") + "</div>" : "") + "</div>";
  } else {
    const d = byId(b.queue[b.i]);
    body = '<div class="prog">' + (b.i + 1) + " / " + total + " · " + esc(label) + '</div><div class="bigcard"><b>' + esc(d.name) + '</b><div class="sub small">' + esc(fmtPlate(d.plate)) + " · " + esc(d.vehicle || "") + " · " + esc(fmtPhone(d.phone)) + "</div></div>" +
      '<button class="btn btn-wa" style="width:100%" data-act="bulk-send">' + I.wa + " Envoyer à " + esc(firstName(d.name)) + '</button><div style="text-align:center;margin-top:10px"><button class="btn btn-sm" data-act="bulk-skip">Passer sans envoyer →</button></div>';
  }
  modal('<div class="dlg-h"><h2>Envoi groupé</h2><button class="iconbtn" data-act="bulk-close" aria-label="Fermer">' + I.x + '</button></div><div class="sub small" style="margin-bottom:12px">WhatsApp n\'ouvre qu\'une conversation à la fois : clique « Envoyer », le message part préparé, puis on passe au suivant. (Avec WhatsApp Business relié dans Réglages, tout part d\'un coup.)</div>' + body);
}
function bulkClose() { ui.bulk = null; closeModal(); refresh(); }

function launchAutoRelance() {
  const ar = autoRelanceTargets();
  if (!ar.ready.length) return toast("Personne à relancer pour le moment.");
  ui.chooser = { id: null, ids: ar.ready.map(d => d.id) };
  modal('<div class="dlg-h"><h2>Relancer ' + ar.ready.length + " chauffeur" + (ar.ready.length > 1 ? "s" : "") + '</h2><button class="iconbtn" data-act="close" aria-label="Fermer">' + I.x + '</button></div>' +
    '<div class="note" style="margin-bottom:12px">' + ar.all.length + " en retard · " + ar.ready.length + " à relancer maintenant" +
    (ar.recent ? "<br>" + ar.recent + " ignoré(s) : déjà contacté(s) il y a moins de " + COOLDOWN_DAYS + " jours" : "") +
    (ar.noPhone ? "<br>" + ar.noPhone + " sans numéro (voir le dossier « Sans numéro »)" : "") + "</div>" +
    '<div class="sub small" style="margin-bottom:10px">Quel message envoyer ?</div>' +
    MESSAGE_TYPES.map(t => '<button class="opt" data-act="pick-type" data-type="' + t.key + '"><b>' + esc(t.label) + "</b><span>" + esc(t.desc) + "</span></button>").join(""));
}

/* ---------- actions sur un chauffeur ---------- */
const drvAct = (id, action, msg) => act(() => API.post("/drivers/" + id + "/action", { action }), msg);
function markReceived(id) { const d = byId(id); if (d) drvAct(id, "received", "Vérification enregistrée pour " + d.name + "."); }
function archiveDriver(id) {
  const d = byId(id); if (!d) return;
  confirmDlg("Chauffeur parti ?", esc(d.name) + " sera retiré du suivi : il n'apparaîtra plus dans les relances. Tu pourras le réactiver depuis « Partis / archivés ».", "Retirer du suivi", async () => { closeModal(); await drvAct(id, "archive", d.name + " retiré du suivi."); }, true);
}
function selection(on) { ui.sel = on; if (!on) ui.ids.clear(); refresh(); }
function updateBulkbar() {
  const bar = $("#bulkbar");
  const show = ui.sel && ui.ids.size > 0 && (ui.view === "drivers" || ui.view === "vehicles");
  bar.classList.toggle("show", show);
  $("#bulk-n").textContent = ui.ids.size + " sélectionné" + (ui.ids.size > 1 ? "s" : "");
}

/* ---- 70_review ---- */
/* ---------- revue : export FoxDrive ---------- */
function revRow(item, inner) {
  return '<label class="rev"><input type="checkbox" class="cbx" data-chg="rev" data-key="' + esc(item.key) + '"' + (item.on ? " checked" : "") + '><div class="grow">' + inner + "</div></label>";
}
function startFoxReview(prev) {
  const res = prev.res;
  ui.rev = { kind: "fox", importId: prev.importId, res, label: prev.label, format: prev.format || "", reason: prev.reason || "", pending: !!prev.pending, items: new Map() };
  [res.matched, res.probable, res.added, res.absent].forEach(arr => arr.forEach(it => ui.rev.items.set(it.key, it)));
  openFoxReview();
}
function changeLines(e) {
  const c = e.changes, out = [];
  if (c.name) out.push("Nom : " + esc(c.name[0]) + " → <b>" + esc(c.name[1]) + "</b> (orthographe FoxDrive)");
  if (c.plate) out.push('<span class="arrow">' + esc(fmtPlate(c.plate[0]) || "—") + " → <b>" + esc(fmtPlate(c.plate[1])) + "</b></span>" + (e.row.vehicle ? " · " + esc(e.row.vehicle) : ""));
  else if (c.vehicle) out.push("Véhicule : " + esc(c.vehicle[0] || "—") + " → <b>" + esc(c.vehicle[1]) + "</b>");
  if (c.lastVerif) out.push("Dernière vérif. : " + (c.lastVerif[0] ? fmtDateFull(parseISO(c.lastVerif[0])) : "jamais") + " → <b>" + (c.lastVerif[1] ? fmtDateFull(parseISO(c.lastVerif[1])) : "jamais (nouveau véhicule)") + "</b>");
  if (c.pickup) out.push("Prise du véhicule : <b>" + fmtDateFull(parseISO(c.pickup[1])) + "</b> → prochaine vérification le <b>" + fmtDateFull(addDays(parseISO(c.pickup[1]), CYCLE_DAYS)) + "</b>");
  if (c.lastCheckin) out.push('<span class="muted">La vérification « reçue » de l\'ancien véhicule est remise à zéro.</span>');
  if (e.returning) out.push(badge("green", "Retour dans la flotte"));
  return out;
}
function openFoxReview() {
  const r = ui.rev.res;
  const veh = r.matched.filter(e => e.plateChanged), oth = r.matched.filter(e => !e.plateChanged);
  let h = '<div class="dlg-h"><div><h2>Analyse de l\'export FoxDrive</h2><div class="sub small">' + esc(ui.rev.label) + " · " + (ui.rev.format ? ui.rev.format + " · " : "") + r.total + " chauffeurs lus · " + r.unchanged + " inchangés</div></div><button class=\"iconbtn\" data-act=\"rev-cancel\" aria-label=\"Fermer\">" + I.x + "</button></div>";
  const total = veh.length + oth.length + r.probable.length + r.added.length + r.absent.length;
  if (!total) h += '<div class="note">Tout est déjà à jour : aucun nouveau chauffeur, aucun changement de véhicule, aucun départ.</div>';
  if (ui.rev.reason) h += '<div class="note warn" style="margin-top:8px"><b>Pourquoi cette validation :</b> ' + esc(ui.rev.reason) + "</div>";
  r.warnings.forEach(w => { h += '<div class="note warn" style="margin-top:8px">' + esc(w) + "</div>"; });
  const sect = (title, n, desc, rows) => n ? '<div class="sect"><h3>' + title + ' <span class="n">' + n + "</span></h3>" + (desc ? '<div class="small muted" style="margin-bottom:8px">' + desc + "</div>" : "") + rows + "</div>" : "";
  h += sect("Changements de véhicule", veh.length, "La plaque FoxDrive du chauffeur n'est plus celle enregistrée. Le numéro de téléphone reste attaché à la personne.",
    veh.map(e => revRow(e, "<b>" + esc(e.driver.name) + "</b>" + changeLines(e).map(x => '<div class="small">' + x + "</div>").join(""))).join(""));
  h += sect("Nouveaux chauffeurs", r.added.length, "Présents dans FoxDrive, absents de l'app. Un numéro est repris automatiquement du carnet de contacts s'il existe.",
    r.added.map(a => revRow(a, "<b>" + esc(a.row.name) + '</b> · <span class="mono">' + esc(fmtPlate(a.row.plate)) + "</span> · " + esc(a.row.vehicle || "—") + '<div class="small">' + (a.phone ? badge("green", "Numéro trouvé : " + fmtPhone(a.phone)) : badge("red", "Numéro manquant")) + (a.row.lastVerif ? " · vérifié le " + fmtDateFull(parseISO(a.row.lastVerif)) : " · jamais vérifié") + "</div>")).join(""));
  h += sect("Même personne ?", r.probable.length, "Le nom ressemble à un chauffeur existant. Coche pour fusionner (l'orthographe FoxDrive sera utilisée) ; sinon il sera traité comme un nouveau chauffeur.",
    r.probable.map(p => revRow(p, "FoxDrive : <b>" + esc(p.row.name) + '</b> · <span class="mono">' + esc(fmtPlate(p.row.plate)) + '</span><div class="small">App : <b>' + esc(p.driver.name) + '</b> · <span class="mono">' + esc(fmtPlate(p.driver.plate)) + "</span></div>")).join(""));
  h += sect("Partis (véhicule rendu)", r.absent.length, "Suivis dans l'app mais absents de cet export : ils sont <b>retirés du suivi</b> et ne recevront plus de relance. Ils restent dans « Partis / archivés » (bouton Réactiver) si besoin."
    + (r.truncated ? ' <button class="btn btn-sm" data-act="rev-absent-all" style="margin-left:6px">Retirer quand même les ' + r.absent.length + " absents</button>" : ""),
    r.absent.map(a => revRow(a, "<b>" + esc(a.driver.name) + '</b> · <span class="mono">' + esc(fmtPlate(a.driver.plate)) + "</span> · " + esc(a.driver.vehicle || "—"))).join(""));
  h += sect("Autres mises à jour", oth.length, "", oth.map(e => revRow(e, "<b>" + esc(e.driver.name) + "</b>" + changeLines(e).map(x => '<div class="small">' + x + "</div>").join(""))).join(""));
  if (r.keptVerif.length) h += '<div class="sect"><details><summary class="small" style="cursor:pointer"><b>' + r.keptVerif.length + " date(s) de vérification conservée(s)</b> — FoxDrive indique « Jamais vérifié » mais l'app avait une date</summary><div class=\"small muted\" style=\"margin:8px 0\">" + r.keptVerif.map(k => esc(k.driver.name) + " (" + fmtDateFull(parseISO(k.kept)) + ")").join(" · ") + "</div></details></div>";
  h += '<div class="dlg-f"><button class="btn" data-act="rev-cancel">' + (ui.rev.pending ? "Décider plus tard" : "Annuler") + '</button>' + (ui.rev.pending ? '<button class="btn btn-danger" data-act="rev-reject">Refuser</button>' : "") + '<button class="btn btn-primary" id="rev-apply" data-act="rev-apply">Appliquer</button></div>';
  modal(h, true, true);
  updateRevCount();
}
function revCount() {
  const r = ui.rev.res;
  if (ui.rev.kind === "contacts") return r.assign.concat(r.change, r.probable).filter(x => x.on).length + r.unmatched.filter(u => u.assignTo).length;
  return [r.matched, r.probable, r.added, r.absent].reduce((s, a) => s + a.filter(x => x.on).length, 0);
}
function updateRevCount() {
  const b = $("#rev-apply"); if (!b || !ui.rev) return;
  const n = revCount();
  b.textContent = ui.rev.kind === "fox" ? (n ? "Appliquer (" + n + ")" : "Terminer (rien à changer)") : (n ? "Appliquer (" + n + ")" : "Terminer");
}
async function applyReview() {
  const rev = ui.rev; if (!rev) return;
  const on = [], off = [], assign = {};
  rev.items.forEach((it, key) => { if (it.assignTo) assign[key] = Number(it.assignTo); else if (it.on === true) on.push(key); else if (it.on === false) off.push(key); });
  const btn = $("#rev-apply"); if (btn) { btn.disabled = true; btn.textContent = "Application…"; }
  try {
    const r = await API.post("/imports/" + rev.importId + "/apply", { on, off, assign });
    const sum = r.summary || {};
    ui.rev = null; closeModal();
    await reload({ force: true });
    if (rev.kind === "fox") {
      const parts = [sum.added && sum.added + " nouveau(x)", sum.vehicle && sum.vehicle + " changement(s) de véhicule", sum.left && sum.left + " parti(s) retiré(s) du suivi", sum.returned && sum.returned + " retour(s)"].filter(Boolean);
      toast("Flotte mise à jour" + (parts.length ? " : " + parts.join(", ") : "") + ".");
    } else toast((sum.assigned || 0) + " numéro(s) ajouté(s), " + (sum.changed || 0) + " modifié(s).");
    go("dash");
  } catch (e) { toast(e.message, true); if (btn) { btn.disabled = false; updateRevCount(); } }
}
async function rejectPending(id) {
  confirmDlg("Refuser cette mise à jour ?", "Elle sera abandonnée. La prochaine lecture de ta feuille la proposera de nouveau si elle contient encore des changements.", "Refuser", async () => { await act(() => API.post("/imports/" + id + "/reject"), "Mise à jour refusée."); }, true);
}
async function reviewPending(id) {
  try {
    const p = await API.get("/imports/" + id);
    if (p.kind === "foxdrive") startFoxReview({ ...p, pending: true }); else startContactsReview({ ...p, pending: true });
  } catch (e) { toast(e.message, true); reload({ force: true }); }
}
/* ---------- revue : contacts ---------- */
function startContactsReview(prev) {
  const res = prev.res;
  ui.rev = { kind: "contacts", importId: prev.importId, res, label: prev.label, pending: !!prev.pending, items: new Map() };
  res.assign.concat(res.change, res.probable).forEach(i => ui.rev.items.set(i.key, i));
  res.unmatched.forEach(u => ui.rev.items.set(u.key, u));
  openContactsReview();
}
function openContactsReview() {
  const r = ui.rev.res;
  const sect = (title, n, desc, rows) => n ? '<div class="sect"><h3>' + title + ' <span class="n">' + n + "</span></h3>" + (desc ? '<div class="small muted" style="margin-bottom:8px">' + desc + "</div>" : "") + rows + "</div>" : "";
  const warnIfBad = i => i.ok ? "" : " " + badge("amber", "format inhabituel");
  let h = '<div class="dlg-h"><div><h2>Analyse des contacts</h2><div class="sub small">' + esc(ui.rev.label) + " · " + r.total + " lignes lues · " + r.same + " déjà à jour</div></div><button class=\"iconbtn\" data-act=\"rev-cancel\" aria-label=\"Fermer\">" + I.x + "</button></div>";
  if (!r.assign.length && !r.change.length && !r.probable.length && !r.unmatched.length) h += '<div class="note">Tous les numéros du fichier sont déjà dans l\'app.</div>';
  h += sect("Numéros à ajouter", r.assign.length, "Chauffeurs sans numéro qui en ont un dans ton fichier.", r.assign.map(i => revRow(i, "<b>" + esc(i.driver.name) + '</b> <span class="mono">' + esc(fmtPhone(i.phone)) + "</span>" + warnIfBad(i) + (i.name !== i.driver.name ? '<div class="small muted">lu dans le fichier : « ' + esc(i.name) + " »</div>" : ""))).join(""));
  h += sect("Numéros modifiés", r.change.length, "Le fichier donne un numéro différent de celui de l'app.", r.change.map(i => revRow(i, "<b>" + esc(i.driver.name) + '</b><div class="small arrow">' + esc(fmtPhone(i.old)) + " → <b>" + esc(fmtPhone(i.phone)) + "</b>" + warnIfBad(i) + "</div>")).join(""));
  h += sect("Même personne ?", r.probable.length, "Nom proche d'un chauffeur existant : coche si c'est bien lui.", r.probable.map(i => revRow(i, "Fichier : <b>" + esc(i.name) + '</b> <span class="mono">' + esc(fmtPhone(i.phone)) + '</span><div class="small">App : <b>' + esc(i.driver.name) + "</b>" + (i.old ? " (actuel : " + esc(fmtPhone(i.old)) + ")" : "") + "</div>")).join(""));
  if (r.unmatched.length) {
    const opts = actives().slice().sort((a, b) => (a.phone ? 1 : 0) - (b.phone ? 1 : 0) || a.name.localeCompare(b.name, "fr"));
    h += sect("Noms introuvables", r.unmatched.length, "Ces noms du fichier ne correspondent à aucun chauffeur actif. Rattache-les à la main si besoin (le numéro est aussi gardé dans le carnet pour de futurs chauffeurs).",
      r.unmatched.map(u => '<div class="rev"><div class="grow"><b>' + esc(u.name) + '</b> <span class="mono">' + esc(fmtPhone(u.phone)) + "</span>" + warnIfBad(u) + '<div style="margin-top:6px"><select class="input" data-chg="rev-assign" data-key="' + esc(u.key) + '"><option value="">— ne pas rattacher —</option>' + opts.map(d => '<option value="' + d.id + '">' + esc(d.name) + (d.phone ? " (a déjà un numéro)" : " · sans numéro") + "</option>").join("") + "</select></div></div></div>").join(""));
  }
  if (r.invalid.length) h += '<div class="note warn" style="margin-top:12px"><b>' + r.invalid.length + " numéro(s) douteux ou doublons dans le fichier :</b> " + r.invalid.map(x => esc(x.name) + " (" + esc(x.raw) + ")").join(" · ") + "</div>";
  if (r.shared.length) h += '<div class="note red" style="margin-top:12px"><b>Numéro partagé par plusieurs chauffeurs :</b><br>' + r.shared.map(s => esc(fmtPhone(s.phone)) + " → " + s.drivers.map(d => esc(d.name)).join(", ")).join("<br>") + "</div>";
  if (r.stillMissing.length) h += '<div class="sect"><details><summary class="small" style="cursor:pointer"><b>' + r.stillMissing.length + " chauffeur(s) resteront sans numéro</b></summary><div class=\"small muted\" style=\"margin:8px 0\">" + r.stillMissing.map(d => esc(d.name)).join(" · ") + "</div></details></div>";
  h += '<div class="dlg-f"><button class="btn" data-act="rev-cancel">' + (ui.rev.pending ? "Décider plus tard" : "Annuler") + '</button>' + (ui.rev.pending ? '<button class="btn btn-danger" data-act="rev-reject">Refuser</button>' : "") + '<button class="btn btn-primary" id="rev-apply" data-act="rev-apply">Appliquer</button></div>';
  modal(h, true, true);
  updateRevCount();
}

/* ---- 72_sync ---- */
/* =========================================================
   MISE À JOUR : feuille Google, import manuel, sauvegardes
   ========================================================= */
const fmtDateTime = ts => { const d = new Date(ts); return fmtDateFull(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
function sumParts(i) {
  const s = i.summary || {};
  return i.kind === "foxdrive"
    ? [s.added ? "+" + s.added + " nouveau" + (s.added > 1 ? "x" : "") : "", s.vehicle ? s.vehicle + " changement" + (s.vehicle > 1 ? "s" : "") + " de véhicule" : "", s.left ? s.left + " départ" + (s.left > 1 ? "s" : "") + " retiré" + (s.left > 1 ? "s" : "") + " du suivi" : "", s.returned ? s.returned + " retour" : "", s.updated ? s.updated + " mise" + (s.updated > 1 ? "s" : "") + " à jour" : ""].filter(Boolean)
    : [s.assigned ? s.assigned + " numéro" + (s.assigned > 1 ? "s" : "") + " ajouté" + (s.assigned > 1 ? "s" : "") : "", s.changed ? s.changed + " modifié" + (s.changed > 1 ? "s" : "") : ""].filter(Boolean);
}
function renderSync() {
  const keepFox = $("#paste-fox") ? $("#paste-fox").value : "", keepCt = $("#paste-contacts") ? $("#paste-contacts").value : "";
  const st = (S.config && S.config.sync) || {};
  const admin = isAdmin();
  const imp = S.imports.filter(i => i.status !== "pending").slice(0, 14).map(i => {
    const parts = sumParts(i);
    return '<div class="act-row"><span class="act-time" style="width:130px">' + esc(fmtDateTime(i.ts)) + '</span><span class="dot import"></span><span><b>' + (i.kind === "foxdrive" ? "Flotte" : "Contacts") + "</b>" + (i.source ? " · " + esc(i.source) : "") + " — " + i.rows + " lignes · " +
      (i.status === "rejected" ? "refusée" : parts.length ? parts.join(" · ") : "aucun changement") + "</span></div>";
  }).join("");
  const pend = (S.pending || []).map(p => '<div class="banner"><div class="grow"><b>' + (p.kind === "foxdrive" ? "Flotte" : "Contacts") + " à valider</b> — " + esc(p.reason || "") + " (" + esc(p.source || "") + ", " + relTime(p.ts) + ')</div><button class="btn btn-primary btn-sm" data-act="review-pending" data-id="' + p.id + '">Voir et valider</button></div>').join("");
  const src = sheetReady()
    ? '<div class="small sub">' + (st.lastOkAt ? "Dernière lecture réussie : <b>" + esc(relTime(st.lastOkAt)) + "</b>" : "Pas encore lue") + (st.lastRunAt ? " · dernier essai " + esc(relTime(st.lastRunAt)) : "") + ". Lecture automatique toutes les 15 minutes." + "</div>" + (st.lastError ? '<div class="note red" style="margin-top:8px"><b>Erreur :</b> ' + esc(st.lastError) + "</div>" : "") +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-primary" data-act="sync-now">' + I.sync + ' Lire la feuille maintenant</button><button class="btn" data-act="sync-force" title="Relire même si la feuille n\'a pas changé">Forcer la relecture</button><button class="btn" data-act="go" data-v="settings">Réglages de la source</button></div>'
    : '<div class="note warn">La feuille Google n\'est pas encore reliée. <button class="btn btn-primary btn-sm" data-act="go" data-v="settings" style="margin-left:6px">Relier ma feuille</button></div>';
  $("#v-sync").innerHTML =
    '<div class="hero"><div><h1>Mise à jour de la flotte</h1><div class="sub"><span>Ta feuille Google est lue automatiquement : nouveaux chauffeurs, changements de véhicule et départs sont repris tout seuls. Quand un point est douteux, la mise à jour t\'attend ici pour validation.</span></div></div></div>' + pend +
    '<div class="sync-grid"><section class="panel"><h2><span class="step-n">1</span> Source automatique</h2>' + src + "</section>" +
    (admin ? '<section class="panel"><h2><span class="step-n">2</span> Import manuel FoxDrive</h2>' +
      '<div class="small sub">Utile en dépannage ou pour un premier remplissage. Dernier import appliqué : ' + (S.lastFox ? esc(fmtDateTime(S.lastFox)) + " (" + relTime(S.lastFox) + ")" : "jamais") + "</div>" +
      '<div class="drop" id="drop-fox"><div style="margin-bottom:10px">Dépose ici un export (Excel, CSV ou texte)</div><button class="btn btn-primary" data-act="pick-fox">' + I.up + " Choisir un fichier</button></div>" +
      '<div class="field"><label for="paste-fox">…ou colle le texte copié depuis la page FoxDrive</label><textarea class="input" id="paste-fox" placeholder="Sur la page FoxDrive : Ctrl+A, Ctrl+C, puis Ctrl+V ici. Fais défiler la page jusqu\'en bas avant de copier."></textarea></div>' +
      '<div><button class="btn" data-act="analyze-fox">Analyser le texte</button></div></section>' +
      '<section class="panel"><h2><span class="step-n">3</span> Contacts · nom → numéro</h2>' +
      '<div class="small sub">' + actives().filter(d => d.phone).length + " chauffeurs sur " + actives().length + " ont un numéro" + (S.lastContacts ? " · dernier import " + relTime(S.lastContacts) : "") + ". Le numéro est rattaché au <b>nom</b> : il suit le chauffeur s'il change de véhicule.</div>" +
      '<div class="drop" id="drop-contacts"><div style="margin-bottom:10px">Dépose ici un fichier de contacts (Excel, CSV, vCard)</div><button class="btn btn-primary" data-act="pick-contacts">' + I.up + " Choisir un fichier</button></div>" +
      '<div class="field"><label for="paste-contacts">…ou colle une liste « Nom ; numéro »</label><textarea class="input" id="paste-contacts" placeholder="Dupont Jean ; 06 12 34 56 78"></textarea></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="analyze-contacts">Analyser la liste</button><button class="btn" data-act="dl-template">' + I.down + " Télécharger le modèle</button></div></section>" +
      '<section class="panel"><h2><span class="step-n">4</span> Sauvegarde &amp; export</h2><div class="small sub">Les données sont sur le serveur (base de données). Une sauvegarde de temps en temps reste une bonne idée.</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="export-backup">' + I.down + ' Exporter la sauvegarde</button><button class="btn" data-act="import-backup">' + I.up + " Importer une sauvegarde</button><button class=\"btn\" data-act=\"export-xlsx\">" + I.down + " Liste en Excel</button></div>" +
      '<div class="note">Une sauvegarde de l\'<b>ancienne app</b> (fichier .json) est acceptée : numéros, dates de contact et de vérification sont repris par nom.</div></section>' : "") + "</div>" +
    '<div class="section-h"><h2>Historique des mises à jour</h2></div><div class="panel activity">' + (imp || '<div class="empty">Aucune mise à jour pour l\'instant.</div>') + "</div>";
  if (keepFox) $("#paste-fox").value = keepFox; if (keepCt) $("#paste-contacts").value = keepCt;
}

/* ---------- lecture d'un fichier choisi : on le transforme en grille/texte, le serveur fait l'analyse ---------- */
function loadXlsxLib() {
  if (typeof XLSX !== "undefined") return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => res(); s.onerror = () => rej(new Error("Impossible de charger le lecteur Excel (connexion internet nécessaire). Enregistre le fichier en CSV ou colle le texte."));
    document.head.appendChild(s);
  });
}
async function readFileSource(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "xlsx" || ext === "xls" || ext === "xlsm") {
    await loadXlsxLib();
    const wb = XLSX.read(new Uint8Array(await readAsBuffer(file)), { type: "array", cellDates: true });
    return { grids: wb.SheetNames.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "", raw: false, dateNF: "dd/mm/yyyy" })) };
  }
  const text = await readAsText(file);
  if (ext === "csv") return { grids: [parseCSV(text)], text };
  return { text };
}
async function previewFoxBody(body, label) {
  const p = await API.post("/imports/fox/preview", { ...body, label });
  startFoxReview(p);
}
async function handleFoxFile(file) {
  try {
    const src = await readFileSource(file);
    let body = null;
    if (src.grids) {
      for (const g of src.grids) { try { const p = foxRowsFromGrid(g); if (p.rows.length) { body = { grid: g }; break; } } catch (e) { /* feuille suivante */ } }
      if (!body && src.text) body = { text: src.text };
    } else body = { text: src.text };
    if (!body) throw new Error("Aucun véhicule loué avec un chauffeur reconnu dans ce fichier.");
    await previewFoxBody(body, file.name);
  } catch (e) { toast(e.message || String(e), true); }
}
async function handleFoxPaste() {
  const t = $("#paste-fox").value;
  if (!t.trim()) return toast("Colle d'abord le texte copié depuis la page FoxDrive.", true);
  try { await previewFoxBody({ text: t }, "texte collé"); } catch (e) { toast(e.message, true); }
}
async function previewContactsBody(body, label) { startContactsReview(await API.post("/imports/contacts/preview", { ...body, label })); }
async function handleContactsFile(file) {
  try {
    const src = await readFileSource(file);
    let body = null;
    if (src.grids) { for (const g of src.grids) { if (contactsFromGrid(g).length) { body = { grid: g }; break; } } if (!body && src.text) body = { text: src.text }; }
    else body = { text: src.text };
    if (!body) throw new Error("Aucun couple nom / numéro reconnu. Il faut une colonne « Nom » et une colonne « Téléphone » (ou des lignes « Nom ; numéro »).");
    await previewContactsBody(body, file.name);
  } catch (e) { toast(e.message || String(e), true); }
}
async function handleContactsPaste() {
  const t = $("#paste-contacts").value;
  if (!t.trim()) return toast("Colle d'abord ta liste de contacts.", true);
  try { await previewContactsBody({ text: t }, "liste collée"); } catch (e) { toast(e.message, true); }
}

/* ---------- synchro ---------- */
let syncing = false;
async function syncNow(force) {
  if (!sheetReady()) { go("settings"); return; }
  if (syncing) return; syncing = true;
  toast("Lecture de la feuille…");
  try {
    const r = await API.post("/sync/run", { force: !!force });
    await reload({ force: true });
    const f = r.fox || {};
    if (f.status === "unchanged") toast("La feuille n'a pas changé depuis la dernière lecture.");
    else if (f.status === "pending") toast("Des changements attendent ta validation.", true);
    else if (f.status === "error") toast(f.error || "Lecture impossible.", true);
    else if (f.status === "applied") { const s = f.summary || {}; const parts = [s.added && s.added + " nouveau(x)", s.vehicle && s.vehicle + " changement(s) de véhicule", s.left && s.left + " parti(s) retiré(s)", s.returned && s.returned + " retour(s)"].filter(Boolean); toast("Flotte à jour" + (parts.length ? " : " + parts.join(", ") : " : rien de nouveau") + "."); }
    else toast("Synchro terminée.");
  } catch (e) { toast(e.message, true); reload({ force: true }).catch(() => { }); } finally { syncing = false; }
}

/* ---------- sauvegarde ---------- */
async function exportBackup() {
  try {
    const b = await API.get("/backup");
    downloadBlob("flotte-sauvegarde-" + toISO(new Date()) + ".json", new Blob([JSON.stringify(b, null, 1)], { type: "application/json" }));
    toast("Sauvegarde téléchargée.");
  } catch (e) { toast(e.message, true); }
}
async function importBackupFile(file) {
  let data; try { data = JSON.parse(await readAsText(file)); } catch (e) { return toast("Ce fichier n'est pas une sauvegarde valide.", true); }
  const legacy = Array.isArray(data);
  const empty = S.drivers.length === 0;
  const run = async (mode, confirm) => {
    const r = await act(() => API.post("/backup/import", { data, mode, confirm }), r => mode === "replace" ? "Sauvegarde restaurée : " + r.drivers + " chauffeurs." : "Sauvegarde fusionnée : " + r.matched + " chauffeur(s) rapproché(s), " + (r.phones || 0) + " numéro(s) repris.");
    if (r) go("dash");
  };
  if (legacy || !data.drivers) { if (legacy) return run("merge"); return toast("Fichier de sauvegarde non reconnu.", true); }
  if (empty) return run("replace");
  modal('<div class="dlg-h"><h2>Importer cette sauvegarde</h2><button class="iconbtn" data-act="close" aria-label="Fermer">' + I.x + '</button></div><div class="sub" style="margin-bottom:12px">' + data.drivers.length + " chauffeurs dans le fichier. Que faire ?</div>" +
    '<button class="opt" id="bk-merge"><b>Compléter (recommandé)</b><span>Garde la flotte actuelle et reprend les numéros, dates de contact et de vérification manquants.</span></button>' +
    '<button class="opt" id="bk-replace"><b>Tout remplacer</b><span>Efface les données actuelles et restaure exactement la sauvegarde.</span></button>');
  $("#bk-merge").onclick = () => { closeModal(); run("merge"); };
  $("#bk-replace").onclick = () => confirmDlg("Tout remplacer ?", "Toute la flotte actuelle, le journal et les numéros seront remplacés par ceux du fichier. Cette action est définitive.", "Remplacer", () => run("replace", "REMPLACER"), true);
}

/* ---- 75_campaigns ---- */
/* =========================================================
   CAMPAGNES (envois WhatsApp Business)
   ========================================================= */
const CAMP_STATUS = { draft: ["amber", "Brouillon"], sending: ["blue", "Envoi en cours"], sent: ["green", "Envoyée"], cancelled: ["", "Annulée"] };
const ITEM_STATUS = { pending: ["", "À envoyer"], sent: ["green", "Envoyé"], failed: ["red", "Échec"], skipped: ["", "Retiré"] };
const typeLabel = k => ((MESSAGE_TYPES.find(t => t.key === k) || {}).label || k).replace(/ \(.*\)/, "");

async function loadCampaigns() {
  try {
    const [c, r] = await Promise.all([API.get("/campaigns"), API.get("/replies")]);
    ui.campaigns = c.campaigns; ui.replies = r.replies;
    if (ui.view === "campaigns") renderCampaigns();
    else if (ui.view === "dash") renderNav();
  } catch (e) { if (e.status !== 401) toast(e.message, true); }
}
function renderCampaigns() {
  const el = $("#v-campaigns");
  const list = ui.campaigns;
  const admin = isAdmin();
  let h = '<div class="hero"><div><h1>Envois WhatsApp</h1><div class="sub">Prépare un envoi, relis la liste, puis envoie. Rien ne part sans ton clic' + ((S.config.automation || {}).autoSendRelance ? ", sauf la relance du jour que tu as autorisée en automatique" : "") + ".</div></div>" +
    (admin ? '<div class="hero-actions"><button class="btn btn-primary" data-act="camp-new">' + I.mega + " Nouvelle campagne</button></div>" : "") + "</div>";
  if (!waReady()) h += '<div class="banner"><div class="grow"><b>WhatsApp Business n\'est pas relié.</b> Tu peux préparer des campagnes mais l\'envoi automatique n\'est possible qu\'une fois la connexion faite dans Réglages.</div><button class="btn btn-sm" data-act="go" data-v="settings">Réglages</button></div>';
  if (list === null) { el.innerHTML = h + '<div class="empty">Chargement…</div>'; return; }
  const rep = (ui.replies || []).slice(0, 8);
  h += '<div class="section-h"><h2>Réponses des chauffeurs</h2></div><div class="panel activity">' + (rep.length ? rep.map(r => '<div class="act-row"><span class="act-time">' + esc(logTimeShort(r.ts)) + '</span><span class="dot reply"></span><span>' + (r.driverId != null && byId(r.driverId) ? '<b class="who" data-act="open" data-id="' + r.driverId + '" style="cursor:pointer">' + esc(r.name) + "</b>" : "<b>" + esc(r.name || fmtPhone(r.phone)) + "</b>") + " : " + esc(String(r.body).replace(/\s+/g, " ").slice(0, 160)) + "</span></div>").join("") : '<div class="empty">Aucune réponse reçue pour l\'instant.</div>') + "</div>";
  h += '<div class="section-h"><h2>Campagnes</h2></div>';
  h += list.length ? '<div class="list">' + list.map(c => {
    const st = CAMP_STATUS[c.status] || ["", c.status];
    return '<button class="row camp-row" data-act="camp-open" data-id="' + c.id + '"><div class="row-main"><b>' + esc(c.title) + "</b><span>" + esc(logTimeShort(c.createdAt)) + " · " + (c.origin === "user" ? "manuelle" : c.origin === "agent" ? "préparée par l'assistant" : "automatique") + '</span></div><div class="cell">' + badge(st[0], st[1]) + '</div><div class="cell small">' +
      c.sent + " envoyé" + (c.sent > 1 ? "s" : "") + (c.pending ? " · " + c.pending + " à envoyer" : "") + (c.failed ? " · <span style=\"color:var(--red)\">" + c.failed + " échec" + (c.failed > 1 ? "s" : "") + "</span>" : "") + "</div></button>";
  }).join("") + "</div>" : '<div class="panel"><div class="empty">Aucune campagne pour l\'instant.</div></div>';
  el.innerHTML = h;
}
function newCampaignDlg() {
  const t = autoRelanceTargets();
  modal('<div class="dlg-h"><h2>Nouvelle campagne</h2><button class="iconbtn" data-act="close" aria-label="Fermer">' + I.x + '</button></div>' +
    '<div class="note" style="margin-bottom:12px">' + t.ready.length + " chauffeur" + (t.ready.length > 1 ? "s" : "") + " à relancer maintenant (en retard, avec un numéro, pas contactés depuis moins de " + COOLDOWN_DAYS + " jours).</div>" +
    '<div class="sub small" style="margin-bottom:10px">Quel message ?</div>' +
    MESSAGE_TYPES.map(m => '<button class="opt" data-act="camp-create" data-type="' + m.key + '"><b>' + esc(m.label) + "</b><span>" + esc(m.desc) + "</span></button>").join(""));
}
async function newCampaign(type, ids) {
  try {
    const r = await API.post("/campaigns", { type, driverIds: ids && ids.length ? ids : undefined });
    closeModal(); await loadCampaigns(); openCampaign(r.campaign);
  } catch (e) { toast(e.message, true); }
}
async function openCampaignById(id) {
  try { const r = await API.get("/campaigns/" + id); openCampaign(r.campaign); } catch (e) { toast(e.message, true); }
}
function openCampaign(c) {
  ui.camp = c;
  const st = CAMP_STATUS[c.status] || ["", c.status];
  const n = c.counts, admin = isAdmin();
  const editable = ["draft", "sending"].includes(c.status);
  const items = c.items.map(it => {
    const s = ITEM_STATUS[it.status] || ["", it.status];
    const act = admin && editable && it.status === "pending" ? '<button class="btn btn-sm" data-act="camp-item" data-id="' + it.driverId + '" data-to="skipped">Retirer</button>'
      : admin && editable && it.status === "skipped" && /main/.test(it.reason || "") ? '<button class="btn btn-sm" data-act="camp-item" data-id="' + it.driverId + '" data-to="pending">Remettre</button>' : "";
    return '<div class="rev"><div class="grow"><b>' + esc(it.name || "—") + '</b> <span class="mono small muted">' + esc(fmtPlate(it.plate)) + " · " + esc(fmtPhone(it.phone)) + "</span>" + (it.reason ? '<div class="small muted">' + esc(it.reason) + "</div>" : "") + (it.status === "failed" && it.error ? '<div class="small" style="color:var(--red)">' + esc(it.error) + "</div>" : "") + '</div><div style="display:flex;gap:8px;align-items:center">' + badge(s[0], s[1]) + act + "</div></div>";
  }).join("");
  const sample = c.items.find(i => i.status === "pending") || c.items[0];
  const sd = sample && byId(sample.driverId);
  const bodies = (ui.settings && ui.settings.templateBodies) || null;
  const preview = sd ? '<div class="sect"><h3>Aperçu du message</h3><div class="bubble">' + esc(buildMessage(sd, c.type)).replace(/\n/g, "<br>") + '</div><div class="small muted" style="margin-top:6px">Le texte réellement envoyé est celui du modèle validé par WhatsApp (Réglages).</div></div>' : "";
  modal('<div class="dlg-h"><div><h2>' + esc(c.title) + '</h2><div class="sub small">' + badge(st[0], st[1]) + " " + esc(typeLabel(c.type)) + " · créée " + esc(relTime(c.createdAt)) + '</div></div><button class="iconbtn" data-act="camp-close" aria-label="Fermer">' + I.x + "</button></div>" +
    (c.note ? '<div class="note" style="margin-bottom:10px">' + esc(c.note) + "</div>" : "") +
    '<div class="kv small" style="margin-bottom:10px"><div><div class="muted">À envoyer</div><b>' + n.pending + "</b></div><div><div class=\"muted\">Envoyés</div><b>" + n.sent + "</b></div><div><div class=\"muted\">Échecs</div><b>" + n.failed + "</b></div><div><div class=\"muted\">Retirés</div><b>" + n.skipped + "</b></div></div>" +
    '<div id="camp-prog"></div>' + preview +
    '<div class="sect"><h3>Destinataires <span class="n">' + n.total + "</span></h3>" + items + "</div>" +
    (admin ? '<div class="dlg-f">' + (editable ? '<button class="btn btn-danger" data-act="camp-cancel" data-id="' + c.id + '">Annuler la campagne</button>' : "") +
      (n.failed && c.status !== "cancelled" ? '<button class="btn" data-act="camp-retry" data-id="' + c.id + '">Réessayer les échecs</button>' : "") +
      (editable && n.pending ? '<button class="btn btn-wa" id="camp-send" data-act="camp-send" data-id="' + c.id + '"' + (waReady() ? "" : " disabled") + ">" + I.wa + " Envoyer " + n.pending + " message" + (n.pending > 1 ? "s" : "") + "</button>" : "") + "</div>" : ""), true, true);
}
async function campItem(driverId, to) {
  const c = ui.camp; if (!c) return;
  try { const r = await API.patch("/campaigns/" + c.id + "/items/" + driverId, { status: to }); openCampaign(r.campaign); loadCampaigns(); } catch (e) { toast(e.message, true); }
}
let campSending = false;
async function sendCampaign(id, retry) {
  if (campSending) return; campSending = true;
  const btn = $("#camp-send"); if (btn) btn.disabled = true;
  let sent = 0, failed = 0, last = null;
  try {
    for (let guard = 0; guard < 40; guard++) {
      const r = await API.post("/campaigns/" + id + "/send", { limit: 15, retryFailed: retry && guard === 0 });
      sent += r.sent; failed += r.failed; last = r.campaign;
      const p = $("#camp-prog"); if (p) p.innerHTML = '<div class="note">Envoi en cours… ' + sent + " envoyé(s)" + (failed ? ", " + failed + " échec(s)" : "") + (r.remaining ? ", " + r.remaining + " restant(s)" : "") + "</div>";
      if (!r.remaining || r.sent + r.failed === 0) break;
    }
    toast(sent + " message(s) envoyé(s)" + (failed ? ", " + failed + " échec(s)" : "") + ".", failed > 0);
  } catch (e) { toast(e.message, true); }
  finally { campSending = false; }
  if (last && $("#ov")) openCampaign(last);
  reload({ force: true }); loadCampaigns();
}
function cancelCamp(id) {
  confirmDlg("Annuler la campagne ?", "Les messages pas encore envoyés ne partiront pas. Ceux déjà envoyés restent envoyés.", "Annuler la campagne", async () => {
    try { const r = await API.post("/campaigns/" + id + "/cancel"); openCampaign(r.campaign); loadCampaigns(); toast("Campagne annulée."); } catch (e) { toast(e.message, true); }
  }, true);
}

/* =========================================================
   ASSISTANT IA
   ========================================================= */
const AGENT_SUGGESTIONS = [
  "Fais-moi le point sur la flotte.",
  "Prépare la relance des chauffeurs en retard.",
  "Qui a répondu ces derniers jours ?",
  "Quels chauffeurs n'ont pas de numéro ?",
  "Qui est parti récemment ?",
];
function renderAgent() {
  const el = $("#v-agent");
  const off = !agentReady();
  const msgs = ui.chat.map(m => m.role === "user"
    ? '<div class="msg me"><div class="bub">' + esc(m.content).replace(/\n/g, "<br>") + "</div></div>"
    : '<div class="msg ai"><div class="bub">' + mdLite(m.content) + (m.campaignId ? '<div style="margin-top:8px"><button class="btn btn-primary btn-sm" data-act="camp-open" data-id="' + m.campaignId + '">' + I.mega + " Voir la campagne préparée</button></div>" : "") +
      (m.tools && m.tools.length ? '<div class="small muted" style="margin-top:6px">Actions : ' + m.tools.map(t => esc(TOOL_LABELS[t.name] || t.name) + (t.ok ? "" : " (échec)")).join(" · ") + "</div>" : "") + "</div></div>").join("");
  const keep = $("#chat-in") ? $("#chat-in").value : "";
  el.innerHTML = '<div class="hero"><div><h1>Assistant</h1><div class="sub"><span>Demande-lui l\'état de la flotte, ou de préparer une relance. Il prépare des brouillons : <b>c\'est toi qui envoies</b>.</span></div></div></div>' +
    (off ? '<div class="banner"><div class="grow"><b>L\'assistant n\'est pas activé.</b> Ajoute ta clé API Claude dans Réglages.</div><button class="btn btn-primary btn-sm" data-act="go" data-v="settings">Réglages</button></div>' : "") +
    '<div class="panel chat"><div class="chat-log" id="chat-log">' + (msgs || '<div class="empty">Pose une question ou choisis une suggestion.</div>') + (ui.chatBusy ? '<div class="msg ai"><div class="bub typing"><i></i><i></i><i></i></div></div>' : "") + "</div>" +
    '<div class="chips" style="margin:10px 0">' + AGENT_SUGGESTIONS.map(s => '<button class="chipbtn" data-act="chat-suggest" data-s="' + esc(s) + '"' + (off || ui.chatBusy ? " disabled" : "") + ">" + esc(s) + "</button>").join("") + "</div>" +
    '<form class="chat-form" id="chat-form"><textarea class="input" id="chat-in" rows="1" placeholder="Écris ta demande…" ' + (off ? "disabled" : "") + "></textarea><button class=\"btn btn-primary\" type=\"submit\" " + (off || ui.chatBusy ? "disabled" : "") + ">" + I.send + " Envoyer</button></form></div>";
  if (keep) $("#chat-in").value = keep;
  const log = $("#chat-log"); if (log) log.scrollTop = log.scrollHeight;
}
const TOOL_LABELS = { fleet_summary: "bilan de la flotte", list_drivers: "liste de chauffeurs", get_driver: "fiche chauffeur", recent_replies: "réponses lues", prepare_campaign: "campagne préparée", add_note: "note ajoutée", record_verification_received: "vérification enregistrée", sync_now: "feuille relue" };
function mdLite(t) {
  let h = esc(t);
  h = h.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  const lines = h.split("\n"), out = [];
  let inList = false;
  lines.forEach(l => {
    const m = l.match(/^\s*[-•*]\s+(.*)$/);
    if (m) { if (!inList) { out.push("<ul>"); inList = true; } out.push("<li>" + m[1] + "</li>"); }
    else { if (inList) { out.push("</ul>"); inList = false; } out.push(l ? "<p>" + l + "</p>" : ""); }
  });
  if (inList) out.push("</ul>");
  return out.join("");
}
async function askAgent(text) {
  text = String(text || "").trim();
  if (!text || ui.chatBusy) return;
  ui.chat.push({ role: "user", content: text });
  ui.chatBusy = true; $("#chat-in") && ($("#chat-in").value = ""); renderAgent();
  try {
    const hist = ui.chat.map(m => ({ role: m.role, content: m.content }));
    const r = await API.post("/agent/chat", { messages: hist });
    ui.chat.push({ role: "assistant", content: r.reply, tools: r.tools, campaignId: r.campaignId });
    if (r.tools && r.tools.some(t => ["add_note", "record_verification_received", "sync_now", "prepare_campaign"].includes(t.name))) { await reload({ force: true, render: false }); loadCampaigns(); }
  } catch (e) { ui.chat.push({ role: "assistant", content: "Erreur : " + e.message }); }
  ui.chatBusy = false;
  if (ui.view === "agent") renderAgent();
}

/* ---- 78_settings ---- */
/* =========================================================
   RÉGLAGES
   ========================================================= */
async function loadSettings() {
  const el = $("#v-settings"); if (el) el.dataset.ready = "0";
  try {
    const [s, u] = await Promise.all([API.get("/settings"), API.get("/users")]);
    ui.settings = s; ui.users = u.users;
    renderSettings(true);
  } catch (e) { if (e.status !== 401) { $("#v-settings").innerHTML = '<div class="empty">' + esc(e.status === 403 ? "Les réglages sont réservés aux administrateurs." : e.message) + "</div>"; } }
}
const copyBtn = (id, label) => '<button class="btn btn-sm" data-act="copy" data-from="' + id + '">' + (label || "Copier") + "</button>";
function fld(label, id, value, opts) {
  opts = opts || {};
  return '<div class="field"><label for="' + id + '">' + label + "</label>" + (opts.area ? '<textarea class="input mono" id="' + id + '" rows="' + opts.area + '" placeholder="' + esc(opts.ph || "") + '">' + esc(value || "") + "</textarea>"
    : '<input class="input' + (opts.mono ? " mono" : "") + '" id="' + id + '" type="' + (opts.type || "text") + '" value="' + esc(value || "") + '" placeholder="' + esc(opts.ph || "") + '" autocomplete="off"' + (opts.ro ? " readonly" : "") + ">") + (opts.hint ? '<div class="small muted" style="margin-top:4px">' + opts.hint + "</div>" : "") + "</div>";
}
function renderSettings(force) {
  const el = $("#v-settings");
  if (!el || !ui.settings || (!force && el.dataset.ready === "1")) return;
  const s = ui.settings, sh = s.sheet, wa = s.whatsapp, an = s.anthropic, au = s.automation, tpl = s.wa_templates;
  const api = sh.mode === "api";
  el.dataset.ready = "1";
  const sw = (id, on, label, hint) => '<label class="switch-row"><input type="checkbox" class="cbx" id="' + id + '"' + (on ? " checked" : "") + '><span><b>' + label + "</b>" + (hint ? '<small class="muted">' + hint + "</small>" : "") + "</span></label>";
  el.innerHTML = '<div class="hero"><div><h1>Réglages</h1><div class="sub">Relie ta feuille Google, WhatsApp Business et l\'assistant. Les clés sont enregistrées chiffrées sur le serveur et ne ressortent jamais.</div></div></div>' +
    '<div class="sync-grid">' +
    /* --- Google --- */
    '<section class="panel"><h2><span class="step-n">1</span> Feuille Google (source des chauffeurs)</h2>' +
    '<div class="seg" role="tablist"><button class="chipbtn" aria-pressed="' + !api + '" data-act="sheet-mode" data-m="csv">Lien de publication (simple)</button><button class="chipbtn" aria-pressed="' + api + '" data-act="sheet-mode" data-m="api">Compte de service (privé)</button></div>' +
    (api
      ? '<div class="small sub">La feuille reste <b>privée</b> : tu la partages avec l\'adresse e-mail du compte de service.</div>' +
        fld("Identifiant de la feuille (ou son lien complet)", "s-sid", sh.spreadsheetId, { mono: true, ph: "https://docs.google.com/spreadsheets/d/…" }) +
        fld("Nom de l'onglet des chauffeurs", "s-tab", sh.tab, { ph: "Chauffeurs" }) + fld("Nom de l'onglet des contacts (facultatif)", "s-ctab", sh.contactsTab, { ph: "Contacts" }) +
        '<div class="field"><label>Clé du compte de service (fichier JSON)</label>' + (s.google_sa.set ? '<div class="note green">Clé enregistrée · compte <b>' + esc(s.google_sa.email) + "</b> — partage ta feuille avec cette adresse (lecture seule suffit).</div>" : "") +
        '<textarea class="input mono" id="s-sa" rows="3" placeholder="' + (s.google_sa.set ? "Colle une nouvelle clé pour la remplacer" : "Colle ici tout le contenu du fichier .json téléchargé depuis Google Cloud") + '"></textarea></div>'
      : '<div class="small sub">Dans Google Sheets : <b>Fichier → Partager → Publier sur le web</b> → choisis l\'onglet → format <b>CSV</b> → Publier, puis copie le lien. (Un lien « tout le monde avec le lien peut voir » fonctionne aussi.)</div>' +
        fld("Lien CSV de l'onglet chauffeurs", "s-csv", sh.csvUrl, { mono: true, ph: "https://docs.google.com/spreadsheets/d/e/…/pub?output=csv" }) +
        fld("Lien CSV de l'onglet contacts (facultatif)", "s-ccsv", sh.contactsCsvUrl, { mono: true, ph: "Nom + Téléphone" })) +
    '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" data-act="save-sheet">Enregistrer</button><button class="btn" data-act="test" data-what="sheet">Tester la lecture</button></div><div id="t-sheet" class="small" style="margin-top:8px"></div></section>' +
    /* --- Automatisation --- */
    '<section class="panel"><h2><span class="step-n">2</span> Automatisation</h2>' +
    sw("a-apply", au.autoApplySync, "Appliquer seul les mises à jour sûres", "Nouveaux chauffeurs, changements de véhicule, départs : appliqués sans toi tant qu'aucun doute n'existe (sinon : en attente de ta validation).") +
    sw("a-draft", au.dailyDraft, "Préparer chaque matin la relance du jour", "Un brouillon « Relance du jour » est créé vers 8 h avec les chauffeurs en retard.") +
    sw("a-send", au.autoSendRelance, "Envoyer automatiquement cette relance (message gentil)", "Sans clic de ta part, dans la limite ci-dessous. La relance ferme (pénalité) ne part jamais seule.") +
    fld("Maximum de messages automatiques par jour", "a-max", String(au.maxPerDay), { type: "number" }) +
    '<div><button class="btn btn-primary" data-act="save-auto">Enregistrer</button></div></section>' +
    /* --- WhatsApp --- */
    '<section class="panel"><h2><span class="step-n">3</span> WhatsApp Business (envoi automatique)</h2>' +
    (wa.set ? '<div class="note green">Connecté · numéro ID ' + esc(wa.phoneNumberId) + " · jeton " + esc(wa.tokenHint) + "</div>" : '<div class="note warn">Pas encore relié : en attendant, les messages s\'ouvrent dans WhatsApp.</div>') +
    fld("Identifiant du numéro de téléphone (Phone number ID)", "w-pid", wa.phoneNumberId, { mono: true }) + fld("Identifiant du compte WhatsApp Business (WABA ID)", "w-waba", wa.wabaId, { mono: true }) +
    fld("Jeton d'accès permanent", "w-token", "", { type: "password", ph: wa.set ? "Déjà enregistré — laisse vide pour le garder" : "EAAG…" }) +
    fld("Secret de l'application Meta (signature des réponses)", "w-secret", "", { type: "password", ph: wa.appSecretSet ? "Déjà enregistré" : "App Secret" }) +
    '<div class="sect"><h3>À copier dans Meta (Webhook)</h3>' + fld("URL de rappel", "w-url", s.webhookUrl, { ro: true, mono: true }) + '<div style="margin:-6px 0 8px">' + copyBtn("w-url") + "</div>" +
    fld("Jeton de vérification", "w-verify", wa.verifyToken || "(sera créé à l'enregistrement)", { ro: true, mono: true }) + '<div style="margin:-6px 0 4px">' + copyBtn("w-verify") + "</div></div>" +
    '<div class="sect"><h3>Modèles de message (à créer dans Meta, catégorie « Utilitaire », langue française)</h3>' +
    Object.keys(tpl).map(k => {
      const b = (s.templateBodies || {})[k] || { label: k, body: "" };
      return '<details class="tpl"><summary><b>' + esc(b.label) + '</b> <span class="muted small">' + esc(tpl[k].name) + "</span></summary>" +
        '<div class="field"><label>Nom du modèle dans Meta</label><input class="input mono" data-tpl="' + k + '" value="' + esc(tpl[k].name) + '"></div>' +
        '<div class="field"><label>Texte à coller dans Meta ({{1}} = prénom, {{2}} = plaque)</label><textarea class="input" id="tb-' + k + '" rows="7" readonly>' + esc(b.body) + '</textarea><div style="margin-top:6px">' + copyBtn("tb-" + k, "Copier le texte") + "</div></div></details>";
    }).join("") + "</div>" +
    '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" data-act="save-wa">Enregistrer</button><button class="btn" data-act="test" data-what="whatsapp">Tester la connexion</button></div><div id="t-whatsapp" class="small" style="margin-top:8px"></div></section>' +
    /* --- IA --- */
    '<section class="panel"><h2><span class="step-n">4</span> Assistant IA (Claude)</h2>' +
    (an.set ? '<div class="note green">Clé enregistrée (' + esc(an.keyHint) + ") · modèle " + esc(an.model) + "</div>" : '<div class="note warn">Pas de clé : l\'assistant est désactivé.</div>') +
    fld("Clé API Anthropic", "c-key", "", { type: "password", ph: an.set ? "Déjà enregistrée — laisse vide pour la garder" : "sk-ant-…" }) +
    '<div class="field"><label for="c-model">Modèle</label><select class="input" id="c-model"><option value="claude-sonnet-5-5"' + (an.model === "claude-sonnet-5-5" ? " selected" : "") + '>Claude Sonnet 5.5 (recommandé)</option><option value="claude-haiku-5-5"' + (an.model === "claude-haiku-5-5" ? " selected" : "") + '>Claude Haiku 5.5 (plus économique)</option></select></div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary" data-act="save-ai">Enregistrer</button><button class="btn" data-act="test" data-what="anthropic">Tester</button></div><div id="t-anthropic" class="small" style="margin-top:8px"></div></section>' +
    /* --- Compte --- */
    '<section class="panel"><h2><span class="step-n">5</span> Compte &amp; équipe</h2>' +
    '<div class="small sub">Connecté : <b>' + esc(ME ? ME.email : "") + "</b> (" + (ME && ME.role === "viewer" ? "lecture seule" : "administrateur") + ")</div>" +
    fld("Mot de passe actuel", "p-old", "", { type: "password" }) + fld("Nouveau mot de passe (10 caractères minimum)", "p-new", "", { type: "password" }) +
    '<div><button class="btn" data-act="save-pass">Changer le mot de passe</button></div>' +
    '<div class="sect"><h3>Utilisateurs</h3>' + (ui.users || []).map(u => '<div class="act-row"><span class="grow">' + esc(u.email) + ' <span class="muted small">' + (u.role === "viewer" ? "lecture seule" : "administrateur") + '</span></span>' + (ME && u.id !== ME.id ? '<button class="btn btn-sm btn-danger" data-act="user-del" data-id="' + u.id + '">Supprimer</button>' : "") + "</div>").join("") +
    '<div class="kv" style="margin-top:10px"><div class="field"><label for="u-mail">E-mail</label><input class="input" id="u-mail" type="email"></div><div class="field"><label for="u-pass">Mot de passe</label><input class="input" id="u-pass" type="password"></div>' +
    '<div class="field"><label for="u-role">Rôle</label><select class="input" id="u-role"><option value="admin">Administrateur</option><option value="viewer">Lecture seule</option></select></div><div class="field" style="align-self:end"><button class="btn" data-act="user-add">Ajouter</button></div></div></div></section>' +
    "</div>";
}
async function putSetting(key, body, msg) {
  try { ui.settings = Object.assign(ui.settings, await API.put("/settings/" + key, body)); const s = await API.get("/settings"); ui.settings = s; await reload({ force: true, render: false }); renderSettings(true); renderNav(); toast(msg || "Enregistré."); return true; }
  catch (e) { toast(e.message, true); return false; }
}
function sheetIdFromInput(v) { const m = String(v || "").match(/\/d\/([a-zA-Z0-9_-]{20,})/); return m ? m[1] : String(v || "").trim(); }
async function saveSheet() {
  const sh = ui.settings.sheet;
  const body = { mode: sh.mode };
  if (sh.mode === "api") {
    body.spreadsheetId = sheetIdFromInput($("#s-sid").value); body.tab = $("#s-tab").value.trim(); body.contactsTab = $("#s-ctab").value.trim();
    const sa = $("#s-sa").value.trim();
    if (sa && !(await putSetting("google_sa", { json: sa }, "Clé enregistrée."))) return;
  } else { body.csvUrl = $("#s-csv").value.trim(); body.contactsCsvUrl = $("#s-ccsv").value.trim(); }
  await putSetting("sheet", body, "Source enregistrée. Clique sur « Tester la lecture ».");
}
async function testSetting(what) {
  const out = $("#t-" + what); if (out) out.innerHTML = '<span class="muted">Test en cours…</span>';
  try { const r = await API.post("/settings/test/" + what); if (out) out.innerHTML = '<div class="note green">' + esc(r.message) + (r.sample && r.sample.length ? '<br><span class="small">Exemples : ' + r.sample.map(esc).join(" · ") + "</span>" : "") + "</div>"; }
  catch (e) { if (out) out.innerHTML = '<div class="note red">' + esc(e.message) + "</div>"; }
}

/* ---- 80_log ---- */
/* ---------- vue : journal ---------- */
const LOG_FILTERS = [["all", "Tout", null], ["new", "Nouveaux", ["new", "return"]], ["vehicle", "Véhicules", ["vehicle"]], ["left", "Départs", ["left", "archive"]], ["phone", "Numéros", ["phone"]], ["msg", "Messages", ["msg"]], ["verif", "Vérifications", ["verif"]]];
function renderLog() {
  $("#log-chips").innerHTML = LOG_FILTERS.map(([k, l, ty]) => '<button class="chipbtn" aria-pressed="' + (ui.logFilter === k) + '" data-act="log-filter" data-f="' + k + '">' + l + ' <span class="n">' + (ty ? S.log.filter(e => ty.includes(e.type)).length : S.log.length) + "</span></button>").join("");
  const f = LOG_FILTERS.find(x => x[0] === ui.logFilter);
  const list = (f[2] ? S.log.filter(e => f[2].includes(e.type)) : S.log).slice(0, 400);
  if (!list.length) { $("#log-list").innerHTML = '<div class="empty">Rien à afficher.</div>'; return; }
  let html = "", day = "";
  const todayS = toISO(new Date()), yest = toISO(addDays(new Date(), -1));
  list.forEach(e => {
    const d = new Date(e.ts), key = toISO(d);
    if (key !== day) {
      day = key;
      let lab = key === todayS ? "Aujourd'hui" : key === yest ? "Hier" : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      lab = lab.charAt(0).toUpperCase() + lab.slice(1);
      html += '<div class="tl-day">' + esc(lab) + "</div>";
    }
    html += '<div class="tl-row"><span class="t">' + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + '</span><span class="type-tag">' + (LOG_LABELS[e.type] || e.type) + "</span><span>" +
      (e.name ? (e.id != null && byId(e.id) ? '<span class="who" data-act="open" data-id="' + e.id + '">' + esc(e.name) + "</span> — " : "<b>" + esc(e.name) + "</b> — ") : "") + esc(e.text) + "</span></div>";
  });
  $("#log-list").innerHTML = html;
}

/* ---- 85_read ---- */
/* ---------- lecture de fichiers ---------- */
function readAsText(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(file); }); }
function readAsBuffer(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsArrayBuffer(file); }); }

/* ---- 90_dl ---- */
/* ---------- sauvegarde / exports ---------- */
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---- 91_exports ---- */
function exportXlsx() {
  const rows = [["Nom", "Plaque", "Véhicule", "Téléphone", "Dernière vérification", "Prochaine échéance", "Statut", "Dernier message", "Prise du véhicule"]];
  sortList(actives(), "name").forEach(d => {
    const si = statusInfo(d), due = dueDate(d);
    rows.push([d.name, fmtPlate(d.plate), d.vehicle, d.phone, d.lastVerif ? fmtDateFull(parseISO(d.lastVerif)) : "", due ? fmtDateFull(due) : "", si.label, d.lastContacted ? fmtDateFull(dayOf(d.lastContacted)) : "", d.pickup ? fmtDateFull(parseISO(d.pickup)) : ""]);
  });
  saveTable("suivi-flotte-" + toISO(new Date()), "Flotte", rows, [30, 12, 22, 14, 18, 18, 18, 16, 16]);
}
function downloadContactsTemplate() {
  const list = actives().slice().sort((a, b) => (a.phone ? 1 : 0) - (b.phone ? 1 : 0) || a.name.localeCompare(b.name, "fr"));
  const rows = [["NOM", "TELEPHONE"]].concat(list.map(d => [d.name, d.phone || ""]));
  saveTable("contacts_chauffeurs", "Contacts", rows, [38, 18], true);
}
function saveTable(base, sheet, rows, widths, phoneText) {
  if (typeof XLSX !== "undefined") {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = widths.map(w => ({ wch: w }));
    if (phoneText) rows.forEach((r, i) => { if (i && r[1]) { const c = ws[XLSX.utils.encode_cell({ r: i, c: 1 })]; if (c) { c.t = "s"; c.z = "@"; } } });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheet);
    XLSX.writeFile(wb, base + ".xlsx");
  } else {
    const csv = "﻿" + rows.map(r => r.map(c => '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"').join(";")).join("\r\n");
    downloadBlob(base + ".csv", new Blob([csv], { type: "text/csv;charset=utf-8" }));
  }
}

/* ---- 95_boot ---- */
/* =========================================================
   CONNEXION
   ========================================================= */
function showAuth(mode, msg) {
  closeModal(true);
  let a = $("#auth");
  if (!a) { a = document.createElement("div"); a.id = "auth"; document.body.appendChild(a); }
  const setup = mode === "setup";
  a.innerHTML = '<form class="auth-card" id="auth-form" autocomplete="on"><div class="brand-mark">' + I.logo + '</div><h1>Fox Drive</h1><div class="sub">' + (setup ? "Première installation : crée le compte administrateur." : "Connecte-toi pour accéder au suivi de flotte.") + "</div>" +
    (msg ? '<div class="note red">' + esc(msg) + "</div>" : "") +
    (setup ? '<div class="field"><label for="au-name">Ton prénom</label><input class="input" id="au-name" autocomplete="name"></div>' : "") +
    '<div class="field"><label for="au-mail">E-mail</label><input class="input" id="au-mail" type="email" required autocomplete="username"></div>' +
    '<div class="field"><label for="au-pass">Mot de passe' + (setup ? " (10 caractères minimum)" : "") + '</label><input class="input" id="au-pass" type="password" required autocomplete="' + (setup ? "new-password" : "current-password") + '"></div>' +
    (setup ? '<div class="field"><label for="au-code">Code d\'installation</label><input class="input" id="au-code" type="password" required><div class="small muted" style="margin-top:4px">C\'est la valeur de la variable SETUP_CODE configurée sur Netlify.</div></div>' : "") +
    '<button class="btn btn-primary" type="submit" style="width:100%">' + (setup ? "Créer le compte" : "Se connecter") + '</button><div class="small muted" id="au-err" style="margin-top:10px;color:var(--red)"></div></form>';
  a.hidden = false; document.body.classList.add("locked");
  $("#auth-form").onsubmit = async ev => {
    ev.preventDefault();
    const err = $("#au-err"); err.textContent = "";
    try {
      if (setup) await API.post("/auth/setup", { email: $("#au-mail").value, password: $("#au-pass").value, code: $("#au-code").value, name: $("#au-name").value });
      else await API.post("/auth/login", { email: $("#au-mail").value, password: $("#au-pass").value });
      await start();
    } catch (e) { err.textContent = e.message; }
  };
  setTimeout(() => { const f = $("#au-mail"); if (f) f.focus(); }, 40);
}
function hideAuth() { const a = $("#auth"); if (a) a.hidden = true; document.body.classList.remove("locked"); }
async function logout() { try { await API.post("/auth/logout"); } catch (e) { /* */ } S = null; ME = null; sigPrev = ""; ui.chat = []; ui.campaigns = null; closeModal(true); showAuth("login"); }

/* =========================================================
   ACTIONS (délégation d'événements)
   ========================================================= */
const ACT = {
  go: t => go(t.dataset.v),
  more: () => openMore(),
  logout: () => logout(),
  close: () => closeModal(),
  open: t => openDriver(Number(t.dataset.id), t.dataset.focus),
  filter: t => { ui.filter = t.dataset.f; renderDrivers(); },
  "log-filter": t => { ui.logFilter = t.dataset.f; renderLog(); },
  chooser: t => openChooser(Number(t.dataset.id)),
  received: t => { markReceived(Number(t.dataset.id)); if (t.dataset.reopen) closeModal(); },
  "save-phone": t => savePhone(Number(t.dataset.id)),
  "save-vehicle": t => saveVehicle(Number(t.dataset.id)),
  send: t => { const id = Number(t.dataset.id); closeModal(); sendMessage(id, t.dataset.type); },
  "pick-type": t => pickType(t.dataset.type),
  "bulk-send": () => { const b = ui.bulk; if (!b) return; sendMessage(b.queue[b.i], b.type); b.i++; renderBulk(); },
  "bulk-skip": () => { if (ui.bulk) { ui.bulk.i++; renderBulk(); } },
  "bulk-close": () => bulkClose(),
  "depart-ok": t => archiveDriver(Number(t.dataset.id)),
  "still-here": t => { const d = byId(t.dataset.id); if (!d) return; closeModal(); drvAct(d.id, "reactivate", d.name + " est de nouveau suivi."); },
  archive: t => archiveDriver(Number(t.dataset.id)),
  "auto-relance": () => launchAutoRelance(),
  "toggle-sel": () => selection(!ui.sel),
  "sel-all": () => { (ui.shown || []).forEach(id => ui.ids.add(id)); refresh(); },
  "sel-clear": () => { ui.ids.clear(); refresh(); },
  "bulk-open": () => { if (ui.ids.size) openChooser(null, Array.from(ui.ids)); },
  "export-xlsx": () => loadXlsxLib().catch(() => { }).then(exportXlsx),
  "dl-template": () => loadXlsxLib().catch(() => { }).then(downloadContactsTemplate),
  "pick-fox": () => $("#in-fox").click(),
  "pick-contacts": () => $("#in-contacts").click(),
  "analyze-fox": () => handleFoxPaste(),
  "analyze-contacts": () => handleContactsPaste(),
  "sync-now": () => syncNow(false),
  "sync-force": () => syncNow(true),
  "export-backup": () => exportBackup(),
  "import-backup": () => $("#in-backup").click(),
  "rev-apply": () => applyReview(),
  "rev-cancel": () => { ui.rev = null; closeModal(); },
  "rev-reject": () => { const id = ui.rev && ui.rev.importId; ui.rev = null; closeModal(); if (id) rejectPending(id); },
  "rev-absent-all": () => { if (!ui.rev) return; ui.rev.res.absent.forEach(a => { a.on = true; }); $$('input[data-chg="rev"]').forEach(i => { const it = ui.rev.items.get(i.dataset.key); if (it && String(it.key).indexOf("abs:") === 0) i.checked = true; }); updateRevCount(); toast("Les absents seront retirés du suivi."); },
  "review-pending": t => reviewPending(Number(t.dataset.id)),
  "camp-new": () => newCampaignDlg(),
  "camp-create": t => newCampaign(t.dataset.type),
  "camp-open": t => openCampaignById(Number(t.dataset.id)),
  "camp-close": () => { ui.camp = null; closeModal(); },
  "camp-item": t => campItem(Number(t.dataset.id), t.dataset.to),
  "camp-send": t => sendCampaign(Number(t.dataset.id), false),
  "camp-retry": t => sendCampaign(Number(t.dataset.id), true),
  "camp-cancel": t => cancelCamp(Number(t.dataset.id)),
  "chat-suggest": t => askAgent(t.dataset.s),
  copy: t => { const el = document.getElementById(t.dataset.from); if (!el) return; const v = el.value; (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => toast("Copié."), () => { el.select(); document.execCommand("copy"); toast("Copié."); }); },
  "sheet-mode": t => { ui.settings.sheet.mode = t.dataset.m; renderSettings(true); },
  "save-sheet": () => saveSheet(),
  test: t => testSetting(t.dataset.what),
  "save-auto": () => putSetting("automation", { autoApplySync: $("#a-apply").checked, dailyDraft: $("#a-draft").checked, autoSendRelance: $("#a-send").checked, maxPerDay: $("#a-max").value }),
  "save-wa": async () => {
    const body = { phoneNumberId: $("#w-pid").value, wabaId: $("#w-waba").value, token: $("#w-token").value, appSecret: $("#w-secret").value };
    const tpl = {}; $$("[data-tpl]").forEach(i => { tpl[i.dataset.tpl] = { name: i.value, lang: "fr" }; });
    if (await putSetting("wa_templates", tpl, "Modèles enregistrés.")) await putSetting("whatsapp", body, "WhatsApp enregistré. Clique sur « Tester la connexion ».");
  },
  "save-ai": () => putSetting("anthropic", { apiKey: $("#c-key").value, model: $("#c-model").value }),
  "save-pass": async () => { try { await API.post("/me/password", { oldPassword: $("#p-old").value, newPassword: $("#p-new").value }); $("#p-old").value = $("#p-new").value = ""; toast("Mot de passe changé."); } catch (e) { toast(e.message, true); } },
  "user-add": async () => { try { await API.post("/users", { email: $("#u-mail").value, password: $("#u-pass").value, role: $("#u-role").value }); toast("Utilisateur ajouté."); loadSettings(); } catch (e) { toast(e.message, true); } },
  "user-del": t => confirmDlg("Supprimer cet utilisateur ?", "Il ne pourra plus se connecter.", "Supprimer", async () => { try { await API.del("/users/" + t.dataset.id); loadSettings(); } catch (e) { toast(e.message, true); } }, true),
};
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]");
  if (!t || t.disabled) return;
  const fn = ACT[t.dataset.act];
  if (fn) { e.preventDefault(); fn(t, e); }
});
document.addEventListener("change", e => {
  const t = e.target, c = t.dataset && t.dataset.chg;
  if (c === "sel") { const id = Number(t.dataset.id); t.checked ? ui.ids.add(id) : ui.ids.delete(id); updateBulkbar(); }
  else if (c === "rev" && ui.rev) { const it = ui.rev.items.get(t.dataset.key); if (it) { it.on = t.checked; updateRevCount(); } }
  else if (c === "rev-assign" && ui.rev) { const it = ui.rev.items.get(t.dataset.key); if (it) { it.assignTo = t.value; updateRevCount(); } }
  else if (t.id === "sort") { ui.sort = t.value; renderDrivers(); }
  else if (t.id === "in-fox" && t.files[0]) { handleFoxFile(t.files[0]); t.value = ""; }
  else if (t.id === "in-contacts" && t.files[0]) { handleContactsFile(t.files[0]); t.value = ""; }
  else if (t.id === "in-backup" && t.files[0]) { importBackupFile(t.files[0]); t.value = ""; }
});
document.addEventListener("input", e => {
  if (e.target.id === "q") { ui.q = e.target.value; renderDrivers(); }
  else if (e.target.id === "vq") { ui.vq = e.target.value; renderVehicles(); }
});
document.addEventListener("submit", e => {
  if (e.target.id === "chat-form") { e.preventDefault(); askAgent($("#chat-in").value); }
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && $("#ov")) { if (ui.bulk) bulkClose(); else closeModal(); }
  if (e.key === "Enter" && !e.shiftKey && e.target.id === "chat-in") { e.preventDefault(); askAgent(e.target.value); }
});
["dragover", "dragenter"].forEach(ev => document.addEventListener(ev, e => { const d = e.target.closest && e.target.closest(".drop"); if (d) { e.preventDefault(); d.classList.add("over"); } }));
["dragleave", "drop"].forEach(ev => document.addEventListener(ev, e => { const d = e.target.closest && e.target.closest(".drop"); if (d) d.classList.remove("over"); }));
document.addEventListener("drop", e => {
  const d = e.target.closest && e.target.closest(".drop"); if (!d) return;
  e.preventDefault();
  const f = e.dataTransfer.files[0]; if (!f) return;
  if (d.id === "drop-fox") handleFoxFile(f); else handleContactsFile(f);
});

/* =========================================================
   DÉMARRAGE
   ========================================================= */
let pollT = 0, lastW = window.innerWidth;
async function start() {
  let st;
  try { st = await API.get("/auth/status"); }
  catch (e) { showAuth("login", e.message); return; }
  if (st.setup) return showAuth("setup");
  if (!st.user) return showAuth("login");
  ME = st.user;
  try { await reload({ render: false }); } catch (e) { if (e.status !== 401) toast(e.message, true); return; }
  hideAuth();
  const v = (location.hash || "").slice(1);
  if (VIEWS.some(x => x.key === v) && viewOk(VIEWS.find(x => x.key === v))) ui.view = v; else ui.view = "dash";
  ui.firstDash = true;
  renderAll();
  if (ui.view === "campaigns") loadCampaigns(); else if (isAdmin()) loadCampaigns();
  if (ui.view === "settings") loadSettings();
  clearInterval(pollT);
  pollT = setInterval(poll, 60000);
}
async function poll() {
  if (document.hidden || !S || $("#ov")) return;
  try { await reload(); if (ui.view === "campaigns" || ui.view === "dash") loadCampaigns(); } catch (e) { /* hors ligne : on réessaie plus tard */ }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && S) poll(); });
window.addEventListener("resize", () => {
  clearTimeout(window.__rz);
  window.__rz = setTimeout(() => { if (S && ui.view === "dash" && (lastW < 400) !== (window.innerWidth < 400)) renderDash(); lastW = window.innerWidth; }, 250);
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => { });
start();
