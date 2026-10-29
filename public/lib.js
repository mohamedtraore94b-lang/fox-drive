/* =========================================================
   LIB — pure logic (no DOM): names, plates, phones, dates,
   parsers (FoxDrive, contacts), reconciliation, messages
   ========================================================= */
const ADDRESS = "3 rue du Pont des Halles, 94150 Rungis";
const CYCLE_DAYS = 30;       // vérification mensuelle
const SOON_DAYS = 7;         // "cette semaine"
const COOLDOWN_DAYS = 3;     // ne pas relancer quelqu'un contacté il y a moins de 3 jours
const DAY_MS = 86400000;

/* ---------- text / names / plates ---------- */
function normText(s) {
  return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function nameTokens(n) { return normText(n).split(" ").filter(t => t && !/^\d+$/.test(t)); }
function nameKey(n) { return nameTokens(n).sort().join(" "); }
function normPlate(s) { return String(s == null ? "" : s).replace(/[\s\-.]/g, "").toUpperCase(); }
function fmtPlate(p) {
  const n = normPlate(p);
  const m = n.match(/^([A-Z]{2})(\d{3})([A-Z]{2})$/);
  return m ? m[1] + "-" + m[2] + "-" + m[3] : (p || "");
}
function esc(s) {
  if (s == null || s === "") return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function firstName(name) {
  // FoxDrive écrit souvent NOM Prénom ou Prénom Nom : on prend le premier mot, comme avant
  return String(name || "").trim().split(/\s+/)[0] || "";
}
const PLACEHOLDER_NAMES = /^(smartkar|chauffeur non identifi|non attribu|non assign|vacant|aucun)/;
function isPlaceholderName(n) { return !n || PLACEHOLDER_NAMES.test(normText(n)); }

/* ---------- phones ---------- */
function normPhone(raw) {
  if (raw == null) return { phone: "", ok: false };
  let s = (typeof raw === "number") ? String(Math.round(raw)) : String(raw).trim();
  if (!s) return { phone: "", ok: false };
  // plusieurs numéros dans une cellule : on prend le premier valide
  const parts = s.split(/\s*(?:\/|;|\||\bou\b|\bet\b)\s*/i).filter(Boolean);
  if (parts.length > 1) {
    for (const p of parts) { const r = normPhone(p); if (r.ok) return r; }
    s = parts[0];
  }
  const intl = /^\s*\+/.test(s) || /^\s*00/.test(s);
  let d = s.replace(/\D/g, "");
  if (!d) return { phone: "", ok: false };
  if (/^00/.test(d)) d = d.slice(2);
  if (intl) {
    if (d.startsWith("33") && d.length === 11) return { phone: "0" + d.slice(2), ok: true };
    return { phone: "+" + d, ok: d.length >= 8 && d.length <= 15 };
  }
  if (d.startsWith("33") && d.length === 11) d = "0" + d.slice(2);
  if (d.length === 9 && /^[1-9]/.test(d)) d = "0" + d;   // Excel supprime le 0 initial
  if (/^0[1-9]\d{8}$/.test(d)) return { phone: d, ok: true };
  return { phone: d, ok: false };
}
function fmtPhone(p) {
  if (!p) return "";
  if (/^0\d{9}$/.test(p)) return p.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  return p;
}
function waNumber(p) {
  const d = String(p || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d.slice(1);
  if (d.startsWith("0")) return "33" + d.slice(1);
  return d;
}

/* ---------- dates ---------- */
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function todayDate() { return startOfDay(new Date()); }
function toISO(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0"), da = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + da;
}
function parseISO(s) { const p = String(s).slice(0, 10).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; }
function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS); }
function dayOf(v) {   // 'YYYY-MM-DD' ou datetime ISO -> Date locale à minuit
  if (!v) return null;
  const s = String(v);
  if (s.length > 10) return startOfDay(new Date(s));
  return parseISO(s);
}
const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
function fmtDate(d) { return d ? d.getDate() + " " + MONTHS_FR[d.getMonth()] : ""; }
function fmtDateFull(d) { return d ? String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + d.getFullYear() : ""; }
function parseAnyDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : toISO(new Date(v.getTime() + 12 * 3600000));
  if (typeof v === "number") {   // numéro de série Excel
    if (v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * DAY_MS)).toISOString().slice(0, 10);
    return null;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3];
  m = s.match(/(?<!\d)(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?!\d)/);
  if (m) {
    let y = m[3]; if (y.length === 2) y = "20" + y;
    return y + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  }
  return null;
}
function relTime(iso) {
  if (!iso) return "jamais";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return "il y a " + min + " min";
  const h = Math.round(min / 60);
  if (h < 24) return "il y a " + h + " h";
  const dd = Math.round(h / 24);
  if (dd < 60) return "il y a " + dd + " j";
  return "il y a " + Math.round(dd / 30) + " mois";
}

/* ---------- échéances ---------- */
function refDate(d) {
  const c = [];
  if (d.lastVerif) c.push(dayOf(d.lastVerif));
  if (d.lastCheckin) c.push(dayOf(d.lastCheckin));
  if (d.pickup) c.push(dayOf(d.pickup));   // prise du véhicule = date de l'import qui l'a détectée : le cycle de 30 jours repart de là
  if (!c.length) return null;
  return c.reduce((a, b) => (a > b ? a : b));
}
function dueDate(d) { const r = refDate(d); return r ? addDays(r, CYCLE_DAYS) : null; }
/* 'overdue' | 'soon' | 'ok' | 'unknown' */
function dueStatus(d, now) {
  const due = dueDate(d);
  if (!due) return "unknown";
  const diff = daysBetween(now || todayDate(), due);
  if (diff < 0) return "overdue";
  if (diff <= SOON_DAYS) return "soon";
  return "ok";
}
function daysToDue(d, now) { const due = dueDate(d); return due ? daysBetween(now || todayDate(), due) : null; }
function contactedThisCycle(d) {
  if (!d.lastContacted) return false;
  const r = refDate(d);
  if (!r) return true;
  return dayOf(d.lastContacted) >= r;
}
function recentlyContacted(d, now) {
  if (!d.lastContacted) return false;
  return daysBetween(dayOf(d.lastContacted), now || todayDate()) < COOLDOWN_DAYS;
}

/* ---------- messages WhatsApp ---------- */
const MESSAGE_TYPES = [
  { key: "relance", label: "Relance mensuelle", desc: "Message gentil : photos + compteur, première relance" },
  { key: "relance_ferme", label: "Relance ferme (pénalité 50 €)", desc: "À utiliser à la main, pour un chauffeur déjà relancé sans retour" },
  { key: "revision", label: "Révision", desc: "Prévenir d'une révision à prévoir et proposer un rendez-vous" },
  { key: "controle", label: "Contrôle", desc: "Convoquer le chauffeur pour un contrôle du véhicule" },
];
function buildMessage(d, type) {
  const fn = firstName(d.name);
  const pl = d.plate ? " (" + fmtPlate(d.plate) + ")" : "";
  if (type === "relance_ferme")
    return "Bonjour " + fn + ",\n\nJe vous ai déjà contacté au sujet de la vérification mensuelle de votre véhicule" + pl + " (photos de chaque côté + compteur kilométrique), et je n'ai toujours rien reçu de votre part.\n\nSans retour rapide, une pénalité de 50€ s'appliquera.\n\nMerci de faire le nécessaire dès aujourd'hui, ou de passer directement à l'agence.\n\nCordialement,\nFOX DRIVE";
  if (type === "revision")
    return "Bonjour " + fn + ",\n\nJe vous écris au sujet de la révision de votre véhicule" + pl + ".\n\nSi vous en avez besoin, merci de me le faire savoir afin qu'on prenne rendez-vous ensemble.\n\nCordialement,\nFOX DRIVE";
  if (type === "controle")
    return "Bonjour " + fn + ",\n\nMerci de vous présenter avec votre véhicule" + pl + " au " + ADDRESS + " pour effectuer le contrôle prévu.\n\nMerci de me confirmer votre disponibilité.\n\nCordialement,\nFOX DRIVE";
  return "Bonjour " + fn + ",\n\nC'est une première relance toute simple 🙂 Dans le cadre du suivi mensuel de notre flotte, il nous faut la vérification de votre véhicule" + pl + " : merci de nous envoyer une photo de chaque côté ainsi qu'une photo du compteur kilométrique.\n\nL'idéal reste de passer directement à l'agence si votre emploi du temps le permet.\n\nMerci de faire cela dès que possible.\n\nBonne journée,\nFOX DRIVE";
}

/* ---------- marque / modèle ---------- */
const VEHICLE_BRANDS = [["RENAULT", "Renault"], ["HYUNDAI", "Hyundai"], ["TOYOTA", "Toyota"], ["TESLA", "Tesla"], ["SUZUKI", "Suzuki"], ["KIA", "Kia"], ["BYD", "BYD"]];
const VEHICLE_MODEL_HINTS = [[/COROLLA/i, "Toyota"], [/C-?HR/i, "Toyota"], [/KONA/i, "Hyundai"], [/TUCSON/i, "Hyundai"], [/STARIA/i, "Hyundai"], [/MOD[EÈ]LE?\s*Y/i, "Tesla"], [/MOD[EÈ]LE?\s*3/i, "Tesla"], [/SWACE/i, "Suzuki"], [/E-?NIRO/i, "Kia"], [/SEAL/i, "BYD"], [/KANGOO/i, "Renault"]];
const VEHICLE_KEEP_UPPER = new Set(["EV", "HEV", "C-HR", "CHR"]);
function detectBrandModel(raw0) {
  const raw = (raw0 || "").trim();
  if (!raw) return { brand: "Non renseigné", model: "Modèle inconnu" };
  const upper = raw.toUpperCase();
  let brand = null;
  for (const [kw, label] of VEHICLE_BRANDS) { if (upper.includes(kw)) { brand = label; break; } }
  if (!brand) for (const [re, label] of VEHICLE_MODEL_HINTS) { if (re.test(upper)) { brand = label; break; } }
  if (!brand) brand = "Autre";
  let mp = raw.replace(/^[—-]+\s*/, "");
  VEHICLE_BRANDS.forEach(([kw]) => { mp = mp.replace(new RegExp("\\b" + kw + "\\b", "ig"), ""); });
  mp = mp.replace(/\bMOD[EÈ]LE?\b/ig, "Modèle").replace(/\b(19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim();
  if (!mp) return { brand, model: "Modèle non précisé" };
  mp = mp.split(" ").map(w => {
    const wu = w.toUpperCase();
    if (wu === "CHR" || wu === "C-HR") return "C-HR";
    if (w === "Modèle" || wu === "MODÈLE") return "Modèle";
    if (VEHICLE_KEEP_UPPER.has(wu)) return wu;
    if (w.length <= 2) return wu;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
  return { brand, model: mp || "Modèle inconnu" };
}

/* =========================================================
   PARSERS
   ========================================================= */
const PLATE_LINE = /^[A-Z]{2}-?\d{3}-?[A-Z]{2}$/;

function parseFoxBlocks(lines) {
  const STATUSES = new Set(["DISPONIBLE", "LOUE", "EN_MAINTENANCE"]);
  const blocks = []; let b = [];
  lines.forEach(l => { if (l === "Vérifier") { if (b.length) blocks.push(b); b = []; } else b.push(l); });
  if (b.length >= 5 && PLATE_LINE.test(b[0]) && STATUSES.has(b[b.length - 1])) blocks.push(b);   // dernière fiche tronquée sans "Vérifier"
  const rows = [];
  blocks.forEach(bl => {
    if (bl.length < 4 || !PLATE_LINE.test(bl[0])) return;
    const rest = bl.slice(2);
    if (rest.length < 2) return;
    const status = rest[rest.length - 1], catVerif = rest[rest.length - 2], mid = rest.slice(0, rest.length - 2);
    let category = catVerif, verifRaw = "";
    if (catVerif.indexOf(" · ") !== -1) { const p = catVerif.split(" · "); category = p[0]; verifRaw = p.slice(1).join(" · "); }
    const lastVerif = parseAnyDate(verifRaw.match(/\d{2}\/\d{2}\/\d{4}/) ? verifRaw.match(/\d{2}\/\d{2}\/\d{4}/)[0] : null);
    let model = "", name = "";
    if (mid.length === 1) model = mid[0];
    else if (mid.length === 2) { model = mid[0]; name = mid[1]; }
    else if (mid.length === 3) { model = mid[1]; name = mid[2]; }
    else if (mid.length > 3) model = mid.join(" / ");
    rows.push({
      plate: normPlate(bl[0]), vehicle: model.replace(/^—\s*/, "").trim(), name: name.trim(), lastVerif,
      category: (category || "").trim(), status: STATUSES.has(status) ? status : "", km: "", warning: ""
    });
  });
  return rows;
}

function parseFoxTable(rawLines) {
  const CAT = /^[A-Z]{1,3}\.{0,2}$/;
  const lines = rawLines.map(l => l.replace(/\s+$/, "")).filter(l => l.trim() !== "");
  const blocks = []; let cur = [];
  lines.forEach(l => {
    if (PLATE_LINE.test(l.trim())) { if (cur.length) blocks.push(cur); cur = [l.trim()]; }
    else if (cur.length) cur.push(l.trim());
  });
  if (cur.length) blocks.push(cur);
  const rows = [];
  blocks.forEach(b => {
    if (b.length < 3) return;
    const vehicle = b[2];
    const middle = b.slice(3);
    const ci = middle.findIndex(l => l.indexOf("\t") !== -1);
    if (ci < 0) return;
    const pre = middle.slice(0, ci), after = middle.slice(ci + 1);
    let category = "", name = "";
    if (pre.length === 2) { category = pre[0]; name = pre[1]; }
    else if (pre.length === 1) { if (CAT.test(pre[0])) category = pre[0]; else name = pre[0]; }
    const f = middle[ci].split("\t");
    const st = (f[3] || "").trim();
    let status = /location|lou/i.test(st) ? "LOUE" : (/dispo/i.test(st) ? "DISPONIBLE" : (/maint|atelier|garage/i.test(st) ? "EN_MAINTENANCE" : st.toUpperCase()));
    let warning = "";
    after.forEach(l => { if (l !== "Détails") warning = l; });
    rows.push({ plate: normPlate(b[0]), vehicle: vehicle.replace(/^—\s*/, "").trim(), name: name.trim(), lastVerif: null, category, status, km: (f[2] || "").trim(), warning });
  });
  return rows;
}

/* texte collé depuis FoxDrive (liste "Vérifier" ou tableau) */
function parseFoxText(text) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.replace(/\u00a0/g, " ")).filter(l => l.trim() !== "");
  const trimmed = lines.map(l => l.trim());
  let rows = [], format = "";
  if (trimmed.some(l => l === "Vérifier")) { rows = parseFoxBlocks(trimmed); format = "liste FoxDrive"; }
  else { rows = parseFoxTable(lines); format = "tableau FoxDrive"; }
  return finalizeFoxRows(rows, format);
}

function finalizeFoxRows(rows, format) {
  const ignored = { vacant: 0, placeholder: 0, other: 0 };
  const active = [];
  rows.forEach(r => {
    if (r.status && r.status !== "LOUE") { ignored.other++; return; }
    if (!r.name) { ignored.vacant++; return; }
    if (isPlaceholderName(r.name)) { ignored.placeholder++; return; }
    active.push(r);
  });
  return { format, rows: active, all: rows, ignored };
}

/* --- CSV minimal (sans dépendance) --- */
function parseCSV(text) {
  const first = String(text).split(/\r?\n/)[0] || "";
  const counts = { ";": (first.match(/;/g) || []).length, ",": (first.match(/,/g) || []).length, "\t": (first.match(/\t/g) || []).length };
  const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows = []; let row = [], cell = "", q = false;
  const t = String(text).replace(/^\uFEFF/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ""));
}

function headerIndex(headers, names) {
  const hs = headers.map(h => normText(h));
  for (const n of names) { const i = hs.indexOf(normText(n)); if (i >= 0) return i; }
  for (const n of names) { const nn = normText(n); const i = hs.findIndex(h => h.includes(nn)); if (i >= 0) return i; }
  return -1;
}

/* tableau (tableau de lignes) -> lignes FoxDrive, par noms de colonnes */
function foxRowsFromGrid(grid) {
  if (!grid.length) throw new Error("Fichier vide.");
  // on cherche la ligne d'en-tête dans les 10 premières lignes
  let hi = 0;
  for (let i = 0; i < Math.min(10, grid.length); i++) {
    const hs = grid[i].map(x => normText(x));
    if (hs.some(h => /immat|plaque/.test(h))) { hi = i; break; }
  }
  const H = grid[hi].map(x => String(x == null ? "" : x));
  const iPlate = headerIndex(H, ["immatriculation", "plaque", "immat"]);
  const iVeh = headerIndex(H, ["vehicule", "modele", "marque modele", "voiture"]);
  const iName = headerIndex(H, ["chauffeur", "conducteur", "locataire", "client", "nom chauffeur", "nom"]);
  const iStatus = headerIndex(H, ["statut", "etat", "status"]);
  const iVerif = headerIndex(H, ["derniere verif", "derniere verification", "date verif", "verification"]);
  const iPick = headerIndex(H, ["date debut location", "debut de location", "debut location", "date de prise", "prise du vehicule", "date prise", "date de depart", "date depart", "depart", "date debut", "debut", "depuis", "start"]);
  const iKm = headerIndex(H, ["kilometrage", "km"]);
  if (iPlate < 0 || iName < 0) throw new Error("Colonnes introuvables : il faut au moins « Immatriculation » et « Chauffeur ».");
  const all = [];
  for (let r = hi + 1; r < grid.length; r++) {
    const g = grid[r];
    const plate = normPlate(g[iPlate]);
    if (!plate) continue;
    const st = iStatus >= 0 ? String(g[iStatus] || "") : "";
    const status = !st ? "LOUE" : (/dispo|libre|vacant|atelier|maintenance|vendu|hors service|panne|restitu|rendu/i.test(st) ? "DISPONIBLE" : "LOUE");   // une colonne « Statut » ou « Situation » du tableur ne doit jamais écarter un chauffeur
    all.push({
      plate, vehicle: iVeh >= 0 ? String(g[iVeh] || "").replace(/^—\s*/, "").trim() : "", name: String(g[iName] || "").trim(),
      lastVerif: iVerif >= 0 ? parseAnyDate(g[iVerif]) : null, pickup: iPick >= 0 ? parseAnyDate(g[iPick]) : null,
      category: "", status, km: iKm >= 0 ? String(g[iKm] || "") : "", warning: ""
    });
  }
  const res = finalizeFoxRows(all, "fichier tableur");
  res.hasPickup = iPick >= 0 && res.rows.some(x => x.pickup);
  res.hasVerif = iVerif >= 0;
  return res;
}

/* --- contacts : tableur, texte "Nom ; numéro", ou vCard --- */
function contactsFromGrid(grid) {
  if (!grid.length) return [];
  let hi = -1;
  for (let i = 0; i < Math.min(6, grid.length); i++) {
    const hs = grid[i].map(x => normText(x));
    if (hs.some(h => /tel|numero|mobile|portable|whatsapp/.test(h)) && hs.some(h => /nom|chauffeur|name|conducteur/.test(h))) { hi = i; break; }
  }
  let iN = 0, iP = 1, start = 0;
  if (hi >= 0) {
    const H = grid[hi];
    iN = headerIndex(H, ["nom", "chauffeur", "name", "conducteur", "nom complet"]);
    iP = headerIndex(H, ["telephone", "tel", "numero", "mobile", "portable", "whatsapp", "phone"]);
    start = hi + 1;
  }
  const out = [];
  for (let r = start; r < grid.length; r++) {
    const name = String(grid[r][iN] == null ? "" : grid[r][iN]).trim();
    const ph = grid[r][iP];
    if (!name || ph == null || String(ph).trim() === "") continue;
    out.push({ name, raw: ph });
  }
  return out;
}
function contactsFromText(text) {
  const t = String(text || "");
  if (/BEGIN:VCARD/i.test(t)) return contactsFromVcf(t);
  const out = [];
  t.split(/\r?\n/).forEach(line => {
    const l = line.trim();
    if (!l) return;
    if (/[;\t|]/.test(l) || /,/.test(l) && /\d/.test(l.split(",").pop())) {
      const parts = l.split(/[;\t|,]/).map(x => x.trim()).filter(Boolean);
      const phIdx = parts.findIndex(p => /\d{8,}/.test(p.replace(/\D/g, "")) && !/[a-z]{3,}/i.test(p.replace(/\bou\b/ig, "")));
      if (phIdx >= 0) { const ph = parts[phIdx]; const nm = parts.filter((_, i) => i !== phIdx).join(" "); if (nm) out.push({ name: nm, raw: ph }); return; }
    }
    // "Nom Prénom 06 12 34 56 78" ou "06 12 34 56 78 Nom Prénom"
    let m = l.match(/^(.*?[A-Za-zÀ-ÿ])[\s:\-–]+(\+?[\d][\d .\-()]{7,})$/);
    if (m) { out.push({ name: m[1].trim(), raw: m[2].trim() }); return; }
    m = l.match(/^(\+?[\d][\d .\-()]{7,}?)[\s:\-–]+([A-Za-zÀ-ÿ].*)$/);
    if (m) out.push({ name: m[2].trim(), raw: m[1].trim() });
  });
  return out;
}
function contactsFromVcf(text) {
  const out = [];
  String(text).split(/BEGIN:VCARD/i).slice(1).forEach(card => {
    const fn = (card.match(/^FN[^:]*:(.+)$/im) || [])[1];
    let n = fn ? fn.trim() : "";
    if (!n) { const nn = (card.match(/^N[^:]*:(.+)$/im) || [])[1]; if (nn) n = nn.split(";").filter(Boolean).reverse().join(" ").trim(); }
    const tel = (card.match(/^TEL[^:]*:(.+)$/im) || [])[1];
    if (n && tel) out.push({ name: n, raw: tel.trim() });
  });
  return out;
}

/* =========================================================
   ÉTAT / RÉCONCILIATION
   ========================================================= */
function isActive(d) { return d.status === "active"; }

function buildNameIndex(drivers) {
  const exact = new Map(), key = new Map();
  // actifs en dernier => ils l'emportent sur les anciens en cas de collision
  const ordered = drivers.slice().sort((a, b) => (isActive(a) ? 1 : 0) - (isActive(b) ? 1 : 0));
  ordered.forEach(d => { exact.set(normText(d.name), d); const k = nameKey(d.name); if (k) key.set(k, d); });
  return { exact, key };
}
function tokensSubset(a, b) {   // a ⊆ b (au moins 2 mots dans le plus court)
  if (a.length < 2) return false;
  return a.every(t => b.includes(t));
}
/* retourne { driver, how } | null ; how = exact | tokens | probable */
function findDriver(name, drivers, idx, exclude, plate) {
  const ex = idx.exact.get(normText(name));
  if (ex && !(exclude && exclude.has(ex.id))) return { driver: ex, how: "exact" };
  const k = nameKey(name);
  const kk = k ? idx.key.get(k) : null;
  if (kk && !(exclude && exclude.has(kk.id))) return { driver: kk, how: "tokens" };
  const toks = nameTokens(name);
  const cands = drivers.filter(d => !(exclude && exclude.has(d.id)) && (() => {
    const dt = nameTokens(d.name);
    return tokensSubset(toks, dt) || tokensSubset(dt, toks);
  })());
  if (cands.length === 1) return { driver: cands[0], how: "probable" };
  if (plate) {
    const pc = drivers.filter(d => !(exclude && exclude.has(d.id)) && isActive(d) && normPlate(d.plate) === plate &&
      nameTokens(d.name).some(t => t.length >= 3 && toks.includes(t)));
    if (pc.length === 1) return { driver: pc[0], how: "probable" };
  }
  return null;
}

function sameVehicleText(a, b) {
  const x = normText(a), y = normText(b);
  return !x || !y || x === y || x.includes(y) || y.includes(x);
}

/* compare un export FoxDrive (lignes actives) à l'état courant — ne modifie rien */
function reconcileFox(state, parsed, nowISO) {
  const today = (nowISO || toISO(new Date())).slice(0, 10);
  const drivers = state.drivers;
  const idx = buildNameIndex(drivers);
  const used = new Set();
  const res = { total: parsed.rows.length, matched: [], probable: [], added: [], absent: [], keptVerif: [], warnings: [], unchanged: 0, returning: 0, truncated: false, ignored: parsed.ignored || {} };
  const seenPlate = new Map(), seenKeys = new Map();

  parsed.rows.forEach(row => {
    // doublons dans l'export
    if (seenPlate.has(row.plate)) res.warnings.push("La plaque " + fmtPlate(row.plate) + " apparaît 2 fois dans l'export (" + seenPlate.get(row.plate) + " et " + row.name + ").");
    else seenPlate.set(row.plate, row.name);
    const sk = nameKey(row.name);
    if (seenKeys.has(sk)) { res.warnings.push("Un même chauffeur est sur plusieurs véhicules : " + row.name + " (" + fmtPlate(seenKeys.get(sk)) + ", " + fmtPlate(row.plate) + "). Seule la première ligne est utilisée."); return; }
    seenKeys.set(sk, row.plate);

    const found = findDriver(row.name, drivers, idx, used, row.plate);
    if (!found) { res.added.push({ key: "add:" + row.plate, row, on: true, phone: contactPhoneFor(state, row.name) }); return; }
    const d = found.driver;
    used.add(d.id);
    const ch = {};
    const plateChanged = normPlate(d.plate) !== row.plate;
    if (plateChanged) ch.plate = [d.plate || "", row.plate];
    if (row.vehicle) {
      if (plateChanged) { if (normText(d.vehicle) !== normText(row.vehicle)) ch.vehicle = [d.vehicle || "", row.vehicle]; }
      else if (!sameVehicleText(d.vehicle, row.vehicle)) ch.vehicle = [d.vehicle || "", row.vehicle];
    }
    if (row.lastVerif) {
      if (plateChanged ? row.lastVerif !== d.lastVerif : (!d.lastVerif || row.lastVerif > d.lastVerif)) ch.lastVerif = [d.lastVerif || null, row.lastVerif];
    } else if (plateChanged) {
      if (d.lastVerif) ch.lastVerif = [d.lastVerif, null];     // nouveau véhicule jamais vérifié
    } else if (d.lastVerif) {
      res.keptVerif.push({ driver: d, kept: d.lastVerif });
    }
    if (row.pickup && row.pickup !== d.pickup) ch.pickup = [d.pickup || null, row.pickup];
    else if (plateChanged && !row.pickup) ch.pickup = [d.pickup || null, today];
    if (plateChanged && d.lastCheckin) ch.lastCheckin = [d.lastCheckin, null];
    if (found.how !== "exact" && normText(d.name) !== normText(row.name)) ch.name = [d.name, row.name];
    const returning = !isActive(d);
    if (returning) res.returning++;
    const entry = { key: "m:" + d.id, driver: d, row, how: found.how, changes: ch, returning, plateChanged, pickupEstimated: plateChanged && !row.pickup, on: found.how !== "probable" };
    if (found.how === "probable") {
      res.probable.push(entry);
    } else if (Object.keys(ch).length || returning) res.matched.push(entry);
    else res.unchanged++;
  });

  // absents : actifs non retrouvés (les "probables" non acceptés comptent comme absents)
  const probIds = new Set(res.probable.map(p => p.driver.id));
  drivers.forEach(d => {
    if (isActive(d) && (!used.has(d.id) || probIds.has(d.id))) {
      const p = res.probable.find(x => x.driver.id === d.id);
      res.absent.push({ key: "abs:" + d.id, driver: d, probKey: p ? p.key : null, on: true });
    }
  });
  // les lignes "probables" non acceptées deviennent de nouveaux chauffeurs
  res.probable.forEach(p => res.added.push({ key: "add:" + p.row.plate, row: p.row, on: true, probKey: p.key, phone: contactPhoneFor(state, p.row.name) }));

  const activeCount = drivers.filter(isActive).length;
  if (activeCount >= 10 && res.total < activeCount * 0.6) {
    res.truncated = true;
    res.absent.forEach(a => { a.on = false; });
    res.warnings.unshift("L'export ne contient que " + res.total + " chauffeurs alors que " + activeCount + " sont suivis : le texte a peut-être été copié en partie. Les départs sont décochés par prudence : si l'export est bien complet, clique sur « Retirer quand même les absents ».");
  }
  return res;
}

function contactPhoneFor(state, name) {
  const book = state.contacts || {};
  const e = book[nameKey(name)];
  return e ? e.phone : "";
}

function pushLog(state, type, d, text, extra) {
  state.log.unshift(Object.assign({ ts: new Date().toISOString(), type, id: d ? d.id : null, name: d ? d.name : "", text }, extra || {}));
  if (state.log.length > 3000) state.log.length = 3000;
}

/* applique la réconciliation (les entrées cochées uniquement) */
function applyFox(state, res, sourceLabel) {
  const now = new Date().toISOString();
  const today = toISO(new Date());
  const sum = { added: 0, vehicle: 0, updated: 0, left: 0, returned: 0 };
  const accepted = new Set(res.probable.filter(p => p.on).map(p => p.key));

  const applyEntry = (e) => {
    const d = e.driver, ch = e.changes;
    if (ch.name) { pushLog(state, "rename", d, d.name + " → " + ch.name[1] + " (orthographe FoxDrive)"); d.name = ch.name[1]; }
    if (e.returning) { d.status = "active"; d.absentSince = null; sum.returned++; pushLog(state, "return", d, "Réapparaît dans FoxDrive — de nouveau suivi"); }
    if (ch.plate) {
      const old = d.plate; d.prevPlate = old; d.plate = ch.plate[1];
      d.vehicle = (ch.vehicle ? ch.vehicle[1] : (e.row.vehicle || d.vehicle));
      sum.vehicle++;
      pushLog(state, "vehicle", d, (old ? fmtPlate(old) : "—") + " → " + fmtPlate(d.plate) + (d.vehicle ? " · " + d.vehicle : ""), { from: old, to: d.plate });
    } else if (ch.vehicle) { d.vehicle = ch.vehicle[1]; sum.updated++; }
    if (ch.lastVerif) d.lastVerif = ch.lastVerif[1];
    if (ch.lastCheckin) d.lastCheckin = ch.lastCheckin[1];
    if (ch.pickup) { d.pickup = ch.pickup[1]; d.pickupEstimated = !!e.pickupEstimated; } else if (e.row.pickup) { d.pickupEstimated = false; }
    if (!ch.plate && (ch.lastVerif && ch.lastVerif[1])) pushLog(state, "verif", d, "Vérification enregistrée le " + fmtDateFull(parseISO(ch.lastVerif[1])));
    if (!d.phone) { const ph = contactPhoneFor(state, d.name); if (ph) d.phone = ph; }
  };
  res.matched.forEach(e => { if (e.on) applyEntry(e); });
  res.probable.forEach(e => { if (e.on) applyEntry(e); });

  let nextId = Math.max(0, ...state.drivers.map(d => d.id)) + 1;
  res.added.forEach(a => {
    if (!a.on) return;
    if (a.probKey && accepted.has(a.probKey)) return;
    const row = a.row;
    const d = {
      id: nextId++, name: row.name, phone: a.phone || "", plate: row.plate, vehicle: row.vehicle || "", manager: "",
      pickup: row.pickup || today, pickupEstimated: !row.pickup, lastVerif: row.lastVerif || null, lastCheckin: null, lastContacted: null,
      status: "active", absentSince: null, source: "foxdrive_" + today
    };
    state.drivers.push(d);
    sum.added++;
    pushLog(state, "new", d, "Nouveau chauffeur · " + fmtPlate(d.plate) + (d.vehicle ? " · " + d.vehicle : "") + (d.phone ? "" : " · numéro manquant"));
  });

  res.absent.forEach(a => {
    if (!a.on) return;
    if (a.probKey && accepted.has(a.probKey)) return;
    if (!isActive(a.driver)) return;
    a.driver.status = "archived"; a.driver.absentSince = today; sum.left++;
    pushLog(state, "left", a.driver, "Absent de l'export FoxDrive — véhicule rendu, retiré du suivi");
  });

  state.imports.unshift({ ts: now, kind: "foxdrive", source: sourceLabel || "", rows: res.total, summary: sum });
  if (state.imports.length > 60) state.imports.length = 60;
  state.lastFox = now;
  return sum;
}

/* contacts : compare un fichier nom→numéro aux chauffeurs */
function reconcileContacts(state, entries) {
  const drivers = state.drivers;
  const idx = buildNameIndex(drivers);
  const res = { assign: [], change: [], same: 0, probable: [], unmatched: [], invalid: [], shared: [], total: entries.length, book: [] };
  const used = new Set();
  const seenFile = new Map();
  entries.forEach(en => {
    const np = normPhone(en.raw);
    if (!np.phone) return;
    res.book.push({ name: en.name, phone: np.phone });
    if (!np.ok) { res.invalid.push({ name: en.name, raw: String(en.raw) }); }
    const found = findDriver(en.name, drivers, idx, null, null);
    if (!found) { res.unmatched.push({ key: "u:" + res.unmatched.length, name: en.name, phone: np.phone, ok: np.ok, assignTo: "" }); return; }
    const d = found.driver;
    if (seenFile.has(d.id) && seenFile.get(d.id) !== np.phone) res.invalid.push({ name: en.name, raw: en.raw + " (déjà vu avec " + fmtPhone(seenFile.get(d.id)) + ")" });
    seenFile.set(d.id, np.phone);
    used.add(d.id);
    const item = { key: "c:" + d.id, driver: d, name: en.name, phone: np.phone, ok: np.ok, how: found.how, old: d.phone || "" };
    if (found.how === "probable") { item.on = false; res.probable.push(item); return; }
    if (!d.phone) { item.on = np.ok; res.assign.push(item); }
    else if (d.phone !== np.phone) { item.on = np.ok; res.change.push(item); }
    else res.same++;
  });
  // numéros partagés par plusieurs chauffeurs actifs (après application prévue)
  const plan = new Map(drivers.filter(isActive).map(d => [d.id, d.phone || ""]));
  res.assign.concat(res.change).forEach(i => { if (i.on) plan.set(i.driver.id, i.phone); });
  const by = new Map();
  plan.forEach((ph, id) => { if (!ph) return; if (!by.has(ph)) by.set(ph, []); by.get(ph).push(id); });
  by.forEach((ids, ph) => { if (ids.length > 1) res.shared.push({ phone: ph, drivers: ids.map(id => drivers.find(d => d.id === id)) }); });
  res.stillMissing = drivers.filter(d => isActive(d) && !plan.get(d.id) && !res.unmatched.some(u => u.assignTo === d.id));
  return res;
}

function applyContacts(state, res) {
  const sum = { assigned: 0, changed: 0 };
  const apply = (i, type) => {
    const d = i.driver;
    const old = d.phone;
    d.phone = i.phone;
    pushLog(state, "phone", d, old ? "Numéro modifié : " + fmtPhone(old) + " → " + fmtPhone(i.phone) : "Numéro ajouté : " + fmtPhone(i.phone));
    if (type === "assign") sum.assigned++; else sum.changed++;
  };
  res.assign.forEach(i => { if (i.on) apply(i, "assign"); });
  res.change.forEach(i => { if (i.on) apply(i, "change"); });
  res.probable.forEach(i => { if (i.on) apply(i, i.old ? "change" : "assign"); });
  res.unmatched.forEach(u => {
    if (!u.assignTo) return;
    const d = state.drivers.find(x => x.id === Number(u.assignTo));
    if (!d) return;
    const old = d.phone; d.phone = u.phone; sum.assigned++;
    pushLog(state, "phone", d, (old ? "Numéro modifié : " : "Numéro ajouté : ") + fmtPhone(u.phone) + " (rattaché manuellement)");
  });
  // carnet : nom -> numéro, pour les futurs nouveaux chauffeurs
  state.contacts = state.contacts || {};
  res.book.forEach(b => { const k = nameKey(b.name); if (k) state.contacts[k] = { name: b.name, phone: b.phone }; });
  state.drivers.forEach(d => { if (d.phone) state.contacts[nameKey(d.name)] = { name: d.name, phone: d.phone }; });
  state.lastContacts = new Date().toISOString();
  state.imports.unshift({ ts: state.lastContacts, kind: "contacts", source: "", rows: res.total, summary: sum });
  if (state.imports.length > 60) state.imports.length = 60;
  return sum;
}

/* sauvegarde ancienne (tableau de chauffeurs) -> fusion par nom sur l'état courant */
function mergeLegacyBackup(state, arr, opts) {
  opts = opts || {};
  const idx = buildNameIndex(state.drivers);
  const out = { matched: 0, phones: 0, contacts: 0, unmatched: [] };
  arr.forEach(o => {
    if (!o || !o.name) return;
    const f = findDriver(o.name, state.drivers, idx, null, normPlate(o.plate));
    if (!f || f.how === "probable") { out.unmatched.push(o.name); return; }
    const d = f.driver; out.matched++;
    if (o.phone) { const np = normPhone(o.phone); const ph = np.ok ? np.phone : o.phone; if (!d.phone) { d.phone = ph; out.phones++; } else if (opts.preferBackup && np.ok && d.phone !== np.phone) { d.phone = np.phone; out.phones++; } }
    if (o.lastContacted && (!d.lastContacted || o.lastContacted > d.lastContacted)) { d.lastContacted = o.lastContacted; out.contacts++; }
    if (o.lastCheckin && (!d.lastCheckin || o.lastCheckin > d.lastCheckin)) d.lastCheckin = o.lastCheckin;
    if (o.lastVerif && !d.lastVerif) d.lastVerif = o.lastVerif;
    if (!d.pickup && (o.pickup || o.depart)) d.pickup = o.pickup || o.depart;
  });
  return out;
}

function normalizeDriver(o) {
  return {
    id: o.id, name: o.name || "", phone: o.phone || "", plate: normPlate(o.plate), vehicle: o.vehicle || "", manager: o.manager || "",
    pickup: o.pickup || o.depart || null, pickupEstimated: !!o.pickupEstimated, lastVerif: o.lastVerif || null, lastCheckin: o.lastCheckin || null,
    lastContacted: o.lastContacted || null, status: o.status || "active", absentSince: o.absentSince || null, source: o.source || "",
    prevPlate: o.prevPlate || undefined
  };
}



export { ADDRESS, CYCLE_DAYS, SOON_DAYS, COOLDOWN_DAYS, DAY_MS, normText, nameTokens, nameKey, normPlate, fmtPlate, esc, firstName, PLACEHOLDER_NAMES, isPlaceholderName, normPhone, fmtPhone, waNumber, startOfDay, todayDate, toISO, parseISO, addDays, daysBetween, dayOf, MONTHS_FR, fmtDate, fmtDateFull, parseAnyDate, relTime, refDate, dueDate, dueStatus, daysToDue, contactedThisCycle, recentlyContacted, MESSAGE_TYPES, buildMessage, VEHICLE_BRANDS, VEHICLE_MODEL_HINTS, VEHICLE_KEEP_UPPER, detectBrandModel, PLATE_LINE, parseFoxBlocks, parseFoxTable, parseFoxText, finalizeFoxRows, parseCSV, headerIndex, foxRowsFromGrid, contactsFromGrid, contactsFromText, contactsFromVcf, isActive, buildNameIndex, tokensSubset, findDriver, sameVehicleText, reconcileFox, contactPhoneFor, pushLog, applyFox, reconcileContacts, applyContacts, mergeLegacyBackup, normalizeDriver };
