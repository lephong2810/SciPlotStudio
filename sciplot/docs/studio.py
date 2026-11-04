"""SciPlot Studio — lõi Python cho giao diện kiểu Origin (chạy trong Pyodide hoặc CPython).

Mô hình:
  • Workbook: các cột (tên ngắn A, B, C… + Long Name, Units, Comments, kiểu X/Y/yEr/L/N) + dữ liệu.
  • Graph: một dict JSON mô tả hình (loại hình, các series, trục, chú giải, chữ…). JS sửa dict này,
    Python vẽ lại bằng matplotlib/sciplot và trả về ảnh + vị trí từng thành phần để bấm/kéo.
Mọi hàm công khai nhận/trả chuỗi JSON."""
from __future__ import annotations

import base64
import io
import json
import math
import re

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.ticker import AutoMinorLocator, MultipleLocator, NullLocator

import sciplot as sp

def _register_fonts(folder="fonts"):
    """Font Liberation Sans/Serif (thay thế tương đương Arial/Times New Roman, giấy phép SIL OFL)."""
    import os
    from matplotlib import font_manager
    if os.path.isdir(folder):
        for f in sorted(os.listdir(folder)):
            if f.lower().endswith(".ttf"):
                font_manager.fontManager.addfont(os.path.join(folder, f))


_register_fonts()

BOOKS: dict[str, dict] = {}
LAST: dict = {"fig": None}

# ---------------------------------------------------------------------------------- workbooks


def _to_num(v):
    if v is None or v == "":
        return np.nan
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", ".") if re.fullmatch(r"\s*[-+]?\d+,\d+([eE][-+]?\d+)?\s*", str(v)) else str(v).strip()
    try:
        return float(s)
    except ValueError:
        return np.nan


def set_book(book_json: str) -> str:
    """Nhận workbook từ JS: {id, name, cols:[{name, lname, units, comment, desig, data:[…]}]}"""
    b = json.loads(book_json)
    df = pd.DataFrame()
    nrow = max([len(c.get("data", [])) for c in b["cols"]] + [0])
    for c in b["cols"]:
        d = list(c.get("data", [])) + [None] * (nrow - len(c.get("data", [])))
        num = np.array([_to_num(v) for v in d], float)
        filled = sum(1 for v in d if v not in (None, ""))
        if filled and np.isfinite(num).sum() >= 0.8 * filled:
            df[c["name"]] = num
        else:
            df[c["name"]] = pd.Series([None if v in (None, "") else str(v) for v in d], dtype=object)
    b["df"] = df
    BOOKS[b["id"]] = b
    return json.dumps({"ok": True, "numeric": [c for c in df.columns if df[c].dtype != object]})


def _col(bid, name):
    b = BOOKS[bid]
    meta = next((c for c in b["cols"] if c["name"] == name), None)
    if meta is None:
        raise KeyError(f"Không có cột {name} trong {b.get('name', bid)}")
    return b["df"][name], meta


def _disp(meta):
    return (meta.get("lname") or "").strip() or meta["name"]


def _axis_label(meta):
    u = (meta.get("units") or "").strip()
    return f"{_disp(meta)} ({u})" if u else _disp(meta)


def set_column_values(bid: str, target: str, formula: str) -> str:
    """Tính cột bằng công thức kiểu Origin: col(A)*1000, log10(abs(col(B))), col(B)/col(C), i …"""
    b = BOOKS[bid]
    df = b["df"]
    n = len(df)
    ns = {k: getattr(np, k) for k in ("sin", "cos", "tan", "exp", "log", "log10", "log2", "sqrt", "abs",
                                      "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "floor", "ceil",
                                      "round", "maximum", "minimum", "where", "pi", "e", "isfinite")}
    ns.update(ln=np.log, mean=np.nanmean, std=np.nanstd, max=np.nanmax, min=np.nanmin, sum=np.nansum,
              i=np.arange(1, n + 1, dtype=float), nan=np.nan)

    def col(key):
        key = str(key)
        if key in df.columns:
            return pd.to_numeric(df[key], errors="coerce").to_numpy(float)
        for c in b["cols"]:
            if _disp(c) == key:
                return pd.to_numeric(df[c["name"]], errors="coerce").to_numpy(float)
        raise KeyError(f"Không có cột {key}")

    ns["col"] = col
    expr = re.sub(r"col\(\s*([A-Za-z][A-Za-z0-9_]*)\s*\)", r'col("\1")', formula)
    if re.search(r"__|import|lambda|open|exec|eval", expr):
        raise ValueError("Công thức có từ khoá không cho phép")
    val = eval(expr, {"__builtins__": {}}, ns)  # noqa: S307 – chỉ chạy trong trình duyệt của chính người dùng
    arr = np.broadcast_to(np.asarray(val, float), (n,)).astype(float)
    return json.dumps([None if not np.isfinite(v) else float(v) for v in arr])


def unstack(bid: str, xcol: str, ycol: str, gcol: str) -> str:
    """Bảng dạng dài (x, y, nhóm) → các cặp cột X/Y theo từng nhóm (giống Unstack Columns của Origin)."""
    b = BOOKS[bid]
    df = b["df"]
    _, mx = _col(bid, xcol)
    _, my = _col(bid, ycol)
    cols = []
    groups = [g for g in pd.unique(df[gcol].dropna())]
    for k, g in enumerate(groups):
        sub = df[df[gcol] == g]
        xs = pd.to_numeric(sub[xcol], errors="coerce").tolist()
        ys = pd.to_numeric(sub[ycol], errors="coerce").tolist()
        clean = lambda arr: [None if (v is None or (isinstance(v, float) and math.isnan(v))) else v for v in arr]
        cols.append({"lname": _disp(mx), "units": mx.get("units", ""), "comment": str(g), "desig": "X", "data": clean(xs)})
        cols.append({"lname": str(g), "units": my.get("units", ""), "comment": _disp(my), "desig": "Y", "data": clean(ys)})
    return json.dumps(cols)


# ---------------------------------------------------------------------------------- graph helpers

DEFAULT_MARK = {"line": None, "scatter": "o", "linesymbol": "o"}
MARKER_CODES = {"none": None, "": None, "circle": "o", "square": "s", "triangle": "^", "down": "v", "diamond": "D",
                "star": "*", "plus": "P", "cross": "X", "hexagon": "h", "pentagon": "p"}
LS = {"solid": "-", "dash": "--", "dot": ":", "dashdot": "-.", "none": "None"}
SERIES_KINDS = {"spectra", "lsv", "tafel", "cv", "nyquist", "tauc", "cdl", "bet"}
TABLE_KINDS = {"box", "histogram", "pca", "heatmap", "volcano"}


def _series_data(G, s):
    bid = s.get("book") or G.get("book")
    y, my = _col(bid, s["y"])
    y = pd.to_numeric(y, errors="coerce").to_numpy(float)
    if s.get("x"):
        x, mx = _col(bid, s["x"])
        xn = pd.to_numeric(x, errors="coerce").to_numpy(float)
        xcat = None if np.isfinite(xn).sum() >= 0.8 * x.notna().sum() else x.astype(str).to_numpy()
    else:
        mx, xn, xcat = {"name": "Row", "lname": "Row", "units": ""}, np.arange(1, len(y) + 1, dtype=float), None
    err = None
    if s.get("yerr"):
        e, _ = _col(bid, s["yerr"])
        err = pd.to_numeric(e, errors="coerce").to_numpy(float)
    label = s.get("label") or _disp(my)
    return dict(x=xn, xcat=xcat, y=y, err=err, label=label, mx=mx, my=my)


def _palette(G, n):
    pal = G.get("palette") or "paper"
    if pal in sp.PALETTES:
        base = sp.PALETTES[pal]
        if pal in getattr(sp, "SEQUENTIAL", ()):  # bảng màu tăng dần: trải đều theo số series
            if n <= 1:
                return [base[len(base) // 2]]
            from matplotlib.colors import LinearSegmentedColormap
            cm = LinearSegmentedColormap.from_list("seq", base)
            return [matplotlib.colors.to_hex(cm(i / (n - 1))) for i in range(n)]
        return [base[i % len(base)] for i in range(n)]
    cmap = plt.get_cmap(pal if pal in plt.colormaps() else "viridis")
    return [matplotlib.colors.to_hex(cmap(i / max(1, n - 1) * 0.9)) for i in range(n)]


def _long_df(G, items):
    rows = []
    for d in items:
        m = np.isfinite(d["x"]) & np.isfinite(d["y"])
        rows.append(pd.DataFrame({"x": d["x"][m], "y": d["y"][m], "series": d["label"]}))
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame(columns=["x", "y", "series"])


# ---------------------------------------------------------------------------------- generic 2-D plots

def _plot_xy(G, ax, items, styles):
    kind = G["kind"]
    ax2 = None
    handles = []
    if kind == "column":
        return _plot_columns(G, ax, items, styles)
    nfit = 0
    npeak = 0
    pal = _palette(G, max(len(items), 1))
    bg_col = None
    if kind == "xps":
        for s_, d_ in zip(G["series"], items):
            if (s_.get("role") or _xps_role(d_["my"])) == "bg":
                bg_col = s_["y"]
                break
        npk = sum(1 for s_, d_ in zip(G["series"], items) if (s_.get("role") or _xps_role(d_["my"])) == "peak")
        pal = _palette(G, max(npk, 1))
    for d, st, s in zip(items, styles, G["series"]):
        role = None
        if kind == "xps":
            role = s.get("role") or _xps_role(d["my"])
            st = dict(st)
            user = lambda k: s.get(k) not in (None, "", "default")
            if role == "raw":
                if not user("marker"): st["marker"] = "o"
                if not user("fill"): st["fill"] = "hollow"
                if not user("ls"): st["ls"] = "None"
                if not user("ms"): st["ms"] = 3.5
                if not user("color"): st["color"] = "#3A3A3A"
            elif role == "bg":
                if not user("color"): st["color"] = "#8C8C8C"
                if not user("ls"): st["ls"] = "--"
                if not user("lw"): st["lw"] = 1.0
                if not user("marker"): st["marker"] = None
            elif role == "env":
                if not user("color"): st["color"] = "#D7263D"
                if not user("lw"): st["lw"] = 1.5
                if not user("marker"): st["marker"] = None
            else:
                if not user("color"): st["color"] = pal[npeak % len(pal)]
                if not user("lw"): st["lw"] = 1.1
                if not user("marker"): st["marker"] = None
                npeak += 1
        target = ax
        if s.get("y2"):
            if ax2 is None:
                ax2 = ax.twinx()
            target = ax2
        x = d["x"]
        if d["xcat"] is not None:
            x = np.arange(len(d["xcat"]), dtype=float)
            ax.set_xticks(x, d["xcat"])
        m = np.isfinite(x) & np.isfinite(d["y"])
        marker = st["marker"]
        ls = st["ls"] if kind != "scatter" else "None"
        kw = dict(color=st["color"], lw=st["lw"], ls=ls, marker=marker, ms=st["ms"], label=d["label"],
                  mfc=(st["color"] if st["fill"] == "solid" else "white" if st["fill"] == "hollow" else "none"),
                  mec=s.get("mec") or st["color"],
                  mew=float(s["mew"]) if s.get("mew") not in (None, "") else max(0.8, st["lw"] * 0.7),
                  zorder=3, alpha=st["alpha"])
        fmode = s.get("fill_mode")
        if role == "peak" and not fmode:
            fmode = (G.get("opts") or {}).get("peak_fill", "gradient")
        if kind == "area" and not fmode:
            fmode = "solid"
        if kind == "area":
            kw.update(marker=None)
        if fmode and fmode != "none":
            fto = s.get("fill_to") or (bg_col if role == "peak" else None)
            base = np.zeros(m.sum())
            if fto:
                bcol, _ = _col(s.get("book") or G.get("book"), fto)
                bv = pd.to_numeric(bcol, errors="coerce").to_numpy(float)
                bv = np.resize(bv, len(m)) if len(bv) != len(m) else bv
                base = np.nan_to_num(bv[m])
            fc = s.get("fill_color") or st["color"]
            dalpha = (G.get("opts") or {}).get("fill_alpha")
            falpha = float(s.get("fill_alpha") or dalpha or (0.55 if fmode == "gradient" else 0.35))
            _area_fill(target, x[m], d["y"][m], base, fc, fmode, falpha, s.get("hatch") or (G.get("opts") or {}).get("hatch") or "///")
        if d["err"] is not None:
            e = d["err"]
            h = target.errorbar(x[m], d["y"][m], yerr=np.abs(e[m]), capsize=st["capsize"], elinewidth=st["lw"] * 0.7,
                                ecolor=st["color"], **kw)
            handles.append(h)
        else:
            (h,) = target.plot(x[m], d["y"][m], **kw)
            handles.append(h)
        if s.get("fit") and d["xcat"] is None:
            _fit_series(ax, target, x[m], d["y"][m], s, st, d["label"], nfit)
            nfit += 1
    return ax2, handles


XPS_ROLES = {
    "raw": ("raw", "exp", "data", "measured", "counts", "cps", "intensity", "original"),
    "bg": ("bg", "background", "shirley", "tougaard", "baseline", "linear bg"),
    "env": ("envelope", "env", "sum", "fit", "total", "cumulative", "model"),
}


def _xps_role(meta):
    """Đoán vai trò cột XPS theo tên: Raw / Background / Envelope / peak thành phần."""
    nm = (_disp(meta) + " " + (meta.get("comment") or "")).lower()
    for role in ("bg", "env", "raw"):
        if any(k in nm for k in XPS_ROLES[role]):
            if role == "env" and "peak" in nm:
                continue
            return role
    return "peak"


def _area_fill(ax, x, y, base, color, mode, alpha, hatch="///"):
    """Tô vùng giữa đường và đường nền. mode: solid | gradient | hatch | none"""
    from matplotlib.colors import to_rgba
    if len(x) < 2:
        return
    if mode == "solid":
        ax.fill_between(x, base, y, color=color, alpha=alpha, lw=0, zorder=2)
    elif mode == "gradient":
        # đậm ở đỉnh, nhạt dần về đường nền (xếp lớp — không có đường nối giữa các dải, vẫn là vector)
        n = 24
        ai = 1 - (1 - min(alpha, 0.98)) ** (1 / n)
        for k in range(n):
            ax.fill_between(x, base + (y - base) * k / n, y, color=color, alpha=ai, lw=0, zorder=2)
    elif mode == "hatch":
        with plt.rc_context({"hatch.linewidth": 0.7}):
            ax.fill_between(x, base, y, facecolor=to_rgba(color, alpha * 0.35), edgecolor=color, hatch=hatch,
                            lw=0, zorder=2)


def _num(v):
    """Số cho phương trình: 4 chữ số có nghĩa, dạng ×10ⁿ khi quá lớn/nhỏ (mathtext)."""
    if not np.isfinite(v):
        return "nan"
    if v == 0:
        return "0"
    e = int(math.floor(math.log10(abs(v))))
    if -3 <= e < 4:
        return f"{v:.4g}"
    mnt = v / 10 ** e
    return rf"{mnt:.3g}\times10^{{{e}}}"


FIT_DEG = {"linear": 1, "linear0": 1, "poly2": 2, "poly3": 3}


def _fit_series(ax, target, x, y, s, st, label, k):
    kind = s["fit"]
    if kind not in FIT_DEG:
        return
    lo, hi = s.get("fit_from"), s.get("fit_to")
    w = np.ones(len(x), bool)
    if lo not in (None, ""):
        w &= x >= float(lo)
    if hi not in (None, ""):
        w &= x <= float(hi)
    xf, yf = x[w], y[w]
    deg = FIT_DEG[kind]
    n = len(xf)
    if n < (2 if kind == "linear0" else deg + 2):
        return
    if kind == "linear0":  # y = a·x (qua gốc toạ độ)
        a = float((xf @ yf) / (xf @ xf))
        coef = np.array([a, 0.0])
        yhat = a * xf
        dof = max(n - 1, 1)
        s2 = float(((yf - yhat) ** 2).sum() / dof)
        se = np.array([math.sqrt(s2 / float(xf @ xf)), np.nan])
    else:
        X = np.vander(xf, deg + 1)
        coef, *_ = np.linalg.lstsq(X, yf, rcond=None)
        yhat = X @ coef
        dof = max(n - deg - 1, 1)
        s2 = float(((yf - yhat) ** 2).sum() / dof)
        try:
            se = np.sqrt(np.diag(s2 * np.linalg.inv(X.T @ X)))
        except np.linalg.LinAlgError:
            se = np.full(deg + 1, np.nan)
    ss_res = float(((yf - yhat) ** 2).sum())
    ss_tot = float(((yf - yf.mean()) ** 2).sum())
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else np.nan
    r2adj = 1 - (1 - r2) * (n - 1) / dof if np.isfinite(r2) and kind != "linear0" else np.nan
    # đường fit
    x0, x1 = (xf.min(), xf.max()) if not s.get("fit_extend") else (min(ax.get_xlim()), max(ax.get_xlim()))
    xs = np.linspace(x0, x1, 200)
    ys = np.polyval(coef, xs)
    color = s.get("fit_color") or st["color"]
    target.plot(xs, ys, color=color, lw=float(s.get("fit_lw") or 1.4), ls={"dash": "--", "dot": ":", "solid": "-"}.get(s.get("fit_ls") or "solid", "-"),
                zorder=4, label="_fit")
    # phương trình + R² (kéo được)
    pw = [1] if kind == "linear0" else list(range(deg, -1, -1))
    cs = [coef[0]] if kind == "linear0" else list(coef)
    parts = []
    for i, (p_, c_) in enumerate(zip(pw, cs)):
        term = _num(abs(c_)) + ("" if p_ == 0 else "x" if p_ == 1 else f"x^{{{p_}}}")
        parts.append(("-" if c_ < 0 else "") + term if i == 0 else (" - " if c_ < 0 else " + ") + term)
    eq = "y = " + "".join(parts)
    txt = f"${eq}$" + chr(10) + f"$R^2 = {r2:.4f}$"
    if s.get("fit_eq", True):
        pos = s.get("fit_pos") or [0.45, 0.30 + 0.15 * k]
        ax.text(float(pos[0]), float(pos[1]), txt, transform=ax.transAxes, ha="left", va="top", color=color,
                zorder=26, gid=f"fit:{s.get('_idx', k)}",
                fontsize=float(s["fit_size"]) if s.get("fit_size") else None)
    res = getattr(ax, "_sciplot_results", {})
    names = ["a", "b"] if kind in ("linear", "linear0") else [f"a{p_}" for p_ in range(deg, -1, -1)]
    row = {"Kiểu fit": {"linear": "y = ax + b", "linear0": "y = ax", "poly2": "bậc 2", "poly3": "bậc 3"}[kind]}
    for nm, c_, e_ in zip(names, coef, se):
        if kind == "linear0" and nm == "b":
            continue
        row[nm] = float(c_)
        row[f"SE({nm})"] = float(e_) if np.isfinite(e_) else None
    row.update({"R²": float(r2) if np.isfinite(r2) else None, "R² hiệu chỉnh": float(r2adj) if np.isfinite(r2adj) else None,
                "n": int(n)})
    res[label] = row
    ax._sciplot_results = res


def _plot_columns(G, ax, items, styles):
    o = G.get("opts", {})
    cats = None
    for d in items:
        if d["xcat"] is not None:
            cats = list(d["xcat"])
            break
    if cats is None:
        xv = items[0]["x"] if items else np.array([])
        cats = [f"{v:g}" if np.isfinite(v) else "" for v in xv]
    n = len(items)
    width = float(o.get("width", 0.8))
    bw = width / max(n, 1)
    pos = np.arange(len(cats), dtype=float)
    handles = []
    ytop = 0
    for k, (d, st) in enumerate(zip(items, styles)):
        y = d["y"][:len(cats)]
        xx = pos[:len(y)] + (k - (n - 1) / 2) * bw
        bars = ax.bar(xx, np.nan_to_num(y), width=bw * 0.92, color=st["color"], edgecolor=o.get("edgecolor", "#333333"),
                      linewidth=0.9, label=d["label"], zorder=2, alpha=st["alpha"])
        if o.get("gradient"):
            sp._gradient_bars(ax, bars, o["gradient"])
        handles.append(bars)
        e = d["err"][:len(cats)] if d["err"] is not None else None
        if e is not None:
            ax.errorbar(xx, np.nan_to_num(y), yerr=np.nan_to_num(np.abs(e)), fmt="none", ecolor="#333333",
                        elinewidth=0.9, capsize=st["capsize"], zorder=3)
        ytop = max(ytop, np.nanmax(np.nan_to_num(y) + (np.nan_to_num(e) if e is not None else 0)) if len(y) else 0)
        if o.get("value_labels"):
            fmt = o.get("value_fmt") or "{:.4g}"
            for xi, yi, ei in zip(xx, y, e if e is not None else [0] * len(y)):
                if np.isfinite(yi):
                    ax.text(xi, yi + (ei if np.isfinite(ei) else 0) + 0.012 * max(ytop, 1e-12), fmt.format(yi),
                            ha="center", va="bottom", fontsize=plt.rcParams["font.size"] - 1)
    ax.set_xticks(pos, cats)
    rot = float(o.get("rotate_x") or 0)
    if rot:
        for t in ax.get_xticklabels():
            t.set_rotation(rot)
            t.set_ha("right")
    ax.xaxis.set_minor_locator(NullLocator())
    ax.set_xlim(-0.6, len(cats) - 0.4)
    ax.set_ylim(0, ytop * (1.15 if o.get("value_labels") else 1.05) if ytop > 0 else 1)
    return None, handles


# ---------------------------------------------------------------------------------- specialised (sciplot)

def _plot_sciplot(G, ax, items, styles):
    kind = G["kind"]
    o = dict(G.get("opts", {}))
    colors = {d["label"]: st["color"] for d, st in zip(items, styles)}
    if kind in SERIES_KINDS:
        df = _long_df(G, items)
        order = [d["label"] for d in items]
        if kind == "spectra":
            sp.spectra(df, x="x", y="y", sample="series", ax=ax, colors=colors, order=order,
                       lw=styles[0]["lw"] if styles else 1.2, **o)
        elif kind in ("lsv", "tafel", "cv"):
            o.setdefault("current_unit", "mA/cm2")
            getattr(sp, kind)(df, E="x", j="y", sample="series", ax=ax, colors=colors, order=order, **o)
        elif kind == "nyquist":
            sp.nyquist(df, zre="x", zim="y", sample="series", ax=ax, colors=colors, order=order, **o)
        elif kind == "tauc":
            sp.tauc(df, wl="x", A="y", sample="series", ax=ax, colors=colors, order=order, **o)
        elif kind == "cdl":
            sp.cdl(df, x="x", y="y", sample="series", ax=ax, colors=colors, order=order, **o)
        elif kind == "bet":
            sp.bet(df, p="x", v="y", sample="series", ax=ax, colors=colors, order=order, **o)
        return None, None
    bid = G.get("book")
    if kind in ("box", "histogram"):
        df = pd.concat([pd.DataFrame({"group": d["label"], "value": d["y"][np.isfinite(d["y"])]}) for d in items])
        if kind == "box":
            sp.box(df, x="group", y="value", ax=ax, colors=[styles[0]["color"]], hue=None,
                   order=[d["label"] for d in items], **o)
        else:
            sp.histogram(df, x="value", hue="group" if len(items) > 1 else None, ax=ax, colors=colors,
                         order=[d["label"] for d in items], color=styles[0]["color"] if styles else None, **o)
        return None, None
    lab_col = o.pop("label_col", None)
    if kind == "pca":
        df = pd.DataFrame({d["label"]: d["y"] for d in items})
        group = None
        if lab_col:
            lc, _ = _col(bid, lab_col)
            df["_group"] = lc.values[:len(df)]
            group = "_group"
        sp.pca(df, columns=[d["label"] for d in items], group=group, ax=ax, legend_title=o.pop("legend_title", ""), **o)
        return None, None
    if kind == "heatmap":
        df = pd.DataFrame({d["label"]: d["y"] for d in items})
        index = None
        if lab_col:
            lc, _ = _col(bid, lab_col)
            df.insert(0, "_name", lc.astype(str).values[:len(df)])
            index = "_name"
        sp.heatmap(df, index=index, columns=[d["label"] for d in items], ax=ax, title=G.get("title") or None, **o)
        return None, None
    if kind == "volcano":
        d = items[0]
        df = pd.DataFrame({"fc": d["x"], "p": d["y"]})
        if lab_col:
            lc, _ = _col(bid, lab_col)
            df["gene"] = lc.astype(str).values[:len(df)]
        sp.volcano(df, fc="fc", p="p", label="gene" if lab_col else None, ax=ax, **o)
        return None, None
    raise ValueError(f"Không biết loại hình {kind}")


# ---------------------------------------------------------------------------------- formatting

def _style(G, i, s):
    kind = G["kind"]
    pal = _palette(G, max(len(G["series"]), 1))
    mk = s.get("marker", "default")
    marker = DEFAULT_MARK.get(kind, "o") if mk in (None, "default") else MARKER_CODES.get(mk, mk)
    if kind == "line" and mk in (None, "default"):
        marker = None
    num = lambda k, d: float(s[k]) if s.get(k) not in (None, "") else d
    return dict(color=s.get("color") or pal[i % len(pal)], marker=marker, ms=num("ms", 6.0),
                lw=num("lw", 1.6), ls=LS.get(s.get("ls") or "solid", "-"), fill=s.get("fill") or "solid",
                alpha=num("alpha", 1.0), capsize=num("capsize", 3.0))


def _apply_axis(ax, which, A, default_label):
    if A is None:
        A = {}
    axis = ax.xaxis if which == "x" else ax.yaxis
    lab = A.get("label")
    if lab is not None:
        (ax.set_xlabel if which == "x" else ax.set_ylabel)(lab)
    elif default_label is not None:
        (ax.set_xlabel if which == "x" else ax.set_ylabel)(default_label)
    lbl = ax.xaxis.label if which == "x" else ax.yaxis.label
    if A.get("label_size"):
        lbl.set_fontsize(float(A["label_size"]))
    if A.get("label_bold"):
        lbl.set_fontweight("bold")
    if A.get("scale") == "log":
        (ax.set_xscale if which == "x" else ax.set_yscale)("log")
    lo, hi = A.get("min"), A.get("max")
    if lo not in (None, "") or hi not in (None, ""):
        get = ax.get_xlim if which == "x" else ax.get_ylim
        cur = get()
        a = float(lo) if lo not in (None, "") else min(cur)
        b = float(hi) if hi not in (None, "") else max(cur)
        (ax.set_xlim if which == "x" else ax.set_ylim)(a, b)
    if A.get("reverse"):
        lim = ax.get_xlim() if which == "x" else ax.get_ylim()
        if lim[0] < lim[1]:
            (ax.invert_xaxis if which == "x" else ax.invert_yaxis)()
    step = A.get("step")
    if step not in (None, "", 0) and A.get("scale") != "log":
        axis.set_major_locator(MultipleLocator(float(step)))
    minor = A.get("minor")
    if minor is not None and A.get("scale") != "log":
        if int(minor) <= 0:
            axis.set_minor_locator(NullLocator())
        else:
            axis.set_minor_locator(AutoMinorLocator(int(minor) + 1))
    tk = {}
    if A.get("tick_dir") in ("in", "out", "inout"):
        tk["direction"] = A["tick_dir"]
    if A.get("tick_size"):
        tk["labelsize"] = float(A["tick_size"])
    if tk:
        ax.tick_params(axis=which, which="both", **tk)
    if A.get("hide_ticklabels"):
        ax.tick_params(axis=which, labelbottom=False, labelleft=False, labelright=False)
    if A.get("decimals") not in (None, ""):
        from matplotlib.ticker import FormatStrFormatter
        axis.set_major_formatter(FormatStrFormatter(f"%.{int(A['decimals'])}f"))


def _apply_legend(ax, G, handles=None, ax2=None):
    L = G.get("legend") or {}
    leg = ax.get_legend()
    if handles is not None:  # loại hình chung: tự dựng chú giải (gộp trục phải)
        if leg:
            leg.remove()
        labels = [h.get_label() for h in handles]
        leg = ax.legend(handles, labels) if handles else None
    if leg is None:
        return None
    if L.get("show") is False:
        leg.remove()
        return None
    fs = L.get("fontsize")
    if fs:
        for t in leg.get_texts():
            t.set_fontsize(float(fs))
        if leg.get_title():
            leg.get_title().set_fontsize(float(fs))
    if L.get("title") is not None and L.get("title") != "":
        leg.set_title(L["title"])
    if L.get("ncol") and int(L["ncol"]) > 1:
        h = leg.legend_handles if hasattr(leg, "legend_handles") else leg.legendHandles
        labels = [t.get_text() for t in leg.get_texts()]
        title = leg.get_title().get_text()
        leg.remove()
        leg = ax.legend(h, labels, ncol=int(L["ncol"]), title=title or None)
    frame = bool(L.get("frame", False))
    leg.set_frame_on(frame)
    if frame:
        leg.get_frame().set_edgecolor("#333333")
        leg.get_frame().set_linewidth(0.8)
    loc = L.get("loc")
    if isinstance(loc, (list, tuple)) and len(loc) == 2:
        leg.set_bbox_to_anchor((float(loc[0]), float(loc[1])), transform=ax.transAxes)
        try:
            leg.set_loc("upper left")
        except AttributeError:
            leg._loc = 2
        leg.borderaxespad = 0.0
    elif isinstance(loc, str) and loc:
        try:
            leg.set_loc(loc)
        except AttributeError:
            pass
    leg.set_zorder(20)
    leg.set_draggable(False)
    return leg


def _frame(ax, G):
    F = G.get("frame") or {}
    lw = F.get("width")
    if lw:
        for spn in ax.spines.values():
            spn.set_linewidth(float(lw))
        ax.tick_params(which="major", width=float(lw))
        ax.tick_params(which="minor", width=float(lw) * 0.8)
    if F.get("box") is False:
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.tick_params(top=False, right=False, which="both")


# ---------------------------------------------------------------------------------- render

def _build(G, dpi):
    sp.set_theme(G.get("theme", "origin"), G.get("font", "sans"), float(G.get("fontsize", 11)))
    w, h = G.get("size", [5, 4])
    fig, ax = plt.subplots(figsize=(float(w), float(h)), dpi=dpi)
    ax2, leg = _draw(G, ax)
    return fig, ax, ax2, leg


def _default_ylabel(items, series):
    left = [d for d, s in zip(items, series) if not s.get("y2")]
    if not left:
        return None
    if len(left) == 1:
        return _axis_label(left[0]["my"])
    units = {(d["my"].get("units") or "").strip() for d in left}
    comments = {(d["my"].get("comment") or "").strip() for d in left}
    u = units.pop() if len(units) == 1 else ""
    if len(comments) == 1:  # các cột cùng một đại lượng (vd sau khi Unstack) → dùng Comments làm tên
        c = comments.pop()
        if c:
            return f"{c} ({u})" if u else c
    return _axis_label(left[0]["my"])


def _draw(G, ax):
    kind = G["kind"]
    series = [dict(s, _idx=i) for i, s in enumerate(G.get("series", [])) if s.get("visible", True)]
    G = {**G, "series": series}
    items = [_series_data(G, s) for s in series]
    seen = {}
    for d in items:  # tên trùng (hai series cùng cột) → thêm (2), (3) để màu/nhãn không dính nhau
        seen[d["label"]] = seen.get(d["label"], 0) + 1
        if seen[d["label"]] > 1:
            d["label"] = f"{d['label']} ({seen[d['label']]})"
    styles = [_style(G, i, s) for i, s in enumerate(series)]
    ax2 = handles = None
    generic = kind in ("line", "scatter", "linesymbol", "area", "column", "xps")
    if not items:
        ax.text(0.5, 0.5, "Chưa có dữ liệu — chọn cột Y trong worksheet", ha="center", va="center",
                transform=ax.transAxes, color="#888")
    elif kind in ("line", "scatter", "linesymbol", "area", "column", "xps"):
        ax2, handles = _plot_xy(G, ax, items, styles)
    else:
        _plot_sciplot(G, ax, items, styles)
    # nhãn trục tự động lấy từ Long Name (Units) giống Origin
    dx = _axis_label(items[0]["mx"]) if (generic and items) else None
    dy = _default_ylabel(items, series) if (generic and items) else None
    if kind == "xps":
        dx = "Binding energy (eV)"
        dy = "Intensity (a.u.)"
        G = {**G, "xaxis": {"reverse": True, **(G.get("xaxis") or {})}}
    if kind in ("box",):
        dx = ""
        dy = _default_ylabel(items, series) if len(items) == 1 else "Value"
    if kind == "histogram":
        dx = _default_ylabel(items, series)
    if kind != "heatmap":
        _apply_axis(ax, "x", G.get("xaxis"), dx)
        _apply_axis(ax, "y", G.get("yaxis"), dy)
        if ax2 is not None:
            right = [d for d, s in zip(items, series) if s.get("y2")]
            _apply_axis(ax2, "y", G.get("y2axis"), _axis_label(right[0]["my"]) if right else None)
            ax2.yaxis.set_label_position("right")
        _frame(ax, G)
        if kind == "xps" and (G.get("opts") or {}).get("hide_y", True):
            ax.set_yticks([])
            ax.yaxis.set_minor_locator(NullLocator())
        if G.get("title"):
            ax.set_title(G["title"])
    leg = _apply_legend(ax, G, handles if generic else None, ax2) if kind != "heatmap" else None
    if kind == "spectra":  # tên mẫu ở đầu phổ: kéo được, ẩn được, đổi cỡ/màu được
        o = G.get("opts") or {}
        by_name = {d["label"]: s for d, s in zip(items, series)}
        for t in list(ax.texts):
            gid = t.get_gid() or ""
            if not gid.startswith("slab:"):
                continue
            s_ = by_name.get(gid[5:])
            if s_ is None:
                continue
            if s_.get("label_hide"):
                t.remove()
                continue
            t.set_gid(f"slab:{s_['_idx']}")
            if s_.get("label_size") or o.get("label_size"):
                t.set_fontsize(float(s_.get("label_size") or o.get("label_size")))
            if s_.get("label_color"):
                t.set_color(s_["label_color"])
            if s_.get("label_bold"):
                t.set_fontweight("bold")
            pos = s_.get("label_pos")
            if pos:
                t.set_transform(ax.transAxes)
                t.set_position((float(pos[0]), float(pos[1])))
                t.set_ha("left")
                t.set_va("top")
    for t in G.get("texts", []):
        kw = dict(transform=ax.transAxes, ha="left", va="top", zorder=25, gid=t["id"])
        if t.get("fontsize"):
            kw["fontsize"] = float(t["fontsize"])
        if t.get("color"):
            kw["color"] = t["color"]
        if t.get("bold"):
            kw["fontweight"] = "bold"
        if t.get("italic"):
            kw["fontstyle"] = "italic"
        ax.text(float(t["x"]), float(t["y"]), t["text"], **kw)
    for r in G.get("reflines", []):
        f = ax.axhline if r.get("orient") == "h" else ax.axvline
        f(float(r["value"]), color=r.get("color", "#777777"), ls=LS.get(r.get("ls", "dash"), "--"),
          lw=float(r.get("lw", 1)), zorder=1)
    return ax2, leg


def _bbox_img(ext, tb, dpi):
    return [ext.x0 - tb.x0 * dpi, tb.y1 * dpi - ext.y1, ext.x1 - tb.x0 * dpi, tb.y1 * dpi - ext.y0]


def _union(exts):
    exts = [e for e in exts if e is not None and e.width > 0]
    if not exts:
        return None
    from matplotlib.transforms import Bbox
    return Bbox.union(exts)


def render_graph(graph_json: str, dpi: float = 110) -> str:
    G = json.loads(graph_json)
    if LAST["fig"] is not None:
        plt.close(LAST["fig"])
    fig, ax, ax2, leg = _build(G, dpi)
    LAST.update(fig=fig, ax=ax)
    fig.canvas.draw()
    r = fig.canvas.get_renderer()
    tb = fig.get_tightbbox(r).padded(0.06)
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches=tb)
    hits = []

    def add(kind, ext, prio, **extra):
        if ext is not None and ext.width > 0 and ext.height > 0:
            hits.append({"kind": kind, "box": [round(v, 1) for v in _bbox_img(ext, tb, dpi)], "prio": prio, **extra})

    axes_info = []
    if G["kind"] != "heatmap":
        ab = ax.get_window_extent(r)
        add("plot", ab, 1)
        from matplotlib.transforms import Bbox
        for which, a, name in (("x", ax, "xaxis"), ("y", ax, "yaxis")) + ((("y", ax2, "y2axis"),) if ax2 is not None else ()):
            tl = _union([t.get_window_extent(r) for t in (a.get_xticklabels() if which == "x" else a.get_yticklabels())
                         if t.get_visible() and t.get_text()])
            if which == "x":
                y0 = min(tl.y0 if tl else ab.y0 - 14, ab.y0 - 10)
                add(name, Bbox([[ab.x0, y0], [ab.x1, ab.y0 + 5]]), 2)
            elif name == "yaxis":
                x0 = min(tl.x0 if tl else ab.x0 - 14, ab.x0 - 10)
                add(name, Bbox([[x0, ab.y0], [ab.x0 + 5, ab.y1]]), 2)
            else:
                x1 = max(tl.x1 if tl else ab.x1 + 14, ab.x1 + 10)
                add(name, Bbox([[ab.x1 - 5, ab.y0], [x1, ab.y1]]), 2)
        for lbl, name in ((ax.xaxis.label, "xlabel"), (ax.yaxis.label, "ylabel")) + \
                ((((ax2.yaxis.label, "y2label"),) if ax2 is not None else ())):
            if lbl.get_text():
                add(name, lbl.get_window_extent(r), 4)
        if ax.title.get_text():
            add("title", ax.title.get_window_extent(r), 4)
        if leg is not None:
            add("legend", leg.get_window_extent(r), 3)
            for k, t in enumerate(leg.get_texts()):
                add("legend_entry", t.get_window_extent(r), 4, index=k, text=t.get_text())
        for t in ax.texts:
            if t.get_gid():
                add("text", t.get_window_extent(r), 5, id=t.get_gid())
        info = {"box": [round(v, 1) for v in _bbox_img(ab, tb, dpi)], "xlim": list(ax.get_xlim()),
                "ylim": list(ax.get_ylim()), "xscale": ax.get_xscale(), "yscale": ax.get_yscale()}
        if ax2 is not None:
            info["y2lim"] = list(ax2.get_ylim())
        axes_info.append(info)
    res = []
    try:
        rr = sp.results(ax)
        if len(rr):
            pass  # giữ đủ chữ số; giao diện tự hiển thị 6 chữ số có nghĩa
            if isinstance(rr, pd.Series):
                res = [{"Mẫu": str(k), "Giá trị": (None if not np.isfinite(v) else float(v))} for k, v in rr.items()]
            else:
                cv = lambda v: None if v is None or (isinstance(v, float) and not np.isfinite(v)) else \
                    (float(v) if isinstance(v, (int, float, np.integer, np.floating)) else str(v))
                res = [{"Mẫu": str(k), **{str(c): cv(v) for c, v in row.items()}}
                       for k, row in rr.iterrows()]
    except Exception:
        res = []
    return json.dumps({"png": base64.b64encode(buf.getvalue()).decode(), "w": round(tb.width * dpi),
                       "h": round(tb.height * dpi), "hits": hits, "axes": axes_info, "results": res,
                       "nleg": len(leg.get_texts()) if leg is not None else 0})


def export_graph(graph_json: str, fmt: str = "png", dpi: float = 600, transparent: bool = False) -> str:
    G = json.loads(graph_json)
    fig, ax, ax2, leg = _build(G, 100)
    buf = io.BytesIO()
    kw = dict(format=fmt, dpi=float(dpi), bbox_inches="tight", pad_inches=0.06, transparent=bool(transparent))
    if fmt == "tiff":
        kw["pil_kwargs"] = {"compression": "tiff_lzw"}
    fig.savefig(buf, **kw)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()


def export_panel(panel_json: str, fmt: str = "png", dpi: float = 600, transparent: bool = False) -> str:
    """Ghép nhiều graph thành một figure có nhãn (a)(b)(c)… — vẽ lại từng graph vào lưới (vector thật)."""
    P = json.loads(panel_json)
    graphs = P["graphs"]
    ncol = max(1, int(P.get("ncol", 2)))
    nrow = math.ceil(len(graphs) / ncol)
    G0 = graphs[0]
    sp.set_theme(G0.get("theme", "origin"), G0.get("font", "sans"), float(G0.get("fontsize", 11)))
    w = max(float(g.get("size", [5, 4])[0]) for g in graphs)
    h = max(float(g.get("size", [5, 4])[1]) for g in graphs)
    fig, axs = plt.subplots(nrow, ncol, figsize=(w * ncol, h * nrow), squeeze=False, layout="constrained")
    tags = P.get("tags", "(a)")
    for k, G in enumerate(graphs):
        a = axs.flat[k]
        _draw(G, a)
        if tags:
            a.annotate(sp._tag(tags, k), xy=(0, 1), xycoords="axes fraction", xytext=(-38, 10),
                       textcoords="offset points", fontsize=plt.rcParams["font.size"] + 3, fontweight="bold",
                       ha="left", va="bottom", annotation_clip=False)
    for j in range(len(graphs), nrow * ncol):
        axs.flat[j].set_visible(False)
    buf = io.BytesIO()
    kw = dict(format=fmt, dpi=float(dpi), bbox_inches="tight", pad_inches=0.08, transparent=bool(transparent))
    if fmt == "tiff":
        kw["pil_kwargs"] = {"compression": "tiff_lzw"}
    fig.savefig(buf, **kw)
    plt.close(fig)
    return base64.b64encode(buf.getvalue()).decode()
