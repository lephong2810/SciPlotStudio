/* SciPlot Studio — giao diện kiểu Origin. Python (studio.py) vẽ hình; JS quản lý project, worksheet, chỉnh sửa. */
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
  if (!pyMod) throw new Error("Python chưa sẵn sàng");
  return pyMod[fn](...args);
}
function pyStatus(text, cls) { $("#pystatustext").textContent = text; $("#pystatus").className = cls || ""; }
async function boot() {
  try {
    if (!window.__MOCK_PY__) {
      pyStatus("Đang tải Python…");
      await new Promise((ok, bad) => {
        const s = document.createElement("script");
        s.src = PYODIDE_URL + "pyodide.js"; s.onload = ok; s.onerror = () => bad(new Error("Không tải được Pyodide (kiểm tra mạng)"));
        document.head.appendChild(s);
      });
      const pyo = await loadPyodide({ indexURL: PYODIDE_URL });
      pyStatus("Đang tải numpy, pandas, matplotlib, scipy…");
      await pyo.loadPackage(["numpy", "pandas", "matplotlib", "scipy", "micropip"]);
      try { await pyo.runPythonAsync(`import micropip\nawait micropip.install(${JSON.stringify(new URL(ADJUSTTEXT_WHEEL, location.href).href)})`); }
      catch (e) { console.warn("adjustText", e); }
      pyStatus("Đang nạp font và SciPlot…");
      pyo.FS.mkdirTree("fonts");
      await Promise.all(FONT_FILES.map(async f => {
        try { const r = await fetch("fonts/" + f); if (r.ok) pyo.FS.writeFile("fonts/" + f, new Uint8Array(await r.arrayBuffer())); } catch (e) { console.warn(f, e); }
      }));
      for (const f of ["sciplot.py", "studio.py"]) {
        const r = await fetch(f);
        if (!r.ok) throw new Error("Không tải được " + f + " — hãy mở trang qua GitHub Pages hoặc một web server (không mở file:// trực tiếp)");
        pyo.FS.writeFile(f, await r.text());
      }
      pyo.runPython("import sys; sys.path.insert(0, '.')\nimport studio");
      pyMod = pyo.pyimport("studio");
    }
    ready = true;
    pyStatus("Sẵn sàng", "ready");
    for (const b of P.books) syncBook(b);
    const g = activeGraph(); if (g) renderGraph(g);
  } catch (e) {
    pyStatus("Lỗi khởi động", "error");
    status("Lỗi: " + (e.message || e));
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
function undo() { if (!undoStack.length) return status("Không còn gì để hoàn tác"); redoStack.push(snapshot()); restore(undoStack.pop()); status("Đã hoàn tác"); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); status("Đã làm lại"); }
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
function syncBook(book) { if (!ready) return; try { py("set_book", JSON.stringify(book)); } catch (e) { status("Lỗi dữ liệu: " + e.message); } }
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
/** AoA → cột kiểu Origin: dòng tiêu đề = Long Name / Units / Comments */
function aoaToCols(aoa, { skip = 0, nhdr = "auto", dec = "." } = {}) {
  let rows = aoa.slice(skip).filter(r => r && filled(r) > 0);
  if (!rows.length) throw new Error("Không có dữ liệu sau khi bỏ qua các dòng đầu.");
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
  // bỏ cột trống hoàn toàn, đặt kiểu cột như Origin: cột số đầu tiên = X, cột chữ = Label
  const keep = cols.filter(c => c.lname || c.data.some(v => v !== null));
  // như Origin: cột đầu tiên là X (kể cả cột chữ — dùng làm nhãn cho hình cột), trừ khi đó là cột nhóm lặp lại
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
  { id: "xps", name: "XPS (peak fitting, tô peak)", group: "Vật liệu" },
  { id: "spectra", name: "Phổ xếp chồng (XRD, Raman, FTIR, XPS)", group: "Vật liệu" },
  { id: "lsv", name: "LSV (η@j)", group: "Điện hoá" }, { id: "tafel", name: "Tafel", group: "Điện hoá" },
  { id: "cv", name: "CV", group: "Điện hoá" }, { id: "cdl", name: "Cdl", group: "Điện hoá" },
  { id: "nyquist", name: "Nyquist (EIS)", group: "Điện hoá" },
  { id: "bet", name: "BET isotherm", group: "Vật liệu" }, { id: "tauc", name: "Tauc (Eg)", group: "Vật liệu" },
  { id: "box", name: "Box chart", group: "Thống kê" }, { id: "histogram", name: "Histogram", group: "Thống kê" },
  { id: "pca", name: "PCA", group: "Thống kê" }, { id: "heatmap", name: "Heatmap", group: "Thống kê" },
  { id: "volcano", name: "Volcano", group: "Thống kê" },
];
const PALETTE_DEFS = [
  { id: "paper", name: "Pastel bài báo (CuO/CZ, ACS ANM 2025)", colors: ["#FF7FC6", "#FC9898", "#F8BF92", "#F4D897", "#82D0FF", "#8E9CFF", "#BC75FF", "#7FD3A8"] },
  { id: "npg", name: "Nature (NPG)", colors: ["#E64B35", "#4DBBD5", "#00A087", "#3C5488", "#F39B7F", "#8491B4", "#91D1C2", "#DC0000"] },
  { id: "npg_soft", name: "Nature pastel", colors: ["#F0937F", "#94D6E6", "#66C6B7", "#8A98B8", "#F8C3B2", "#B5BDD2", "#BDE3DA", "#EA6666"] },
  { id: "okabe", name: "Okabe–Ito (an toàn mù màu, Nature Methods)", colors: ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#F0E442", "#000000"] },
  { id: "tol_light", name: "Paul Tol light (pastel, an toàn mù màu)", colors: ["#77AADD", "#EE8866", "#EEDD88", "#FFAABB", "#99DDFF", "#44BB99", "#BBCC33", "#AAAA00"] },
  { id: "tol_muted", name: "Paul Tol muted (trầm, an toàn mù màu)", colors: ["#CC6677", "#332288", "#DDCC77", "#117733", "#88CCEE", "#882255", "#44AA99", "#999933"] },
  { id: "aaas", name: "Science (AAAS)", colors: ["#3B4992", "#EE0000", "#008B45", "#631879", "#008280", "#BB0021", "#5F559B", "#A20056"] },
  { id: "seq_warm", name: "Tăng dần hồng → tím (theo hàm lượng)", seq: true, colors: ["#FFD8A8", "#FDB48C", "#F9917E", "#EE6F7B", "#D6527F", "#A83C82"] },
  { id: "seq_blue", name: "Tăng dần xanh dương", seq: true, colors: ["#C6DBEF", "#9ECAE1", "#6BAED6", "#4292C6", "#2171B5", "#08519C"] },
  { id: "seq_green", name: "Tăng dần xanh lá", seq: true, colors: ["#C7E9C0", "#A1D99B", "#74C476", "#41AB5D", "#238B45", "#005A32"] },
  { id: "seq_purple", name: "Tăng dần tím", seq: true, colors: ["#DADAEB", "#BCBDDC", "#9E9AC8", "#807DBA", "#6A51A3", "#4A1486"] },
  { id: "viridis", name: "Viridis (tăng dần, in đen trắng vẫn rõ)", seq: true, colors: ["#440154", "#443983", "#31688E", "#21918C", "#35B779", "#90D743", "#FDE725"] },
  { id: "bold", name: "Đậm cổ điển", colors: ["#000000", "#E41A1C", "#377EB8", "#4DAF4A", "#984EA3", "#FF7F00", "#A65628", "#F781BF"] },
  { id: "gray", name: "Xám (in đen trắng)", colors: ["#222222", "#777777", "#AAAAAA", "#555555", "#CCCCCC", "#333333"] },
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
const GRADIENTS = [["Hồng → vàng (bài báo)", "#FC9D99,#F3D597"], ["Hồng → trắng", "#F48FB1,#FFF0F5"], ["Đào → kem", "#F7A072,#FBE8C8"], ["Xanh → trắng", "#6BAED6,#EAF4FB"],
  ["Xanh ngọc → trắng", "#66C6B7,#E8F6F3"], ["Tím → hồng", "#9E8CF0,#F6C6E0"], ["Xanh → tím", "#82D0FF,#BC75FF"], ["Xanh lá → vàng", "#7FD3A8,#F5EFA8"], ["Xám", "#8C8C8C,#EDEDED"]];
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
    theme: "origin", font: "sans", fontsize: 11, palette: "paper",
    xaxis: {}, yaxis: {}, y2axis: {}, legend: {}, title: "", texts: [], reflines: [], frame: {}, ...extra,
  };
  P.graphs.push(g);
  return g;
}
/** Tạo series từ cột đang chọn theo quy tắc Origin: X = cột X gần nhất bên trái, yEr ngay bên phải */
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
  install: '<svg viewBox="0 0 20 20" fill="none" stroke="#333" stroke-width="1.6"><rect x="3" y="3" width="14" height="14" rx="3"/><path d="M10 6v7M7 10l3 3 3-3"/></svg>',
};
let tool = "pointer";
const MENUS = () => [
  ["File", [
    ["Workbook mới", () => newBookCmd(), "Ctrl+N"], ["Nhập dữ liệu (Excel/CSV/TXT)…", () => pickFile("import"), "Ctrl+I"],
    ["Dán dữ liệu từ Excel/Origin…", () => pasteDialog()], "-",
    ["Mở project (.sciplot.json)…", () => pickFile("project"), "Ctrl+O"], ["Lưu project", () => saveProject(), "Ctrl+S"],
    ["Khôi phục phiên làm việc trước", () => restoreAutosave()], ["Project mới", () => confirmNewProject()], "-",
    ["Xuất hình…", () => exportDialog(), "Ctrl+E"], ["Ghép nhiều hình thành 1 figure (a)(b)…", () => panelDialog()], "-",
    ["Cài SciPlot như một app", () => installApp()],
  ]],
  ["Edit", [
    ["Hoàn tác", () => undo(), "Ctrl+Z"], ["Làm lại", () => redo(), "Ctrl+Y"], "-",
    ["Sao chép hình (dán vào Word/PowerPoint)", () => copyImage(), "Ctrl+Shift+C"],
    ["Xoá đối tượng đang chọn", () => deleteSelected(), "Del"],
  ]],
  ["Plot", [
    ...["2D", "Vật liệu", "Điện hoá", "Thống kê"].flatMap(gp => [["#" + gp], ...KINDS.filter(k => k.group === gp).map(k => [k.name, () => plotCmd(k.id)])]),
  ]],
  ["Column", [
    ["Đặt làm X", () => setDesig("X")], ["Đặt làm Y", () => setDesig("Y")], ["Đặt làm Y Error", () => setDesig("yEr")],
    ["Đặt làm Label (chữ)", () => setDesig("L")], ["Bỏ qua (Disregard)", () => setDesig("N")], "-",
    ["Set Column Values (công thức)…", () => formulaDialog(), "Ctrl+Q"], ["Thêm cột", () => addColumn()], ["Chèn cột bên trái", () => addColumn(true)],
    ["Xoá cột đang chọn", () => deleteColumns()], "-",
    ["Tách theo nhóm (Unstack)…", () => unstackDialog()],
  ]],
  ["Graph", [
    ["Plot Details (series, kiểu vẽ)…", () => plotDetails(), "F4"], ["Trục (Axis)…", () => axisDialog("x"), "F5"],
    ["Chú giải (Legend)…", () => legendDialog()], ["Trang & khung (Page/Layer)…", () => pageDialog()], "-",
    ["Thêm chữ", () => setTool("text")], ["Thêm đường ngang", () => setTool("hline")], ["Thêm đường dọc", () => setTool("vline")], "-",
    ["Rescale (khớp lại trục)", () => rescale(), "Ctrl+R"], ["Đổi loại hình…", () => changeKindDialog()], "-",
    ["Copy Format (sao chép định dạng)", () => copyFormat()], ["Paste Format (dán định dạng)", () => pasteFormat()],
    ["Lưu làm template…", () => saveTemplate()], ["Áp dụng template…", () => applyTemplateDialog()], "-",
    ["Nhân bản graph", () => duplicateGraph()],
  ]],
  ["Analysis", [
    ["Fit tuyến tính / đa thức (y = ax + b, R²)…", () => fitDialog(), "Ctrl+L"],
    ["Bỏ mọi đường fit", () => { const g = activeGraph(); if (g) mutate(() => g.series.forEach(clearFit)); }], "-",
    ["Set Column Values (công thức)…", () => formulaDialog(), "Ctrl+Q"],
    ["Đưa kết quả tính vào workbook", () => { const b = $("#res2book"); if (b) b.click(); else status("Chưa có kết quả tính nào"); }],
  ]],
  ["Help", [
    ["Hướng dẫn nhanh", () => helpDialog()], ["Phím tắt", () => shortcutsDialog()],
    ["Bản đơn giản (form)", () => { location.href = "simple.html"; }],
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
    ["book", "Workbook mới", newBookCmd], ["importf", "Nhập file", () => pickFile("import")], ["open", "Mở project", () => pickFile("project")], ["save", "Lưu project", saveProject], "|",
    ["undo", "Hoàn tác (Ctrl+Z)", undo], ["redo", "Làm lại (Ctrl+Y)", redo], "|",
    ["line", "Line", () => plotCmd("line"), "Line"], ["scatter", "Scatter", () => plotCmd("scatter")], ["linesymbol", "Line + Symbol", () => plotCmd("linesymbol")],
    ["column", "Column", () => plotCmd("column")], ["spectra", "Phổ xếp chồng", () => plotCmd("spectra")], "|",
    ["pointer", "Chọn / kéo (Esc)", () => setTool("pointer"), null, "tool"], ["zoom", "Phóng to vùng (kéo chuột)", () => setTool("zoom"), null, "tool"],
    ["text", "Thêm chữ (bấm vào hình)", () => setTool("text"), null, "tool"], ["hline", "Đường ngang", () => setTool("hline"), null, "tool"],
    ["vline", "Đường dọc", () => setTool("vline"), null, "tool"], ["rescale", "Rescale (Ctrl+R)", rescale], "|",
    ["fit", "Fit tuyến tính y = ax + b, R² (Ctrl+L)", () => fitDialog(), "Fit"], ["details", "Plot Details (F4)", () => plotDetails(), "Plot Details"], ["export", "Xuất hình (Ctrl+E)", () => exportDialog(), "Xuất"],
    ["copy", "Sao chép hình", copyImage], "|", ["install", "Cài như app", installApp, "Cài app"],
  ];
  $("#toolbar").innerHTML = T.map((t, i) => t === "|" ? '<span class="sep"></span>' :
    `<button class="tb${t[4] === "tool" && t[0] === tool ? " on" : ""}" data-i="${i}" ${t[4] === "tool" ? `data-tool="${t[0]}"` : ""} title="${esc(t[1])}">${ICONS[t[0]] || ""}${t[3] ? `<span class="lbl">${esc(t[3])}</span>` : ""}</button>`).join("");
  $$("#toolbar .tb").forEach(b => b.onclick = () => T[+b.dataset.i][2]());
  // cụm phóng to / thu nhỏ hình (chỉ tác động lên hình đang mở, không zoom cả app)
  const inst = $$("#toolbar .tb").find(b => T[+b.dataset.i][0] === "install");
  const z = document.createElement("span"); z.id = "tbzoom";
  z.title = "Phóng to / thu nhỏ hình · ⌘/Ctrl + cuộn chuột · ⌘/Ctrl + / − · ⌘/Ctrl 0";
  z.innerHTML = `<button class="tb zb" data-z="out" aria-label="Thu nhỏ">${ICONS.zoomout}</button><select data-z="sel" aria-label="Mức phóng"></select>` +
    `<button class="tb zb" data-z="in" aria-label="Phóng to">${ICONS.zoomin}</button><button class="tb" data-z="fit" title="Vừa khung cửa sổ">${ICONS.fitwin}</button>`;
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
  status({ pointer: "Chọn: bấm để chọn, bấm đúp để chỉnh, kéo chú giải/chữ để di chuyển", zoom: "Kéo chuột trên vùng vẽ để phóng to — Ctrl+R để về như cũ",
    text: "Bấm vào vị trí trên hình để thêm chữ", hline: "Bấm vào hình để thêm đường ngang tại vị trí đó", vline: "Bấm vào hình để thêm đường dọc tại vị trí đó" }[t]);
}

/* ================================================================== explorer, tabs, windows */
function renderExplorer() {
  const L = $("#explist");
  const item = (o, ico) => `<div class="exitem${o.id === P.active ? " active" : ""}" data-id="${o.id}" title="Bấm đúp để đổi tên"><span class="ico">${ico}</span>${esc(o.name)}</div>`;
  const head = t => `<div class="panehead small" style="border:0;margin:4px 0 0">${t}</div>`;
  L.innerHTML = (P.books.length + P.graphs.length)
    ? (P.graphs.length ? head(`Graphs (${P.graphs.length})`) + P.graphs.map(g => item(g, "📈")).join("") : "") +
      (P.books.length ? head(`Workbooks (${P.books.length})`) + P.books.map(b => item(b, "▦")).join("") : "")
    : '<div class="exitem sample">(trống) — nhập file hoặc chọn dữ liệu mẫu</div>';
  $$(".exitem[data-id]", L).forEach(el => {
    el.onclick = () => openWin(el.dataset.id);
    el.ondblclick = () => renameObj(el.dataset.id);
    el.oncontextmenu = e => {
      e.preventDefault(); const id = el.dataset.id;
      openPopup($("#ctxmenu"), [["Mở", () => openWin(id)], ["Đổi tên", () => renameObj(id)], ["Nhân bản", () => byId(id).kind ? duplicateGraph(id) : duplicateBook(id)], "-", ["Xoá", () => deleteObj(id)]], e.clientX, e.clientY);
    };
  });
}
function renderTabs() {
  P.open = P.open.filter(id => byId(id));
  $("#tabs").innerHTML = P.open.map(id => { const o = byId(id); return `<div class="tab${id === P.active ? " active" : ""}" data-id="${id}">${o.kind ? "📈" : "▦"} ${esc(o.name)}<button class="x" title="Đóng" data-close="${id}">×</button></div>`; }).join("");
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
  const o = byId(id); const n = prompt("Tên mới:", o.name);
  if (n && n.trim()) mutate(() => { o.name = n.trim(); });
}
function deleteObj(id) {
  const o = byId(id);
  const usedBy = o.cols ? P.graphs.filter(g => g.book === id).map(g => g.name) : [];
  if (!confirm(`Xoá ${o.name}?` + (usedBy.length ? `\nCác hình dùng dữ liệu này cũng sẽ bị xoá: ${usedBy.join(", ")}` : ""))) return;
  mutate(() => {
    if (o.cols) { P.books = P.books.filter(b => b.id !== id); P.graphs = P.graphs.filter(g => g.book !== id); }
    else P.graphs = P.graphs.filter(g => g.id !== id);
    P.open = P.open.filter(x => byId(x)); if (!byId(P.active)) P.active = P.open[0] || null;
  });
}
function duplicateGraph(id) {
  const g = id ? byId(id) : activeGraph(); if (!g) return status("Hãy mở một graph trước");
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
    book.cols.map((c, j) => `<th data-c="${j}" class="${S.cols.has(j) ? "colsel" : ""}" title="Bấm chọn cột · chuột phải: đổi kiểu cột, công thức…">${esc(c.name)}<span class="desig d-${c.desig}">(${c.desig})</span></th>`).join("") + `</tr></thead><tbody>`;
  for (const [k, lab] of metaRows) h += `<tr class="meta"><th class="rowh">${lab}</th>` + book.cols.map((c, j) => `<td data-m="${k}" data-c="${j}" class="${S.cols.has(j) ? "colsel" : ""}">${esc(c[k] || "")}</td>`).join("") + "</tr>";
  for (let r = 0; r < shown; r++) h += `<tr><th class="rowh">${r + 1}</th>` + book.cols.map((c, j) => { const v = c.data[r]; return `<td data-r="${r}" data-c="${j}" class="${typeof v === "number" ? "num" : ""}${S.cols.has(j) ? " colsel" : ""}">${esc(cellText(v))}</td>`; }).join("") + "</tr>";
  h += `</tbody></table>${n + 20 > shown ? `<div class="sheetfoot">Đang hiện ${shown} / ${n} dòng · <button class="mini" id="more_${book.id}">Hiện thêm</button></div>` : ""}</div>`;
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
      ["Đặt làm X", () => setDesig("X")], ["Đặt làm Y", () => setDesig("Y")], ["Đặt làm Y Error", () => setDesig("yEr")], ["Đặt làm Label", () => setDesig("L")], ["Bỏ qua", () => setDesig("N")], "-",
      ["Set Column Values…", () => formulaDialog()], ["Chèn cột bên trái", () => addColumn(true)], ["Thêm cột", () => addColumn()], ["Xoá cột", () => deleteColumns()], "-",
      ["#Vẽ từ cột đã chọn"], ...["linesymbol", "line", "scatter", "column", "spectra"].map(k => [kindName(k), () => plotCmd(k)]),
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
  status(`Đã dán ${aoa.length} dòng × ${Math.max(...aoa.map(r => r.length))} cột`);
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
  const book = activeBook(); if (!book) return status("Hãy mở một workbook");
  mutate(() => selectedCols(book).forEach(j => { book.cols[j].desig = d; }), { books: [book] });
}
function addColumn(left) {
  const book = activeBook(); if (!book) return status("Hãy mở một workbook");
  const at = left ? Math.min(...selectedCols(book)) : book.cols.length;
  mutate(() => { book.cols.splice(at, 0, { name: nextColName(book), lname: "", units: "", comment: "", desig: "Y", data: [] }); }, { books: [book] });
}
function deleteColumns() {
  const book = activeBook(); if (!book) return;
  const idx = selectedCols(book);
  const names = idx.map(j => book.cols[j].name);
  const used = P.graphs.filter(g => g.book === book.id && g.series.some(s => names.includes(s.x) || names.includes(s.y)));
  if (used.length && !confirm(`Cột ${names.join(", ")} đang được dùng trong ${used.map(g => g.name).join(", ")}. Vẫn xoá?`)) return;
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
    { k: "skip", label: "Bỏ qua … dòng đầu", t: "number" },
    { k: "nhdr", label: "Dòng tiêu đề", t: "sel", opts: [["auto", "tự nhận"], ["0", "không có"], ["1", "1: Long Name"], ["2", "2: Long Name + Units"], ["3", "3: Long Name + Units + Comments"]] },
    ...(wb ? [] : [{ k: "sep", label: "Phân cách cột", t: "sel", opts: [["auto", "tự nhận"], ["tab", "Tab"], ["comma", ","], ["semicolon", ";"], ["space", "khoảng trắng"]] }]),
    { k: "dec", label: "Dấu thập phân", t: "sel", opts: [[".", "chấm (1.23)"], [",", "phẩy (1,23)"]] },
    { k: "plot", label: "Vẽ ngay sau khi nhập", t: "sel", opts: [["", "không — chỉ mở worksheet"], ...KINDS.map(k => [k.id, k.name])] },
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
      $(".note", root).textContent = `${n} dòng × ${cols.length} cột · nhận ${nhdr} dòng tiêu đề`;
    } catch (e) { box.innerHTML = ""; $(".note", root).textContent = e.message; }
  };
  dialog({
    title: "Nhập dữ liệu: " + fname, fields, values: v, wide: true,
    extra: '<p class="note"></p><div class="prev"></div>', onChange: preview, onOpen: preview,
    okText: "Nhập",
    onOk: vals => {
      const { cols } = parse(vals);
      let book;
      mutate(() => { book = newBook(fname.replace(/\.\w+$/, ""), cols); P.open.push(book.id); P.active = book.id; }, { books: [] });
      syncBook(book);
      status(`Đã nhập ${fname}: ${nrows(book)} dòng × ${book.cols.length} cột`);
      if (vals.plot) setTimeout(() => plotCmd(vals.plot, book), 30);
    },
  });
}
function pasteDialog() {
  dialog({
    title: "Dán dữ liệu", fields: [{ k: "text", label: "Dữ liệu", t: "textarea", help: "Bôi đen vùng dữ liệu trong Excel/Origin (gồm dòng tên cột, đơn vị) → Ctrl+C → dán vào đây" },
      { k: "dec", label: "Dấu thập phân", t: "sel", opts: [[".", "chấm"], [",", "phẩy"]] }], values: { text: "", dec: "." }, wide: true, okText: "Tạo workbook",
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
  ["co_oxidation_conversion.csv", "CO conversion theo nhiệt độ", "linesymbol", { palette: "pastel", xaxis: { label: "Temperature [$^{o}$C]", min: 30, max: 140, step: 20 }, yaxis: { label: "CO conversion efficiency [%]", min: -10, max: 110, step: 20 }, legend: { loc: [0.03, 0.97] } }],
  ["co_oxidation_rate.csv", "Tốc độ CO (cột gradient)", "column", { opts: { gradient: "#F2A0A0,#F0D9A0", value_labels: true, value_fmt: "{:.4g}", rotate_x: 30 }, yaxis: { label: "CO conversion rate [mL/min$\\cdot$g$_{cat}$]", min: 0, max: 20, step: 5 }, xaxis: { label: "" }, legend: { show: false }, texts: [{ id: "t1", text: "@ At 90$^{o}$C", x: 0.04, y: 0.95 }] }],
  ["xrd_demo.csv", "XRD xếp chồng", "spectra", {}],
  ["lsv_oer_demo.csv", "LSV OER", "lsv", { opts: { reaction: "OER", ref: "Hg/HgO", pH: 14, current_unit: "mA", area: 0.196, R: 2.5 } }],
  ["cv_scanrate_demo.csv", "CV nhiều tốc độ quét", "cv", { opts: { ref: "RHE", current_unit: "mA/cm2" } }],
  ["eis_demo.csv", "EIS Nyquist", "nyquist", {}],
  ["bet_demo.csv", "BET isotherm", "bet", {}, ["P_P0", "V_cm3g", "sample"]],
  ["xps_o1s_demo.csv", "XPS O 1s (tô peak)", "xps", { texts: [{ id: "t1", text: "O 1s", x: 0.80, y: 0.62, fontsize: 13, bold: true }] }],
  ["uvvis_demo.csv", "UV-Vis → Tauc", "tauc", { opts: { transition: "direct", xlim: "1.8,4.2" } }],
  ["iris.csv", "Iris (PCA)", "pca", {}],
  ["rnaseq_top20_demo.csv", "RNA-seq heatmap", "heatmap", {}],
];
function renderSamples() {
  $("#samplelist").innerHTML = SAMPLES.map((s, i) => `<div class="exitem sample" data-s="${i}"><span class="ico">＋</span>${esc(s[1])}</div>`).join("");
  $$("#samplelist .exitem").forEach(el => el.onclick = () => openSample(+el.dataset.s));
  $("#welcome").innerHTML = `<h2>SciPlot Studio</h2><p>Vẽ và chỉnh hình khoa học kiểu Origin, chạy hoàn toàn trong trình duyệt. Dữ liệu không rời khỏi máy của bạn.</p>
    <ol><li><b>File → Nhập dữ liệu</b> (Excel, CSV, TXT) hoặc <b>Dán dữ liệu</b>: dòng tên cột + đơn vị tự thành Long Name / Units.</li>
    <li>Chọn cột Y trong worksheet (bấm tiêu đề cột) → <b>Plot</b> → loại hình.</li>
    <li><b>Bấm đúp</b> vào trục, nhãn, chú giải, chữ để chỉnh; <b>kéo</b> chú giải/chữ để di chuyển; <b>F4</b> mở Plot Details.</li>
    <li><b>File → Xuất hình</b> (PNG/TIFF 600 dpi, PDF/SVG vector) hoặc <b>Edit → Sao chép hình</b> để dán vào PowerPoint.</li></ol>
    <div class="cards">${SAMPLES.slice(0, 6).map((s, i) => `<div class="card" data-s="${i}"><b>${esc(s[1])}</b><span>Mở dữ liệu mẫu và vẽ</span></div>`).join("")}
    <div class="card" id="wc_import"><b>Nhập file của bạn</b><span>Excel / CSV / TXT xuất từ thiết bị</span></div></div>`;
  $$("#welcome .card[data-s]").forEach(el => el.onclick = () => openSample(+el.dataset.s));
  $("#wc_import").onclick = () => pickFile("import");
}
async function openSample(i) {
  const [file, label, kind, extra, unstackBy] = SAMPLES[i];
  if (!ready) { status("Python đang tải — chờ chấm xanh 'Sẵn sàng' ở góc trên rồi mở lại"); return; }
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
    status(`Đã mở hình mẫu và workbook ${target.name} — thay số trong worksheet, bấm lại tab hình để xem cập nhật`);
  } catch (e) { status("Không mở được dữ liệu mẫu: " + e.message); console.error(e); }
}

/* ================================================================== plotting commands */
function plotCmd(kind, book, extra = {}, name) {
  book = book || activeBook() || (activeGraph() && byId(activeGraph().book));
  if (!book) { status("Hãy mở hoặc nhập một workbook trước"); return; }
  if (looksLong(book) && !TABLE_KINDS.has(kind) && kind !== "volcano" && kind !== "column") {
    if (confirm("Bảng đang ở dạng dài (cột nhóm + cột X + cột Y). Tách theo nhóm (Unstack) để mỗi mẫu thành một đường?")) {
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
  if (!series.length) { status("Chưa có cột Y nào: hãy chọn cột (bấm tiêu đề cột) hoặc đặt kiểu cột Y"); return; }
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
  if (!ready) { alert("Python đang tải, thử lại sau vài giây"); throw new Error("Python chưa sẵn sàng"); }
  const cols = JSON.parse(py("unstack", book.id, x, y, gcol));
  cols.forEach((c, i) => { c.name = colLetter(i); });
  let nb;
  mutate(() => { nb = newBook(book.name + "_unstack", cols); }, { books: [], rebuild: false });
  syncBook(nb);
  if (!silent) { P.open.push(nb.id); P.active = nb.id; afterChange(); }
  status(`Đã tách ${book.name} theo cột nhóm → ${nb.name} (${cols.length / 2} mẫu)`);
  return nb;
}
function unstackDialog() {
  const book = activeBook(); if (!book) return status("Hãy mở một workbook");
  const opt = book.cols.map(c => [c.name, `${c.name}: ${dispName(c)}`]);
  const g = book.cols.find(c => c.desig === "L"), X = book.cols.find(c => c.desig === "X"), Y = book.cols.find(c => c.desig === "Y");
  dialog({ title: "Tách theo nhóm (Unstack)", fields: [{ k: "g", label: "Cột nhóm (tên mẫu)", t: "sel", opts: opt }, { k: "x", label: "Cột X", t: "sel", opts: opt }, { k: "y", label: "Cột Y", t: "sel", opts: opt }],
    values: { g: g ? g.name : opt[0][0], x: X ? X.name : opt[0][0], y: Y ? Y.name : opt[1] ? opt[1][0] : opt[0][0] }, okText: "Tách",
    onOk: v => doUnstack(book, v.x, v.y, v.g, false) });
}
function formulaDialog() {
  const book = activeBook(); if (!book) return status("Hãy mở một workbook");
  const j = selectedCols(book)[0]; const c = book.cols[j];
  dialog({ title: `Set Column Values: cột ${c.name}`, fields: [
    { k: "f", label: `${c.name} =`, t: "textarea", help: "Ví dụ: col(B)*1000 · col(B)/0.196 · log10(abs(col(B))) · col(A)+0.059*14 · 1240/col(A) · i (số thứ tự dòng). Hàm: sin, cos, exp, ln, log10, sqrt, abs, mean, max, min" },
    { k: "lname", label: "Long Name", t: "text" }, { k: "units", label: "Units", t: "text" }],
    values: { f: c.formula || "", lname: c.lname, units: c.units }, wide: true, okText: "Tính",
    onOk: v => {
      let arr;
      try { arr = JSON.parse(py("set_column_values", book.id, c.name, v.f)); } catch (e) { alert("Công thức lỗi: " + pyErr(e)); return false; }
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
    ZSTEPS.map(v => `<option value="${v}" ${v === pct ? "selected" : ""}>${v}%</option>`).join("") + '<option value="fit">Vừa khung</option>';
}
let renderBusy = false, renderQueued = null;
function renderGraph(g) {
  const w = $(`.win[data-id="${g.id}"]`); if (!w) return;
  if (!ready) { $(".page", w).style.minWidth = "200px"; return; }
  if (renderBusy) { renderQueued = g; return; }
  renderBusy = true;
  const page = $(".page", w);
  let busy = $(".busy", w); if (!busy) { busy = document.createElement("div"); busy.className = "busy"; busy.textContent = "Đang vẽ…"; $(".canvaswrap", w).appendChild(busy); }
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
      err.textContent = "Không vẽ được hình: " + pyErr(e);
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
  return { plot: "Vùng vẽ — bấm đúp: Plot Details", xaxis: "Trục X — bấm đúp để chỉnh", yaxis: "Trục Y — bấm đúp để chỉnh", y2axis: "Trục Y phải — bấm đúp",
    xlabel: "Nhãn trục X — bấm đúp để sửa", ylabel: "Nhãn trục Y — bấm đúp để sửa", y2label: "Nhãn trục Y phải", title: "Tiêu đề", legend: "Chú giải — kéo để di chuyển, bấm đúp để chỉnh",
    legend_entry: "Series — bấm đúp để đổi màu, ký hiệu, nét", text: "Chữ — kéo để di chuyển, bấm đúp để sửa" }[h.kind] || h.kind;
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
      status(`Đã thêm đường ${tool === "hline" ? "ngang tại Y" : "dọc tại X"} = ${fmtNum(val)} — bấm đúp vùng vẽ → Plot Details để sửa/xoá`);
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
    status("Đã phóng to — Ctrl+R (Rescale) để trở lại");
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
    ["Plot Details…", () => plotDetails(g)], ["Trục X…", () => axisDialog("x", g)], ["Trục Y…", () => axisDialog("y", g)], ["Chú giải…", () => legendDialog(g)],
    ["Trang & khung…", () => pageDialog(g)], "-",
    ["Thêm chữ tại đây", () => d && textDialog(g, null, { fx: d.fx, fy: d.fy })], ["Thêm đường ngang tại đây", () => d && mutate(() => g.reflines.push({ id: "r" + Date.now(), orient: "h", value: +d.y.toPrecision(5), ls: "dash", color: "#777777", lw: 1 }))],
    ["Thêm đường dọc tại đây", () => d && mutate(() => g.reflines.push({ id: "r" + Date.now(), orient: "v", value: +d.x.toPrecision(5), ls: "dash", color: "#777777", lw: 1 }))],
    [g.legend && g.legend.show === false ? "Hiện chú giải" : "Ẩn chú giải", () => mutate(() => { g.legend = g.legend || {}; g.legend.show = g.legend.show === false; })],
    ["Tiêu đề…", () => titleDialog(g)], "-", ["Rescale", () => rescale()], ["Sao chép hình", () => copyImage()], ["Xuất hình…", () => exportDialog()],
  ];
  if (h && h.kind === "text" && String(h.id).startsWith("slab:")) { const i = +h.id.slice(5); items.unshift(["Sửa tên mẫu…", () => sampleLabelDialog(g, i)], ["Ẩn tên này", () => mutate(() => { g.series[i].label_hide = true; })], ["Đặt lại vị trí", () => mutate(() => { delete g.series[i].label_pos; })], ["Đặt lại vị trí mọi tên mẫu", () => mutate(() => g.series.forEach(x => { delete x.label_pos; }))], "-"); }
  else if (h && h.kind === "text" && String(h.id).startsWith("fit:")) { const i = +h.id.slice(4); items.unshift(["Tuỳ chỉnh fit…", () => plotDetails(g, i)], ["Ẩn phương trình", () => mutate(() => { g.series[i].fit_eq = false; })], ["Xoá đường fit", () => mutate(() => { clearFit(g.series[i]); })], "-"); }
  else if (h && h.kind === "text") items.unshift(["Sửa chữ…", () => textDialog(g, h.id)], ["Xoá chữ này", () => mutate(() => { g.texts = g.texts.filter(t => t.id !== h.id); })], "-");
  if (["line", "scatter", "linesymbol", "area", "xps"].includes(g.kind)) items.splice(items.length - 4, 0, ["Fit tuyến tính / đa thức…", () => fitDialog(g)]);
  openPopup($("#ctxmenu"), items, e.clientX, e.clientY);
}
function rescale() {
  const g = activeGraph(); if (!g) return;
  mutate(() => { for (const k of ["xaxis", "yaxis", "y2axis"]) if (g[k]) { delete g[k].min; delete g[k].max; } });
  status("Đã rescale các trục");
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
  m.innerHTML = `<div class="mhd">${esc(title)}<button class="close" title="Đóng">×</button></div><div class="mbody"></div>
    <div class="mft">${buttons.map((b, i) => `<button class="btn ${b.cls || ""}" data-b="${i}" style="${i === 0 ? "margin-right:auto" : ""}">${esc(b.text)}</button>`).join("")}
    ${onApply ? '<button class="btn" data-act="apply">Áp dụng</button>' : ""}<button class="btn" data-act="cancel">Huỷ</button><button class="btn primary" data-act="ok">${esc(okText)}</button></div>`;
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
    case "number": input = `<input type="number" id="${id}" data-k="${f.k}" value="${val ?? ""}" step="${f.step || "any"}" placeholder="${esc(f.ph || "tự động")}">`; break;
    case "color": {
      const rows = typeof f.swatches === "function" ? f.swatches() : f.swatches || [{ name: "Bài báo", colors: PAL.paper.colors }, { name: "Nature", colors: PAL.npg.colors }, { name: "Trung tính", colors: NEUTRAL }];
      input = `<div class="pair"><input type="color" id="${id}" data-k="${f.k}" value="${val || f.def || "#000000"}" style="flex:none;width:46px;height:28px;padding:1px">${f.auto ? `<label style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-auto="${f.k}" ${val ? "" : "checked"}> tự động</label>` : ""}</div>` +
        rows.map(r => `<div class="swrow"><span class="swlab">${esc(r.name)}</span>${r.colors.map(c => `<button type="button" class="swb${String(val).toUpperCase() === c.toUpperCase() ? " on" : ""}" data-sw="${f.k}" data-c="${c}" title="${c}" style="background:${c}"></button>`).join("")}</div>`).join("");
      break;
    }
    case "palette": input = `<div class="pallist">${PALETTE_DEFS.map(p => `<label class="palrow${val === p.id ? " on" : ""}"><input type="radio" name="pal_${f.k}" data-pal="${f.k}" value="${p.id}" ${val === p.id ? "checked" : ""}><span class="palname">${esc(p.name)}</span><span class="strip">${p.colors.map(c => `<i style="background:${c}"></i>`).join("")}</span></label>`).join("")}</div>`; break;
    case "textarea": input = `<textarea id="${id}" data-k="${f.k}">${esc(val ?? "")}</textarea>`; break;
    case "pair": input = `<div class="pair"><input type="number" step="any" data-k="${f.k}" data-i="0" value="${val && val[0] != null ? val[0] : ""}"><input type="number" step="any" data-k="${f.k}" data-i="1" value="${val && val[1] != null ? val[1] : ""}"></div>`; break;
    case "gradient": input = `<div class="pair"><label style="display:flex;gap:4px;align-items:center"><input type="checkbox" data-gon="${f.k}" ${val ? "checked" : ""}> bật</label><input type="color" data-g1="${f.k}" value="${(val || "#F2A0A0,#F0D9A0").split(",")[0]}" style="flex:none;width:46px;height:28px;padding:1px"><input type="color" data-g2="${f.k}" value="${(val || "#F2A0A0,#F0D9A0").split(",")[1]}" style="flex:none;width:46px;height:28px;padding:1px"></div>` +
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
  g = g || activeGraph(); if (!g) return status("Hãy mở một graph");
  const keys = { x: "xaxis", y: "yaxis", y2: "y2axis" };
  const hasY2 = g.series.some(s => s.y2);
  const vals = {};
  for (const [w, k] of Object.entries(keys)) for (const [a, b] of Object.entries(g[k] || {})) vals[w + "_" + a] = b;
  const F = w => [
    { k: w + "_label", label: "Tên trục", t: "text", ph: "tự động (Long Name + Units)", help: "Chỉ số trên: $^{o}$C, cm$^{-2}$ · dưới: g$_{cat}$ · chữ Hy Lạp: $\\eta$, $\\theta$" },
    { k: w + "_label_size", label: "Cỡ chữ tên trục", t: "number", step: 0.5 },
    { k: w + "_label_bold", label: "Tên trục in đậm", t: "bool" },
    { k: w + "_min", label: "Từ (From)", t: "number" }, { k: w + "_max", label: "Đến (To)", t: "number" },
    { k: w + "_step", label: "Bước tick chính (Increment)", t: "number" },
    { k: w + "_minor", label: "Số tick phụ giữa 2 tick chính", t: "sel", opts: [["", "theo theme"], ["0", "0 (không có)"], ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["9", "9"]] },
    { k: w + "_scale", label: "Kiểu thang", t: "sel", opts: [["linear", "Linear"], ["log", "Log10"]] },
    { k: w + "_reverse", label: "Đảo chiều trục", t: "bool" },
    { k: w + "_tick_dir", label: "Hướng tick", t: "sel", opts: [["", "theo theme"], ["in", "vào trong"], ["out", "ra ngoài"], ["inout", "cả hai"]] },
    { k: w + "_tick_size", label: "Cỡ chữ số trên trục", t: "number", step: 0.5 },
    { k: w + "_decimals", label: "Số chữ số thập phân", t: "number", step: 1, ph: "tự động" },
    { k: w + "_hide_ticklabels", label: "Ẩn số trên trục", t: "bool" },
  ];
  const tabs = [{ name: "Trục X (dưới)", fields: F("x") }, { name: "Trục Y (trái)", fields: F("y") }, ...(hasY2 ? [{ name: "Trục Y (phải)", fields: F("y2") }] : [])];
  const apply = v => mutate(() => {
    for (const [w, k] of Object.entries(keys)) {
      const A = {};
      for (const f of F(w)) { const a = f.k.slice(w.length + 1); const val = v[f.k]; if (val !== null && val !== undefined && val !== "" && val !== false) A[a] = f.t === "sel" && a === "minor" ? +val : val; }
      if (A.scale === "linear") delete A.scale;
      g[k] = A;
    }
  });
  const d = dialog({ title: "Trục — " + g.name, tabs, values: vals, onOk: apply, onApply: apply });
  const ti = which === "x" ? 0 : which === "y" ? 1 : 2;
  if (ti) setTimeout(() => { const b = $(`#modal .mtabs button[data-t="${ti}"]`); if (b) b.click(); if (focus === "label") { const f = $(`#modal [data-k="${which}_label"]`); if (f) f.focus(); } }, 0);
  else if (focus === "label") setTimeout(() => { const f = $(`#modal [data-k="x_label"]`); if (f) f.focus(); }, 40);
  return d;
}
function legendDialog(g) {
  g = g || activeGraph(); if (!g) return status("Hãy mở một graph");
  const L = g.legend || {};
  const v = { show: L.show !== false, fontsize: L.fontsize ?? null, frame: !!L.frame, ncol: L.ncol || 1, title: L.title ?? "", pos: Array.isArray(L.loc) ? "custom" : (L.loc || "") };
  const apply = v => mutate(() => {
    const N = { show: v.show, fontsize: v.fontsize, frame: v.frame, ncol: +v.ncol || 1, title: v.title };
    N.loc = v.pos === "custom" ? (g.legend && g.legend.loc) : (v.pos || null);
    g.legend = clean(N); if (!v.show) g.legend.show = false;
  });
  dialog({ title: "Chú giải (Legend)", values: v, onOk: apply, onApply: apply, fields: [
    { k: "show", label: "Hiện chú giải", t: "bool" }, { k: "fontsize", label: "Cỡ chữ", t: "number", step: 0.5 },
    { k: "frame", label: "Có khung viền", t: "bool" }, { k: "ncol", label: "Số cột", t: "number", step: 1 },
    { k: "title", label: "Tiêu đề chú giải", t: "text" },
    { k: "pos", label: "Vị trí", t: "sel", opts: [["", "tự động (best)"], ["custom", "vị trí đã kéo"], ["upper left", "trên-trái"], ["upper right", "trên-phải"], ["lower left", "dưới-trái"], ["lower right", "dưới-phải"], ["center right", "giữa-phải"], ["upper center", "trên-giữa"]], help: "Có thể kéo chú giải trực tiếp trên hình" },
  ] });
}
function titleDialog(g) {
  g = g || activeGraph(); if (!g) return;
  dialog({ title: "Tiêu đề hình", values: { title: g.title || "" }, fields: [{ k: "title", label: "Tiêu đề", t: "text", help: "Để trống để bỏ tiêu đề" }], onOk: v => mutate(() => { g.title = v.title; }) });
}
function textDialog(g, tid, at) {
  g = g || activeGraph(); if (!g) return;
  const t = tid ? g.texts.find(t => t.id === tid) : { text: "", fontsize: null, color: null, bold: false, italic: false };
  dialog({ title: tid ? "Sửa chữ" : "Thêm chữ", values: clone(t), okText: tid ? "OK" : "Thêm",
    buttons: tid ? [{ text: "Xoá", cls: "danger", onClick: (v, close) => { mutate(() => { g.texts = g.texts.filter(x => x.id !== tid); }); close(); } }] : [],
    fields: [{ k: "text", label: "Nội dung", t: "textarea", help: "Ví dụ: (a) · @ 90 $^{o}$C · j = 10 mA cm$^{-2}$ · $\\eta_{10}$ = 260 mV · xuống dòng bằng Enter" },
      { k: "fontsize", label: "Cỡ chữ", t: "number", step: 0.5 }, { k: "color", label: "Màu", t: "color", auto: true },
      { k: "bold", label: "In đậm", t: "bool" }, { k: "italic", label: "In nghiêng", t: "bool" }],
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
  g = g || activeGraph(); if (!g) return status("Hãy mở một graph");
  const v = { w: g.size[0], h: g.size[1], theme: g.theme, font: g.font, fontsize: g.fontsize, palette: g.palette || "okabe", fw: (g.frame || {}).width ?? null, box: (g.frame || {}).box !== false, title: g.title || "" };
  const apply = v => mutate(() => { g.size = [+v.w || 5, +v.h || 4]; g.theme = v.theme; g.font = v.font; g.fontsize = +v.fontsize || 11; g.palette = v.palette; g.frame = clean({ width: v.fw, box: v.box ? null : false }); if (!v.box) g.frame.box = false; g.title = v.title; });
  dialog({ title: "Trang & khung — " + g.name, values: v, onOk: apply, onApply: apply, fields: [
    { k: "w", label: "Rộng (inch)", t: "number", step: 0.1, help: "1 cột bài báo ≈ 3.3 inch, 2 cột ≈ 7 inch" }, { k: "h", label: "Cao (inch)", t: "number", step: 0.1 },
    { k: "theme", label: "Kiểu khung", t: "sel", opts: [["origin", "Origin – khung kín, tick ra ngoài"], ["origin-in", "Origin – khung kín, tick vào trong 4 cạnh"], ["classic", "Chỉ trục trái/dưới"], ["bw", "Khung + lưới"], ["minimal", "Tối giản"]] },
    { k: "fw", label: "Độ dày khung & tick", t: "number", step: 0.1, ph: "theo theme (1.2)" }, { k: "box", label: "Khung kín 4 cạnh", t: "bool" },
    { k: "font", label: "Font", t: "sel", opts: [["sans", "Sans (Arial / Liberation Sans)"], ["serif", "Serif (Times / Liberation Serif)"]] },
    { k: "fontsize", label: "Cỡ chữ chung", t: "number", step: 0.5 },
    { k: "palette", label: "Bảng màu", t: "palette", help: "Đổi bảng màu sẽ đặt lại màu các series chưa chọn màu riêng" },
    { k: "title", label: "Tiêu đề", t: "text" },
  ] });
}
function changeKindDialog() {
  const g = activeGraph(); if (!g) return status("Hãy mở một graph");
  dialog({ title: "Đổi loại hình", values: { kind: g.kind }, fields: [{ k: "kind", label: "Loại hình", t: "sel", opts: KINDS.map(k => [k.id, k.name]) }],
    onOk: v => mutate(() => { g.kind = v.kind; g.opts = { ...(DEFAULT_OPTS[v.kind] || {}), ...(g.opts.label_col ? { label_col: g.opts.label_col } : {}) }; }) });
}

/* ---- Plot details ---- */
const MARKERS = [["default", "mặc định"], ["none", "không"], ["circle", "● tròn"], ["square", "■ vuông"], ["triangle", "▲ tam giác"], ["down", "▼ tam giác ngược"], ["diamond", "◆ thoi"], ["star", "★ sao"], ["pentagon", "⬟ ngũ giác"], ["hexagon", "⬢ lục giác"], ["plus", "✚ cộng"], ["cross", "✖ chéo"]];
const ECHEM = [
  { k: "ref", label: "Điện cực so sánh khi đo", t: "sel", opts: ["RHE", "SHE", "Ag/AgCl", "Ag/AgCl(3M)", "Ag/AgCl(3.5M)", "SCE", "Hg/HgO", "Hg/HgO(0.1M)", "Hg/Hg2SO4"].map(r => [r, r]) },
  { k: "pH", label: "pH", t: "number", step: 0.5, show: v => v.ref && v.ref !== "RHE" },
  { k: "E_ref", label: "E°(ref) tự nhập (V)", t: "number", step: 0.001, ph: "dùng giá trị chuẩn" },
  { k: "current_unit", label: "Đơn vị cột dòng", t: "sel", opts: [["mA/cm2", "mA/cm²"], ["mA", "mA"], ["A", "A"], ["uA", "µA"], ["A/cm2", "A/cm²"]] },
  { k: "area", label: "Diện tích điện cực (cm²)", t: "number", step: 0.001, ph: "bỏ qua" },
  { k: "R", label: "R bù iR (Ω)", t: "number", step: 0.1, ph: "không bù" },
];
const HATCHES = [["", "/// (mặc định)"], ["///", "/// chéo phải"], ["\\\\\\", "\\\\\\ chéo trái"], ["xxx", "xxx ô chéo"], ["|||", "||| dọc"], ["---", "--- ngang"], ["...", "... chấm"], ["ooo", "ooo vòng"]];
const KIND_OPTS = {
  xps: [{ k: "peak_fill", label: "Tô các peak", t: "sel", opts: [["gradient", "Gradient mờ dần về đường nền"], ["solid", "Tô đặc trong suốt"], ["hatch", "Gạch chéo (hatch)"], ["none", "Chỉ viền, không tô"]] },
    { k: "fill_alpha", label: "Độ đậm vùng tô (0–1)", t: "number", step: 0.05, ph: "0.55 gradient / 0.35 đặc" },
    { k: "hatch", label: "Kiểu gạch (khi chọn hatch)", t: "sel", opts: HATCHES.slice(1) },
    { k: "hide_y", label: "Ẩn số trục Y (a.u.)", t: "bool" }],
  column: [{ k: "gradient", label: "Tô gradient (trên, dưới)", t: "gradient" }, { k: "value_labels", label: "Ghi giá trị trên cột", t: "bool" },
    { k: "value_fmt", label: "Định dạng số", t: "text", ph: "{:.4g}", help: "{:.2f} = 2 chữ số thập phân" }, { k: "rotate_x", label: "Xoay nhãn trục X (độ)", t: "number" },
    { k: "width", label: "Độ rộng nhóm cột (0–1)", t: "number", step: 0.05, ph: "0.8" }, { k: "edgecolor", label: "Màu viền cột", t: "color", auto: true }],
  spectra: [{ k: "kind", label: "Loại phổ", t: "sel", opts: [["xrd", "XRD (2θ)"], ["raman", "Raman"], ["ftir", "FTIR (đảo trục)"], ["xps", "XPS (đảo trục)"], ["uvvis", "UV-Vis"], ["pl", "PL"]] },
    { k: "normalize", label: "Chuẩn hoá mỗi phổ [0,1]", t: "bool" }, { k: "offset", label: "Khoảng cách giữa các phổ", t: "number", step: 0.05, ph: "tự động" },
    { k: "smooth", label: "Làm mượt (cửa sổ SG)", t: "number", step: 2, ph: "tắt" },
    { k: "labels", label: "Tên mẫu", t: "sel", opts: [["right", "ghi trên đầu phải mỗi phổ (kéo được)"], ["legend", "trong chú giải"], ["none", "không hiện"]] },
    { k: "label_size", label: "Cỡ chữ tên mẫu", t: "number", step: 0.5, ph: "theo hình" },
    { k: "first_on_top", label: "Mẫu đầu tiên nằm trên cùng", t: "bool" },
    { k: "phases", label: "Ký hiệu pha (JSON)", t: "text", ph: '{"CuO":[35.5,38.7]}' }, { k: "hkl", label: "Chỉ số hkl", t: "text", ph: "28.5:(111),33.1:(200)" }],
  lsv: [...ECHEM, { k: "reaction", label: "Phản ứng", t: "sel", opts: [["OER", "OER"], ["HER", "HER"], ["", "khác"]] }, { k: "j_mark", label: "Tính η tại |j| (mA cm⁻²)", t: "number", ph: "10" }],
  tafel: [...ECHEM, { k: "reaction", label: "Phản ứng", t: "sel", opts: [["OER", "OER"], ["HER", "HER"]] }, { k: "fit_range", label: "Khoảng fit |j| (mA cm⁻²)", t: "pair" },
    { k: "slope_labels", label: "Ghi độ dốc", t: "sel", opts: [["legend", "trong chú giải"], ["text", "cạnh đường fit"]] }],
  cv: [...ECHEM], cdl: [{ k: "half", label: "Chia đôi (Δj/2)", t: "bool" }],
  nyquist: [{ k: "lines", label: "Nối điểm", t: "bool" }, { k: "equal", label: "Tỉ lệ 1:1", t: "bool" }, { k: "unit", label: "Đơn vị", t: "text", ph: "Ω" }],
  bet: [{ k: "calc", label: "Tính S_BET (0.05–0.30)", t: "bool" }],
  tauc: [{ k: "transition", label: "Chuyển mức", t: "sel", opts: [["direct", "trực tiếp (αhν)²"], ["indirect", "gián tiếp (αhν)^½"]] }, { k: "fit_range", label: "Khoảng fit (eV) vd 3.2,3.4", t: "text" }, { k: "energy_input", label: "Cột X đã là eV", t: "bool" }],
  box: [{ k: "kind", label: "Kiểu", t: "sel", opts: [["box", "box"], ["violin", "violin"]] }, { k: "points", label: "Hiện điểm dữ liệu", t: "bool" }, { k: "filled", label: "Tô đặc", t: "bool" }, { k: "show_mean", label: "Đánh dấu trung bình", t: "bool" }],
  histogram: [{ k: "bins", label: "Số bins", t: "number", ph: "30" }, { k: "binwidth", label: "Độ rộng bin", t: "number", ph: "theo số bins" }, { k: "density", label: "Mật độ", t: "bool" }, { k: "kde", label: "Đường KDE", t: "bool" },
    { k: "multiple", label: "Nhiều nhóm", t: "sel", opts: [["overlay", "chồng mờ"], ["stack", "xếp chồng"], ["dodge", "cạnh nhau"]] }],
  pca: [{ k: "scale", label: "Chuẩn hoá", t: "bool" }, { k: "ellipse", label: "Elip tin cậy", t: "bool" }, { k: "level", label: "Mức tin cậy", t: "number", step: 0.01, ph: "0.95" }, { k: "loadings", label: "Biplot", t: "bool" }],
  heatmap: [{ k: "scale", label: "Scale", t: "sel", opts: [["row", "theo hàng"], ["column", "theo cột"], ["none", "không"]] }, { k: "cluster_rows", label: "Phân cụm hàng", t: "bool" }, { k: "cluster_cols", label: "Phân cụm cột", t: "bool" },
    { k: "cmap", label: "Thang màu", t: "sel", opts: [["navy-white-red", "navy-white-red"], ["blue-white-red", "blue-white-red"], ["pheatmap", "pheatmap"], ["viridis", "viridis"], ["magma", "magma"]] },
    { k: "cutree_rows", label: "Tách hàng thành … cụm", t: "number" }, { k: "cutree_cols", label: "Tách cột thành … cụm", t: "number" }, { k: "show_values", label: "Ghi giá trị", t: "bool" }],
  volcano: [{ k: "fc_thr", label: "Ngưỡng |log2FC|", t: "number", ph: "1" }, { k: "p_thr", label: "Ngưỡng p", t: "number", ph: "0.05" }, { k: "top", label: "Số gene gắn nhãn", t: "number", ph: "10" }],
};
const FIT_TYPES = [["", "không"], ["linear", "Tuyến tính  y = ax + b"], ["linear0", "Tuyến tính qua gốc  y = ax"], ["poly2", "Đa thức bậc 2"], ["poly3", "Đa thức bậc 3"]];
const FIT_FIELDS = p => [
  { k: p + "fit", label: "Fit (hồi quy)", t: "sel", opts: FIT_TYPES },
  { k: p + "fit_from", label: "Fit từ X =", t: "number", ph: "đầu dữ liệu", show: v => v[p + "fit"] },
  { k: p + "fit_to", label: "đến X =", t: "number", ph: "cuối dữ liệu", show: v => v[p + "fit"] },
  { k: p + "fit_eq", label: "Ghi phương trình và R² lên hình", t: "bool", show: v => v[p + "fit"] },
  { k: p + "fit_extend", label: "Kéo dài đường fit hết trục X", t: "bool", show: v => v[p + "fit"] },
  { k: p + "fit_color", label: "Màu đường fit", t: "color", auto: true, show: v => v[p + "fit"] },
  { k: p + "fit_ls", label: "Kiểu nét fit", t: "sel", opts: [["solid", "liền —"], ["dash", "đứt – –"], ["dot", "chấm ···"]], show: v => v[p + "fit"] },
  { k: p + "fit_lw", label: "Độ dày nét fit", t: "number", step: 0.1, ph: "1.4", show: v => v[p + "fit"] },
  { k: p + "fit_size", label: "Cỡ chữ phương trình", t: "number", step: 0.5, ph: "theo hình", show: v => v[p + "fit"] },
];
const FIT_KEYS = ["fit", "fit_from", "fit_to", "fit_eq", "fit_extend", "fit_color", "fit_ls", "fit_lw", "fit_size", "fit_pos"];
function clearFit(s) { for (const k of FIT_KEYS) delete s[k]; }
function sampleLabelDialog(g, i) {
  const s0 = g.series[i]; if (!s0) return;
  const book = byId(g.book); const col = book.cols.find(c => c.name === s0.y) || { name: s0.y };
  const v = { label: s0.label || "", label_size: s0.label_size ?? null, label_color: s0.label_color || null, label_bold: !!s0.label_bold, show: !s0.label_hide };
  dialog({ title: "Tên mẫu", values: v, fields: [
    { k: "label", label: "Nội dung", t: "text", ph: dispName(col), help: "Để trống = theo Long Name của cột. Chỉ số: CeO$_2$, Cu$^{2+}$" },
    { k: "label_size", label: "Cỡ chữ", t: "number", step: 0.5, ph: "theo hình" },
    { k: "label_color", label: "Màu", t: "color", auto: true, swatches: () => [{ name: "Bài báo", colors: PAL.paper.colors }, { name: "Trung tính", colors: NEUTRAL }] },
    { k: "label_bold", label: "In đậm", t: "bool" }, { k: "show", label: "Hiện tên này", t: "bool" }],
    buttons: [{ text: "Đặt lại vị trí", onClick: (vv, close) => { mutate(() => { delete s0.label_pos; }); close(); } }],
    extra: '<p class="note">Kéo tên mẫu trên hình để di chuyển, hoặc bấm chọn rồi dùng phím mũi tên để nhích (Shift = bước lớn).</p>',
    onOk: vv => mutate(() => {
      for (const [k, val] of [["label", vv.label], ["label_size", vv.label_size], ["label_color", vv.label_color]]) { if (val === null || val === "") delete s0[k]; else s0[k] = val; }
      if (vv.label_bold) s0.label_bold = true; else delete s0.label_bold;
      if (vv.show) delete s0.label_hide; else s0.label_hide = true;
    }) });
}
function fitDialog(g) {
  g = g || activeGraph(); if (!g) return status("Hãy mở một graph trước");
  if (!["line", "scatter", "linesymbol", "area", "xps"].includes(g.kind)) {
    if (!confirm(`Fit dùng cho hình Scatter / Line / Line + Symbol. Đổi "${g.name}" (${kindName(g.kind)}) sang Scatter để fit?`)) return;
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
    ...FIT_FIELDS("").map(f => f.k === "fit" ? { ...f, label: "Kiểu fit", opts: FIT_TYPES.map(o => o[0] ? o : ["", "bỏ fit"]) } : { ...f, show: vv => vv.fit }),
  ], extra: '<p class="note">Kết quả a, b, sai số chuẩn (SE), R² hiện ở khung Kết quả tính bên dưới, và đưa được vào workbook. Phương trình trên hình kéo đi được; bấm đúp để chỉnh.</p>',
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
  g = g || activeGraph(); if (!g) return status("Hãy mở một graph");
  const book = byId(g.book);
  const work = clone(g);
  let cur = Math.min(focusIndex ?? 0, Math.max(0, work.series.length - 1));
  work.palette = work.palette || "paper";
  const curPal = () => palColors(work.palette, work.series.length);
  const colOpts = (none) => [...(none ? [["", "— không —"]] : []), ...book.cols.map(c => [c.name, `${c.name}: ${dispName(c)}`])];
  const generic = ["line", "scatter", "linesymbol", "area", "column", "xps"].includes(g.kind);
  const lineish = generic && g.kind !== "column";
  const SF = [
    { k: "label", label: "Tên trong chú giải", t: "text", ph: "theo Long Name" },
    { k: "y", label: "Cột Y", t: "sel", opts: colOpts(false) }, ...(TABLE_KINDS.has(g.kind) ? [] : [{ k: "x", label: "Cột X", t: "sel", opts: colOpts(true) }]),
    ...(generic ? [{ k: "yerr", label: "Cột sai số Y", t: "sel", opts: colOpts(true) }] : []),
    ...(g.kind === "xps" ? [{ k: "role", label: "Vai trò (XPS)", t: "sel", opts: [["", "tự nhận theo tên cột"], ["raw", "Raw (dữ liệu đo)"], ["bg", "Background"], ["env", "Envelope (tổng fit)"], ["peak", "Peak thành phần"]] }] : []),
    { k: "color", label: "Màu", t: "color", auto: true, swatches: () => [{ name: "Bảng màu hình", colors: [...new Set(curPal())] }, { name: "Bài báo", colors: PAL.paper.colors }, { name: "Nature", colors: PAL.npg.colors }, { name: "Trung tính", colors: NEUTRAL }] },
    ...(generic && g.kind !== "column" ? [
      { k: "marker", label: "Ký hiệu (Symbol)", t: "sel", opts: MARKERS }, { k: "ms", label: "Cỡ ký hiệu", t: "number", step: 0.5, ph: "6" },
      { k: "mew", label: "Độ dày viền ký hiệu", t: "number", step: 0.1, ph: "tự động (≈ 0.7 × độ dày nét)" },
      { k: "mec", label: "Màu viền ký hiệu", t: "color", auto: true, swatches: () => [{ name: "Trung tính", colors: NEUTRAL }, { name: "Bảng màu hình", colors: [...new Set(curPal())] }] },
      { k: "fill", label: "Tô ký hiệu", t: "sel", opts: [["", "mặc định"], ["solid", "đặc"], ["hollow", "rỗng (nền trắng)"], ["none", "trong suốt"]] },
      { k: "ls", label: "Kiểu nét", t: "sel", opts: [["", "mặc định"], ["solid", "liền —"], ["dash", "đứt – –"], ["dot", "chấm ···"], ["dashdot", "gạch chấm –·"], ["none", "không nối"]] }] : []),
    ...(g.kind !== "column" ? [{ k: "lw", label: "Độ dày nét", t: "number", step: 0.1, ph: "1.6" }] : []),
    ...(generic ? [{ k: "alpha", label: "Độ đậm (0–1)", t: "number", step: 0.05, ph: "1" }, { k: "capsize", label: "Đầu thanh sai số", t: "number", step: 0.5, ph: "3" }] : []),
    ...(generic && g.kind !== "column" ? [{ k: "y2", label: "Vẽ theo trục Y bên phải", t: "bool" }] : []),
    ...(lineish ? [
      { k: "fill_mode", label: "Tô vùng dưới đường", t: "sel", opts: [["", g.kind === "xps" ? "theo tuỳ chọn XPS" : g.kind === "area" ? "đặc (mặc định Area)" : "không tô"], ["solid", "Tô đặc trong suốt"], ["gradient", "Gradient mờ dần về đường nền"], ["hatch", "Gạch chéo (hatch)"], ["none", "Không tô"]] },
      { k: "fill_to", label: "Tô xuống tới", t: "sel", opts: [["", g.kind === "xps" ? "Background (tự nhận)" : "trục 0"], ...colOpts(false)] },
      { k: "fill_color", label: "Màu tô", t: "color", auto: true, swatches: () => [{ name: "Bảng màu hình", colors: [...new Set(curPal())] }, { name: "Bài báo", colors: PAL.paper.colors }] },
      { k: "fill_alpha", label: "Độ đậm vùng tô (0–1)", t: "number", step: 0.05, ph: "0.35–0.55" },
      { k: "hatch", label: "Kiểu gạch", t: "sel", opts: HATCHES }] : []),
    ...(lineish ? FIT_FIELDS("") : []),
    { k: "visible", label: "Hiện series này", t: "bool" },
  ];
  const KO = KIND_OPTS[g.kind] || [];
  const ovals = { ...Object.fromEntries(KO.filter(f => f.t === "bool").map(f => [f.k, BOOL_DEFAULTS[f.k] ?? false])), ...work.opts };
  const seriesTab = {
    name: "Series (Plot)",
    html: () => {
      const s = work.series[cur] || {};
      const sv = { visible: true, marker: "default", fit_eq: true, ...s };
      const pal = curPal();
      return `<div class="pdgrid"><div><label class="note" style="display:block;margin:0 0 3px">Bảng màu cho cả hình</label><select data-pdpal style="width:100%;margin-bottom:4px">${PALETTE_DEFS.map(p => `<option value="${p.id}" ${p.id === work.palette ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
        <div class="strip big" style="margin-bottom:8px">${palColors(work.palette, Math.max(work.series.length, PAL[work.palette] && PAL[work.palette].seq ? work.series.length : 8)).map(c => `<i style="background:${c}"></i>`).join("")}</div>
        <div class="slist">${work.series.map((x, i) => `<div class="si${i === cur ? " on" : ""}" data-i="${i}"><span class="sw" style="background:${x.color || pal[i % pal.length]}"></span>${esc(plainMath(x.label || dispName(book.cols.find(c => c.name === x.y) || { name: x.y })))}${work.series.some((o, j) => j !== i && o.y === x.y) ? ' <span title="Series này trùng cột với series khác — đổi Cột Y" style="color:#b00020">⚠</span>' : ""}</div>`).join("") || '<div class="si">(chưa có series)</div>'}</div>
        <div class="sbtns"><button class="btn" data-sa="add">+ Thêm</button><button class="btn" data-sa="del">Xoá</button><button class="btn" data-sa="up">▲</button><button class="btn" data-sa="down">▼</button></div>
        <div class="sbtns"><button class="btn" data-sa="applyall" title="Áp kiểu ký hiệu/nét/cỡ của series này cho mọi series">Áp kiểu cho tất cả</button></div></div>
        <div>${work.series.length ? `<div class="fgrid">${SF.map(f => fieldHTML(f, sv)).join("")}</div>` : ""}</div></div>`;
    },
    read: (root) => { const s = work.series[cur]; if (!s) return; const v = readFields(root, SF, { ...s }); Object.assign(s, v); for (const k of Object.keys(s)) if (s[k] === "" || s[k] === null || s[k] === undefined) delete s[k]; if (!s.y2) delete s.y2; if (s.visible !== false) delete s.visible; if (s.marker === "default") delete s.marker; if (!s.fit) { for (const k of FIT_KEYS) delete s[k]; } else if (s.fit_eq === true) delete s.fit_eq; if (s.fit_extend === false) delete s.fit_extend; },
    bind: (root, _v, redraw) => {
      const fsel = $('[data-k="fit"]', root); if (fsel) fsel.addEventListener("change", () => { seriesTab.read(root); redraw(); });
      const ps = $("[data-pdpal]", root); if (ps) ps.onchange = () => { seriesTab.read(root); work.palette = ps.value; work.series.forEach(x => { delete x.color; }); redraw(); status("Đã đổi bảng màu — màu từng series đặt lại theo bảng mới"); };
      $$(".si[data-i]", root).forEach(el => el.onclick = () => { seriesTab.read(root); cur = +el.dataset.i; redraw(); });
      $$("[data-sa]", root).forEach(b => b.onclick = () => {
        seriesTab.read(root);
        const a = b.dataset.sa;
        if (a === "add") {
          const yc = book.cols.find(c => c.desig === "Y" && !work.series.some(s => s.y === c.name)) || book.cols.find(c => colIsNumeric(c) && c.desig !== "X" && !work.series.some(s => s.y === c.name));
          if (!yc) { alert("Mọi cột số trong workbook đã được vẽ. Thêm cột mới vào workbook trước, hoặc đổi 'Cột Y' của một series."); return; }
          let x = null; const yi = book.cols.indexOf(yc); for (let k = yi - 1; k >= 0; k--) if (book.cols[k].desig === "X") { x = book.cols[k].name; break; }
          work.series.push({ x: x || (work.series[cur] || {}).x, y: yc.name }); cur = work.series.length - 1;
        }
        if (a === "del" && work.series.length) { work.series.splice(cur, 1); cur = Math.max(0, cur - 1); }
        if (a === "up" && cur > 0) { [work.series[cur - 1], work.series[cur]] = [work.series[cur], work.series[cur - 1]]; cur--; }
        if (a === "down" && cur < work.series.length - 1) { [work.series[cur + 1], work.series[cur]] = [work.series[cur], work.series[cur + 1]]; cur++; }
        if (a === "applyall") { const s = work.series[cur]; for (const o of work.series) for (const k of ["marker", "ms", "mew", "mec", "fill", "ls", "lw", "alpha", "capsize"]) if (s[k] !== undefined) o[k] = s[k]; else delete o[k]; status("Đã áp kiểu cho mọi series"); }
        redraw();
      });
    },
  };
  const optTab = { name: "Tuỳ chọn " + kindName(g.kind), fields: KO };
  const refTab = {
    name: "Đường tham chiếu",
    html: () => `<div class="fgrid">${(work.reflines || []).map((r, i) => `<label>${r.orient === "h" ? "Ngang tại Y =" : "Dọc tại X ="}</label><div class="pair"><input type="number" step="any" data-rv="${i}" value="${r.value}"><select data-rs="${i}">${[["dash", "đứt"], ["solid", "liền"], ["dot", "chấm"]].map(([a, b]) => `<option value="${a}" ${r.ls === a ? "selected" : ""}>${b}</option>`).join("")}</select><input type="color" data-rc="${i}" value="${r.color || "#777777"}" style="flex:none;width:40px"><button class="btn danger" data-rd="${i}">Xoá</button></div>`).join("") || '<div class="full note">Chưa có. Dùng công cụ đường ngang/dọc trên thanh công cụ, hoặc bấm nút dưới.</div>'}
      <div class="full sbtns"><button class="btn" data-ra="h">+ Đường ngang</button><button class="btn" data-ra="v">+ Đường dọc</button></div></div>`,
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
function copyFormat() { const g = activeGraph(); if (!g) return status("Hãy mở một graph"); copiedFormat = styleOf(g); status(`Đã sao chép định dạng của ${g.name} — mở hình khác rồi chọn Graph → Paste Format`); }
function pasteFormat() { const g = activeGraph(); if (!g || !copiedFormat) return status(copiedFormat ? "Hãy mở graph cần dán" : "Chưa sao chép định dạng nào"); mutate(() => applyStyle(g, copiedFormat)); status("Đã dán định dạng"); }
function loadTemplates() { try { return JSON.parse(localStorage.getItem("sciplot.templates") || "{}"); } catch (e) { return {}; } }
function saveTemplate() {
  const g = activeGraph(); if (!g) return status("Hãy mở một graph");
  const name = prompt("Tên template (vd: Bài báo 1 cột, ACS):", g.name); if (!name) return;
  const T = loadTemplates(); T[name] = styleOf(g);
  try { localStorage.setItem("sciplot.templates", JSON.stringify(T)); status(`Đã lưu template "${name}" trên trình duyệt này`); } catch (e) { status("Không lưu được template (bộ nhớ trình duyệt bị chặn)"); }
}
function applyTemplateDialog() {
  const g = activeGraph(); if (!g) return status("Hãy mở một graph");
  const T = loadTemplates(); const names = Object.keys(T);
  const builtin = { "Bài báo 1 cột (3.3 × 2.6 in, Arial 8)": { size: [3.3, 2.6], fontsize: 8, font: "sans", theme: "origin", frame: { width: 1 } },
    "Bài báo 2 cột (7 × 4 in, Arial 10)": { size: [7, 4], fontsize: 10, font: "sans", theme: "origin" },
    "Slide PowerPoint (6 × 4.5 in, chữ 16)": { size: [6, 4.5], fontsize: 16, font: "sans", theme: "origin", frame: { width: 1.6 } },
    "Kiểu Times, tick vào trong": { font: "serif", theme: "origin-in" },
    "Nature – 1 cột (89 mm, Arial 7 pt, bảng màu Nature)": { size: [3.5, 2.8], fontsize: 7, font: "sans", theme: "origin", frame: { width: 0.8 }, palette: "npg" },
    "Nature – 2 cột (183 mm, Arial 7 pt)": { size: [7.2, 4.2], fontsize: 7, font: "sans", theme: "origin", frame: { width: 0.8 }, palette: "npg" },
    "ACS – 1 cột (3.25 in, Arial 8 pt, pastel bài báo)": { size: [3.25, 2.7], fontsize: 8, font: "sans", theme: "origin", frame: { width: 1 }, palette: "paper" },
    "ACS – 2 cột (7 in, Arial 9 pt)": { size: [7, 4.2], fontsize: 9, font: "sans", theme: "origin", frame: { width: 1 }, palette: "paper" } };
  const all = { ...builtin, ...T };
  dialog({ title: "Áp dụng template", values: { t: Object.keys(all)[0] }, fields: [{ k: "t", label: "Template", t: "sel", opts: Object.keys(all).map(n => [n, (T[n] ? "★ " : "") + n]) }],
    extra: names.length ? "" : '<p class="note">Lưu template của riêng bạn: Graph → Lưu làm template.</p>',
    buttons: names.length ? [{ text: "Xoá template đã chọn", cls: "danger", onClick: v => { if (!T[v.t]) return; delete T[v.t]; try { localStorage.setItem("sciplot.templates", JSON.stringify(T)); } catch (e) { } return "close"; } }] : [],
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
  const g = activeGraph(); if (!g) return status("Hãy mở một graph để xuất");
  dialog({ title: "Xuất hình — " + g.name, values: { fmt: "png", dpi: 600, tr: false, name: g.name }, okText: "Xuất",
    fields: [{ k: "fmt", label: "Định dạng", t: "sel", opts: [["png", "PNG (ảnh)"], ["tiff", "TIFF (tạp chí yêu cầu)"], ["pdf", "PDF (vector)"], ["svg", "SVG (vector, sửa được)"]] },
      { k: "dpi", label: "Độ phân giải (dpi)", t: "sel", opts: [["300", "300"], ["600", "600"], ["1200", "1200"]] }, { k: "tr", label: "Nền trong suốt", t: "bool" }, { k: "name", label: "Tên file", t: "text" }],
    onOk: v => { try { download(py("export_graph", JSON.stringify(g), v.fmt, +v.dpi, v.tr), MIME[v.fmt], `${v.name || g.name}.${v.fmt === "tiff" ? "tif" : v.fmt}`); status("Đã xuất " + v.fmt.toUpperCase()); } catch (e) { alert("Lỗi xuất hình: " + pyErr(e)); } } });
}
function panelDialog() {
  if (!P.graphs.length) return status("Chưa có graph nào");
  const v = { ncol: Math.min(2, P.graphs.length), tags: "(a)", fmt: "pdf", dpi: 600, name: "Figure" };
  P.graphs.forEach(g => { v["g_" + g.id] = true; });
  dialog({ title: "Ghép nhiều hình thành 1 figure", values: v, okText: "Xuất figure", fields: [
    ...P.graphs.map(g => ({ k: "g_" + g.id, label: g.name, t: "bool" })),
    { k: "ncol", label: "Số cột", t: "number", step: 1 }, { k: "tags", label: "Nhãn", t: "sel", opts: [["(a)", "(a) (b) (c)"], ["a", "a b c"], ["A", "A B C"], ["", "không"]] },
    { k: "fmt", label: "Định dạng", t: "sel", opts: [["pdf", "PDF"], ["png", "PNG"], ["tiff", "TIFF"], ["svg", "SVG"]] },
    { k: "dpi", label: "dpi", t: "sel", opts: [["300", "300"], ["600", "600"]] }, { k: "name", label: "Tên file", t: "text" }],
    onOk: v => {
      const gs = P.graphs.filter(g => v["g_" + g.id]); if (!gs.length) return false;
      try { download(py("export_panel", JSON.stringify({ graphs: gs, ncol: +v.ncol || 2, tags: v.tags }), v.fmt, +v.dpi, false), MIME[v.fmt], `${v.name}.${v.fmt === "tiff" ? "tif" : v.fmt}`); }
      catch (e) { alert("Lỗi: " + pyErr(e)); return false; }
    } });
}
async function copyImage() {
  const g = activeGraph(); if (!g) return status("Hãy mở một graph");
  try {
    const b64 = py("export_graph", JSON.stringify(g), "png", 300, false);
    const bin = atob(b64), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([arr], { type: "image/png" }) })]);
    status("Đã sao chép hình (300 dpi) — dán vào Word/PowerPoint bằng Ctrl+V / ⌘V");
  } catch (e) { status("Trình duyệt không cho sao chép ảnh — dùng Xuất hình thay thế"); }
}

/* ================================================================== project files */
function saveProject() {
  const name = (P.graphs[0] && P.graphs[0].name) || (P.books[0] && P.books[0].name) || "project";
  downloadBlob(new Blob([JSON.stringify(P)], { type: "application/json" }), `${name}.sciplot.json`);
  status("Đã lưu project — mở lại bằng File → Mở project");
}
async function openProjectFile(file) {
  try { const p = JSON.parse(await file.text()); if (!p.books || !p.graphs) throw new Error("không phải file project SciPlot"); loadProject(p); status("Đã mở " + file.name); }
  catch (e) { alert("Không mở được project: " + e.message); }
}
function loadProject(p) {
  undoStack.push(snapshot());
  P = { ...newProject(), ...p }; $$(".win").forEach(w => w.remove());
  for (const b of P.books) syncBook(b); afterChange();
}
function restoreAutosave() {
  let s = null; try { s = localStorage.getItem("sciplot.autosave"); } catch (e) { }
  if (!s) return status("Không có phiên làm việc nào được lưu tạm trên trình duyệt này");
  loadProject(JSON.parse(s)); status("Đã khôi phục phiên làm việc trước");
}
function confirmNewProject() { if (confirm("Đóng project hiện tại và bắt đầu project mới? (Có thể Hoàn tác)")) loadProject(newProject()); }

/* ================================================================== results */
function showResults(res, g) {
  const R = $("#results");
  if (!res || !res.length) { R.innerHTML = `<div class="empty">${g ? "Loại hình này không có giá trị tính toán." : "Kết quả tính (η10, Tafel, S_BET, Eg, Cdl…) hiện ở đây khi vẽ các hình điện hoá/vật liệu."}</div>`; return; }
  const cols = Object.keys(res[0]);
  R.innerHTML = `<table><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr>${res.map(r => `<tr>${cols.map(c => `<td>${r[c] === null ? "" : esc(typeof r[c] === "number" ? +r[c].toPrecision(6) : r[c])}</td>`).join("")}</tr>`).join("")}</table>
    <button class="mini" id="res2book" style="margin-top:6px">Đưa vào workbook mới</button>`;
  $("#res2book").onclick = () => {
    const cols2 = cols.map((c, i) => ({ name: colLetter(i), lname: c, units: "", comment: g ? g.name : "", desig: i === 0 ? "L" : "Y", data: res.map(r => r[c]) }));
    let b; mutate(() => { b = newBook((g ? g.name : "Results") + "_kq", cols2); P.open.push(b.id); P.active = b.id; }, { books: [] }); syncBook(b);
  };
}

/* ================================================================== help */
function helpDialog() {
  dialog({ title: "Hướng dẫn nhanh", wide: true, okText: "Đóng", fields: [], extra: `<div style="line-height:1.55">
    <p><b>1. Dữ liệu.</b> File → Nhập dữ liệu (Excel/CSV/TXT) hoặc dán từ Excel. Dòng tiêu đề tự thành <i>Long Name</i>, dòng đơn vị thành <i>Units</i> như Origin. Có thể gõ/dán trực tiếp vào worksheet.</p>
    <p><b>2. Kiểu cột.</b> Chuột phải tiêu đề cột → X / Y / Y Error / Label. Khi vẽ, mỗi cột Y dùng cột X gần nhất bên trái; cột Y Error ngay bên phải thành thanh sai số.</p>
    <p><b>3. Vẽ.</b> Chọn cột Y (bấm tiêu đề, giữ Ctrl/Shift chọn nhiều) → menu Plot hoặc nút trên thanh công cụ. Bảng dạng dài (cột tên mẫu) sẽ được đề nghị tách theo nhóm.</p>
    <p><b>4. Chỉnh hình.</b> Bấm đúp: trục → hộp Axis (khoảng, bước tick, tick phụ, log, đảo trục, cỡ chữ); nhãn trục → sửa tên; chú giải → Legend; tên series trong chú giải → màu/ký hiệu/nét của series đó; vùng vẽ → Plot Details. Kéo chú giải hoặc chữ để di chuyển; mũi tên bàn phím để dịch từng chút.</p>
    <p><b>5. Công cụ.</b> Phóng to bằng khung chọn, thêm chữ, đường tham chiếu; Ctrl+R để rescale. Graph → Copy/Paste Format để mọi hình cùng kiểu; Lưu làm template để dùng lại.</p>
    <p><b>6. Xuất.</b> File → Xuất hình (PNG/TIFF 600 dpi, PDF/SVG vector); Edit → Sao chép hình để dán vào PowerPoint; File → Ghép nhiều hình để tạo figure (a)(b)(c). File → Lưu project để làm tiếp sau.</p></div>` });
}
function shortcutsDialog() {
  dialog({ title: "Phím tắt", okText: "Đóng", fields: [], extra: `<table style="font-size:13px;line-height:1.8">${[["Ctrl/⌘ Z · Y", "Hoàn tác · làm lại"], ["Ctrl/⌘ S", "Lưu project"], ["Ctrl/⌘ O", "Mở project"], ["Ctrl/⌘ I", "Nhập dữ liệu"], ["Ctrl/⌘ E", "Xuất hình"], ["Ctrl/⌘ R", "Rescale"], ["F4", "Plot Details"], ["F5", "Hộp thoại trục"], ["Ctrl/⌘ Q", "Set Column Values"], ["Del", "Xoá chữ/đối tượng đang chọn"], ["Mũi tên", "Dịch chữ/chú giải đang chọn · di chuyển ô trong worksheet"], ["Esc", "Về công cụ chọn"], ["Enter / F2", "Sửa ô worksheet"], ["Ctrl/⌘ C · V", "Sao chép / dán ô, cột (tương thích Excel)"]].map(([a, b]) => `<tr><td style="padding-right:18px"><kbd>${a}</kbd></td><td>${b}</td></tr>`).join("")}</table>` });
}

/* ================================================================== PWA */
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; });
function installApp() {
  if (installEvt) { installEvt.prompt(); installEvt.userChoice.then(() => { installEvt = null; }); return; }
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  dialog({ title: "Cài SciPlot như một app", okText: "Đóng", fields: [], extra: standalone ? "<p>SciPlot đang chạy ở chế độ app rồi.</p>" : `<div style="line-height:1.6">
    <p><b>Safari trên Mac (macOS 14 trở lên):</b> menu <i>File → Add to Dock…</i></p>
    <p><b>Chrome / Edge:</b> bấm biểu tượng cài đặt ở cuối thanh địa chỉ, hoặc menu ⋮ → <i>Cast, save and share → Install page as app</i>.</p>
    <p><b>iPad / iPhone:</b> nút Chia sẻ → <i>Add to Home Screen</i>.</p>
    <p class="note">Sau lần mở đầu tiên (có mạng), app chạy được cả khi không có Internet.</p></div>` });
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
  const t = sheetCopy(); if (t === null) return; e.preventDefault(); e.clipboardData.setData("text/plain", t); status("Đã sao chép");
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
  if (saved) status("Có phiên làm việc trước — File → Khôi phục phiên làm việc trước để mở lại");
  setTool("pointer"); status("Kéo-thả file Excel/CSV vào đây, hoặc chọn dữ liệu mẫu bên trái");
  boot();
}
init();
if ("serviceWorker" in navigator) {
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) status("Đã có bản SciPlot mới — tải lại trang (⌘R / F5) để dùng");
    hadController = true;
  });
}
