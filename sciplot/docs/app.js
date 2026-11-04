/*i18n-wrapped*/
/* SciPlot Studio — giao diện worksheet + đồ thị. Python (studio.py) vẽ hình; JS quản lý project, worksheet, chỉnh sửa. */
"use strict";
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.2/full/";
const FONT_FILES = ["Sans", "Serif"].flatMap(f => ["Regular", "Bold", "Italic", "BoldItalic"].map(s => `Liberation${f}-${s}.ttf`));
const ADJUSTTEXT_WHEEL = "wheels/adjusttext-1.3.0-py3-none-any.whl";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const DPR = Math.min(2, window.devicePixelRatio || 1);

/* ================================================================== Python bridge */
let pyMod = null, ready = false;
function py(fn, ...args) {
  if (window.__MOCK_PY__) return window.__MOCK_PY__(fn, args);
  if (!pyMod) throw new Error(I18("Python chưa sẵn sàng"));
  return pyMod[fn](...args);
}
function pyStatus(text, cls) { $("#pystatustext").textContent = text; $("#pystatus").className = cls || ""; }
async function boot() {
  try {
    if (!window.__MOCK_PY__) {
      pyStatus(I18("Đang tải Python…"));
      await new Promise((ok, bad) => {
        const s = document.createElement("script");
        s.src = PYODIDE_URL + "pyodide.js"; s.onload = ok; s.onerror = () => bad(new Error(I18("Không tải được Pyodide (kiểm tra mạng)")));
        document.head.appendChild(s);
      });
      const pyo = await loadPyodide({ indexURL: PYODIDE_URL });
      pyStatus(I18("Đang tải numpy, pandas, matplotlib, scipy…"));
      await pyo.loadPackage(["numpy", "pandas", "matplotlib", "scipy", "micropip"]);
      try { await pyo.runPythonAsync(`import micropip\nawait micropip.install(${JSON.stringify(new URL(ADJUSTTEXT_WHEEL, location.href).href)})`); }
      catch (e) { console.warn("adjustText", e); }
      pyStatus(I18("Đang nạp font và SciPlot…"));
      pyo.FS.mkdirTree("fonts");
      await Promise.all(FONT_FILES.map(async f => {
        try { const r = await fetch("fonts/" + f); if (r.ok) pyo.FS.writeFile("fonts/" + f, new Uint8Array(await r.arrayBuffer())); } catch (e) { console.warn(f, e); }
      }));
      for (const f of ["sciplot.py", "studio.py"]) {
        const r = await fetch(f);
        if (!r.ok) throw new Error(I18("Không tải được ") + f + I18(" — hãy mở trang qua GitHub Pages hoặc một web server (không mở file:// trực tiếp)"));
        pyo.FS.writeFile(f, await r.text());
      }
      pyo.runPython("import sys; sys.path.insert(0, '.')\nimport studio");
      pyMod = pyo.pyimport("studio");
    }
    ready = true;
    try { py("set_lang", LANG); } catch (e) { }
    pyStatus(I18("Sẵn sàng"), "ready");
    for (const b of P.books) syncBook(b);
    const g = activeGraph(); if (g) renderGraph(g);
  } catch (e) {
    pyStatus(I18("Lỗi khởi động"), "error");
    status(I18("Lỗi: ") + (e.message || e));
    console.error(e);
  }
}

/* ================================================================== project state */
let P = newProject();
function newProject() { return { version: 1, books: [], graphs: [], open: [], active: null, seq: { book: 0, graph: 0 } }; }
const byId = id => P.books.find(b => b.id === id) || P.graphs.find(g => g.id === id);
const activeObj = () => byId(P.active);
const activeGraph = () => { const o = activeObj(); return o && o.kind ? o : null; };
const activeBook = () => { const o = activeObj(); return o && o.cols ? o : null; };
const undoStack = [], redoStack = [];
function snapshot() { return JSON.stringify({ books: P.books, graphs: P.graphs, open: P.open, active: P.active, seq: P.seq }); }
function mutate(fn, opts = {}) {
  undoStack.push(snapshot()); if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  fn();
  afterChange(opts);
}
function afterChange(opts = {}) {
  if (opts.books) for (const b of opts.books) syncBook(b);
  renderExplorer(); renderTabs();
  if (opts.rebuild !== false) showActive(opts);
  autosave();
}
function restore(snap) {
  const s = JSON.parse(snap);
  Object.assign(P, s);
  for (const b of P.books) syncBook(b);
  $$(".win").forEach(w => w.remove());
  afterChange();
}
function undo() { if (!undoStack.length) return status(I18("Không còn gì để hoàn tác")); redoStack.push(snapshot()); restore(undoStack.pop()); status(I18("Đã hoàn tác")); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); status(I18("Đã làm lại")); }
function status(msg) { $("#statusmsg").textContent = msg; }

let saveTimer = null;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const s = JSON.stringify(P);
      if (s.length < 4.5e6) localStorage.setItem("sciplot.autosave", s);
    } catch (e) { /* bộ nhớ trình duyệt đầy hoặc bị chặn — bỏ qua */ }
  }, 800);
}

/* ================================================================== workbook helpers */
const DESIGS = { X: "X", Y: "Y", yEr: "yEr", L: "L", N: "N" };
function colLetter(i) { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function nextColName(book) { let i = 0; const names = new Set(book.cols.map(c => c.name)); while (names.has(colLetter(i))) i++; return colLetter(i); }
function uniqueName(base, list) { let n = base, k = 2; const names = new Set(list.map(o => o.name)); while (names.has(n)) n = `${base}${k++}`; return n; }
function newBook(name, cols) {
  const id = "b" + (++P.seq.book);
  const book = { id, name: uniqueName(name || `Book${P.seq.book}`, P.books), cols: cols || [] };
  if (!book.cols.length) for (let k = 0; k < 2; k++) book.cols.push({ name: colLetter(k), lname: "", units: "", comment: "", desig: k ? "Y" : "X", data: [] });
  book.cols.forEach((c, i) => { c.name = c.name || colLetter(i); c.data = c.data || []; });
  P.books.push(book);
  return book;
}
function nrows(book) { return Math.max(0, ...book.cols.map(c => c.data.length)); }
function syncBook(book) { if (!ready) return; try { py("set_book", JSON.stringify(book)); } catch (e) { status(I18("Lỗi dữ liệu: ") + e.message); } }
const isNumStr = v => typeof v === "number" || (typeof v === "string" && /^\s*[-+]?(\d+([.,]\d*)?|[.,]\d+)([eE][-+]?\d+)?\s*$/.test(v));
function parseCell(v, dec = ".") {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
  const s = String(v).trim();
  if (s === "") return null;
  if (isNumStr(s)) { const t = dec === "," ? s.replace(",", ".") : s; const n = Number(t); if (Number.isFinite(n)) return n; }
  return s;
}
function colIsNumeric(c) { const f = c.data.filter(v => v !== null && v !== ""); return f.length > 0 && f.filter(v => typeof v === "number").length >= 0.8 * f.length; }
const plainMath = t => String(t).replace(/\$([^$]*)\$/g, (m, g) => g.replace(/\\([a-zA-Z]+)/g, "$1").replace(/[_^{}]/g, ""));
function dispName(c) { return (c.lname || "").trim() || c.name; }

/* ---- đọc file / văn bản thành bảng (giữ logic đã kiểm thử ở bản web đơn giản) ---- */
const filled = r => r.filter(c => c !== "" && c !== null && c !== undefined).length;
function splitLine(line, delim) {
  if (delim === "ws") return line.trim().split(/\s+/);
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === delim) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur); return out.map(x => x.trim());
}
function textToAoa(text, sep, dec) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(l => l.trim() !== "");
  const sample = lines.slice(0, 30).join("\n");
  let delim = { tab: "\t", comma: ",", semicolon: ";", space: "ws" }[sep];
  if (!delim) delim = sample.includes("\t") ? "\t" : sample.includes(";") ? ";" : (dec !== "," && sample.includes(",")) ? "," : "ws";
  return lines.map(l => splitLine(l, delim));
}
function decodeText(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder("utf-16le").decode(buf);
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder("utf-16be").decode(buf);
  const t = new TextDecoder("utf-8").decode(buf);
  return t.includes("�") ? new TextDecoder("windows-1258").decode(buf) : t;
}
/** AoA → cột worksheet: dòng tiêu đề = Long Name / Units / Comments */
function aoaToCols(aoa, { skip = 0, nhdr = "auto", dec = "." } = {}) {
  let rows = aoa.slice(skip).filter(r => r && filled(r) > 0);
  if (!rows.length) throw new Error(I18("Không có dữ liệu sau khi bỏ qua các dòng đầu."));
  const width = Math.max(...rows.map(r => r.length));
  if (nhdr === "auto") {
    while (rows.length > 2 && width > 1 && filled(rows[0]) <= 1 && filled(rows[1]) > 1) rows = rows.slice(1);
    nhdr = 0;
    while (nhdr < 3 && nhdr < rows.length - 1) {
      const r = rows[nhdr], n = filled(r), k = r.filter(isNumStr).length;
      if (n && k / n < 0.5) nhdr++; else break;
    }
  } else nhdr = +nhdr;
  const hdr = rows.slice(0, nhdr), body = rows.slice(nhdr);
  const cols = [];
  for (let i = 0; i < width; i++) {
    const get = r => (hdr[r] && hdr[r][i] !== undefined && hdr[r][i] !== null) ? String(hdr[r][i]).trim() : "";
    cols.push({ name: colLetter(i), lname: get(0), units: get(1), comment: nhdr >= 3 ? hdr.slice(2).map((_, k) => get(2 + k)).filter(Boolean).join(" ") : "",
      desig: "Y", data: body.map(r => parseCell(r[i], dec)) });
  }
  // bỏ cột trống hoàn toàn, đặt kiểu cột mặc định: cột số đầu tiên = X, cột chữ = Label
  const keep = cols.filter(c => c.lname || c.data.some(v => v !== null));
  // cột đầu tiên là X (kể cả cột chữ — dùng làm nhãn cho hình cột), trừ khi đó là cột nhóm lặp lại
  let seenX = false;
  keep.forEach((c, i) => {
    c.name = colLetter(i);
    const num = colIsNumeric(c);
    if (i === 0 && !num) {
      const vals = c.data.filter(v => v !== null);
      const repeated = new Set(vals).size < vals.length / 3;
      if (!repeated && keep.slice(1).some(colIsNumeric)) { c.desig = "X"; seenX = true; } else c.desig = "L";
    } else if (!num) c.desig = "L";
    else if (!seenX) { c.desig = "X"; seenX = true; }
  });
  return { cols: keep, nhdr };
}
function bestSheet(wb) {
  let best = wb.SheetNames[0], score = -1;
  for (const n of wb.SheetNames) { const ws = wb.Sheets[n]; let k = 0; for (const a in ws) if (a[0] !== "!" && ws[a].t === "n") k++; if (k > score) { score = k; best = n; } }
  return best;
}

/* ================================================================== graph model */
const KINDS = [
  { id: "line", name: "Line", group: "2D" }, { id: "scatter", name: "Scatter", group: "2D" },
  { id: "linesymbol", name: "Line + Symbol", group: "2D" }, { id: "column", name: "Column / Bar", group: "2D" },
  { id: "area", name: "Area", group: "2D" },
  { id: "xps", name: I18("XPS (peak fitting, tô peak)"), group: I18("Vật liệu") },
  { id: "spectra", name: I18("Phổ xếp chồng (XRD, Raman, FTIR, XPS)"), group: I18("Vật liệu") },
  { id: "lsv", name: I18("LSV (η@j)"), group: I18("Điện hoá") }, { id: "tafel", name: "Tafel", group: I18("Điện hoá") },
  { id: "cv", name: "CV", group: I18("Điện hoá") }, { id: "cdl", name: "Cdl", group: I18("Điện hoá") },
  { id: "nyquist", name: "Nyquist (EIS)", group: I18("Điện hoá") },
  { id: "bet", name: "BET isotherm", group: I18("Vật liệu") }, { id: "tauc", name: "Tauc (Eg)", group: I18("Vật liệu") },
  { id: "box", name: "Box chart", group: I18("Thống kê") }, { id: "histogram", name: "Histogram", group: I18("Thống kê") },
  { id: "pca", name: "PCA", group: I18("Thống kê") }, { id: "heatmap", name: "Heatmap", group: I18("Thống kê") },
  { id: "volcano", name: "Volcano", group: I18("Thống kê") },
];
const PALETTE_DEFS = [
  { id: "paper", name: I18("Pastel bài báo (CuO/CZ, ACS ANM 2025)"), colors: ["#FF7FC6", "#FC9898", "#F8BF92", "#F4D897", "#82D0FF", "#8E9CFF", "#BC75FF", "#7FD3A8"] },
  { id: "npg", name: I18("NPG-style (đỏ–xanh đậm)"), colors: ["#E64B35", "#4DBBD5", "#00A087", "#3C5488", "#F39B7F", "#8491B4", "#91D1C2", "#DC0000"] },
  { id: "npg_soft", name: "NPG-style pastel", colors: ["#F0937F", "#94D6E6", "#66C6B7", "#8A98B8", "#F8C3B2", "#B5BDD2", "#BDE3DA", "#EA6666"] },
  { id: "okabe", name: I18("Okabe–Ito (an toàn mù màu)"), colors: ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#F0E442", "#000000"] },
  { id: "tol_light", name: I18("Paul Tol light (pastel, an toàn mù màu)"), colors: ["#77AADD", "#EE8866", "#EEDD88", "#FFAABB", "#99DDFF", "#44BB99", "#BBCC33", "#AAAA00"] },
  { id: "tol_muted", name: I18("Paul Tol muted (trầm, an toàn mù màu)"), colors: ["#CC6677", "#332288", "#DDCC77", "#117733", "#88CCEE", "#882255", "#44AA99", "#999933"] },
  { id: "aaas", name: "Science (AAAS)", colors: ["#3B4992", "#EE0000", "#008B45", "#631879", "#008280", "#BB0021", "#5F559B", "#A20056"] },
  { id: "seq_warm", name: I18("Tăng dần hồng → tím (theo hàm lượng)"), seq: true, colors: ["#FFD8A8", "#FDB48C", "#F9917E", "#EE6F7B", "#D6527F", "#A83C82"] },
  { id: "seq_blue", name: I18("Tăng dần xanh dương"), seq: true, colors: ["#C6DBEF", "#9ECAE1", "#6BAED6", "#4292C6", "#2171B5", "#08519C"] },
  { id: "seq_green", name: I18("Tăng dần xanh lá"), seq: true, colors: ["#C7E9C0", "#A1D99B", "#74C476", "#41AB5D", "#238B45", "#005A32"] },
  { id: "seq_purple", name: I18("Tăng dần tím"), seq: true, colors: ["#DADAEB", "#BCBDDC", "#9E9AC8", "#807DBA", "#6A51A3", "#4A1486"] },
  { id: "viridis", name: I18("Viridis (tăng dần, in đen trắng vẫn rõ)"), seq: true, colors: ["#440154", "#443983", "#31688E", "#21918C", "#35B779", "#90D743", "#FDE725"] },
  { id: "bold", name: I18("Đậm cổ điển"), colors: ["#000000", "#E41A1C", "#377EB8", "#4DAF4A", "#984EA3", "#FF7F00", "#A65628", "#F781BF"] },
  { id: "gray", name: I18("Xám (in đen trắng)"), colors: ["#222222", "#777777", "#AAAAAA", "#555555", "#CCCCCC", "#333333"] },
];
const PAL = Object.fromEntries(PALETTE_DEFS.map(p => [p.id, p]));
const NEUTRAL = ["#000000", "#3A3A3A", "#666666", "#8C8C8C", "#BFBFBF", "#FFFFFF"];
function hexMix(a, b, t) { const pa = a.match(/\w\w/g).map(h => parseInt(h, 16)), pb = b.match(/\w\w/g).map(h => parseInt(h, 16)); return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase(); }
function palColors(id, n) {
  const P_ = PAL[id] || PAL.paper; const c = P_.colors; n = Math.max(1, n || c.length);
  if (!P_.seq) return Array.from({ length: n }, (_, i) => c[i % c.length]);
  if (n === 1) return [c[Math.floor(c.length / 2)]];
  return Array.from({ length: n }, (_, i) => { const f = i / (n - 1) * (c.length - 1), k = Math.min(c.length - 2, Math.floor(f)); return hexMix(c[k], c[k + 1], f - k); });
}
const GRADIENTS = [[I18("Hồng → vàng (bài báo)"), "#FC9D99,#F3D597"], [I18("Hồng → trắng"), "#F48FB1,#FFF0F5"], [I18("Đào → kem"), "#F7A072,#FBE8C8"], [I18("Xanh → trắng"), "#6BAED6,#EAF4FB"],
  [I18("Xanh ngọc → trắng"), "#66C6B7,#E8F6F3"], [I18("Tím → hồng"), "#9E8CF0,#F6C6E0"], [I18("Xanh → tím"), "#82D0FF,#BC75FF"], [I18("Xanh lá → vàng"), "#7FD3A8,#F5EFA8"], [I18("Xám"), "#8C8C8C,#EDEDED"]];
const kindName = k => (KINDS.find(x => x.id === k) || { name: k }).name;
const TABLE_KINDS = new Set(["box", "histogram", "pca", "heatmap"]);
const DEFAULT_OPTS = {
  xps: { peak_fill: "gradient" }, spectra: { kind: "xrd" }, lsv: { reaction: "OER", ref: "RHE", current_unit: "mA/cm2" },
  tafel: { reaction: "OER", ref: "RHE", current_unit: "mA/cm2", fit_range: [1, 10] }, cv: { ref: "RHE", current_unit: "mA/cm2" },
  heatmap: { scale: "row" }, nyquist: { lines: true }, cdl: { half: false }, tauc: { transition: "direct" },
};
const DEFAULT_SIZE = { spectra: [4.5, 5], heatmap: [6.5, 5.5], nyquist: [4.6, 4.4], xps: [4.6, 3.8] };
function newGraph(kind, book, series, extra = {}) {
  const id = "g" + (++P.seq.graph);
  const g = {
    id, name: uniqueName(`Graph${P.seq.graph}`, P.graphs), kind, book: book.id, series,
    opts: clone(DEFAULT_OPTS[kind] || {}), size: clone(DEFAULT_SIZE[kind] || [5, 4]),
    theme: "boxed", font: "sans", fontsize: 11, palette: "paper",
    xaxis: {}, yaxis: {}, y2axis: {}, legend: {}, title: "", texts: [], reflines: [], frame: {}, ...extra,
  };
  P.graphs.push(g);
  return g;
}
/** Tạo series từ cột đang chọn theo quy tắc: X = cột X gần nhất bên trái, yEr ngay bên phải */
function seriesFromSelection(book, sel, kind) {
  let idx = sel.length ? sel : book.cols.map((c, i) => i).filter(i => book.cols[i].desig === "Y" || (TABLE_KINDS.has(kind) && book.cols[i].desig === "X" && colIsNumeric(book.cols[i])));
  if (!sel.length && !idx.length) idx = book.cols.map((c, i) => i).filter(i => colIsNumeric(book.cols[i])).slice(1);
  const out = [];
  for (const i of idx) {
    const c = book.cols[i];
    if (!c || c.desig === "X" && !TABLE_KINDS.has(kind) || c.desig === "L" || c.desig === "N" || c.desig === "yEr") continue;
    let x = null;
    for (let k = i - 1; k >= 0; k--) if (book.cols[k].desig === "X") { x = book.cols[k].name; break; }
    if (!x) { const fx = book.cols.find(cc => cc.desig === "X"); x = fx ? fx.name : null; }
    const nx = book.cols[i + 1];
    out.push({ x: TABLE_KINDS.has(kind) ? null : x, y: c.name, yerr: nx && nx.desig === "yEr" ? nx.name : null });
  }
  return out;
}
function labelCol(book) { const c = book.cols.find(c => c.desig === "L"); return c ? c.name : null; }
function looksLong(book) {
  const L = book.cols.filter(c => c.desig === "L"), Y = book.cols.filter(c => c.desig === "Y"), X = book.cols.filter(c => c.desig === "X");
  if (L.length !== 1 || X.length !== 1 || Y.length < 1) return false;
  const vals = new Set(L[0].data.filter(v => v !== null)); return vals.size > 1 && vals.size < L[0].data.length / 3;
}

/* ================================================================== menus & toolbar */
const ICONS = {
  line: '<svg viewBox="0 0 20 20"><polyline points="2,16 7,9 11,12 18,3" fill="none" stroke="#2f6fd6" stroke-width="2"/></svg>',
  scatter: '<svg viewBox="0 0 20 20"><g fill="#2f6fd6"><circle cx="4" cy="15" r="2"/><circle cx="8" cy="9" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="16" cy="5" r="2"/></g></svg>',
  linesymbol: '<svg viewBox="0 0 20 20"><polyline points="3,16 8,9 12,12 17,4" fill="none" stroke="#2f6fd6" stroke-width="1.6"/><g fill="#fff" stroke="#2f6fd6" stroke-width="1.6"><circle cx="3" cy="16" r="2"/><circle cx="8" cy="9" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="17" cy="4" r="2"/></g></svg>',
  column: '<svg viewBox="0 0 20 20"><g fill="#e98f8f" stroke="#666"><rect x="2" y="9" width="4" height="9"/><rect x="8" y="4" width="4" height="14"/><rect x="14" y="7" width="4" height="11"/></g></svg>',
  spectra: '<svg viewBox="0 0 20 20" fill="none" stroke-width="1.4"><path d="M1 17h4l1-4 1 4h3l1-6 1 6h7" stroke="#2f6fd6"/><path d="M1 10h5l1-5 1 5h4l1-3 1 3h5" stroke="#c96a00"/></svg>',
  undo: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.8"><path d="M7 5L3 9l4 4"/><path d="M3 9h9a5 5 0 010 10h-2"/></svg>',
  redo: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.8"><path d="M13 5l4 4-4 4"/><path d="M17 9H8a5 5 0 000 10h2"/></svg>',
  pointer: '<svg viewBox="0 0 20 20"><path d="M5 2l10 9h-5l3 6-2 1-3-6-3 4z" fill="#333"/></svg>',
  zoom: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.8"><circle cx="8.5" cy="8.5" r="5.5"/><path d="M13 13l5 5M6 8.5h5M8.5 6v5"/></svg>',
  text: '<svg viewBox="0 0 20 20"><text x="3" y="16" font-size="15" font-family="serif" font-weight="700" fill="#333">T</text><path d="M14 4v12" stroke="#2f6fd6" stroke-width="1.5"/></svg>',
  hline: '<svg viewBox="0 0 20 20"><path d="M2 10h16" stroke="#333" stroke-width="1.6" stroke-dasharray="3 2"/></svg>',
  vline: '<svg viewBox="0 0 20 20"><path d="M10 2v16" stroke="#333" stroke-width="1.6" stroke-dasharray="3 2"/></svg>',
  rescale: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.7"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/></svg>',
  export: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.7"><path d="M10 3v10M6 9l4 4 4-4M3 15v2h14v-2"/></svg>',
  copy: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.6"><rect x="6" y="6" width="10" height="11" rx="1.5"/><path d="M4 13V4a1 1 0 011-1h8"/></svg>',
  book: '<svg viewBox="0 0 20 20"><rect x="2" y="3" width="16" height="14" fill="#fff" stroke="#1b6e3a"/><path d="M2 7h16M2 11h16M8 3v14M13 3v14" stroke="#1b6e3a"/></svg>',
  open: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.6"><path d="M2 5h6l2 2h8v9H2z"/></svg>',
  save: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.6"><path d="M3 3h11l3 3v11H3z"/><path d="M6 3v5h7V3M6 17v-5h8v5"/></svg>',
  importf: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.6"><path d="M10 13V3M6 7l4-4 4 4"/><rect x="3" y="12" width="14" height="5"/></svg>',
  details: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.6"><circle cx="10" cy="10" r="3"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3M4.3 4.3l2.1 2.1M13.6 13.6l2.1 2.1M4.3 15.7l2.1-2.1M13.6 6.4l2.1-2.1"/></svg>',
  fit: '<svg viewBox="0 0 20 20"><path d="M2 17L18 4" stroke="#d62728" stroke-width="1.8"/><g fill="#2f6fd6"><circle cx="4" cy="14" r="1.8"/><circle cx="8" cy="12.5" r="1.8"/><circle cx="11" cy="8" r="1.8"/><circle cx="15" cy="7" r="1.8"/></g></svg>',
  zoomin: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.8"><path d="M4 10h12M10 4v12"/></svg>',
  zoomout: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.8"><path d="M4 10h12"/></svg>',
  fitwin: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.6"><rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M7 8l-2-2m0 0v2m0-2h2M13 12l2 2m0 0v-2m0 2h-2"/></svg>',
  star: '<svg viewBox="0 0 20 20"><path d="M10 2.5l2.3 4.9 5.2.6-3.9 3.6 1.1 5.2L10 14.2 5.3 16.8l1.1-5.2L2.5 8l5.2-.6z" fill="#f5b301" stroke="#c98a00" stroke-width="1"/></svg>',
  install: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.6"><rect x="3" y="3" width="14" height="14" rx="3"/><path d="M10 6v7M7 10l3 3 3-3"/></svg>',
};
let tool = "pointer";
const MENUS = () => [
  ["File", [
    [I18("Workbook mới"), () => newBookCmd(), "Ctrl+N"], [I18("Nhập dữ liệu (Excel/CSV/TXT)…"), () => pickFile("import"), "Ctrl+I"],
    [I18("Dán dữ liệu từ bảng tính…"), () => pasteDialog()], "-",
    [I18("Mở project (.sciplot.json)…"), () => pickFile("project"), "Ctrl+O"], [I18("Lưu project"), () => saveProject(), "Ctrl+S"],
    [I18("Khôi phục phiên làm việc trước"), () => restoreAutosave()], [I18("Project mới"), () => confirmNewProject()], "-",
    [I18("Xuất hình…"), () => exportDialog(), "Ctrl+E"], [I18("Ghép nhiều hình thành 1 figure (a)(b)…"), () => panelDialog()], "-",
    [I18("Cài SciPlot như một app"), () => installApp()],
  ]],
  ["Edit", [
    [I18("Hoàn tác"), () => undo(), "Ctrl+Z"], [I18("Làm lại"), () => redo(), "Ctrl+Y"], "-",
    [I18("Sao chép hình (dán vào Word/PowerPoint)"), () => copyImage(), "Ctrl+Shift+C"],
    [I18("Xoá đối tượng đang chọn"), () => deleteSelected(), "Del"],
  ]],
  ["Plot", [
    ...["2D", I18("Vật liệu"), I18("Điện hoá"), I18("Thống kê")].flatMap(gp => [["#" + gp], ...KINDS.filter(k => k.group === gp).map(k => [k.name, () => plotCmd(k.id)])]),
  ]],
  ["Column", [
    [I18("Đặt làm X"), () => setDesig("X")], [I18("Đặt làm Y"), () => setDesig("Y")], [I18("Đặt làm Y Error"), () => setDesig("yEr")],
    [I18("Đặt làm Label (chữ)"), () => setDesig("L")], [I18("Bỏ qua (Disregard)"), () => setDesig("N")], "-",
    [I18("Set Column Values (công thức)…"), () => formulaDialog(), "Ctrl+Q"], [I18("Thêm cột"), () => addColumn()], [I18("Chèn cột bên trái"), () => addColumn(true)],
    [I18("Xoá cột đang chọn"), () => deleteColumns()], "-",
    [I18("Tách theo nhóm (Unstack)…"), () => unstackDialog()],
  ]],
  ["Graph", [
    [I18("Plot Details (series, kiểu vẽ)…"), () => plotDetails(), "F4"], [I18("Trục (Axis)…"), () => axisDialog("x"), "F5"],
    [I18("Chú giải (Legend)…"), () => legendDialog()], ["Trang & khung (Page/Layer)…", () => pageDialog()], "-",
    [I18("Thêm chữ"), () => setTool("text")], [I18("Thêm đường ngang"), () => setTool("hline")], [I18("Thêm đường dọc"), () => setTool("vline")], "-",
    [I18("Rescale (khớp lại trục)"), () => rescale(), "Ctrl+R"], [I18("Đổi loại hình…"), () => changeKindDialog()], "-",
    [I18("Copy Format (sao chép định dạng)"), () => copyFormat()], [I18("Paste Format (dán định dạng)"), () => pasteFormat()],
    [I18("Lưu làm template…"), () => saveTemplate()], [I18("Áp dụng template…"), () => applyTemplateDialog()], "-",
    [I18("Nhân bản graph"), () => duplicateGraph()],
  ]],
  ["Analysis", [
    [I18("Fit tuyến tính / đa thức (y = ax + b, R²)…"), () => fitDialog(), "Ctrl+L"],
    [I18("Bỏ mọi đường fit"), () => { const g = activeGraph(); if (g) mutate(() => g.series.forEach(clearFit)); }], "-",
    [I18("Set Column Values (công thức)…"), () => formulaDialog(), "Ctrl+Q"],
    [I18("Đưa kết quả tính vào workbook"), () => { const b = $("#res2book"); if (b) b.click(); else status(I18("Chưa có kết quả tính nào")); }],
  ]],
  ["Help", [
    [I18("Hướng dẫn nhanh"), () => helpDialog()], [I18("Phím tắt"), () => shortcutsDialog()],
    [I18("Bản đơn giản (form)"), () => { location.href = "simple.html"; }], "-",
    [I18("⭐ Ủng hộ & trích dẫn (acknowledge)…"), () => citeDialog()], "-",
    [LANG === "en" ? "✓ English" : "English", () => switchLang("en")], [LANG === "vi" ? I18("✓ Tiếng Việt") : I18("Tiếng Việt"), () => switchLang("vi")], "-",
    [I18("Giới thiệu & giấy phép…"), () => aboutDialog()],
  ]],
];
function buildMenus() {
  const nav = $("#menus"); nav.innerHTML = "";
  for (const [name, items] of MENUS()) {
    const b = document.createElement("button"); b.textContent = name;
    b.onclick = e => { e.stopPropagation(); openPopup($("#menupop"), items, b.getBoundingClientRect().left, b.getBoundingClientRect().bottom, b); };
    b.onmouseenter = () => { if (!$("#menupop").hidden && openMenuBtn && openMenuBtn !== b) b.click(); };
    nav.appendChild(b);
  }
}
let openMenuBtn = null;
function openPopup(el, items, x, y, btn) {
  closePopups();
  el.innerHTML = items.map((it, i) => it === "-" ? '<div class="msep"></div>' : typeof it[0] === "string" && it[0].startsWith("#") ? `<div class="mhead">${esc(it[0].slice(1))}</div>` :
    `<div class="mi${it[3] === false ? " dis" : ""}" data-i="${i}"><span>${esc(it[0])}</span>${it[2] ? `<kbd>${esc(it[2])}</kbd>` : ""}</div>`).join("");
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, innerWidth - r.width - 6) + "px";
  el.style.top = Math.min(y, innerHeight - r.height - 6) + "px";
  $$(".mi", el).forEach(m => m.onclick = e => { e.stopPropagation(); closePopups(); items[+m.dataset.i][1](); });
  if (btn) { openMenuBtn = btn; btn.classList.add("open"); }
}
function closePopups() {
  $("#menupop").hidden = true; $("#ctxmenu").hidden = true;
  if (openMenuBtn) openMenuBtn.classList.remove("open"); openMenuBtn = null;
}
function buildToolbar() {
  const T = [
    ["book", I18("Workbook mới"), newBookCmd], ["importf", I18("Nhập file"), () => pickFile("import")], ["open", I18("Mở project"), () => pickFile("project")], ["save", I18("Lưu project"), saveProject], "|",
    ["undo", I18("Hoàn tác (Ctrl+Z)"), undo], ["redo", I18("Làm lại (Ctrl+Y)"), redo], "|",
    ["line", "Line", () => plotCmd("line"), "Line"], ["scatter", "Scatter", () => plotCmd("scatter")], ["linesymbol", "Line + Symbol", () => plotCmd("linesymbol")],
    ["column", "Column", () => plotCmd("column")], ["spectra", I18("Phổ xếp chồng"), () => plotCmd("spectra")], "|",
    ["pointer", I18("Chọn / kéo (Esc)"), () => setTool("pointer"), null, "tool"], ["zoom", I18("Phóng to vùng (kéo chuột)"), () => setTool("zoom"), null, "tool"],
    ["text", I18("Thêm chữ (bấm vào hình)"), () => setTool("text"), null, "tool"], ["hline", I18("Đường ngang"), () => setTool("hline"), null, "tool"],
    ["vline", I18("Đường dọc"), () => setTool("vline"), null, "tool"], ["rescale", "Rescale (Ctrl+R)", rescale], "|",
    ["fit", I18("Fit tuyến tính y = ax + b, R² (Ctrl+L)"), () => fitDialog(), "Fit"], ["details", "Plot Details (F4)", () => plotDetails(), "Plot Details"], ["export", I18("Xuất hình (Ctrl+E)"), () => exportDialog(), I18("Xuất")],
    ["copy", I18("Sao chép hình"), copyImage], "|", ["star", I18("Ủng hộ: Star trên GitHub & câu acknowledge"), () => citeDialog(), "Star"], ["install", I18("Cài như app"), installApp, I18("Cài app")],
  ];
  $("#toolbar").innerHTML = T.map((t, i) => t === "|" ? '<span class="sep"></span>' :
    `<button class="tb${t[4] === "tool" && t[0] === tool ? " on" : ""}" data-i="${i}" ${t[4] === "tool" ? `data-tool="${t[0]}"` : ""} title="${esc(t[1])}">${ICONS[t[0]] || ""}${t[3] ? `<span class="lbl">${esc(t[3])}</span>` : ""}</button>`).join("");
  $$("#toolbar .tb").forEach(b => b.onclick = () => T[+b.dataset.i][2]());
  // cụm phóng to / thu nhỏ hình (chỉ tác động lên hình đang mở, không zoom cả app)
  const inst = $$("#toolbar .tb").find(b => T[+b.dataset.i][0] === "install");
  const z = document.createElement("span"); z.id = "tbzoom";
  z.title = I18("Phóng to / thu nhỏ hình · ⌘/Ctrl + cuộn chuột · ⌘/Ctrl + / − · ⌘/Ctrl 0");
  z.innerHTML = `${I18("<button class=\"tb zb\" data-z=\"out\" aria-label=\"Thu nhỏ\">")}${ICONS.zoomout}${I18("</button><select data-z=\"sel\" aria-label=\"Mức phóng\"></select>")}` +
    `${I18("<button class=\"tb zb\" data-z=\"in\" aria-label=\"Phóng to\">")}${ICONS.zoomin}${I18("</button><button class=\"tb\" data-z=\"fit\" title=\"Vừa khung cửa sổ\">")}${ICONS.fitwin}</button>`;
  inst.before(z, Object.assign(document.createElement("span"), { className: "sep" }));
  const zg = () => activeGraph();
  $('[data-z="in"]', z).onclick = () => { const g = zg(); if (g) setZoom(g.id, gV(g.id).zoom * 1.25); };
  $('[data-z="out"]', z).onclick = () => { const g = zg(); if (g) setZoom(g.id, gV(g.id).zoom / 1.25); };
  $('[data-z="fit"]', z).onclick = () => { const g = zg(); if (g) zoomFit(g.id); };
  $('[data-z="sel"]', z).onchange = e => { const g = zg(); if (!g) return; const v = e.target.value; if (v === "fit") zoomFit(g.id); else setZoom(g.id, +v / 100); };
  updateZoomUI();
}
function setTool(t) {
  tool = t;
  $$("#toolbar [data-tool]").forEach(b => b.classList.toggle("on", b.dataset.tool === t));
  $$(".overlay").forEach(o => { o.className = "overlay " + (t === "pointer" ? "" : t); });
  status({ pointer: I18("Chọn: bấm để chọn, bấm đúp để chỉnh, kéo chú giải/chữ để di chuyển"), zoom: I18("Kéo chuột trên vùng vẽ để phóng to — Ctrl+R để về như cũ"),
    text: I18("Bấm vào vị trí trên hình để thêm chữ"), hline: I18("Bấm vào hình để thêm đường ngang tại vị trí đó"), vline: I18("Bấm vào hình để thêm đường dọc tại vị trí đó") }[t]);
}

/* ================================================================== explorer, tabs, windows */
function renderExplorer() {
  const L = $("#explist");
  const item = (o, ico) => `<div class="exitem${o.id === P.active ? " active" : ""}" data-id="${o.id}${I18("\" title=\"Bấm đúp để đổi tên\"><span class=\"ico\">")}${ico}</span>${esc(o.name)}</div>`;
  const head = t => `<div class="panehead small" style="border:0;margin:4px 0 0">${t}</div>`;
  L.innerHTML = (P.books.length + P.graphs.length)
    ? (P.graphs.length ? head(`Graphs (${P.graphs.length})`) + P.graphs.map(g => item(g, "📈")).join("") : "") +
      (P.books.length ? head(`Workbooks (${P.books.length})`) + P.books.map(b => item(b, "▦")).join("") : "")
    : I18('<div class="exitem sample">(trống) — nhập file hoặc chọn dữ liệu mẫu</div>');
  $$(".exitem[data-id]", L).forEach(el => {
    el.onclick = () => openWin(el.dataset.id);
    el.ondblclick = () => renameObj(el.dataset.id);
    el.oncontextmenu = e => {
      e.preventDefault(); const id = el.dataset.id;
      openPopup($("#ctxmenu"), [[I18("Mở"), () => openWin(id)], [I18("Đổi tên"), () => renameObj(id)], [I18("Nhân bản"), () => byId(id).kind ? duplicateGraph(id) : duplicateBook(id)], "-", [I18("Xoá"), () => deleteObj(id)]], e.clientX, e.clientY);
    };
  });
}
function renderTabs() {
  P.open = P.open.filter(id => byId(id));
  $("#tabs").innerHTML = P.open.map(id => { const o = byId(id); return `<div class="tab${id === P.active ? " active" : ""}" data-id="${id}">${o.kind ? "📈" : "▦"} ${esc(o.name)}${I18("<button class=\"x\" title=\"Đóng\" data-close=\"")}${id}${I18("\">×</button></div>")}`; }).join("");
  $$(".tab").forEach(t => t.onclick = e => { if (e.target.dataset.close) { closeWin(e.target.dataset.close); return; } openWin(t.dataset.id); });
}
function openWin(id) {
  if (!P.open.includes(id)) P.open.push(id);
  P.active = id;
  renderExplorer(); renderTabs(); showActive();
}
function closeWin(id) {
  P.open = P.open.filter(x => x !== id);
  const w = $(`.win[data-id="${id}"]`); if (w) w.remove();
  if (P.active === id) P.active = P.open[P.open.length - 1] || null;
  renderTabs(); renderExplorer(); showActive();
}
function showActive(opts = {}) {
  $("#welcome").style.display = P.active ? "none" : "";
  $$(".win").forEach(w => { if (!byId(w.dataset.id)) w.remove(); });
  $$(".win").forEach(w => w.classList.toggle("active", w.dataset.id === P.active));
  const o = activeObj();
  updateZoomUI();
  if (!o) { showResults(null); return; }
  let w = $(`.win[data-id="${o.id}"]`);
  const fresh = !w;
  if (!w) { w = document.createElement("div"); w.className = "win active"; w.dataset.id = o.id; $("#winarea").appendChild(w); }
  if (o.cols) { if (fresh || opts.sheet !== false) renderSheet(o, w); showResults(null); }
  else { if (fresh) buildGraphWin(o, w); renderGraph(o); }
}
function renameObj(id) {
  const o = byId(id); const n = prompt(I18("Tên mới:"), o.name);
  if (n && n.trim()) mutate(() => { o.name = n.trim(); });
}
function deleteObj(id) {
  const o = byId(id);
  const usedBy = o.cols ? P.graphs.filter(g => g.book === id).map(g => g.name) : [];
  if (!confirm(`${I18("Xoá ")}${o.name}?` + (usedBy.length ? `${I18("\nCác hình dùng dữ liệu này cũng sẽ bị xoá: ")}${usedBy.join(", ")}` : ""))) return;
  mutate(() => {
    if (o.cols) { P.books = P.books.filter(b => b.id !== id); P.graphs = P.graphs.filter(g => g.book !== id); }
    else P.graphs = P.graphs.filter(g => g.id !== id);
    P.open = P.open.filter(x => byId(x)); if (!byId(P.active)) P.active = P.open[0] || null;
  });
}
function duplicateGraph(id) {
  const g = id ? byId(id) : activeGraph(); if (!g) return status(I18("Hãy mở một graph trước"));
  mutate(() => { const c = clone(g); c.id = "g" + (++P.seq.graph); c.name = uniqueName(g.name + "_copy", P.graphs); P.graphs.push(c); P.open.push(c.id); P.active = c.id; });
}
function duplicateBook(id) {
  const b = byId(id);
  mutate(() => { const c = clone(b); c.id = "b" + (++P.seq.book); c.name = uniqueName(b.name + "_copy", P.books); P.books.push(c); P.open.push(c.id); P.active = c.id; }, { books: [] });
  syncBook(P.books[P.books.length - 1]);
}

/* ================================================================== worksheet */
const SHEET_PAGE = 400;
const sheetState = {};  // id → {sel:{r,c}, cols:Set, shown}
function sstate(book) { return sheetState[book.id] || (sheetState[book.id] = { sel: { r: 0, c: 0 }, cols: new Set(), shown: SHEET_PAGE }); }
function cellText(v) { if (v === null || v === undefined) return ""; if (typeof v === "number") return Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0) ? v.toExponential(5) : String(+v.toPrecision(10)); return String(v); }
function renderSheet(book, w) {
  const S = sstate(book);
  const n = nrows(book), shown = Math.min(Math.max(n + 20, 30), S.shown + 20);
  const metaRows = [["lname", "Long Name"], ["units", "Units"], ["comment", "Comments"]];
  let h = `<div class="sheetwrap"><table class="sheet"><thead><tr><th class="rowh"></th>` +
    book.cols.map((c, j) => `<th data-c="${j}" class="${S.cols.has(j) ? "colsel" : ""}${I18("\" title=\"Bấm chọn cột · chuột phải: đổi kiểu cột, công thức…\">")}${esc(c.name)}<span class="desig d-${c.desig}">(${c.desig})</span></th>`).join("") + `</tr></thead><tbody>`;
  for (const [k, lab] of metaRows) h += `<tr class="meta"><th class="rowh">${lab}</th>` + book.cols.map((c, j) => `<td data-m="${k}" data-c="${j}" class="${S.cols.has(j) ? "colsel" : ""}">${esc(c[k] || "")}</td>`).join("") + "</tr>";
  for (let r = 0; r < shown; r++) h += `<tr><th class="rowh">${r + 1}</th>` + book.cols.map((c, j) => { const v = c.data[r]; return `<td data-r="${r}" data-c="${j}" class="${typeof v === "number" ? "num" : ""}${S.cols.has(j) ? " colsel" : ""}">${esc(cellText(v))}</td>`; }).join("") + "</tr>";
  h += `</tbody></table>${n + 20 > shown ? `${I18("<div class=\"sheetfoot\">Đang hiện ")}${shown} / ${n}${I18(" dòng · <button class=\"mini\" id=\"more_")}${book.id}${I18("\">Hiện thêm</button></div>")}` : ""}</div>`;
  const keepScroll = w.firstChild ? [w.firstChild.scrollTop, w.firstChild.scrollLeft] : null;
  w.innerHTML = h;
  const wrap = w.firstChild; if (keepScroll) { wrap.scrollTop = keepScroll[0]; wrap.scrollLeft = keepScroll[1]; }
  const more = $(`#more_${book.id}`); if (more) more.onclick = () => { S.shown += SHEET_PAGE * 2; renderSheet(book, w); };
  const table = $("table", w);
  markSel(book, w);
  table.onmousedown = e => {
    const th = e.target.closest("thead th[data-c]"), td = e.target.closest("td");
    if (th) {
      const j = +th.dataset.c;
      if (e.shiftKey && S.cols.size) { const a = Math.min(...S.cols); for (let k = Math.min(a, j); k <= Math.max(a, j); k++) S.cols.add(k); }
      else if (e.ctrlKey || e.metaKey) S.cols.has(j) ? S.cols.delete(j) : S.cols.add(j);
      else { S.cols.clear(); S.cols.add(j); }
      renderSheet(book, w); return;
    }
    if (td && !td.classList.contains("editing")) {
      if (!(e.ctrlKey || e.metaKey)) S.cols.clear();
      S.sel = { r: td.dataset.m ? -1 - ["lname", "units", "comment"].indexOf(td.dataset.m) : +td.dataset.r, c: +td.dataset.c };
      $$(".colsel", w).forEach(x => x.classList.remove("colsel"));
      markSel(book, w);
    }
  };
  table.ondblclick = e => { const td = e.target.closest("td"); if (td) startEdit(book, w, td); };
  table.oncontextmenu = e => {
    const th = e.target.closest("thead th[data-c]"); if (!th) return;
    e.preventDefault(); const j = +th.dataset.c; if (!S.cols.has(j)) { S.cols.clear(); S.cols.add(j); renderSheet(book, w); }
    openPopup($("#ctxmenu"), [
      [I18("Đặt làm X"), () => setDesig("X")], [I18("Đặt làm Y"), () => setDesig("Y")], [I18("Đặt làm Y Error"), () => setDesig("yEr")], [I18("Đặt làm Label"), () => setDesig("L")], [I18("Bỏ qua"), () => setDesig("N")], "-",
      ["Set Column Values…", () => formulaDialog()], [I18("Chèn cột bên trái"), () => addColumn(true)], [I18("Thêm cột"), () => addColumn()], [I18("Xoá cột"), () => deleteColumns()], "-",
      [I18("#Vẽ từ cột đã chọn")], ...["linesymbol", "line", "scatter", "column", "spectra"].map(k => [kindName(k), () => plotCmd(k)]),
    ], e.clientX, e.clientY);
  };
}
function cellAt(w, r, c) { return r < 0 ? $(`td[data-m="${["lname", "units", "comment"][-1 - r]}"][data-c="${c}"]`, w) : $(`td[data-r="${r}"][data-c="${c}"]`, w); }
function markSel(book, w) {
  const S = sstate(book);
  $$("td.sel", w).forEach(x => x.classList.remove("sel"));
  const td = cellAt(w, S.sel.r, S.sel.c); if (td) td.classList.add("sel");
}
let editing = null;
function startEdit(book, w, td, initial) {
  if (editing) commitEdit();
  td.classList.add("editing"); td.contentEditable = "true"; td.spellcheck = false;
  if (initial !== undefined) td.textContent = initial;
  td.focus();
  const range = document.createRange(); range.selectNodeContents(td); if (initial !== undefined) range.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(range);
  editing = { book, w, td, orig: td.textContent };
}
function commitEdit(cancel) {
  if (!editing) return;
  const { book, w, td, orig } = editing; editing = null;
  td.contentEditable = "false"; td.classList.remove("editing");
  const text = td.textContent;
  if (cancel || text === orig) { td.textContent = orig; return; }
  const c = +td.dataset.c;
  mutate(() => {
    const col = book.cols[c];
    if (td.dataset.m) col[td.dataset.m] = text.trim();
    else { const r = +td.dataset.r; while (col.data.length <= r) col.data.push(null); col.data[r] = parseCell(text); }
  }, { books: [book], rebuild: false });
  renderSheet(book, w);
}
function sheetKey(e) {
  const book = activeBook(); if (!book) return false;
  const w = $(`.win[data-id="${book.id}"]`); const S = sstate(book);
  if (editing) {
    if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); commitEdit(); move(e.key === "Tab" ? 0 : 1, e.key === "Tab" ? (e.shiftKey ? -1 : 1) : 0); return true; }
    if (e.key === "Escape") { commitEdit(true); return true; }
    return false;
  }
  function move(dr, dc) {
    S.sel.r = Math.max(-3, S.sel.r + dr); S.sel.c = Math.min(book.cols.length - 1, Math.max(0, S.sel.c + dc));
    if (S.sel.r >= S.shown) { S.shown += SHEET_PAGE; renderSheet(book, w); }
    markSel(book, w); const td = cellAt(w, S.sel.r, S.sel.c); if (td) td.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  const k = e.key;
  if (k === "ArrowDown") { move(1, 0); return true; } if (k === "ArrowUp") { move(-1, 0); return true; }
  if (k === "ArrowLeft") { move(0, -1); return true; } if (k === "ArrowRight" || k === "Tab") { move(0, 1); return true; }
  if (k === "Enter" || k === "F2") { const td = cellAt(w, S.sel.r, S.sel.c); if (td) startEdit(book, w, td); return true; }
  if ((k === "Delete" || k === "Backspace") && !e.ctrlKey) {
    if (S.cols.size) { clearColumns(book, [...S.cols]); return true; }
    mutate(() => { const col = book.cols[S.sel.c]; if (S.sel.r < 0) col[["lname", "units", "comment"][-1 - S.sel.r]] = ""; else if (S.sel.r < col.data.length) col.data[S.sel.r] = null; }, { books: [book], rebuild: false });
    renderSheet(book, w); return true;
  }
  if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { const td = cellAt(w, S.sel.r, S.sel.c); if (td) { startEdit(book, w, td, k); e.preventDefault(); } return true; }
  return false;
}
function clearColumns(book, idx) { mutate(() => idx.forEach(j => { book.cols[j].data = []; }), { books: [book] }); }
function sheetPaste(text) {
  const book = activeBook(); if (!book || editing) return false;
  const S = sstate(book);
  const aoa = textToAoa(text, "auto", ".");
  if (!aoa.length) return true;
  mutate(() => {
    let r0 = S.sel.r, c0 = S.sel.c;
    for (let i = 0; i < aoa.length; i++) for (let j = 0; j < aoa[i].length; j++) {
      const c = c0 + j;
      while (book.cols.length <= c) book.cols.push({ name: nextColName(book), lname: "", units: "", comment: "", desig: "Y", data: [] });
      const col = book.cols[c], r = r0 + i;
      if (r < 0) col[["lname", "units", "comment"][-1 - r]] = String(aoa[i][j]);
      else { while (col.data.length <= r) col.data.push(null); col.data[r] = parseCell(aoa[i][j]); }
    }
  }, { books: [book] });
  status(`${I18("Đã dán ")}${aoa.length}${I18(" dòng × ")}${Math.max(...aoa.map(r => r.length))}${I18(" cột")}`);
  return true;
}
function sheetCopy() {
  const book = activeBook(); if (!book || editing) return null;
  const S = sstate(book);
  if (S.cols.size) {
    const idx = [...S.cols].sort((a, b) => a - b), n = Math.max(...idx.map(j => book.cols[j].data.length));
    const lines = [idx.map(j => dispName(book.cols[j])).join("\t")];
    for (let r = 0; r < n; r++) lines.push(idx.map(j => cellText(book.cols[j].data[r])).join("\t"));
    return lines.join("\n");
  }
  const c = book.cols[S.sel.c]; return S.sel.r < 0 ? c[["lname", "units", "comment"][-1 - S.sel.r]] || "" : cellText(c.data[S.sel.r]);
}
function selectedCols(book) { const S = sstate(book); return S.cols.size ? [...S.cols].sort((a, b) => a - b) : [S.sel.c]; }
function setDesig(d) {
  const book = activeBook(); if (!book) return status(I18("Hãy mở một workbook"));
  mutate(() => selectedCols(book).forEach(j => { book.cols[j].desig = d; }), { books: [book] });
}
function addColumn(left) {
  const book = activeBook(); if (!book) return status(I18("Hãy mở một workbook"));
  const at = left ? Math.min(...selectedCols(book)) : book.cols.length;
  mutate(() => { book.cols.splice(at, 0, { name: nextColName(book), lname: "", units: "", comment: "", desig: "Y", data: [] }); }, { books: [book] });
}
function deleteColumns() {
  const book = activeBook(); if (!book) return;
  const idx = selectedCols(book);
  const names = idx.map(j => book.cols[j].name);
  const used = P.graphs.filter(g => g.book === book.id && g.series.some(s => names.includes(s.x) || names.includes(s.y)));
  if (used.length && !confirm(`${I18("Cột ")}${names.join(", ")}${I18(" đang được dùng trong ")}${used.map(g => g.name).join(", ")}${I18(". Vẫn xoá?")}`)) return;
  mutate(() => {
    book.cols = book.cols.filter((c, j) => !idx.includes(j));
    for (const g of used) g.series = g.series.filter(s => !names.includes(s.y)).map(s => names.includes(s.x) ? { ...s, x: null } : s);
    sstate(book).cols.clear();
  }, { books: [book] });
}

/* ================================================================== import */
let pickMode = "import";
function pickFile(mode) { pickMode = mode; const f = $("#fileinput"); f.accept = mode === "project" ? ".json" : ".csv,.tsv,.txt,.dat,.xlsx,.xls,.xlsm,.ods"; f.value = ""; f.click(); }
async function onFilePicked(file) {
  if (!file) return;
  if (pickMode === "project" || file.name.endsWith(".json")) return openProjectFile(file);
  const buf = await file.arrayBuffer();
  const ext = file.name.split(".").pop().toLowerCase();
  let wb = null, text = null;
  if (["xlsx", "xls", "xlsm", "ods", "xlsb"].includes(ext)) wb = XLSX.read(buf, { type: "array", cellDates: true });
  else text = decodeText(buf);
  importDialog(file.name, wb, text);
}
function importDialog(fname, wb, text) {
  const v = { sheet: wb ? bestSheet(wb) : "", skip: 0, nhdr: "auto", sep: "auto", dec: ".", plot: "linesymbol" };
  const fields = [
    ...(wb ? [{ k: "sheet", label: "Sheet", t: "sel", opts: wb.SheetNames.map(s => [s, s]) }] : []),
    { k: "skip", label: I18("Bỏ qua … dòng đầu"), t: "number" },
    { k: "nhdr", label: I18("Dòng tiêu đề"), t: "sel", opts: [["auto", I18("tự nhận")], ["0", I18("không có")], ["1", "1: Long Name"], ["2", "2: Long Name + Units"], ["3", "3: Long Name + Units + Comments"]] },
    ...(wb ? [] : [{ k: "sep", label: I18("Phân cách cột"), t: "sel", opts: [["auto", I18("tự nhận")], ["tab", "Tab"], ["comma", ","], ["semicolon", ";"], ["space", I18("khoảng trắng")]] }]),
    { k: "dec", label: I18("Dấu thập phân"), t: "sel", opts: [[".", I18("chấm (1.23)")], [",", I18("phẩy (1,23)")]] },
    { k: "plot", label: I18("Vẽ ngay sau khi nhập"), t: "sel", opts: [["", I18("không — chỉ mở worksheet")], ...KINDS.map(k => [k.id, k.name])] },
  ];
  const parse = vals => {
    const aoa = wb ? XLSX.utils.sheet_to_json(wb.Sheets[vals.sheet], { header: 1, raw: true, defval: "" }) : textToAoa(text, vals.sep, vals.dec);
    return aoaToCols(aoa, { skip: +vals.skip || 0, nhdr: vals.nhdr, dec: vals.dec });
  };
  const preview = (root, vals) => {
    const box = $(".prev", root);
    try {
      const { cols, nhdr } = parse(vals);
      const n = Math.max(0, ...cols.map(c => c.data.length));
      box.innerHTML = `<table><tr><th></th>${cols.map(c => `<th>${c.name}(${c.desig})</th>`).join("")}</tr>` +
        [["Long Name", "lname"], ["Units", "units"], ["Comments", "comment"]].map(([l, k]) => `<tr class="m"><td>${l}</td>${cols.map(c => `<td>${esc(c[k])}</td>`).join("")}</tr>`).join("") +
        Array.from({ length: Math.min(8, n) }, (_, r) => `<tr><td>${r + 1}</td>${cols.map(c => `<td>${esc(cellText(c.data[r]))}</td>`).join("")}</tr>`).join("") + "</table>";
      $(".note", root).textContent = `${n}${I18(" dòng × ")}${cols.length}${I18(" cột · nhận ")}${nhdr}${I18(" dòng tiêu đề")}`;
    } catch (e) { box.innerHTML = ""; $(".note", root).textContent = e.message; }
  };
  dialog({
    title: I18("Nhập dữ liệu: ") + fname, fields, values: v, wide: true,
    extra: '<p class="note"></p><div class="prev"></div>', onChange: preview, onOpen: preview,
    okText: I18("Nhập"),
    onOk: vals => {
      const { cols } = parse(vals);
      let book;
      mutate(() => { book = newBook(fname.replace(/\.\w+$/, ""), cols); P.open.push(book.id); P.active = book.id; }, { books: [] });
      syncBook(book);
      status(`${I18("Đã nhập ")}${fname}: ${nrows(book)}${I18(" dòng × ")}${book.cols.length}${I18(" cột")}`);
      if (vals.plot) setTimeout(() => plotCmd(vals.plot, book), 30);
    },
  });
}
function pasteDialog() {
  dialog({
    title: I18("Dán dữ liệu"), fields: [{ k: "text", label: I18("Dữ liệu"), t: "textarea", help: I18("Bôi đen vùng dữ liệu trong Excel hoặc phần mềm khác (gồm dòng tên cột, đơn vị) → Ctrl+C → dán vào đây") },
      { k: "dec", label: I18("Dấu thập phân"), t: "sel", opts: [[".", I18("chấm")], [",", I18("phẩy")]] }], values: { text: "", dec: "." }, wide: true, okText: I18("Tạo workbook"),
    onOk: vals => {
      if (!vals.text.trim()) return;
      const { cols } = aoaToCols(textToAoa(vals.text, "auto", vals.dec), { dec: vals.dec });
      let book; mutate(() => { book = newBook("Pasted", cols); P.open.push(book.id); P.active = book.id; }, { books: [] }); syncBook(book);
    },
  });
}
function newBookCmd() { let b; mutate(() => { b = newBook(); P.open.push(b.id); P.active = b.id; }, { books: [] }); syncBook(b); }

/* ================================================================== samples */
const SAMPLES = [
  ["co_oxidation_conversion.csv", I18("CO conversion theo nhiệt độ"), "linesymbol", { palette: "pastel", xaxis: { label: "Temperature [$^{o}$C]", min: 30, max: 140, step: 20 }, yaxis: { label: "CO conversion efficiency [%]", min: -10, max: 110, step: 20 }, legend: { loc: [0.03, 0.97] } }],
  ["co_oxidation_rate.csv", I18("Tốc độ CO (cột gradient)"), "column", { opts: { gradient: "#F2A0A0,#F0D9A0", value_labels: true, value_fmt: "{:.4g}", rotate_x: 30 }, yaxis: { label: "CO conversion rate [mL/min$\\cdot$g$_{cat}$]", min: 0, max: 20, step: 5 }, xaxis: { label: "" }, legend: { show: false }, texts: [{ id: "t1", text: "@ At 90$^{o}$C", x: 0.04, y: 0.95 }] }],
  ["xrd_demo.csv", I18("XRD xếp chồng"), "spectra", {}],
  ["lsv_oer_demo.csv", "LSV OER", "lsv", { opts: { reaction: "OER", ref: "Hg/HgO", pH: 14, current_unit: "mA", area: 0.196, R: 2.5 } }],
  ["cv_scanrate_demo.csv", I18("CV nhiều tốc độ quét"), "cv", { opts: { ref: "RHE", current_unit: "mA/cm2" } }],
  ["eis_demo.csv", "EIS Nyquist", "nyquist", {}],
  ["bet_demo.csv", "BET isotherm", "bet", {}, ["P_P0", "V_cm3g", "sample"]],
  ["xps_o1s_demo.csv", I18("XPS O 1s (tô peak)"), "xps", { texts: [{ id: "t1", text: "O 1s", x: 0.80, y: 0.62, fontsize: 13, bold: true }] }],
  ["uvvis_demo.csv", "UV-Vis → Tauc", "tauc", { opts: { transition: "direct", xlim: "1.8,4.2" } }],
  ["iris.csv", "Iris (PCA)", "pca", {}],
  ["rnaseq_top20_demo.csv", "RNA-seq heatmap", "heatmap", {}],
];
function renderSamples() {
  $("#samplelist").innerHTML = SAMPLES.map((s, i) => `<div class="exitem sample" data-s="${i}"><span class="ico">＋</span>${esc(s[1])}</div>`).join("");
  $$("#samplelist .exitem").forEach(el => el.onclick = () => openSample(+el.dataset.s));
  $("#welcome").innerHTML = `${I18("<h2>SciPlot Studio</h2><p>Vẽ và chỉnh hình khoa học chuẩn bài báo, chạy hoàn toàn trong trình duyệt. Dữ liệu không rời khỏi máy của bạn.</p>\n    <ol><li><b>File → Nhập dữ liệu</b> (Excel, CSV, TXT) hoặc <b>Dán dữ liệu</b>: dòng tên cột + đơn vị tự thành Long Name / Units.</li>\n    <li>Chọn cột Y trong worksheet (bấm tiêu đề cột) → <b>Plot</b> → loại hình.</li>\n    <li><b>Bấm đúp</b> vào trục, nhãn, chú giải, chữ để chỉnh; <b>kéo</b> chú giải/chữ để di chuyển; <b>F4</b> mở Plot Details.</li>\n    <li><b>File → Xuất hình</b> (PNG/TIFF 600 dpi, PDF/SVG vector) hoặc <b>Edit → Sao chép hình</b> để dán vào PowerPoint.</li></ol>\n    <div class=\"cards\">")}${SAMPLES.slice(0, 6).map((s, i) => `<div class="card" data-s="${i}"><b>${esc(s[1])}${I18("</b><span>Mở dữ liệu mẫu và vẽ</span></div>")}`).join("")}${I18("\n    <div class=\"card\" id=\"wc_import\"><b>Nhập file của bạn</b><span>Excel / CSV / TXT xuất từ thiết bị</span></div></div>\n    <p class=\"wcsupport\">Thấy hữu ích? <a href=\"")}${REPO_URL}${I18("\" target=\"_blank\" rel=\"noopener\">⭐ Star trên GitHub</a> · <a href=\"#\" id=\"wc_cite\">ghi nhận SciPlot trong bài báo của bạn</a></p>")}`;
  { const wc = $("#wc_cite"); if (wc) wc.onclick = e => { e.preventDefault(); citeDialog(); }; }
  $$("#welcome .card[data-s]").forEach(el => el.onclick = () => openSample(+el.dataset.s));
  $("#wc_import").onclick = () => pickFile("import");
}
async function openSample(i) {
  const [file, label, kind, extra, unstackBy] = SAMPLES[i];
  if (!ready) { status(I18("Python đang tải — chờ chấm xanh 'Sẵn sàng' ở góc trên rồi mở lại")); return; }
  try {
    const text = await (await fetch("examples/" + file)).text();
    const { cols } = aoaToCols(textToAoa(text, "auto", "."), { nhdr: 1 });
    let book;
    mutate(() => { book = newBook(file.replace(/\.csv$/, ""), cols); }, { books: [], rebuild: false });
    syncBook(book);
    if (file === "co_oxidation_rate.csv") { book.cols[2].desig = "yEr"; syncBook(book); }
    if (file === "rnaseq_top20_demo.csv") { book.cols[0].desig = "L"; syncBook(book); }
    let target = book;
    const byL = n => (book.cols.find(c => c.lname === n) || {}).name;
    if (unstackBy) target = doUnstack(book, byL(unstackBy[0]), byL(unstackBy[1]), byL(unstackBy[2]), true);
    else if (looksLong(book) && !TABLE_KINDS.has(kind)) target = doUnstack(book, book.cols.find(c => c.desig === "X").name, book.cols.find(c => c.desig === "Y").name, book.cols.find(c => c.desig === "L").name, true);
    plotCmd(kind, target, extra, label);
    // mở luôn workbook số liệu cạnh hình mẫu để thay số trực tiếp
    if (!P.open.includes(target.id)) { const gi = P.open.indexOf(P.active); P.open.splice(gi < 0 ? P.open.length : gi, 0, target.id); }
    renderTabs(); renderExplorer();
    status(`${I18("Đã mở hình mẫu và workbook ")}${target.name}${I18(" — thay số trong worksheet, bấm lại tab hình để xem cập nhật")}`);
  } catch (e) { status(I18("Không mở được dữ liệu mẫu: ") + e.message); console.error(e); }
}

/* ================================================================== plotting commands */
function plotCmd(kind, book, extra = {}, name) {
  book = book || activeBook() || (activeGraph() && byId(activeGraph().book));
  if (!book) { status(I18("Hãy mở hoặc nhập một workbook trước")); return; }
  if (looksLong(book) && !TABLE_KINDS.has(kind) && kind !== "volcano" && kind !== "column") {
    if (confirm(I18("Bảng đang ở dạng dài (cột nhóm + cột X + cột Y). Tách theo nhóm (Unstack) để mỗi mẫu thành một đường?"))) {
      const X = book.cols.find(c => c.desig === "X"), Y = book.cols.find(c => c.desig === "Y"), L = book.cols.find(c => c.desig === "L");
      book = doUnstack(book, X.name, Y.name, L.name, true);
    }
  }
  const S = sstate(book);
  let sel = S.cols.size ? [...S.cols].sort((a, b) => a - b) : [];
  let series = seriesFromSelection(book, sel, kind);
  if (kind === "volcano") {
    const Y = book.cols.filter(c => colIsNumeric(c));
    const fc = Y.find(c => /logfc|log2|fold/i.test(dispName(c))) || Y[0], p = Y.find(c => /fdr|padj|adj|p.?val/i.test(dispName(c))) || Y[1];
    series = fc && p ? [{ x: fc.name, y: p.name }] : [];
  }
  if (!series.length) { status(I18("Chưa có cột Y nào: hãy chọn cột (bấm tiêu đề cột) hoặc đặt kiểu cột Y")); return; }
  const lc = labelCol(book);
  const opts = { ...(DEFAULT_OPTS[kind] || {}), ...(extra.opts || {}) };
  if (lc && ["pca", "heatmap", "volcano"].includes(kind)) opts.label_col = lc;
  let g;
  mutate(() => {
    g = newGraph(kind, book, series, { ...clone(extra), opts });
    if (name) g.name = uniqueName(name.replace(/[^\p{L}\p{N} ]/gu, "").slice(0, 24) || g.name, P.graphs);
    P.open.push(g.id); P.active = g.id;
  });
}
function doUnstack(book, x, y, gcol, silent) {
  if (!ready) { alert(I18("Python đang tải, thử lại sau vài giây")); throw new Error(I18("Python chưa sẵn sàng")); }
  const cols = JSON.parse(py("unstack", book.id, x, y, gcol));
  cols.forEach((c, i) => { c.name = colLetter(i); });
  let nb;
  mutate(() => { nb = newBook(book.name + "_unstack", cols); }, { books: [], rebuild: false });
  syncBook(nb);
  if (!silent) { P.open.push(nb.id); P.active = nb.id; afterChange(); }
  status(`${I18("Đã tách ")}${book.name}${I18(" theo cột nhóm → ")}${nb.name} (${cols.length / 2}${I18(" mẫu)")}`);
  return nb;
}
function unstackDialog() {
  const book = activeBook(); if (!book) return status(I18("Hãy mở một workbook"));
  const opt = book.cols.map(c => [c.name, `${c.name}: ${dispName(c)}`]);
  const g = book.cols.find(c => c.desig === "L"), X = book.cols.find(c => c.desig === "X"), Y = book.cols.find(c => c.desig === "Y");
  dialog({ title: I18("Tách theo nhóm (Unstack)"), fields: [{ k: "g", label: I18("Cột nhóm (tên mẫu)"), t: "sel", opts: opt }, { k: "x", label: I18("Cột X"), t: "sel", opts: opt }, { k: "y", label: I18("Cột Y"), t: "sel", opts: opt }],
    values: { g: g ? g.name : opt[0][0], x: X ? X.name : opt[0][0], y: Y ? Y.name : opt[1] ? opt[1][0] : opt[0][0] }, okText: I18("Tách"),
    onOk: v => doUnstack(book, v.x, v.y, v.g, false) });
}
function formulaDialog() {
  const book = activeBook(); if (!book) return status(I18("Hãy mở một workbook"));
  const j = selectedCols(book)[0]; const c = book.cols[j];
  dialog({ title: `${I18("Set Column Values: cột ")}${c.name}`, fields: [
    { k: "f", label: `${c.name} =`, t: "textarea", help: I18("Ví dụ: col(B)*1000 · col(B)/0.196 · log10(abs(col(B))) · col(A)+0.059*14 · 1240/col(A) · i (số thứ tự dòng). Hàm: sin, cos, exp, ln, log10, sqrt, abs, mean, max, min") },
    { k: "lname", label: "Long Name", t: "text" }, { k: "units", label: "Units", t: "text" }],
    values: { f: c.formula || "", lname: c.lname, units: c.units }, wide: true, okText: I18("Tính"),
    onOk: v => {
      let arr;
      try { arr = JSON.parse(py("set_column_values", book.id, c.name, v.f)); } catch (e) { alert(I18("Công thức lỗi: ") + pyErr(e)); return false; }
      mutate(() => { c.data = arr; c.formula = v.f; c.lname = v.lname; c.units = v.units; if (c.desig === "L" || c.desig === "N") c.desig = "Y"; }, { books: [book] });
    } });
}

/* ================================================================== graph window */
const gview = {};  // id → {sel, hits, axes, natural:{w,h}, results}
function buildGraphWin(g, w) {
  w.innerHTML = `<div class="graphwin"><div class="canvaswrap"><div class="page"><img alt="Graph"><div class="overlay ${tool === "pointer" ? "" : tool}"></div></div></div></div>`;
  const ov = $(".overlay", w);
  $(".canvaswrap", w).addEventListener("wheel", e => {
    if (!(e.ctrlKey || e.metaKey)) return;           // cuộn bình thường = cuộn trang; ⌘/Ctrl + cuộn (hoặc chụm 2 ngón) = zoom hình
    e.preventDefault();
    setZoom(g.id, gV(g.id).zoom * Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 20 ? 0.012 : 0.0022)), e);
  }, { passive: false });
  updateZoomUI(g.id);
  ov.addEventListener("mousedown", e => graphMouseDown(g.id, e));
  ov.addEventListener("dblclick", e => graphDblClick(g.id, e));
  ov.addEventListener("mousemove", e => graphHover(g.id, e));
  ov.addEventListener("mouseleave", () => { $("#coords").textContent = ""; });
  ov.addEventListener("contextmenu", e => graphContext(g.id, e));
}
const ZMIN = 0.25, ZMAX = 6, ZSTEPS = [25, 50, 75, 100, 125, 150, 200, 300, 400, 600];
function gV(id) { return gview[id] || (gview[id] = { sel: null, zoom: 1, dpi: 110 * DPR, css: 1 / DPR }); }
const renderDpi = z => Math.round(Math.min(450, Math.max(72, 110 * DPR * z)));
function setZoom(id, z, anchorEvt) {
  const V = gV(id), w = $(`.win[data-id="${id}"]`); if (!w) return;
  z = Math.min(ZMAX, Math.max(ZMIN, z));
  const wrap = $(".canvaswrap", w), page = $(".page", w), img = $("img", w);
  let ax = null;
  if (anchorEvt && img.naturalWidth) { const r = page.getBoundingClientRect(); ax = [anchorEvt.clientX - r.left, anchorEvt.clientY - r.top, anchorEvt.clientX, anchorEvt.clientY]; }
  const ratio = z / V.zoom;
  V.zoom = z; V.css = 110 * z / V.dpi;
  if (img.naturalWidth) { img.style.width = img.naturalWidth * V.css + "px"; img.style.height = img.naturalHeight * V.css + "px"; drawHits(id); }
  if (ax) { const r2 = page.getBoundingClientRect(); wrap.scrollLeft += (r2.left + ax[0] * ratio) - ax[2]; wrap.scrollTop += (r2.top + ax[1] * ratio) - ax[3]; }
  updateZoomUI(id);
  clearTimeout(V.zt);
  if (Math.abs(renderDpi(z) - V.dpi) > 4) V.zt = setTimeout(() => { const g = byId(id); if (g) renderGraph(g); }, 260);  // vẽ lại sắc nét ở độ phân giải mới
}
function zoomFit(id) {
  const V = gV(id), w = $(`.win[data-id="${id}"]`); const img = $("img", w), wrap = $(".canvaswrap", w);
  if (!img.naturalWidth) return;
  const cw = img.naturalWidth * V.css, ch = img.naturalHeight * V.css;
  setZoom(id, V.zoom * Math.min((wrap.clientWidth - 56) / cw, (wrap.clientHeight - 56) / ch));
}
function updateZoomUI(id) {
  const box = $("#tbzoom"); if (!box) return;
  const g = activeGraph();
  box.classList.toggle("off", !g);
  $$("button,select", box).forEach(el => { el.disabled = !g; });
  if (!g || (id && id !== g.id)) { if (!g) $("select", box).innerHTML = "<option>100%</option>"; return; }
  id = g.id;
  const sel = $("select", box);
  const pct = Math.round(gV(id).zoom * 100);
  sel.innerHTML = (ZSTEPS.includes(pct) ? "" : `<option value="${pct}" selected>${pct}%</option>`) +
    ZSTEPS.map(v => `<option value="${v}" ${v === pct ? "selected" : ""}>${v}%</option>`).join("") + I18('<option value="fit">Vừa khung</option>');
}
let renderBusy = false, renderQueued = null;
function renderGraph(g) {
  const w = $(`.win[data-id="${g.id}"]`); if (!w) return;
  if (!ready) { $(".page", w).style.minWidth = "200px"; return; }
  if (renderBusy) { renderQueued = g; return; }
  renderBusy = true;
  const page = $(".page", w);
  let busy = $(".busy", w); if (!busy) { busy = document.createElement("div"); busy.className = "busy"; busy.textContent = I18("Đang vẽ…"); $(".canvaswrap", w).appendChild(busy); }
  setTimeout(() => {
    try {
      const V = gV(g.id);
      const dpi = renderDpi(V.zoom);
      const out = JSON.parse(py("render_graph", JSON.stringify(g), dpi));
      const img = $("img", page);
      img.onload = () => { V.dpi = dpi; V.css = 110 * V.zoom / dpi; img.style.width = (img.naturalWidth * V.css) + "px"; img.style.height = (img.naturalHeight * V.css) + "px"; drawHits(g.id); };
      img.src = "data:image/png;base64," + out.png;
      V.hits = out.hits; V.axes = out.axes; V.results = out.results;
      const err = $(".gerr", w); if (err) err.remove();
      showResults(out.results, g);
    } catch (e) {
      console.error(e);
      let err = $(".gerr", w); if (!err) { err = document.createElement("div"); err.className = "gerr"; $(".canvaswrap", w).prepend(err); }
      err.textContent = I18("Không vẽ được hình: ") + pyErr(e);
    } finally {
      busy.remove(); renderBusy = false;
      if (renderQueued) { const q = renderQueued; renderQueued = null; if (byId(q.id)) renderGraph(q); }
    }
  }, 10);
}
function pyErr(e) { const s = String(e && e.message || e); return s.trim().split("\n").filter(Boolean).slice(-1)[0] || s; }
function drawHits(id) {
  const V = gview[id]; const w = $(`.win[data-id="${id}"]`); if (!V || !w) return;
  const ov = $(".overlay", w); const sc = gV(id).css;
  const draggable = new Set(["legend", "text"]);
  ov.innerHTML = [...V.hits].sort((a, b) => a.prio - b.prio).map((h, i) =>
    `<div class="hit${draggable.has(h.kind) ? " drag" : ""}${sameHit(V.sel, h) ? " selected" : ""}" data-h="${V.hits.indexOf(h)}" title="${esc(hitTitle(h))}" style="left:${h.box[0] * sc}px;top:${h.box[1] * sc}px;width:${(h.box[2] - h.box[0]) * sc}px;height:${(h.box[3] - h.box[1]) * sc}px;z-index:${h.prio}"></div>`).join("");
}
const sameHit = (a, b) => a && b && a.kind === b.kind && (a.id || a.index || "") === (b.id || b.index || "");
function hitTitle(h) {
  return { plot: I18("Vùng vẽ — bấm đúp: Plot Details"), xaxis: I18("Trục X — bấm đúp để chỉnh"), yaxis: I18("Trục Y — bấm đúp để chỉnh"), y2axis: I18("Trục Y phải — bấm đúp"),
    xlabel: I18("Nhãn trục X — bấm đúp để sửa"), ylabel: I18("Nhãn trục Y — bấm đúp để sửa"), y2label: I18("Nhãn trục Y phải"), title: I18("Tiêu đề"), legend: I18("Chú giải — kéo để di chuyển, bấm đúp để chỉnh"),
    legend_entry: I18("Series — bấm đúp để đổi màu, ký hiệu, nét"), text: I18("Chữ — kéo để di chuyển, bấm đúp để sửa") }[h.kind] || h.kind;
}
function hitAt(id, e) {
  const t = e.target.closest(".hit"); const V = gview[id];
  return t && V ? V.hits[+t.dataset.h] : null;
}
function localXY(id, e) { const ov = $(`.win[data-id="${id}"] .overlay`); const r = ov.getBoundingClientRect(); const c = gV(id).css; return [(e.clientX - r.left) / c, (e.clientY - r.top) / c]; }
function pxToData(id, px, py_, axisKey = "y") {
  const V = gview[id]; const A = V && V.axes && V.axes[0]; if (!A) return null;
  const [x0, y0, x1, y1] = A.box;
  const fx = (px - x0) / (x1 - x0), fy = (y1 - py_) / (y1 - y0);
  const conv = (f, lim, scale) => scale === "log" ? Math.pow(10, Math.log10(lim[0]) + f * (Math.log10(lim[1]) - Math.log10(lim[0]))) : lim[0] + f * (lim[1] - lim[0]);
  return { fx, fy, x: conv(fx, A.xlim, A.xscale), y: conv(fy, axisKey === "y2" && A.y2lim ? A.y2lim : A.ylim, A.yscale), inside: fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1 };
}
const fmtNum = v => Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(3) : (+v.toPrecision(5)).toString();
function graphHover(id, e) {
  const [x, y] = localXY(id, e); const d = pxToData(id, x, y);
  $("#coords").textContent = d && d.inside ? `X = ${fmtNum(d.x)}   Y = ${fmtNum(d.y)}` : "";
}
function graphMouseDown(id, e) {
  if (e.button !== 0) return;
  const g = byId(id); const V = gview[id]; const h = hitAt(id, e);
  const [x, y] = localXY(id, e);
  if (tool === "text" || tool === "hline" || tool === "vline") {
    const d = pxToData(id, x, y); if (!d) return;
    if (tool === "text") {
      textDialog(g, null, { fx: Math.max(0, Math.min(0.98, d.fx)), fy: Math.max(0.02, Math.min(1, d.fy)) });
    } else {
      const val = tool === "hline" ? d.y : d.x;
      mutate(() => { g.reflines = g.reflines || []; g.reflines.push({ id: "r" + Date.now(), orient: tool === "hline" ? "h" : "v", value: +val.toPrecision(5), ls: "dash", color: "#777777", lw: 1 }); });
      status(`${I18("Đã thêm đường ")}${tool === "hline" ? I18("ngang tại Y") : I18("dọc tại X")} = ${fmtNum(val)}${I18(" — bấm đúp vùng vẽ → Plot Details để sửa/xoá")}`);
    }
    setTool("pointer"); return;
  }
  if (tool === "zoom") return startRubber(id, e, x, y);
  V.sel = h ? { kind: h.kind, id: h.id, index: h.index } : null;
  $$(`.win[data-id="${id}"] .hit`).forEach(el => el.classList.toggle("selected", !!h && V.hits[+el.dataset.h] === h));
  if (h && (h.kind === "legend" || h.kind === "text" || (h.kind === "legend_entry"))) {
    const target = h.kind === "legend_entry" ? V.hits.find(k => k.kind === "legend") : h;
    if (target) startDrag(id, e, target, x, y, h.kind === "legend_entry" ? { kind: "legend_entry", index: h.index } : null);
  }
}
function startDrag(id, e, h, x0, y0, clickSel) {
  const w = $(`.win[data-id="${id}"]`); const ov = $(".overlay", w); const sc = gV(id).css;
  const ghost = document.createElement("div"); ghost.className = "ghost"; let moved = false;
  const bw = h.box[2] - h.box[0], bh = h.box[3] - h.box[1];
  const place = (dx, dy) => { ghost.style.left = (h.box[0] + dx) * sc + "px"; ghost.style.top = (h.box[1] + dy) * sc + "px"; ghost.style.width = bw * sc + "px"; ghost.style.height = bh * sc + "px"; };
  const mm = ev => { const [x, y] = localXY(id, ev); const dx = x - x0, dy = y - y0; if (!moved && Math.hypot(dx, dy) * gV(id).css > 3) { moved = true; ov.appendChild(ghost); } if (moved) place(dx, dy); };
  const mu = ev => {
    document.removeEventListener("mousemove", mm); document.removeEventListener("mouseup", mu); ghost.remove();
    if (!moved) return;
    const [x, y] = localXY(id, ev); const A = gview[id].axes[0]; const [ax0, ay0, ax1, ay1] = A.box;
    const L = h.box[0] + (x - x0), T = h.box[1] + (y - y0);
    const fx = +((L - ax0) / (ax1 - ax0)).toFixed(4), fy = +((ay1 - T) / (ay1 - ay0)).toFixed(4);
    const g = byId(id);
    mutate(() => {
      if (h.kind === "legend") { g.legend = g.legend || {}; g.legend.loc = [fx, fy]; }
      else if (String(h.id).startsWith("fit:")) { const si = g.series[+h.id.slice(4)]; if (si) si.fit_pos = [fx, fy]; }
      else if (String(h.id).startsWith("slab:")) { const si = g.series[+h.id.slice(5)]; if (si) si.label_pos = [fx, fy]; }
      else { const t = g.texts.find(t => t.id === h.id); if (t) { t.x = fx; t.y = fy; } }
    });
  };
  document.addEventListener("mousemove", mm); document.addEventListener("mouseup", mu);
}
function startRubber(id, e, x0, y0) {
  const w = $(`.win[data-id="${id}"]`); const ov = $(".overlay", w); const sc = gV(id).css;
  const rb = document.createElement("div"); rb.className = "rubber"; ov.appendChild(rb);
  const mm = ev => { const [x, y] = localXY(id, ev); rb.style.left = Math.min(x, x0) * sc + "px"; rb.style.top = Math.min(y, y0) * sc + "px"; rb.style.width = Math.abs(x - x0) * sc + "px"; rb.style.height = Math.abs(y - y0) * sc + "px"; };
  const mu = ev => {
    document.removeEventListener("mousemove", mm); document.removeEventListener("mouseup", mu); rb.remove();
    const [x, y] = localXY(id, ev);
    if (Math.abs(x - x0) < 6 || Math.abs(y - y0) < 6) return;
    const a = pxToData(id, x0, y0), b = pxToData(id, x, y); const g = byId(id);
    mutate(() => {
      g.xaxis = g.xaxis || {}; g.yaxis = g.yaxis || {};
      g.xaxis.min = +Math.min(a.x, b.x).toPrecision(5); g.xaxis.max = +Math.max(a.x, b.x).toPrecision(5);
      g.yaxis.min = +Math.min(a.y, b.y).toPrecision(5); g.yaxis.max = +Math.max(a.y, b.y).toPrecision(5);
      g.xaxis.step = null; g.yaxis.step = null;
    });
    status(I18("Đã phóng to — Ctrl+R (Rescale) để trở lại"));
  };
  document.addEventListener("mousemove", mm); document.addEventListener("mouseup", mu);
}
function graphDblClick(id, e) {
  const g = byId(id); const h = hitAt(id, e);
  if (!h) return pageDialog(g);
  const map = { xaxis: () => axisDialog("x", g), xlabel: () => axisDialog("x", g, "label"), yaxis: () => axisDialog("y", g), ylabel: () => axisDialog("y", g, "label"),
    y2axis: () => axisDialog("y2", g), y2label: () => axisDialog("y2", g, "label"), legend: () => legendDialog(g), legend_entry: () => plotDetails(g, h.index),
    title: () => titleDialog(g), text: () => String(h.id).startsWith("fit:") ? plotDetails(g, +h.id.slice(4)) : String(h.id).startsWith("slab:") ? sampleLabelDialog(g, +h.id.slice(5)) : textDialog(g, h.id), plot: () => plotDetails(g) };
  (map[h.kind] || (() => plotDetails(g)))();
}
function graphContext(id, e) {
  e.preventDefault(); const g = byId(id); const h = hitAt(id, e); const [x, y] = localXY(id, e); const d = pxToData(id, x, y);
  const items = [
    ["Plot Details…", () => plotDetails(g)], [I18("Trục X…"), () => axisDialog("x", g)], [I18("Trục Y…"), () => axisDialog("y", g)], [I18("Chú giải…"), () => legendDialog(g)],
    ["Trang & khung…", () => pageDialog(g)], "-",
    [I18("Thêm chữ tại đây"), () => d && textDialog(g, null, { fx: d.fx, fy: d.fy })], [I18("Thêm đường ngang tại đây"), () => d && mutate(() => g.reflines.push({ id: "r" + Date.now(), orient: "h", value: +d.y.toPrecision(5), ls: "dash", color: "#777777", lw: 1 }))],
    [I18("Thêm đường dọc tại đây"), () => d && mutate(() => g.reflines.push({ id: "r" + Date.now(), orient: "v", value: +d.x.toPrecision(5), ls: "dash", color: "#777777", lw: 1 }))],
    [g.legend && g.legend.show === false ? I18("Hiện chú giải") : I18("Ẩn chú giải"), () => mutate(() => { g.legend = g.legend || {}; g.legend.show = g.legend.show === false; })],
    [I18("Tiêu đề…"), () => titleDialog(g)], "-", ["Rescale", () => rescale()], [I18("Sao chép hình"), () => copyImage()], [I18("Xuất hình…"), () => exportDialog()],
  ];
  if (h && h.kind === "text" && String(h.id).startsWith("slab:")) { const i = +h.id.slice(5); items.unshift([I18("Sửa tên mẫu…"), () => sampleLabelDialog(g, i)], [I18("Ẩn tên này"), () => mutate(() => { g.series[i].label_hide = true; })], [I18("Đặt lại vị trí"), () => mutate(() => { delete g.series[i].label_pos; })], [I18("Đặt lại vị trí mọi tên mẫu"), () => mutate(() => g.series.forEach(x => { delete x.label_pos; }))], "-"); }
  else if (h && h.kind === "text" && String(h.id).startsWith("fit:")) { const i = +h.id.slice(4); items.unshift([I18("Tuỳ chỉnh fit…"), () => plotDetails(g, i)], [I18("Ẩn phương trình"), () => mutate(() => { g.series[i].fit_eq = false; })], [I18("Xoá đường fit"), () => mutate(() => { clearFit(g.series[i]); })], "-"); }
  else if (h && h.kind === "text") items.unshift([I18("Sửa chữ…"), () => textDialog(g, h.id)], [I18("Xoá chữ này"), () => mutate(() => { g.texts = g.texts.filter(t => t.id !== h.id); })], "-");
  if (["line", "scatter", "linesymbol", "area", "xps"].includes(g.kind)) items.splice(items.length - 4, 0, [I18("Fit tuyến tính / đa thức…"), () => fitDialog(g)]);
  openPopup($("#ctxmenu"), items, e.clientX, e.clientY);
}
function rescale() {
  const g = activeGraph(); if (!g) return;
  mutate(() => { for (const k of ["xaxis", "yaxis", "y2axis"]) if (g[k]) { delete g[k].min; delete g[k].max; } });
  status(I18("Đã rescale các trục"));
}
function deleteSelected() {
  const g = activeGraph(); if (!g) return; const V = gview[g.id]; if (!V || !V.sel) return;
  if (V.sel.kind === "text" && String(V.sel.id).startsWith("slab:")) mutate(() => { g.series[+V.sel.id.slice(5)].label_hide = true; V.sel = null; });
  else if (V.sel.kind === "text" && String(V.sel.id).startsWith("fit:")) mutate(() => { g.series[+V.sel.id.slice(4)].fit_eq = false; V.sel = null; });
  else if (V.sel.kind === "text") mutate(() => { g.texts = g.texts.filter(t => t.id !== V.sel.id); V.sel = null; });
  else if (V.sel.kind === "legend") mutate(() => { g.legend = g.legend || {}; g.legend.show = false; V.sel = null; });
  else if (V.sel.kind === "title") mutate(() => { g.title = ""; V.sel = null; });
}
function nudge(dx, dy) {
  const g = activeGraph(); if (!g) return false; const V = gview[g.id]; if (!V || !V.sel) return false;
  const sid = String(V.sel.id || "");
  if (V.sel.kind === "text" && (sid.startsWith("fit:") || sid.startsWith("slab:"))) {
    const isFit = sid.startsWith("fit:"), key = isFit ? "fit_pos" : "label_pos";
    const si = g.series[+sid.slice(isFit ? 4 : 5)]; const h = V.hits.find(h => h.kind === "text" && h.id === V.sel.id); const A = V.axes[0];
    if (!si || !h) return false;
    mutate(() => { const cur = si[key] || [(h.box[0] - A.box[0]) / (A.box[2] - A.box[0]), (A.box[3] - h.box[1]) / (A.box[3] - A.box[1])]; si[key] = [+(cur[0] + dx).toFixed(4), +(cur[1] + dy).toFixed(4)]; }); return true;
  }
  if (V.sel.kind === "text") { mutate(() => { const t = g.texts.find(t => t.id === V.sel.id); if (t) { t.x = +(t.x + dx).toFixed(4); t.y = +(t.y + dy).toFixed(4); } }); return true; }
  if (V.sel.kind === "legend") {
    const h = V.hits.find(h => h.kind === "legend"); const A = V.axes[0];
    mutate(() => {
      let loc = g.legend && Array.isArray(g.legend.loc) ? g.legend.loc : [(h.box[0] - A.box[0]) / (A.box[2] - A.box[0]), (A.box[3] - h.box[1]) / (A.box[3] - A.box[1])];
      g.legend = g.legend || {}; g.legend.loc = [+(loc[0] + dx).toFixed(4), +(loc[1] + dy).toFixed(4)];
    }); return true;
  }
  return false;
}

/* ================================================================== dialogs */
let dragDlg = null;
function dialog({ title, fields, values, tabs, onOk, onApply, onChange, onOpen, okText = "OK", wide, extra = "", buttons = [] }) {
  const m = $("#modal"); m.className = wide ? "wide" : "";
  const vals = clone(values || {});
  const tabList = tabs || [{ name: null, fields }];
  let tabIdx = 0;
  const body = () => {
    const T = tabList[tabIdx];
    return (tabList.length > 1 ? `<div class="mtabs">${tabList.map((t, i) => `<button data-t="${i}" class="${i === tabIdx ? "on" : ""}">${esc(t.name)}</button>`).join("")}</div>` : "") +
      (T.html ? T.html(vals) : `<div class="fgrid">${T.fields.map(f => fieldHTML(f, vals)).join("")}</div>`) + (tabIdx === 0 ? extra : "");
  };
  m.innerHTML = `<div class="mhd">${esc(title)}${I18("<button class=\"close\" title=\"Đóng\">×</button></div><div class=\"mbody\"></div>\n    <div class=\"mft\">")}${buttons.map((b, i) => `<button class="btn ${b.cls || ""}" data-b="${i}" style="${i === 0 ? "margin-right:auto" : ""}">${esc(b.text)}</button>`).join("")}
    ${onApply ? I18('<button class="btn" data-act="apply">Áp dụng</button>') : ""}${I18("<button class=\"btn\" data-act=\"cancel\">Huỷ</button><button class=\"btn primary\" data-act=\"ok\">")}${esc(okText)}</button></div>`;
  const mb = $(".mbody", m);
  const read = () => { const T = tabList[tabIdx]; if (T.read) T.read(mb, vals); else readFields(mb, T.fields, vals); return vals; };
  const draw = () => {
    mb.innerHTML = body();
    $$(".mtabs button", mb).forEach(b => b.onclick = () => { read(); tabIdx = +b.dataset.t; draw(); });
    const T = tabList[tabIdx];
    if (T.bind) T.bind(mb, vals, draw);
    $$("[data-sw]", mb).forEach(b => b.onclick = () => {
      const k = b.dataset.sw, inp = $(`input[type=color][data-k="${k}"]`, mb); if (!inp) return;
      inp.value = b.dataset.c; const au = $(`[data-auto="${k}"]`, mb); if (au) au.checked = false;
      $$(`[data-sw="${k}"]`, mb).forEach(x => x.classList.toggle("on", x === b));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    });
    $$("[data-gp]", mb).forEach(b => b.onclick = () => {
      const k = b.dataset.gp, [c1, c2] = b.dataset.g.split(",");
      const on = $(`[data-gon="${k}"]`, mb); if (on) on.checked = true;
      $(`[data-g1="${k}"]`, mb).value = c1; $(`[data-g2="${k}"]`, mb).value = c2;
      $$(`[data-gp="${k}"]`, mb).forEach(x => x.classList.toggle("on", x === b));
      on.dispatchEvent(new Event("change", { bubbles: true }));
    });
    $$("[data-pal]", mb).forEach(r => r.addEventListener("change", () => $$(".palrow", mb).forEach(l => l.classList.toggle("on", l.contains(r) && r.checked))));
    $$("input,select,textarea", mb).forEach(el => el.addEventListener("change", () => { read(); if (onChange) onChange(mb, vals); if (T.fields && T.fields.some(f => f.show)) { draw(); } }));
    if (onOpen && tabIdx === 0) onOpen(mb, vals);
  };
  draw();
  const close = () => { $("#modalwrap").hidden = true; document.removeEventListener("keydown", keyh, true); };
  const ok = () => { read(); const r = onOk && onOk(vals); if (r !== false) close(); };
  const keyh = e => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    if (e.key === "Enter" && !e.shiftKey && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "BUTTON") { e.preventDefault(); e.stopPropagation(); ok(); }
  };
  document.addEventListener("keydown", keyh, true);
  $(".close", m).onclick = close;
  $('[data-act="cancel"]', m).onclick = close;
  $('[data-act="ok"]', m).onclick = ok;
  const ap = $('[data-act="apply"]', m); if (ap) ap.onclick = () => { read(); onApply(vals); };
  $$("[data-b]", m).forEach(b => b.onclick = () => { read(); const r = buttons[+b.dataset.b].onClick(vals, close); if (r === "close") close(); });
  $("#modalwrap").hidden = false;
  m.style.transform = "";
  const hd = $(".mhd", m);
  hd.onmousedown = e => { if (e.target.closest("button")) return; dragDlg = { x: e.clientX, y: e.clientY, t: m.style.transform }; const base = (m.style.transform.match(/-?\d+(\.\d+)?/g) || [0, 0]).map(Number);
    const mm = ev => { m.style.transform = `translate(${base[0] + ev.clientX - dragDlg.x}px,${base[1] + ev.clientY - dragDlg.y}px)`; };
    const mu = () => { document.removeEventListener("mousemove", mm); document.removeEventListener("mouseup", mu); };
    document.addEventListener("mousemove", mm); document.addEventListener("mouseup", mu); };
  setTimeout(() => { const f = $("input,select,textarea", mb); if (f) f.focus(); }, 30);
  return { close, vals };
}
function fieldHTML(f, v) {
  if (f.show && !f.show(v)) return "";
  const id = "fd_" + f.k.replace(/\W/g, "_"); const val = v[f.k];
  let input;
  switch (f.t) {
    case "bool": return `<label for="${id}">${esc(f.label)}</label><div><input type="checkbox" id="${id}" data-k="${f.k}" ${val ? "checked" : ""}></div>${f.help ? `<div class="help">${esc(f.help)}</div>` : ""}`;
    case "sel": input = `<select id="${id}" data-k="${f.k}">${f.opts.map(([a, b]) => `<option value="${esc(a)}" ${String(a) === String(val ?? "") ? "selected" : ""}>${esc(b)}</option>`).join("")}</select>`; break;
    case "number": input = `<input type="number" id="${id}" data-k="${f.k}" value="${val ?? ""}" step="${f.step || "any"}" placeholder="${esc(f.ph || I18("tự động"))}">`; break;
    case "color": {
      const rows = typeof f.swatches === "function" ? f.swatches() : f.swatches || [{ name: I18("Bài báo"), colors: PAL.paper.colors }, { name: "NPG-style", colors: PAL.npg.colors }, { name: I18("Trung tính"), colors: NEUTRAL }];
      input = `<div class="pair"><input type="color" id="${id}" data-k="${f.k}" value="${val || f.def || "#000000"}" style="flex:none;width:46px;height:28px;padding:1px">${f.auto ? `<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-auto="${f.k}" ${val ? "" : "checked"}${I18("> tự động</label>")}` : ""}</div>` +
        rows.map(r => `<div class="swrow"><span class="swlab">${esc(r.name)}</span>${r.colors.map(c => `<button type="button" class="swb${String(val).toUpperCase() === c.toUpperCase() ? " on" : ""}" data-sw="${f.k}" data-c="${c}" title="${c}" style="background:${c}"></button>`).join("")}</div>`).join("");
      break;
    }
    case "palette": input = `<div class="pallist">${PALETTE_DEFS.map(p => `<label class="palrow${val === p.id ? " on" : ""}"><input type="radio" name="pal_${f.k}" data-pal="${f.k}" value="${p.id}" ${val === p.id ? "checked" : ""}><span class="palname">${esc(p.name)}</span><span class="strip">${p.colors.map(c => `<i style="background:${c}"></i>`).join("")}</span></label>`).join("")}</div>`; break;
    case "textarea": input = `<textarea id="${id}" data-k="${f.k}">${esc(val ?? "")}</textarea>`; break;
    case "pair": input = `<div class="pair"><input type="number" step="any" data-k="${f.k}" data-i="0" value="${val && val[0] != null ? val[0] : ""}"><input type="number" step="any" data-k="${f.k}" data-i="1" value="${val && val[1] != null ? val[1] : ""}"></div>`; break;
    case "gradient": input = `<div class="pair"><label style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-gon="${f.k}" ${val ? "checked" : ""}${I18("> bật</label><input type=\"color\" data-g1=\"")}${f.k}" value="${(val || "#F2A0A0,#F0D9A0").split(",")[0]}" style="flex:none;width:46px;height:28px;padding:1px"><input type="color" data-g2="${f.k}" value="${(val || "#F2A0A0,#F0D9A0").split(",")[1]}" style="flex:none;width:46px;height:28px;padding:1px"></div>` +
      `<div class="swrow">${GRADIENTS.map(([n, gg]) => `<button type="button" class="grb${val === gg ? " on" : ""}" data-gp="${f.k}" data-g="${gg}" title="${esc(n)}" style="background:linear-gradient(180deg,${gg})"></button>`).join("")}</div>`; break;
    case "html": return f.html(v);
    default: input = `<input type="text" id="${id}" data-k="${f.k}" value="${esc(val ?? "")}" placeholder="${esc(f.ph || "")}">`;
  }
  return `<label for="${id}">${esc(f.label)}</label><div>${input}</div>${f.help ? `<div class="help">${esc(f.help)}</div>` : ""}`;
}
function readFields(root, fields, v) {
  for (const f of fields) {
    if (f.show && !f.show(v)) continue;
    if (f.t === "pair") { const a = $$(`[data-k="${f.k}"]`, root).map(i => i.value === "" ? null : +i.value); v[f.k] = a.every(x => x === null) ? null : a; continue; }
    if (f.t === "palette") { const r = $(`[data-pal="${f.k}"]:checked`, root); if (r) v[f.k] = r.value; continue; }
    if (f.t === "gradient") { const on = $(`[data-gon="${f.k}"]`, root); if (!on) continue; v[f.k] = on.checked ? `${$(`[data-g1="${f.k}"]`, root).value},${$(`[data-g2="${f.k}"]`, root).value}` : null; continue; }
    const el = $(`[data-k="${f.k}"]`, root); if (!el) continue;
    if (f.t === "bool") v[f.k] = el.checked;
    else if (f.t === "number") v[f.k] = el.value === "" ? null : +el.value;
    else if (f.t === "color") { const au = $(`[data-auto="${f.k}"]`, root); v[f.k] = au && au.checked ? null : el.value; }
    else v[f.k] = el.value;
  }
  return v;
}
const clean = o => { for (const k of Object.keys(o)) if (o[k] === null || o[k] === "" || o[k] === undefined) delete o[k]; return o; };

/* ---- Axis dialog ---- */
function axisDialog(which, g, focus) {
  g = g || activeGraph(); if (!g) return status(I18("Hãy mở một graph"));
  const keys = { x: "xaxis", y: "yaxis", y2: "y2axis" };
  const hasY2 = g.series.some(s => s.y2);
  const vals = {};
  for (const [w, k] of Object.entries(keys)) for (const [a, b] of Object.entries(g[k] || {})) vals[w + "_" + a] = b;
  const F = w => [
    { k: w + "_label", label: I18("Tên trục"), t: "text", ph: I18("tự động (Long Name + Units)"), help: I18("Chỉ số trên: $^{o}$C, cm$^{-2}$ · dưới: g$_{cat}$ · chữ Hy Lạp: $\\eta$, $\\theta$") },
    { k: w + "_label_size", label: I18("Cỡ chữ tên trục"), t: "number", step: 0.5 },
    { k: w + "_label_bold", label: I18("Tên trục in đậm"), t: "bool" },
    { k: w + "_min", label: I18("Từ (From)"), t: "number" }, { k: w + "_max", label: I18("Đến (To)"), t: "number" },
    { k: w + "_step", label: I18("Bước tick chính (Increment)"), t: "number" },
    { k: w + "_minor", label: I18("Số tick phụ giữa 2 tick chính"), t: "sel", opts: [["", "theo theme"], ["0", I18("0 (không có)")], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["9", "9"]] },
    { k: w + "_scale", label: I18("Kiểu thang"), t: "sel", opts: [["linear", "Linear"], ["log", "Log10"]] },
    { k: w + "_reverse", label: I18("Đảo chiều trục"), t: "bool" },
    { k: w + "_tick_dir", label: I18("Hướng tick"), t: "sel", opts: [["", "theo theme"], ["in", I18("vào trong")], ["out", I18("ra ngoài")], ["inout", I18("cả hai")]] },
    { k: w + "_tick_size", label: I18("Cỡ chữ số trên trục"), t: "number", step: 0.5 },
    { k: w + "_decimals", label: I18("Số chữ số thập phân"), t: "number", step: 1, ph: I18("tự động") },
    { k: w + "_hide_ticklabels", label: I18("Ẩn số trên trục"), t: "bool" },
  ];
  const tabs = [{ name: I18("Trục X (dưới)"), fields: F("x") }, { name: I18("Trục Y (trái)"), fields: F("y") }, ...(hasY2 ? [{ name: I18("Trục Y (phải)"), fields: F("y2") }] : [])];
  const apply = v => mutate(() => {
    for (const [w, k] of Object.entries(keys)) {
      const A = {};
      for (const f of F(w)) { const a = f.k.slice(w.length + 1); const val = v[f.k]; if (val !== null && val !== undefined && val !== "" && val !== false) A[a] = f.t === "sel" && a === "minor" ? +val : val; }
      if (A.scale === "linear") delete A.scale;
      g[k] = A;
    }
  });
  const d = dialog({ title: I18("Trục — ") + g.name, tabs, values: vals, onOk: apply, onApply: apply });
  const ti = which === "x" ? 0 : which === "y" ? 1 : 2;
  if (ti) setTimeout(() => { const b = $(`#modal .mtabs button[data-t="${ti}"]`); if (b) b.click(); if (focus === "label") { const f = $(`#modal [data-k="${which}_label"]`); if (f) f.focus(); } }, 0);
  else if (focus === "label") setTimeout(() => { const f = $(`#modal [data-k="x_label"]`); if (f) f.focus(); }, 40);
  return d;
}
function legendDialog(g) {
  g = g || activeGraph(); if (!g) return status(I18("Hãy mở một graph"));
  const L = g.legend || {};
  const v = { show: L.show !== false, fontsize: L.fontsize ?? null, frame: !!L.frame, ncol: L.ncol || 1, title: L.title ?? "", pos: Array.isArray(L.loc) ? "custom" : (L.loc || "") };
  const apply = v => mutate(() => {
    const N = { show: v.show, fontsize: v.fontsize, frame: v.frame, ncol: +v.ncol || 1, title: v.title };
    N.loc = v.pos === "custom" ? (g.legend && g.legend.loc) : (v.pos || null);
    g.legend = clean(N); if (!v.show) g.legend.show = false;
  });
  dialog({ title: I18("Chú giải (Legend)"), values: v, onOk: apply, onApply: apply, fields: [
    { k: "show", label: I18("Hiện chú giải"), t: "bool" }, { k: "fontsize", label: I18("Cỡ chữ"), t: "number", step: 0.5 },
    { k: "frame", label: I18("Có khung viền"), t: "bool" }, { k: "ncol", label: I18("Số cột"), t: "number", step: 1 },
    { k: "title", label: I18("Tiêu đề chú giải"), t: "text" },
    { k: "pos", label: I18("Vị trí"), t: "sel", opts: [["", I18("tự động (best)")], ["custom", I18("vị trí đã kéo")], ["upper left", I18("trên-trái")], ["upper right", I18("trên-phải")], ["lower left", I18("dưới-trái")], ["lower right", I18("dưới-phải")], ["center right", I18("giữa-phải")], ["upper center", I18("trên-giữa")]], help: I18("Có thể kéo chú giải trực tiếp trên hình") },
  ] });
}
function titleDialog(g) {
  g = g || activeGraph(); if (!g) return;
  dialog({ title: I18("Tiêu đề hình"), values: { title: g.title || "" }, fields: [{ k: "title", label: I18("Tiêu đề"), t: "text", help: I18("Để trống để bỏ tiêu đề") }], onOk: v => mutate(() => { g.title = v.title; }) });
}
function textDialog(g, tid, at) {
  g = g || activeGraph(); if (!g) return;
  const t = tid ? g.texts.find(t => t.id === tid) : { text: "", fontsize: null, color: null, bold: false, italic: false };
  dialog({ title: tid ? I18("Sửa chữ") : I18("Thêm chữ"), values: clone(t), okText: tid ? "OK" : I18("Thêm"),
    buttons: tid ? [{ text: I18("Xoá"), cls: "danger", onClick: (v, close) => { mutate(() => { g.texts = g.texts.filter(x => x.id !== tid); }); close(); } }] : [],
    fields: [{ k: "text", label: I18("Nội dung"), t: "textarea", help: I18("Ví dụ: (a) · @ 90 $^{o}$C · j = 10 mA cm$^{-2}$ · $\\eta_{10}$ = 260 mV · xuống dòng bằng Enter") },
      { k: "fontsize", label: I18("Cỡ chữ"), t: "number", step: 0.5 }, { k: "color", label: I18("Màu"), t: "color", auto: true },
      { k: "bold", label: I18("In đậm"), t: "bool" }, { k: "italic", label: I18("In nghiêng"), t: "bool" }],
    onOk: v => {
      if (!v.text.trim()) return;
      mutate(() => {
        if (tid) {
          const t2 = g.texts.find(x => x.id === tid);
          t2.text = v.text; t2.bold = v.bold || undefined; t2.italic = v.italic || undefined;
          for (const k of ["fontsize", "color"]) { if (v[k] === null || v[k] === "") delete t2[k]; else t2[k] = v[k]; }
        }
        else g.texts.push(clean({ id: "t" + Date.now(), x: +(at ? at.fx : 0.05).toFixed(4), y: +(at ? at.fy : 0.95).toFixed(4), ...v, bold: v.bold || undefined, italic: v.italic || undefined }));
      });
    } });
}
function pageDialog(g) {
  g = g || activeGraph(); if (!g) return status(I18("Hãy mở một graph"));
  const th = ["boxed", "boxed-in", "classic", "bw", "minimal"].includes(g.theme) ? g.theme : String(g.theme || "").endsWith("-in") ? "boxed-in" : "boxed";
  const v = { w: g.size[0], h: g.size[1], theme: th, font: g.font, fontsize: g.fontsize, palette: g.palette || "okabe", fw: (g.frame || {}).width ?? null, box: (g.frame || {}).box !== false, title: g.title || "" };
  const apply = v => mutate(() => { g.size = [+v.w || 5, +v.h || 4]; g.theme = v.theme; g.font = v.font; g.fontsize = +v.fontsize || 11; g.palette = v.palette; g.frame = clean({ width: v.fw, box: v.box ? null : false }); if (!v.box) g.frame.box = false; g.title = v.title; });
  dialog({ title: "Trang & khung — " + g.name, values: v, onOk: apply, onApply: apply, fields: [
    { k: "w", label: I18("Rộng (inch)"), t: "number", step: 0.1, help: I18("1 cột bài báo ≈ 3.3 inch, 2 cột ≈ 7 inch") }, { k: "h", label: "Cao (inch)", t: "number", step: 0.1 },
    { k: "theme", label: I18("Kiểu khung"), t: "sel", opts: [["boxed", I18("Khung kín 4 cạnh – tick ra ngoài")], ["boxed-in", I18("Khung kín 4 cạnh – tick vào trong")], ["classic", I18("Chỉ trục trái/dưới")], ["bw", I18("Khung + lưới")], ["minimal", I18("Tối giản")]] },
    { k: "fw", label: I18("Độ dày khung & tick"), t: "number", step: 0.1, ph: "theo theme (1.2)" }, { k: "box", label: I18("Khung kín 4 cạnh"), t: "bool" },
    { k: "font", label: "Font", t: "sel", opts: [["sans", "Sans (Arial / Liberation Sans)"], ["serif", "Serif (Times / Liberation Serif)"]] },
    { k: "fontsize", label: I18("Cỡ chữ chung"), t: "number", step: 0.5 },
    { k: "palette", label: I18("Bảng màu"), t: "palette", help: I18("Đổi bảng màu sẽ đặt lại màu các series chưa chọn màu riêng") },
    { k: "title", label: I18("Tiêu đề"), t: "text" },
  ] });
}
function changeKindDialog() {
  const g = activeGraph(); if (!g) return status(I18("Hãy mở một graph"));
  dialog({ title: I18("Đổi loại hình"), values: { kind: g.kind }, fields: [{ k: "kind", label: I18("Loại hình"), t: "sel", opts: KINDS.map(k => [k.id, k.name]) }],
    onOk: v => mutate(() => { g.kind = v.kind; g.opts = { ...(DEFAULT_OPTS[v.kind] || {}), ...(g.opts.label_col ? { label_col: g.opts.label_col } : {}) }; }) });
}

/* ---- Plot details ---- */
const MARKERS = [["default", I18("mặc định")], ["none", I18("không")], ["circle", I18("● tròn")], ["square", I18("■ vuông")], ["triangle", I18("▲ tam giác")], ["down", I18("▼ tam giác ngược")], ["diamond", "◆ thoi"], ["star", "★ sao"], ["pentagon", I18("⬟ ngũ giác")], ["hexagon", I18("⬢ lục giác")], ["plus", I18("✚ cộng")], ["cross", I18("✖ chéo")]];
const ECHEM = [
  { k: "ref", label: I18("Điện cực so sánh khi đo"), t: "sel", opts: ["RHE", "SHE", "Ag/AgCl", "Ag/AgCl(3M)", "Ag/AgCl(3.5M)", "SCE", "Hg/HgO", "Hg/HgO(0.1M)", "Hg/Hg2SO4"].map(r => [r, r]) },
  { k: "pH", label: "pH", t: "number", step: 0.5, show: v => v.ref && v.ref !== "RHE" },
  { k: "E_ref", label: I18("E°(ref) tự nhập (V)"), t: "number", step: 0.001, ph: I18("dùng giá trị chuẩn") },
  { k: "current_unit", label: I18("Đơn vị cột dòng"), t: "sel", opts: [["mA/cm2", "mA/cm²"], ["mA", "mA"], ["A", "A"], ["uA", "µA"], ["A/cm2", "A/cm²"]] },
  { k: "area", label: I18("Diện tích điện cực (cm²)"), t: "number", step: 0.001, ph: I18("bỏ qua") },
  { k: "R", label: I18("R bù iR (Ω)"), t: "number", step: 0.1, ph: I18("không bù") },
];
const HATCHES = [["", I18("/// (mặc định)")], ["///", I18("/// chéo phải")], ["\\\\\\", I18("\\\\\\ chéo trái")], ["xxx", I18("xxx ô chéo")], ["|||", I18("||| dọc")], ["---", "--- ngang"], ["...", I18("... chấm")], ["ooo", I18("ooo vòng")]];
const KIND_OPTS = {
  xps: [{ k: "peak_fill", label: I18("Tô các peak"), t: "sel", opts: [["gradient", I18("Gradient mờ dần về đường nền")], ["solid", I18("Tô đặc trong suốt")], ["hatch", I18("Gạch chéo (hatch)")], ["none", I18("Chỉ viền, không tô")]] },
    { k: "fill_alpha", label: I18("Độ đậm vùng tô (0–1)"), t: "number", step: 0.05, ph: I18("0.55 gradient / 0.35 đặc") },
    { k: "hatch", label: I18("Kiểu gạch (khi chọn hatch)"), t: "sel", opts: HATCHES.slice(1) },
    { k: "hide_y", label: I18("Ẩn số trục Y (a.u.)"), t: "bool" }],
  column: [{ k: "gradient", label: I18("Tô gradient (trên, dưới)"), t: "gradient" }, { k: "value_labels", label: I18("Ghi giá trị trên cột"), t: "bool" },
    { k: "value_fmt", label: I18("Định dạng số"), t: "text", ph: "{:.4g}", help: I18("{:.2f} = 2 chữ số thập phân") }, { k: "rotate_x", label: I18("Xoay nhãn trục X (độ)"), t: "number" },
    { k: "width", label: I18("Độ rộng nhóm cột (0–1)"), t: "number", step: 0.05, ph: "0.8" }, { k: "edgecolor", label: I18("Màu viền cột"), t: "color", auto: true }],
  spectra: [{ k: "kind", label: I18("Loại phổ"), t: "sel", opts: [["xrd", I18("XRD (2θ)")], ["raman", "Raman"], ["ftir", I18("FTIR (đảo trục)")], ["xps", I18("XPS (đảo trục)")], ["uvvis", "UV-Vis"], ["pl", "PL"]] },
    { k: "normalize", label: I18("Chuẩn hoá mỗi phổ [0,1]"), t: "bool" }, { k: "offset", label: I18("Khoảng cách giữa các phổ"), t: "number", step: 0.05, ph: I18("tự động") },
    { k: "smooth", label: I18("Làm mượt (cửa sổ SG)"), t: "number", step: 2, ph: I18("tắt") },
    { k: "labels", label: I18("Tên mẫu"), t: "sel", opts: [["right", I18("ghi trên đầu phải mỗi phổ (kéo được)")], ["legend", I18("trong chú giải")], ["none", I18("không hiện")]] },
    { k: "label_size", label: I18("Cỡ chữ tên mẫu"), t: "number", step: 0.5, ph: I18("theo hình") },
    { k: "first_on_top", label: I18("Mẫu đầu tiên nằm trên cùng"), t: "bool" },
    { k: "phases", label: I18("Ký hiệu pha (JSON)"), t: "text", ph: '{"CuO":[35.5,38.7]}' }, { k: "hkl", label: I18("Chỉ số hkl"), t: "text", ph: "28.5:(111),33.1:(200)" }],
  lsv: [...ECHEM, { k: "reaction", label: I18("Phản ứng"), t: "sel", opts: [["OER", "OER"], ["HER", "HER"], ["", I18("khác")]] }, { k: "j_mark", label: I18("Tính η tại |j| (mA cm⁻²)"), t: "number", ph: "10" }],
  tafel: [...ECHEM, { k: "reaction", label: I18("Phản ứng"), t: "sel", opts: [["OER", "OER"], ["HER", "HER"]] }, { k: "fit_range", label: I18("Khoảng fit |j| (mA cm⁻²)"), t: "pair" },
    { k: "slope_labels", label: I18("Ghi độ dốc"), t: "sel", opts: [["legend", I18("trong chú giải")], ["text", I18("cạnh đường fit")]] }],
  cv: [...ECHEM], cdl: [{ k: "half", label: I18("Chia đôi (Δj/2)"), t: "bool" }],
  nyquist: [{ k: "lines", label: I18("Nối điểm"), t: "bool" }, { k: "equal", label: I18("Tỉ lệ 1:1"), t: "bool" }, { k: "unit", label: I18("Đơn vị"), t: "text", ph: I18("Ω") }],
  bet: [{ k: "calc", label: I18("Tính S_BET (0.05–0.30)"), t: "bool" }],
  tauc: [{ k: "transition", label: I18("Chuyển mức"), t: "sel", opts: [["direct", I18("trực tiếp (αhν)²")], ["indirect", I18("gián tiếp (αhν)^½")]] }, { k: "fit_range", label: I18("Khoảng fit (eV) vd 3.2,3.4"), t: "text" }, { k: "energy_input", label: I18("Cột X đã là eV"), t: "bool" }],
  box: [{ k: "kind", label: I18("Kiểu"), t: "sel", opts: [["box", "box"], ["violin", "violin"]] }, { k: "points", label: I18("Hiện điểm dữ liệu"), t: "bool" }, { k: "filled", label: I18("Tô đặc"), t: "bool" }, { k: "show_mean", label: I18("Đánh dấu trung bình"), t: "bool" }],
  histogram: [{ k: "bins", label: I18("Số bins"), t: "number", ph: "30" }, { k: "binwidth", label: I18("Độ rộng bin"), t: "number", ph: I18("theo số bins") }, { k: "density", label: I18("Mật độ"), t: "bool" }, { k: "kde", label: I18("Đường KDE"), t: "bool" },
    { k: "multiple", label: I18("Nhiều nhóm"), t: "sel", opts: [["overlay", I18("chồng mờ")], ["stack", I18("xếp chồng")], ["dodge", I18("cạnh nhau")]] }],
  pca: [{ k: "scale", label: I18("Chuẩn hoá"), t: "bool" }, { k: "ellipse", label: I18("Elip tin cậy"), t: "bool" }, { k: "level", label: I18("Mức tin cậy"), t: "number", step: 0.01, ph: "0.95" }, { k: "loadings", label: "Biplot", t: "bool" }],
  heatmap: [{ k: "scale", label: "Scale", t: "sel", opts: [["row", I18("theo hàng")], ["column", I18("theo cột")], ["none", I18("không")]] }, { k: "cluster_rows", label: I18("Phân cụm hàng"), t: "bool" }, { k: "cluster_cols", label: I18("Phân cụm cột"), t: "bool" },
    { k: "cmap", label: I18("Thang màu"), t: "sel", opts: [["navy-white-red", "navy-white-red"], ["blue-white-red", "blue-white-red"], ["pheatmap", "pheatmap"], ["viridis", "viridis"], ["magma", "magma"]] },
    { k: "cutree_rows", label: I18("Tách hàng thành … cụm"), t: "number" }, { k: "cutree_cols", label: I18("Tách cột thành … cụm"), t: "number" }, { k: "show_values", label: I18("Ghi giá trị"), t: "bool" }],
  volcano: [{ k: "fc_thr", label: I18("Ngưỡng |log2FC|"), t: "number", ph: "1" }, { k: "p_thr", label: I18("Ngưỡng p"), t: "number", ph: "0.05" }, { k: "top", label: I18("Số gene gắn nhãn"), t: "number", ph: "10" }],
};
const FIT_TYPES = [["", I18("không")], ["linear", I18("Tuyến tính  y = ax + b")], ["linear0", I18("Tuyến tính qua gốc  y = ax")], ["poly2", I18("Đa thức bậc 2")], ["poly3", I18("Đa thức bậc 3")]];
const FIT_FIELDS = p => [
  { k: p + "fit", label: I18("Fit (hồi quy)"), t: "sel", opts: FIT_TYPES },
  { k: p + "fit_from", label: I18("Fit từ X ="), t: "number", ph: I18("đầu dữ liệu"), show: v => v[p + "fit"] },
  { k: p + "fit_to", label: I18("đến X ="), t: "number", ph: I18("cuối dữ liệu"), show: v => v[p + "fit"] },
  { k: p + "fit_eq", label: I18("Ghi phương trình và R² lên hình"), t: "bool", show: v => v[p + "fit"] },
  { k: p + "fit_extend", label: I18("Kéo dài đường fit hết trục X"), t: "bool", show: v => v[p + "fit"] },
  { k: p + "fit_color", label: I18("Màu đường fit"), t: "color", auto: true, show: v => v[p + "fit"] },
  { k: p + "fit_ls", label: I18("Kiểu nét fit"), t: "sel", opts: [["solid", I18("liền —")], ["dash", I18("đứt – –")], ["dot", I18("chấm ···")]], show: v => v[p + "fit"] },
  { k: p + "fit_lw", label: I18("Độ dày nét fit"), t: "number", step: 0.1, ph: "1.4", show: v => v[p + "fit"] },
  { k: p + "fit_size", label: I18("Cỡ chữ phương trình"), t: "number", step: 0.5, ph: I18("theo hình"), show: v => v[p + "fit"] },
];
const FIT_KEYS = ["fit", "fit_from", "fit_to", "fit_eq", "fit_extend", "fit_color", "fit_ls", "fit_lw", "fit_size", "fit_pos"];
function clearFit(s) { for (const k of FIT_KEYS) delete s[k]; }
function sampleLabelDialog(g, i) {
  const s0 = g.series[i]; if (!s0) return;
  const book = byId(g.book); const col = book.cols.find(c => c.name === s0.y) || { name: s0.y };
  const v = { label: s0.label || "", label_size: s0.label_size ?? null, label_color: s0.label_color || null, label_bold: !!s0.label_bold, show: !s0.label_hide };
  dialog({ title: I18("Tên mẫu"), values: v, fields: [
    { k: "label", label: I18("Nội dung"), t: "text", ph: dispName(col), help: I18("Để trống = theo Long Name của cột. Chỉ số: CeO$_2$, Cu$^{2+}$") },
    { k: "label_size", label: I18("Cỡ chữ"), t: "number", step: 0.5, ph: I18("theo hình") },
    { k: "label_color", label: I18("Màu"), t: "color", auto: true, swatches: () => [{ name: I18("Bài báo"), colors: PAL.paper.colors }, { name: I18("Trung tính"), colors: NEUTRAL }] },
    { k: "label_bold", label: I18("In đậm"), t: "bool" }, { k: "show", label: I18("Hiện tên này"), t: "bool" }],
    buttons: [{ text: I18("Đặt lại vị trí"), onClick: (vv, close) => { mutate(() => { delete s0.label_pos; }); close(); } }],
    extra: I18('<p class="note">Kéo tên mẫu trên hình để di chuyển, hoặc bấm chọn rồi dùng phím mũi tên để nhích (Shift = bước lớn).</p>'),
    onOk: vv => mutate(() => {
      for (const [k, val] of [["label", vv.label], ["label_size", vv.label_size], ["label_color", vv.label_color]]) { if (val === null || val === "") delete s0[k]; else s0[k] = val; }
      if (vv.label_bold) s0.label_bold = true; else delete s0.label_bold;
      if (vv.show) delete s0.label_hide; else s0.label_hide = true;
    }) });
}
function fitDialog(g) {
  g = g || activeGraph(); if (!g) return status(I18("Hãy mở một graph trước"));
  if (!["line", "scatter", "linesymbol", "area", "xps"].includes(g.kind)) {
    if (!confirm(`${I18("Fit dùng cho hình Scatter / Line / Line + Symbol. Đổi \"")}${g.name}" (${kindName(g.kind)}${I18(") sang Scatter để fit?")}`)) return;
    mutate(() => { g.kind = "scatter"; g.opts = {}; });
  }
  const book = byId(g.book);
  const nm = s => s.label || dispName(book.cols.find(c => c.name === s.y) || { name: s.y });
  const first = g.series.find(s => s.fit) || {};
  const v = { fit: first.fit || "linear", fit_from: first.fit_from ?? null, fit_to: first.fit_to ?? null, fit_eq: first.fit_eq !== false, fit_extend: !!first.fit_extend,
    fit_color: first.fit_color || null, fit_ls: first.fit_ls || "solid", fit_lw: first.fit_lw ?? null, fit_size: first.fit_size ?? null };
  g.series.forEach((s, i) => { v["s_" + i] = g.series.length === 1 || !!s.fit || !g.series.some(x => x.fit); });
  dialog({ title: "Fit — " + g.name, values: v, okText: "Fit", fields: [
    ...g.series.map((s, i) => ({ k: "s_" + i, label: "Series: " + nm(s), t: "bool" })),
    ...FIT_FIELDS("").map(f => f.k === "fit" ? { ...f, label: I18("Kiểu fit"), opts: FIT_TYPES.map(o => o[0] ? o : ["", I18("bỏ fit")]) } : { ...f, show: vv => vv.fit }),
  ], extra: I18('<p class="note">Kết quả a, b, sai số chuẩn (SE), R² hiện ở khung Kết quả tính bên dưới, và đưa được vào workbook. Phương trình trên hình kéo đi được; bấm đúp để chỉnh.</p>'),
    onOk: vals => mutate(() => {
      g.series.forEach((s, i) => {
        if (!vals["s_" + i]) return;
        if (!vals.fit) { clearFit(s); return; }
        for (const k of FIT_KEYS) if (k !== "fit_pos") { const x = vals[k]; if (x === null || x === "" || x === undefined) delete s[k]; else s[k] = x; }
        if (s.fit_eq === true) delete s.fit_eq;
        if (!s.fit_extend) delete s.fit_extend;
      });
    }) });
}
const BOOL_DEFAULTS = { hide_y: true, normalize: true, calc: true, lines: true, equal: true, scale: true, ellipse: true, points: true, cluster_rows: true, cluster_cols: true };
function plotDetails(g, focusIndex) {
  g = g || activeGraph(); if (!g) return status(I18("Hãy mở một graph"));
  const book = byId(g.book);
  const work = clone(g);
  let cur = Math.min(focusIndex ?? 0, Math.max(0, work.series.length - 1));
  work.palette = work.palette || "paper";
  const curPal = () => palColors(work.palette, work.series.length);
  const colOpts = (none) => [...(none ? [["", I18("— không —")]] : []), ...book.cols.map(c => [c.name, `${c.name}: ${dispName(c)}`])];
  const generic = ["line", "scatter", "linesymbol", "area", "column", "xps"].includes(g.kind);
  const lineish = generic && g.kind !== "column";
  const SF = [
    { k: "label", label: I18("Tên trong chú giải"), t: "text", ph: "theo Long Name" },
    { k: "y", label: I18("Cột Y"), t: "sel", opts: colOpts(false) }, ...(TABLE_KINDS.has(g.kind) ? [] : [{ k: "x", label: I18("Cột X"), t: "sel", opts: colOpts(true) }]),
    ...(generic ? [{ k: "yerr", label: I18("Cột sai số Y"), t: "sel", opts: colOpts(true) }] : []),
    ...(g.kind === "xps" ? [{ k: "role", label: I18("Vai trò (XPS)"), t: "sel", opts: [["", I18("tự nhận theo tên cột")], ["raw", I18("Raw (dữ liệu đo)")], ["bg", "Background"], ["env", I18("Envelope (tổng fit)")], ["peak", I18("Peak thành phần")]] }] : []),
    { k: "color", label: I18("Màu"), t: "color", auto: true, swatches: () => [{ name: I18("Bảng màu hình"), colors: [...new Set(curPal())] }, { name: I18("Bài báo"), colors: PAL.paper.colors }, { name: "NPG-style", colors: PAL.npg.colors }, { name: I18("Trung tính"), colors: NEUTRAL }] },
    ...(generic && g.kind !== "column" ? [
      { k: "marker", label: I18("Ký hiệu (Symbol)"), t: "sel", opts: MARKERS }, { k: "ms", label: I18("Cỡ ký hiệu"), t: "number", step: 0.5, ph: "6" },
      { k: "mew", label: I18("Độ dày viền ký hiệu"), t: "number", step: 0.1, ph: I18("tự động (≈ 0.7 × độ dày nét)") },
      { k: "mec", label: I18("Màu viền ký hiệu"), t: "color", auto: true, swatches: () => [{ name: I18("Trung tính"), colors: NEUTRAL }, { name: I18("Bảng màu hình"), colors: [...new Set(curPal())] }] },
      { k: "fill", label: I18("Tô ký hiệu"), t: "sel", opts: [["", I18("mặc định")], ["solid", I18("đặc")], ["hollow", I18("rỗng (nền trắng)")], ["none", I18("trong suốt")]] },
      { k: "ls", label: I18("Kiểu nét"), t: "sel", opts: [["", I18("mặc định")], ["solid", I18("liền —")], ["dash", I18("đứt – –")], ["dot", I18("chấm ···")], ["dashdot", I18("gạch chấm –·")], ["none", I18("không nối")]] }] : []),
    ...(g.kind !== "column" ? [{ k: "lw", label: I18("Độ dày nét"), t: "number", step: 0.1, ph: "1.6" }] : []),
    ...(generic ? [{ k: "alpha", label: I18("Độ đậm (0–1)"), t: "number", step: 0.05, ph: "1" }, { k: "capsize", label: I18("Đầu thanh sai số"), t: "number", step: 0.5, ph: "3" }] : []),
    ...(generic && g.kind !== "column" ? [{ k: "y2", label: I18("Vẽ theo trục Y bên phải"), t: "bool" }] : []),
    ...(lineish ? [
      { k: "fill_mode", label: I18("Tô vùng dưới đường"), t: "sel", opts: [["", g.kind === "xps" ? I18("theo tuỳ chọn XPS") : g.kind === "area" ? I18("đặc (mặc định Area)") : I18("không tô")], ["solid", I18("Tô đặc trong suốt")], ["gradient", I18("Gradient mờ dần về đường nền")], ["hatch", I18("Gạch chéo (hatch)")], ["none", I18("Không tô")]] },
      { k: "fill_to", label: I18("Tô xuống tới"), t: "sel", opts: [["", g.kind === "xps" ? I18("Background (tự nhận)") : I18("trục 0")], ...colOpts(false)] },
      { k: "fill_color", label: I18("Màu tô"), t: "color", auto: true, swatches: () => [{ name: I18("Bảng màu hình"), colors: [...new Set(curPal())] }, { name: I18("Bài báo"), colors: PAL.paper.colors }] },
      { k: "fill_alpha", label: I18("Độ đậm vùng tô (0–1)"), t: "number", step: 0.05, ph: "0.35–0.55" },
      { k: "hatch", label: I18("Kiểu gạch"), t: "sel", opts: HATCHES }] : []),
    ...(lineish ? FIT_FIELDS("") : []),
    { k: "visible", label: I18("Hiện series này"), t: "bool" },
  ];
  const KO = KIND_OPTS[g.kind] || [];
  const ovals = { ...Object.fromEntries(KO.filter(f => f.t === "bool").map(f => [f.k, BOOL_DEFAULTS[f.k] ?? false])), ...work.opts };
  const seriesTab = {
    name: "Series (Plot)",
    html: () => {
      const s = work.series[cur] || {};
      const sv = { visible: true, marker: "default", fit_eq: true, ...s };
      const pal = curPal();
      return `${I18("<div class=\"pdgrid\"><div><label class=\"note\" style=\"display:block;margin:0 0 3px\">Bảng màu cho cả hình</label><select data-pdpal style=\"width:100%;margin-bottom:4px\">")}${PALETTE_DEFS.map(p => `<option value="${p.id}" ${p.id === work.palette ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        <div class="strip big" style="margin-bottom:8px">${palColors(work.palette, Math.max(work.series.length, PAL[work.palette] && PAL[work.palette].seq ? work.series.length : 8)).map(c => `<i style="background:${c}"></i>`).join("")}</div>
        <div class="slist">${work.series.map((x, i) => `<div class="si${i === cur ? " on" : ""}" data-i="${i}"><span class="sw" style="background:${x.color || pal[i % pal.length]}"></span>${esc(plainMath(x.label || dispName(book.cols.find(c => c.name === x.y) || { name: x.y })))}${work.series.some((o, j) => j !== i && o.y === x.y) ? I18(' <span title="Series này trùng cột với series khác — đổi Cột Y" style="color:#b00020">⚠</span>') : ""}</div>`).join("") || I18('<div class="si">(chưa có series)</div>')}${I18("</div>\n        <div class=\"sbtns\"><button class=\"btn\" data-sa=\"add\">+ Thêm</button><button class=\"btn\" data-sa=\"del\">Xoá</button><button class=\"btn\" data-sa=\"up\">▲</button><button class=\"btn\" data-sa=\"down\">▼</button></div>\n        <div class=\"sbtns\"><button class=\"btn\" data-sa=\"applyall\" title=\"Áp kiểu ký hiệu/nét/cỡ của series này cho mọi series\">Áp kiểu cho tất cả</button></div></div>\n        <div>")}${work.series.length ? `<div class="fgrid">${SF.map(f => fieldHTML(f, sv)).join("")}</div>` : ""}</div></div>`;
    },
    read: (root) => { const s = work.series[cur]; if (!s) return; const v = readFields(root, SF, { ...s }); Object.assign(s, v); for (const k of Object.keys(s)) if (s[k] === "" || s[k] === null || s[k] === undefined) delete s[k]; if (!s.y2) delete s.y2; if (s.visible !== false) delete s.visible; if (s.marker === "default") delete s.marker; if (!s.fit) { for (const k of FIT_KEYS) delete s[k]; } else if (s.fit_eq === true) delete s.fit_eq; if (s.fit_extend === false) delete s.fit_extend; },
    bind: (root, _v, redraw) => {
      const fsel = $('[data-k="fit"]', root); if (fsel) fsel.addEventListener("change", () => { seriesTab.read(root); redraw(); });
      const ps = $("[data-pdpal]", root); if (ps) ps.onchange = () => { seriesTab.read(root); work.palette = ps.value; work.series.forEach(x => { delete x.color; }); redraw(); status(I18("Đã đổi bảng màu — màu từng series đặt lại theo bảng mới")); };
      $$(".si[data-i]", root).forEach(el => el.onclick = () => { seriesTab.read(root); cur = +el.dataset.i; redraw(); });
      $$("[data-sa]", root).forEach(b => b.onclick = () => {
        seriesTab.read(root);
        const a = b.dataset.sa;
        if (a === "add") {
          const yc = book.cols.find(c => c.desig === "Y" && !work.series.some(s => s.y === c.name)) || book.cols.find(c => colIsNumeric(c) && c.desig !== "X" && !work.series.some(s => s.y === c.name));
          if (!yc) { alert(I18("Mọi cột số trong workbook đã được vẽ. Thêm cột mới vào workbook trước, hoặc đổi 'Cột Y' của một series.")); return; }
          let x = null; const yi = book.cols.indexOf(yc); for (let k = yi - 1; k >= 0; k--) if (book.cols[k].desig === "X") { x = book.cols[k].name; break; }
          work.series.push({ x: x || (work.series[cur] || {}).x, y: yc.name }); cur = work.series.length - 1;
        }
        if (a === "del" && work.series.length) { work.series.splice(cur, 1); cur = Math.max(0, cur - 1); }
        if (a === "up" && cur > 0) { [work.series[cur - 1], work.series[cur]] = [work.series[cur], work.series[cur - 1]]; cur--; }
        if (a === "down" && cur < work.series.length - 1) { [work.series[cur + 1], work.series[cur]] = [work.series[cur], work.series[cur + 1]]; cur++; }
        if (a === "applyall") { const s = work.series[cur]; for (const o of work.series) for (const k of ["marker", "ms", "mew", "mec", "fill", "ls", "lw", "alpha", "capsize"]) if (s[k] !== undefined) o[k] = s[k]; else delete o[k]; status(I18("Đã áp kiểu cho mọi series")); }
        redraw();
      });
    },
  };
  const optTab = { name: I18("Tuỳ chọn ") + kindName(g.kind), fields: KO };
  const refTab = {
    name: I18("Đường tham chiếu"),
    html: () => `<div class="fgrid">${(work.reflines || []).map((r, i) => `<label>${r.orient === "h" ? I18("Ngang tại Y =") : I18("Dọc tại X =")}</label><div class="pair"><input type="number" step="any" data-rv="${i}" value="${r.value}"><select data-rs="${i}">${[["dash", I18("đứt")], ["solid", I18("liền")], ["dot", I18("chấm")]].map(([a, b]) => `<option value="${a}" ${r.ls === a ? "selected" : ""}>${b}</option>`).join("")}</select><input type="color" data-rc="${i}" value="${r.color || "#777777"}" style="flex:none;width:40px"><button class="btn danger" data-rd="${i}${I18("\">Xoá</button></div>")}`).join("") || I18('<div class="full note">Chưa có. Dùng công cụ đường ngang/dọc trên thanh công cụ, hoặc bấm nút dưới.</div>')}${I18("\n      <div class=\"full sbtns\"><button class=\"btn\" data-ra=\"h\">+ Đường ngang</button><button class=\"btn\" data-ra=\"v\">+ Đường dọc</button></div></div>")}`,
    read: root => { (work.reflines || []).forEach((r, i) => { const v = $(`[data-rv="${i}"]`, root); if (v) { r.value = +v.value; r.ls = $(`[data-rs="${i}"]`, root).value; r.color = $(`[data-rc="${i}"]`, root).value; } }); },
    bind: (root, _v, redraw) => {
      $$("[data-rd]", root).forEach(b => b.onclick = () => { refTab.read(root); work.reflines.splice(+b.dataset.rd, 1); redraw(); });
      $$("[data-ra]", root).forEach(b => b.onclick = () => { refTab.read(root); work.reflines = work.reflines || []; work.reflines.push({ id: "r" + Date.now(), orient: b.dataset.ra, value: 0, ls: "dash", color: "#777777", lw: 1 }); redraw(); });
    },
  };
  const tabs = [seriesTab, ...(KO.length ? [optTab] : []), ...(generic || ["lsv", "tafel", "cv", "spectra", "bet", "tauc", "cdl", "nyquist"].includes(g.kind) ? [refTab] : [])];
  const commit = v => mutate(() => {
    g.series = work.series; g.reflines = work.reflines || []; g.palette = work.palette;
    const o = { ...v }; for (const k of Object.keys(o)) if (o[k] === null || o[k] === "") delete o[k];
    if (work.opts.label_col) o.label_col = work.opts.label_col;
    g.opts = o;
  });
  dialog({ title: "Plot Details — " + g.name, tabs, values: ovals, wide: true, onOk: v => { commit(v); }, onApply: v => { commit(v); } });
}

/* ================================================================== format copy / templates */
const STYLE_KEYS = ["theme", "font", "fontsize", "palette", "size", "frame"];  // template có palette sẽ đặt lại màu series
function styleOf(g) {
  const st = Object.fromEntries(STYLE_KEYS.map(k => [k, clone(g[k])]));
  const ax = a => { const o = clone(a || {}); delete o.min; delete o.max; delete o.label; return o; };
  st.xaxis = ax(g.xaxis); st.yaxis = ax(g.yaxis); st.y2axis = ax(g.y2axis);
  st.legend = clone(g.legend || {});
  st.series = g.series.map(s => Object.fromEntries(["color", "marker", "ms", "mew", "mec", "fill", "ls", "lw", "alpha", "capsize"].filter(k => s[k] !== undefined).map(k => [k, s[k]])));
  return st;
}
function applyStyle(g, st) {
  for (const k of STYLE_KEYS) if (st[k] !== undefined) g[k] = clone(st[k]);
  for (const k of ["xaxis", "yaxis", "y2axis"]) g[k] = { ...(g[k] || {}), ...clone(st[k] || {}) };
  g.legend = { ...(g.legend || {}), ...clone(st.legend || {}) };
  if (st.palette && !(st.series && st.series.length)) g.series.forEach(s => { delete s.color; });
  g.series.forEach((s, i) => { const ss = st.series && st.series.length ? st.series[i % st.series.length] : {}; Object.assign(s, clone(ss)); });
}
let copiedFormat = null;
function copyFormat() { const g = activeGraph(); if (!g) return status(I18("Hãy mở một graph")); copiedFormat = styleOf(g); status(`${I18("Đã sao chép định dạng của ")}${g.name}${I18(" — mở hình khác rồi chọn Graph → Paste Format")}`); }
function pasteFormat() { const g = activeGraph(); if (!g || !copiedFormat) return status(copiedFormat ? I18("Hãy mở graph cần dán") : I18("Chưa sao chép định dạng nào")); mutate(() => applyStyle(g, copiedFormat)); status(I18("Đã dán định dạng")); }
function loadTemplates() { try { return JSON.parse(localStorage.getItem("sciplot.templates") || "{}"); } catch (e) { return {}; } }
function saveTemplate() {
  const g = activeGraph(); if (!g) return status(I18("Hãy mở một graph"));
  const name = prompt(I18("Tên template (vd: Bài báo 1 cột):"), g.name); if (!name) return;
  const T = loadTemplates(); T[name] = styleOf(g);
  try { localStorage.setItem("sciplot.templates", JSON.stringify(T)); status(`${I18("Đã lưu template \"")}${name}${I18("\" trên trình duyệt này")}`); } catch (e) { status(I18("Không lưu được template (bộ nhớ trình duyệt bị chặn)")); }
}
function applyTemplateDialog() {
  const g = activeGraph(); if (!g) return status(I18("Hãy mở một graph"));
  const T = loadTemplates(); const names = Object.keys(T);
  const builtin = { "Bài báo 1 cột (3.3 × 2.6 in, sans 8)": { size: [3.3, 2.6], fontsize: 8, font: "sans", theme: "boxed", frame: { width: 1 } },
    "Bài báo 2 cột (7 × 4 in, sans 10)": { size: [7, 4], fontsize: 10, font: "sans", theme: "boxed" },
    "Slide PowerPoint (6 × 4.5 in, chữ 16)": { size: [6, 4.5], fontsize: 16, font: "sans", theme: "boxed", frame: { width: 1.6 } },
    "Kiểu Times, tick vào trong": { font: "serif", theme: "boxed-in" },
    "Khổ 1 cột 89 mm (sans 7 pt, NPG-style)": { size: [3.5, 2.8], fontsize: 7, font: "sans", theme: "boxed", frame: { width: 0.8 }, palette: "npg" },
    "Khổ 2 cột 183 mm (sans 7 pt)": { size: [7.2, 4.2], fontsize: 7, font: "sans", theme: "boxed", frame: { width: 0.8 }, palette: "npg" },
    "Khổ 1 cột 3.25 in (sans 8 pt, pastel bài báo)": { size: [3.25, 2.7], fontsize: 8, font: "sans", theme: "boxed", frame: { width: 1 }, palette: "paper" },
    "Khổ 2 cột 7 in (sans 9 pt)": { size: [7, 4.2], fontsize: 9, font: "sans", theme: "boxed", frame: { width: 1 }, palette: "paper" } };
  const all = { ...builtin, ...T };
  dialog({ title: I18("Áp dụng template"), values: { t: Object.keys(all)[0] }, fields: [{ k: "t", label: "Template", t: "sel", opts: Object.keys(all).map(n => [n, T[n] ? "★ " + n : I18(n)]) }],
    extra: names.length ? "" : I18('<p class="note">Lưu template của riêng bạn: Graph → Lưu làm template.</p>'),
    buttons: names.length ? [{ text: I18("Xoá template đã chọn"), cls: "danger", onClick: v => { if (!T[v.t]) return; delete T[v.t]; try { localStorage.setItem("sciplot.templates", JSON.stringify(T)); } catch (e) { } return "close"; } }] : [],
    onOk: v => mutate(() => applyStyle(g, { ...all[v.t], series: all[v.t].series || [] })) });
}

/* ================================================================== export */
function download(b64, mime, name) {
  const bin = atob(b64), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  downloadBlob(new Blob([arr], { type: mime }), name);
}
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob); const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
const MIME = { png: "image/png", pdf: "application/pdf", svg: "image/svg+xml", tiff: "image/tiff" };
function exportDialog() {
  const g = activeGraph(); if (!g) return status(I18("Hãy mở một graph để xuất"));
  dialog({ title: I18("Xuất hình — ") + g.name, values: { fmt: "png", dpi: 600, tr: false, name: g.name }, okText: I18("Xuất"),
    fields: [{ k: "fmt", label: I18("Định dạng"), t: "sel", opts: [["png", I18("PNG (ảnh)")], ["tiff", I18("TIFF (tạp chí yêu cầu)")], ["pdf", "PDF (vector)"], ["svg", I18("SVG (vector, sửa được)")]] },
      { k: "dpi", label: I18("Độ phân giải (dpi)"), t: "sel", opts: [["300", "300"], ["600", "600"], ["1200", "1200"]] }, { k: "tr", label: I18("Nền trong suốt"), t: "bool" }, { k: "name", label: I18("Tên file"), t: "text" }],
    onOk: v => { try { download(py("export_graph", JSON.stringify(g), v.fmt, +v.dpi, v.tr), MIME[v.fmt], `${v.name || g.name}.${v.fmt === "tiff" ? "tif" : v.fmt}`); status(I18("Đã xuất ") + v.fmt.toUpperCase()); nudgeSupport(); } catch (e) { alert(I18("Lỗi xuất hình: ") + pyErr(e)); } } });
}
function panelDialog() {
  if (!P.graphs.length) return status(I18("Chưa có graph nào"));
  const v = { ncol: Math.min(2, P.graphs.length), tags: "(a)", fmt: "pdf", dpi: 600, name: "Figure" };
  P.graphs.forEach(g => { v["g_" + g.id] = true; });
  dialog({ title: I18("Ghép nhiều hình thành 1 figure"), values: v, okText: I18("Xuất figure"), fields: [
    ...P.graphs.map(g => ({ k: "g_" + g.id, label: g.name, t: "bool" })),
    { k: "ncol", label: I18("Số cột"), t: "number", step: 1 }, { k: "tags", label: I18("Nhãn"), t: "sel", opts: [["(a)", "(a) (b) (c)"], ["a", "a b c"], ["A", "A B C"], ["", I18("không")]] },
    { k: "fmt", label: I18("Định dạng"), t: "sel", opts: [["pdf", "PDF"], ["png", "PNG"], ["tiff", "TIFF"], ["svg", "SVG"]] },
    { k: "dpi", label: "dpi", t: "sel", opts: [["300", "300"], ["600", "600"]] }, { k: "name", label: I18("Tên file"), t: "text" }],
    onOk: v => {
      const gs = P.graphs.filter(g => v["g_" + g.id]); if (!gs.length) return false;
      try { download(py("export_panel", JSON.stringify({ graphs: gs, ncol: +v.ncol || 2, tags: v.tags }), v.fmt, +v.dpi, false), MIME[v.fmt], `${v.name}.${v.fmt === "tiff" ? "tif" : v.fmt}`); nudgeSupport(); }
      catch (e) { alert(I18("Lỗi: ") + pyErr(e)); return false; }
    } });
}
async function copyImage() {
  const g = activeGraph(); if (!g) return status(I18("Hãy mở một graph"));
  try {
    const b64 = py("export_graph", JSON.stringify(g), "png", 300, false);
    const bin = atob(b64), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([arr], { type: "image/png" }) })]);
    status(I18("Đã sao chép hình (300 dpi) — dán vào Word/PowerPoint bằng Ctrl+V / ⌘V"));
  } catch (e) { status(I18("Trình duyệt không cho sao chép ảnh — dùng Xuất hình thay thế")); }
}

/* ================================================================== project files */
function saveProject() {
  const name = (P.graphs[0] && P.graphs[0].name) || (P.books[0] && P.books[0].name) || "project";
  downloadBlob(new Blob([JSON.stringify(P)], { type: "application/json" }), `${name}.sciplot.json`);
  status(I18("Đã lưu project — mở lại bằng File → Mở project"));
}
async function openProjectFile(file) {
  try { const p = JSON.parse(await file.text()); if (!p.books || !p.graphs) throw new Error(I18("không phải file project SciPlot")); loadProject(p); status(I18("Đã mở ") + file.name); }
  catch (e) { alert(I18("Không mở được project: ") + e.message); }
}
function loadProject(p) {
  undoStack.push(snapshot());
  P = { ...newProject(), ...p }; $$(".win").forEach(w => w.remove());
  for (const b of P.books) syncBook(b); afterChange();
}
function restoreAutosave() {
  let s = null; try { s = localStorage.getItem("sciplot.autosave"); } catch (e) { }
  if (!s) return status(I18("Không có phiên làm việc nào được lưu tạm trên trình duyệt này"));
  loadProject(JSON.parse(s)); status(I18("Đã khôi phục phiên làm việc trước"));
}
function confirmNewProject() { if (confirm(I18("Đóng project hiện tại và bắt đầu project mới? (Có thể Hoàn tác)"))) loadProject(newProject()); }

/* ================================================================== results */
function showResults(res, g) {
  const R = $("#results");
  if (!res || !res.length) { R.innerHTML = `<div class="empty">${g ? I18("Loại hình này không có giá trị tính toán.") : I18("Kết quả tính (η10, Tafel, S_BET, Eg, Cdl…) hiện ở đây khi vẽ các hình điện hoá/vật liệu.")}</div>`; return; }
  const cols = Object.keys(res[0]);
  R.innerHTML = `<table><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr>${res.map(r => `<tr>${cols.map(c => `<td>${r[c] === null ? "" : esc(typeof r[c] === "number" ? +r[c].toPrecision(6) : r[c])}</td>`).join("")}</tr>`).join("")}${I18("</table>\n    <button class=\"mini\" id=\"res2book\" style=\"margin-top:6px\">Đưa vào workbook mới</button>")}`;
  $("#res2book").onclick = () => {
    const cols2 = cols.map((c, i) => ({ name: colLetter(i), lname: c, units: "", comment: g ? g.name : "", desig: i === 0 ? "L" : "Y", data: res.map(r => r[c]) }));
    let b; mutate(() => { b = newBook((g ? g.name : "Results") + "_kq", cols2); P.open.push(b.id); P.active = b.id; }, { books: [] }); syncBook(b);
  };
}

/* ================================================================== help */
function helpDialog() {
  dialog({ title: I18("Hướng dẫn nhanh"), wide: true, okText: I18("Đóng"), fields: [], extra: `${I18("<div style=\"line-height:1.55\">\n    <p><b>1. Dữ liệu.</b> File → Nhập dữ liệu (Excel/CSV/TXT) hoặc dán từ Excel. Dòng tiêu đề tự thành <i>Long Name</i>, dòng đơn vị thành <i>Units</i>. Có thể gõ/dán trực tiếp vào worksheet.</p>\n    <p><b>2. Kiểu cột.</b> Chuột phải tiêu đề cột → X / Y / Y Error / Label. Khi vẽ, mỗi cột Y dùng cột X gần nhất bên trái; cột Y Error ngay bên phải thành thanh sai số.</p>\n    <p><b>3. Vẽ.</b> Chọn cột Y (bấm tiêu đề, giữ Ctrl/Shift chọn nhiều) → menu Plot hoặc nút trên thanh công cụ. Bảng dạng dài (cột tên mẫu) sẽ được đề nghị tách theo nhóm.</p>\n    <p><b>4. Chỉnh hình.</b> Bấm đúp: trục → hộp Axis (khoảng, bước tick, tick phụ, log, đảo trục, cỡ chữ); nhãn trục → sửa tên; chú giải → Legend; tên series trong chú giải → màu/ký hiệu/nét của series đó; vùng vẽ → Plot Details. Kéo chú giải hoặc chữ để di chuyển; mũi tên bàn phím để dịch từng chút.</p>\n    <p><b>5. Công cụ.</b> Phóng to bằng khung chọn, thêm chữ, đường tham chiếu; Ctrl+R để rescale. Graph → Copy/Paste Format để mọi hình cùng kiểu; Lưu làm template để dùng lại.</p>\n    <p><b>6. Xuất.</b> File → Xuất hình (PNG/TIFF 600 dpi, PDF/SVG vector); Edit → Sao chép hình để dán vào PowerPoint; File → Ghép nhiều hình để tạo figure (a)(b)(c). File → Lưu project để làm tiếp sau.</p></div>")}` });
}
const APP_VERSION = "1.0";
const REPO_URL = "https://github.com/lephong2810/SciPlotStudio";
const SITE_URL = "https://lephong2810.github.io/SciPlotStudio/";
const CITES = () => [
  ["Acknowledgments (English)", `The authors thank Dr. Phong Hoai Le (University of Science, VNU-HCM, Vietnam) for developing SciPlot Studio (${REPO_URL}), which was used to prepare the figures in this work.`],
  ["Methods / Experimental (English)", `Figures were prepared using SciPlot Studio (version ${APP_VERSION}; P. H. Le, University of Science, VNU-HCM, Vietnam; ${REPO_URL}).`],
  [I18("Chú thích hình / Supporting Information"), `Plotted with SciPlot Studio v${APP_VERSION} (${REPO_URL}).`],
  [I18("Tài liệu tham khảo (ACS style)"), `Le, P. H. SciPlot Studio, version ${APP_VERSION}; University of Science, VNU-HCM: Ho Chi Minh City, Vietnam, 2026. ${REPO_URL} (accessed ${new Date().toISOString().slice(0, 10)}).`],
  [I18("Luận văn / khoá luận (tiếng Việt)"), `${I18("Các hình trong luận văn được vẽ bằng phần mềm SciPlot Studio (phiên bản ")}${APP_VERSION}${I18(") do TS. Lê Hoài Phong (Trường Đại học Khoa học Tự nhiên, ĐHQG-HCM) phát triển, ")}${REPO_URL}.`]];
function copyText(txt, btn) {
  const done = () => { if (btn) { const o = btn.textContent; btn.textContent = I18("✓ Đã chép"); setTimeout(() => { btn.textContent = o; }, 1500); } };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, () => { prompt(I18("Chép đoạn này:"), txt); });
  else prompt(I18("Chép đoạn này:"), txt);
}
function citeDialog() {
  const C = CITES();
  const d = dialog({ title: I18("Ủng hộ & trích dẫn SciPlot Studio"), wide: true, okText: I18("Đóng"), fields: [], extra: `${I18("<div style=\"line-height:1.55;font-size:13px\">\n    <p>SciPlot Studio miễn phí cho mọi người. Nếu thấy app ổn, hãy <b>nhấn ⭐ Star trên GitHub</b> để nhiều người biết đến hơn. Nếu app giúp ích cho nghiên cứu của bạn, hãy <b>ghi nhận (acknowledge) SciPlot Studio</b> trong bài báo, luận văn hoặc báo cáo. Cảm ơn bạn rất nhiều!</p>\n    <p><a class=\"starbtn\" href=\"")}${REPO_URL}${I18("\" target=\"_blank\" rel=\"noopener\">⭐ Star trên GitHub</a></p>\n    ")}${C.map(([h, txt], i) => `<div class="citebox"><div class="citehd"><b>${esc(h)}</b><button type="button" class="mini" data-cite="${i}${I18("\">Sao chép</button></div><div class=\"citetx\">")}${esc(txt)}</div></div>`).join("")}${I18("\n    <p class=\"note\">Chọn một mẫu phù hợp với yêu cầu của tạp chí; có thể chỉnh lại câu cho hợp văn phong bài báo.</p></div>")}` });
  $$("#modal [data-cite]").forEach(b => b.onclick = () => copyText(C[+b.dataset.cite][1], b));
  return d;
}
/* nhắc nhẹ một lần sau vài lần xuất hình */
function nudgeSupport() {
  let n = 0, off = false;
  try { n = +(localStorage.getItem("sciplot_exports") || 0) + 1; localStorage.setItem("sciplot_exports", n); off = localStorage.getItem("sciplot_nudge_off") === "1"; } catch (e) { return; }
  if (off || !(n === 3 || n % 25 === 0) || $("#nudge")) return;
  const el = document.createElement("div"); el.id = "nudge";
  el.innerHTML = `${I18("<button class=\"x\" data-n=\"close\" title=\"Đóng\">×</button><b>SciPlot có giúp ích cho bạn?</b><p>Nhấn ⭐ Star trên GitHub và ghi nhận SciPlot Studio trong bài báo của bạn nhé — đó là cách ủng hộ tốt nhất.</p>\n    <div class=\"nbtn\"><a class=\"starbtn\" href=\"")}${REPO_URL}${I18("\" target=\"_blank\" rel=\"noopener\">⭐ Star</a><button class=\"mini\" data-n=\"cite\">Câu acknowledge</button><button class=\"mini\" data-n=\"never\">Không nhắc lại</button></div>")}`;
  document.body.appendChild(el);
  el.onclick = e => { const a = (e.target.closest("[data-n]") || {}).dataset; if (!a || !a.n) return;
    if (a.n === "cite") citeDialog(); if (a.n === "never") { try { localStorage.setItem("sciplot_nudge_off", "1"); } catch (_) {} } el.remove(); };
}
function switchLang(l) {
  if (l === LANG) return;
  try { localStorage.setItem("sciplot.autosave", JSON.stringify(P)); localStorage.setItem("sciplot_lang", l); sessionStorage.setItem("sciplot_relang", "1"); } catch (e) { }
  location.reload();
}
function aboutDialog() {
  const L = [["Pyodide", "MPL-2.0", "https://github.com/pyodide/pyodide/blob/main/LICENSE"],
    ["Python (CPython, qua Pyodide)", "PSF License", "https://docs.python.org/3/license.html"],
    ["matplotlib", I18("Matplotlib License (kiểu PSF/BSD)"), "https://matplotlib.org/stable/project/license.html"],
    ["NumPy", "BSD-3-Clause", "https://numpy.org/doc/stable/license.html"],
    ["SciPy", "BSD-3-Clause", "https://github.com/scipy/scipy/blob/main/LICENSE.txt"],
    ["pandas", "BSD-3-Clause", "https://github.com/pandas-dev/pandas/blob/main/LICENSE"],
    ["adjustText", "MIT", "https://github.com/Phlya/adjustText/blob/master/LICENSE"],
    ["SheetJS Community Edition (xlsx)", "Apache-2.0", "https://git.sheetjs.com/sheetjs/sheetjs/src/branch/master/LICENSE"],
    ["Liberation Sans / Serif", "SIL Open Font License 1.1", "fonts/LICENSE-Liberation.txt"]];
  dialog({ title: I18("Giới thiệu SciPlot Studio"), wide: true, okText: I18("Đóng"), fields: [], extra: `<div style="line-height:1.55;font-size:13px">
    <p><b>SciPlot Studio</b> ${APP_VERSION}${I18(" — công cụ vẽ và chỉnh sửa hình khoa học chạy hoàn toàn trong trình duyệt. <a href=\"")}${REPO_URL}" target="_blank" rel="noopener">${REPO_URL}${I18("</a><br>© 2026 Lê Hoài Phong · Khoa Hóa học, Trường ĐH Khoa học Tự nhiên, ĐHQG-HCM. Mã nguồn phát hành theo <a href=\"LICENSE\" target=\"_blank\">giấy phép MIT</a>.</p>\n    <p class=\"note\">SciPlot Studio là phần mềm độc lập, <b>không liên kết, không được tài trợ hay xác nhận</b> bởi bất kỳ nhà phát triển phần mềm hay nhà xuất bản nào. Các nhãn hiệu được nhắc tới thuộc về chủ sở hữu tương ứng. Tên các bảng màu (vd. \"NPG-style\", Okabe–Ito) chỉ mô tả phong cách màu, không ngụ ý liên kết với tạp chí hay nhà xuất bản. Dữ liệu trong các hình mẫu là dữ liệu mô phỏng.</p>\n    <p><b>Phần mềm mã nguồn mở bên thứ ba</b> (xem thêm <a href=\"THIRD_PARTY_NOTICES.md\" target=\"_blank\">THIRD_PARTY_NOTICES.md</a>):</p>\n    <table style=\"border-collapse:collapse;width:100%\">")}${L.map(([n, l, u]) => `<tr><td style="padding:2px 10px 2px 0">${n}</td><td style="padding:2px 0"><a href="${u}" target="_blank" rel="noopener">${l}</a></td></tr>`).join("")}</table></div>` });
}
function shortcutsDialog() {
  dialog({ title: I18("Phím tắt"), okText: I18("Đóng"), fields: [], extra: `<table style="font-size:13px;line-height:1.8">${[["Ctrl/⌘ Z · Y", I18("Hoàn tác · làm lại")], ["Ctrl/⌘ S", I18("Lưu project")], ["Ctrl/⌘ O", I18("Mở project")], ["Ctrl/⌘ I", I18("Nhập dữ liệu")], ["Ctrl/⌘ E", I18("Xuất hình")], ["Ctrl/⌘ R", "Rescale"], ["F4", "Plot Details"], ["F5", I18("Hộp thoại trục")], ["Ctrl/⌘ Q", "Set Column Values"], ["Del", I18("Xoá chữ/đối tượng đang chọn")], [I18("Mũi tên"), I18("Dịch chữ/chú giải đang chọn · di chuyển ô trong worksheet")], ["Esc", I18("Về công cụ chọn")], ["Enter / F2", I18("Sửa ô worksheet")], ["Ctrl/⌘ C · V", I18("Sao chép / dán ô, cột (tương thích Excel)")]].map(([a, b]) => `<tr><td style="padding-right:18px"><kbd>${a}</kbd></td><td>${b}</td></tr>`).join("")}</table>` });
}

/* ================================================================== PWA */
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; });
function installApp() {
  if (installEvt) { installEvt.prompt(); installEvt.userChoice.then(() => { installEvt = null; }); return; }
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  dialog({ title: I18("Cài SciPlot như một app"), okText: I18("Đóng"), fields: [], extra: standalone ? I18("<p>SciPlot đang chạy ở chế độ app rồi.</p>") : `${I18("<div style=\"line-height:1.6\">\n    <p><b>Safari trên Mac (macOS 14 trở lên):</b> menu <i>File → Add to Dock…</i></p>\n    <p><b>Chrome / Edge:</b> bấm biểu tượng cài đặt ở cuối thanh địa chỉ, hoặc menu ⋮ → <i>Cast, save and share → Install page as app</i>.</p>\n    <p><b>iPad / iPhone:</b> nút Chia sẻ → <i>Add to Home Screen</i>.</p>\n    <p class=\"note\">Sau lần mở đầu tiên (có mạng), app chạy được cả khi không có Internet.</p></div>")}` });
}
if ("serviceWorker" in navigator && !window.__MOCK_PY__ && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(e => console.warn("SW", e)));
}

/* ================================================================== keyboard & clipboard */
document.addEventListener("keydown", e => {
  if (!$("#modalwrap").hidden) return;
  const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
  const inField = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) && !editing;
  if (inField) return;
  if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); if (editing) commitEdit(true); undo(); return; }
  if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); return; }
  if (mod && k === "s") { e.preventDefault(); saveProject(); return; }
  if (mod && k === "o") { e.preventDefault(); pickFile("project"); return; }
  if (mod && k === "i") { e.preventDefault(); pickFile("import"); return; }
  if (mod && k === "e") { e.preventDefault(); exportDialog(); return; }
  if (mod && k === "r") { e.preventDefault(); rescale(); return; }
  if (mod && k === "n") { e.preventDefault(); newBookCmd(); return; }
  if (mod && k === "q") { e.preventDefault(); formulaDialog(); return; }
  if (mod && k === "l") { e.preventDefault(); fitDialog(); return; }
  if (mod && activeGraph() && ["=", "+", "-", "_", "0"].includes(e.key)) {   // zoom hình, không zoom cả app
    e.preventDefault(); const g = activeGraph(); const V = gV(g.id);
    if (e.key === "0") setZoom(g.id, 1); else setZoom(g.id, V.zoom * (e.key === "-" || e.key === "_" ? 1 / 1.25 : 1.25));
    return;
  }
  if (mod && e.shiftKey && k === "c") { e.preventDefault(); copyImage(); return; }
  if (e.key === "F4") { e.preventDefault(); plotDetails(); return; }
  if (e.key === "F5") { e.preventDefault(); axisDialog("x"); return; }
  if (activeBook()) { if (!mod && sheetKey(e)) { if (!editing) e.preventDefault(); } return; }
  if (activeGraph()) {
    if (e.key === "Escape") { setTool("pointer"); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); return; }
    const step = e.shiftKey ? 0.02 : 0.005;
    const nd = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (nd && nudge(...nd)) e.preventDefault();
  }
});
document.addEventListener("paste", e => {
  if (!$("#modalwrap").hidden || editing) return;
  if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  const t = e.clipboardData.getData("text/plain"); if (!t) return;
  if (activeBook()) { e.preventDefault(); sheetPaste(t); }
  else { e.preventDefault(); const { cols } = aoaToCols(textToAoa(t, "auto", "."), {}); let b; mutate(() => { b = newBook("Pasted", cols); P.open.push(b.id); P.active = b.id; }, { books: [] }); syncBook(b); }
});
document.addEventListener("copy", e => {
  if (!$("#modalwrap").hidden || editing || ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  const t = sheetCopy(); if (t === null) return; e.preventDefault(); e.clipboardData.setData("text/plain", t); status(I18("Đã sao chép"));
});
document.addEventListener("mousedown", e => {
  if (!e.target.closest(".popup") && !e.target.closest("#menus")) closePopups();
  if (editing && !e.target.closest("td.editing")) commitEdit();
});
window.addEventListener("blur", closePopups);

/* ================================================================== init */
function init() {
  buildMenus(); buildToolbar(); renderSamples(); renderExplorer(); renderTabs(); showActive();
  $("#fileinput").onchange = e => onFilePicked(e.target.files[0]);
  $("#togglelog").onclick = () => { $("#resultsbar").classList.toggle("collapsed"); $("#togglelog").textContent = $("#resultsbar").classList.contains("collapsed") ? "▸" : "▾"; };
  $("#winarea").addEventListener("dragover", e => e.preventDefault());
  $("#winarea").addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { pickMode = f.name.endsWith(".json") ? "project" : "import"; onFilePicked(f); } });
  let saved = null; try { saved = localStorage.getItem("sciplot.autosave"); } catch (e) { }
  setTool("pointer"); status(I18("Kéo-thả file Excel/CSV vào đây, hoặc chọn dữ liệu mẫu bên trái"));
  let relang = false; try { relang = sessionStorage.getItem("sciplot_relang") === "1"; sessionStorage.removeItem("sciplot_relang"); } catch (e) { }
  if (relang && saved) restoreAutosave(); else if (saved) status(I18("Có phiên làm việc trước — File → Khôi phục phiên làm việc trước để mở lại"));
  const ls = $("#langsw"); if (ls) { ls.innerHTML = ["vi", "en"].map(l => `<button data-l="${l}" class="${l === LANG ? "on" : ""}" title="${l === "vi" ? I18("Tiếng Việt") : "English"}">${l.toUpperCase()}</button>`).join(""); ls.onclick = e => { const b = e.target.closest("[data-l]"); if (b) switchLang(b.dataset.l); }; }
  boot();
}
init();
if ("serviceWorker" in navigator) {
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) status(I18("Đã có bản SciPlot mới — tải lại trang (⌘R / F5) để dùng"));
    hadController = true;
  });
}
