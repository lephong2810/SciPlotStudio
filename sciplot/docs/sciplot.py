#!/usr/bin/env python3
"""
SciPlot — công cụ vẽ hình khoa học bằng Python (matplotlib)
==========================================================
Chuyển các bài học trong "Data Visualization with R" (NIH BTEP, ggplot2/pheatmap/
patchwork) thành một bộ hàm Python gọn, cho hình chuẩn bài báo.

Các loại hình (tương ứng bài học trong tài liệu):
    scatter    – Lesson 2-3: geom_point (+ màu/hình/kích thước theo nhóm, facet, đường hồi quy, nối line)
    line       – Lesson 2:   geom_line (đường + điểm, theo nhóm)
    pca        – Lesson 3:   prcomp + stat_ellipse (elip tin cậy 95 %, % phương sai trên trục)
    volcano    – Lesson 3:   volcano plot (logFC vs -log10 FDR, ngưỡng, gắn nhãn gene)
    bar        – Lesson 4:   geom_bar (count / mean ± SD|SE|CI95 / identity, dodge|stack, thêm điểm)
    histogram  – Lesson 4:   geom_histogram (bins / binwidth, theo nhóm, KDE)
    box        – Lesson 4:   geom_boxplot / violin + jitter-dodge
    heatmap    – Lesson 5:   pheatmap (scale row/column, phân cụm + dendrogram, annotation, cutree)
    panel      – Lesson 6:   patchwork / cowplot (ghép nhiều hình, nhãn A, B, C)

Dùng như thư viện:
    import sciplot as sp
    fig, ax = sp.scatter(df, x="Petal.Length", y="Petal.Width", color="Species")
    sp.save(fig, "hinh1.png", dpi=600)

Dùng dòng lệnh:
    python sciplot.py scatter iris.csv --x Petal.Length --y Petal.Width --color Species -o hinh.png
    python sciplot.py panel examples/panel.json -o figure1.pdf
    python sciplot.py --help
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib

if __name__ == "__main__":
    matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, to_rgba
from matplotlib.lines import Line2D
from matplotlib.patches import Ellipse, Patch

__version__ = "1.0.0"

# --------------------------------------------------------------------------------------
# Theme & palettes
# --------------------------------------------------------------------------------------
# Okabe–Ito: bảng màu thân thiện với người mù màu, phù hợp in ấn
PALETTES = {
    "okabe": ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#F0E442", "#000000"],
    "npg": ["#E64B35", "#4DBBD5", "#00A087", "#3C5488", "#F39B7F", "#8491B4", "#91D1C2", "#DC0000"],
    "aaas": ["#3B4992", "#EE0000", "#008B45", "#631879", "#008280", "#BB0021", "#5F559B", "#A20056"],
    "tableau": list(plt.get_cmap("tab10").colors),
    "gray": ["#222222", "#777777", "#AAAAAA", "#555555", "#CCCCCC", "#333333"],
    "pastel": ["#F06EAA", "#F08A8A", "#F5B98A", "#F2E3A0", "#8FD3F2", "#8F8FEA", "#B86FE6", "#7FD3A8"],
    "bold": ["#000000", "#E41A1C", "#377EB8", "#4DAF4A", "#984EA3", "#FF7F00", "#A65628", "#F781BF"],
    # pastel lấy từ Figure 1 bài Le et al., ACS Appl. Nano Mater. 2025 (CuO/CeO2–ZrO2)
    "paper": ["#FF7FC6", "#FC9898", "#F8BF92", "#F4D897", "#82D0FF", "#8E9CFF", "#BC75FF", "#7FD3A8"],
    "npg_soft": ["#F0937F", "#94D6E6", "#66C6B7", "#8A98B8", "#F8C3B2", "#B5BDD2", "#BDE3DA", "#EA6666"],
    "tol_light": ["#77AADD", "#EE8866", "#EEDD88", "#FFAABB", "#99DDFF", "#44BB99", "#BBCC33", "#AAAA00"],
    "tol_muted": ["#CC6677", "#332288", "#DDCC77", "#117733", "#88CCEE", "#882255", "#44AA99", "#999933"],
    "seq_warm": ["#FFD8A8", "#FDB48C", "#F9917E", "#EE6F7B", "#D6527F", "#A83C82"],
    "seq_blue": ["#C6DBEF", "#9ECAE1", "#6BAED6", "#4292C6", "#2171B5", "#08519C"],
    "seq_green": ["#C7E9C0", "#A1D99B", "#74C476", "#41AB5D", "#238B45", "#005A32"],
    "seq_purple": ["#DADAEB", "#BCBDDC", "#9E9AC8", "#807DBA", "#6A51A3", "#4A1486"],
    "viridis": ["#440154", "#443983", "#31688E", "#21918C", "#35B779", "#90D743", "#FDE725"],
}
SEQUENTIAL = {"seq_warm", "seq_blue", "seq_green", "seq_purple", "viridis"}
MARKERS = ["o", "^", "s", "D", "v", "P", "X", "*", "<", ">"]
FONTS = {
    "sans": ["Arial", "Helvetica", "Liberation Sans", "DejaVu Sans"],
    "serif": ["Times New Roman", "Times", "Liberation Serif", "DejaVu Serif"],
    "mono": ["Courier New", "Liberation Mono", "DejaVu Sans Mono"],
}


THEMES = ["origin", "origin-in", "classic", "bw", "minimal"]


def set_theme(theme: str = "origin", font: str = "sans", fontsize: float = 11) -> None:
    """Đặt giao diện chung.
    theme: origin    – khung kín 4 cạnh, tick ra ngoài ở trục trái/dưới, có minor tick (giống OriginLab)
           origin-in – khung kín 4 cạnh, tick hướng vào trong, có ở cả 4 cạnh (kiểu bài báo điện hoá)
           classic | bw | minimal (kiểu ggplot2)
    font: sans | serif | mono | <tên font>."""
    family = FONTS.get(font, [font] + FONTS["sans"])
    rc = {
        "font.family": "sans-serif" if font != "serif" else "serif",
        "font.sans-serif": family if font != "serif" else FONTS["sans"],
        "font.serif": FONTS["serif"],
        "font.size": fontsize,
        "axes.titlesize": fontsize + 1,
        "axes.labelsize": fontsize,
        "xtick.labelsize": fontsize - 1,
        "ytick.labelsize": fontsize - 1,
        "legend.fontsize": fontsize - 1,
        "legend.title_fontsize": fontsize - 1,
        "legend.frameon": False,
        "axes.linewidth": 0.9,
        "xtick.major.width": 0.9,
        "ytick.major.width": 0.9,
        "xtick.direction": "out",
        "ytick.direction": "out",
        "savefig.bbox": "tight",
        "savefig.dpi": 300,
        "figure.dpi": 110,
        "pdf.fonttype": 42,  # chữ trong PDF/SVG vẫn sửa được bằng Illustrator/Inkscape
        "ps.fonttype": 42,
        "svg.fonttype": "none",
        "axes.prop_cycle": matplotlib.cycler(color=PALETTES["okabe"]),
    }
    if font == "mono":
        rc["font.family"] = "monospace"
        rc["font.monospace"] = FONTS["mono"]
    rc.update({"xtick.minor.visible": False, "ytick.minor.visible": False, "xtick.top": False,
               "ytick.right": False, "axes.spines.left": True, "axes.spines.bottom": True})
    if theme in ("origin", "origin-in"):
        inward = theme == "origin-in"
        rc.update({"axes.spines.top": True, "axes.spines.right": True, "axes.grid": False,
                   "axes.linewidth": 1.2, "xtick.major.width": 1.2, "ytick.major.width": 1.2,
                   "xtick.minor.width": 1.0, "ytick.minor.width": 1.0,
                   "xtick.major.size": 5, "ytick.major.size": 5, "xtick.minor.size": 3, "ytick.minor.size": 3,
                   "xtick.minor.visible": True, "ytick.minor.visible": True,
                   "xtick.direction": "in" if inward else "out", "ytick.direction": "in" if inward else "out",
                   "xtick.top": inward, "ytick.right": inward})
    elif theme == "classic":  # giống theme_classic(): chỉ có trục trái/dưới
        rc.update({"axes.spines.top": False, "axes.spines.right": False, "axes.grid": False})
    elif theme == "bw":  # giống theme_bw(): khung + lưới mảnh
        rc.update({"axes.spines.top": True, "axes.spines.right": True, "axes.grid": True,
                   "grid.color": "#DDDDDD", "grid.linewidth": 0.5})
    elif theme == "minimal":
        rc.update({"axes.spines.top": False, "axes.spines.right": False, "axes.spines.left": False,
                   "axes.grid": True, "grid.color": "#E5E5E5", "grid.linewidth": 0.6})
    plt.rcParams.update(rc)


set_theme()


def _no_minor(ax, axis="both"):
    from matplotlib.ticker import NullLocator
    if axis in ("x", "both"):
        ax.xaxis.set_minor_locator(NullLocator())
    if axis in ("y", "both"):
        ax.yaxis.set_minor_locator(NullLocator())


def _palette(levels, palette="okabe", colors=None) -> dict:
    """Trả về dict {mức: màu}. colors có thể là dict, list hoặc chuỗi 'a=red,b=#00f'."""
    levels = list(levels)
    if isinstance(colors, str) and colors:
        if "=" in colors:
            colors = dict(kv.split("=", 1) for kv in colors.split(","))
        else:
            colors = [c.strip() for c in colors.split(",")]
    base = PALETTES.get(palette) if isinstance(palette, str) else list(palette)
    if base is None:
        cmap = plt.get_cmap(palette)
        base = [cmap(i / max(1, len(levels) - 1)) for i in range(len(levels))]
    out = {lv: base[i % len(base)] for i, lv in enumerate(levels)}
    if isinstance(colors, dict):
        out.update({k: v for k, v in colors.items()})
        out.update({lv: colors[str(lv)] for lv in levels if str(lv) in colors})
    elif isinstance(colors, (list, tuple)):
        out.update({lv: colors[i % len(colors)] for i, lv in enumerate(levels)})
    return out


def _levels(series: pd.Series, order=None):
    if order:
        if isinstance(order, str):
            order = [o.strip() for o in order.split(",")]
        vals = list(pd.unique(series.dropna()))
        str_map = {str(v): v for v in vals}
        return [str_map.get(str(o), o) for o in order if str(o) in str_map]
    if isinstance(series.dtype, pd.CategoricalDtype):
        return list(series.cat.categories)
    vals = pd.unique(series.dropna())
    if pd.api.types.is_numeric_dtype(series):  # số: sắp tăng dần ; chữ: giữ thứ tự xuất hiện trong file
        return sorted(vals)
    return list(vals)


def _new_ax(ax, figsize):
    if ax is None:
        fig, ax = plt.subplots(figsize=figsize)
    else:
        fig = ax.figure
    return fig, ax


def _finish(ax, title=None, xlabel=None, ylabel=None, xlim=None, ylim=None, logx=False, logy=False,
            legend="best", legend_title=None, rotate_x=0, handles=None, note=None):
    if note:  # chú thích góc trên-trái, vd "@ 90 °C"
        ax.text(0.04, 0.95, note, transform=ax.transAxes, ha="left", va="top")
    if title:
        ax.set_title(title)
    if xlabel is not None:
        ax.set_xlabel(xlabel)
    if ylabel is not None:
        ax.set_ylabel(ylabel)
    if logx:
        ax.set_xscale("log")
    if logy:
        ax.set_yscale("log")
    if xlim is not None:
        ax.set_xlim(*_pair(xlim))
    if ylim is not None:
        ax.set_ylim(*_pair(ylim))
    if rotate_x:
        for t in ax.get_xticklabels():
            t.set_rotation(rotate_x)
            t.set_ha("right")
    if legend in (None, False, "none"):
        if ax.get_legend():
            ax.get_legend().remove()
    else:
        kw = {}
        if legend == "right":
            kw = dict(loc="center left", bbox_to_anchor=(1.01, 0.5))
        elif legend == "bottom":
            kw = dict(loc="upper center", bbox_to_anchor=(0.5, -0.16), ncol=6)
        elif legend == "top":
            kw = dict(loc="lower center", bbox_to_anchor=(0.5, 1.02), ncol=6)
        else:
            kw = dict(loc=legend)
        if handles:
            ax.legend(handles=handles, title=legend_title, **kw)
        elif ax.get_legend_handles_labels()[0]:
            ax.legend(title=legend_title, **kw)
    return ax


def _pair(v):
    if isinstance(v, str):
        v = [float(s) for s in v.split(",")]
    return tuple(None if (x is None or (isinstance(x, float) and math.isnan(x))) else x for x in v)


# --------------------------------------------------------------------------------------
# 1. Scatter / line  (Lesson 2-3)
# --------------------------------------------------------------------------------------
def scatter(df, x, y, color=None, shape=None, size=None, label=None, facet=None, ax=None,
            fit=None, ci=True, connect=False, coord_fixed=False, point_size=36, alpha=0.9,
            palette="okabe", colors=None, edgecolor="none", ncol_facet=3, order=None,
            labels_list=None, figsize=(5, 4), **kw):
    """Biểu đồ phân tán. fit: None | 'linear' | 'poly2' | 'lowess' ; connect=True để nối thành line.
    label: cột chứa nhãn để gắn chữ (labels_list: chỉ gắn những nhãn này)."""
    df = df.copy()
    if facet:  # facet_wrap
        lv = _levels(df[facet], order if False else None)
        n = len(lv)
        nc = min(ncol_facet, n)
        nr = math.ceil(n / nc)
        fig, axes = plt.subplots(nr, nc, figsize=(figsize[0] * nc * 0.75, figsize[1] * nr * 0.75),
                                 sharex=True, sharey=True, squeeze=False)
        for i, lvl in enumerate(lv):
            a = axes.flat[i]
            scatter(df[df[facet] == lvl], x, y, color, shape, size, label, None, a, fit, ci, connect,
                    coord_fixed, point_size, alpha, palette, colors, edgecolor, order=order,
                    labels_list=labels_list, legend=None, _all_levels=_levels(df[color], order) if color else None)
            a.set_title(f"{facet} = {lvl}", fontsize=plt.rcParams["font.size"])
            if not plt.rcParams["axes.spines.top"]:
                pass
        for j in range(n, nr * nc):
            axes.flat[j].set_visible(False)
        for a in axes[-1, :]:
            a.set_xlabel(kw.get("xlabel", x))
        for a in axes[:, 0]:
            a.set_ylabel(kw.get("ylabel", y))
        for a in axes.flat[:n]:
            if a not in axes[-1, :]:
                a.set_xlabel("")
            if a not in axes[:, 0]:
                a.set_ylabel("")
        h, l = axes.flat[0].get_legend_handles_labels()
        if h and kw.get("legend", "right") not in (None, False, "none"):
            fig.legend(h, l, title=kw.get("legend_title", color), loc="center left",
                       bbox_to_anchor=(1.0, 0.5), frameon=False)
        if kw.get("title"):
            fig.suptitle(kw["title"])
        fig.tight_layout()
        return fig, axes

    fig, ax = _new_ax(ax, figsize)
    all_levels = kw.pop("_all_levels", None)
    shape_map = {}
    if shape:
        shape_map = {g: MARKERS[i % len(MARKERS)] for i, g in enumerate(_levels(df[shape], order))}
    if size:
        s_raw = pd.to_numeric(df[size], errors="coerce")
        s_min, s_max = s_raw.min(), s_raw.max()
        df["_s"] = point_size * (0.3 + 2.2 * (s_raw - s_min) / (s_max - s_min if s_max > s_min else 1))
    else:
        df["_s"] = point_size
    groups = [(None, df)]
    cmap_ = {}
    if color:
        lv = all_levels or _levels(df[color], order)
        cmap_ = _palette(lv, palette, colors)
        groups = [(g, df[df[color] == g]) for g in lv]

    for g, sub in groups:
        c = cmap_.get(g, PALETTES["okabe"][0] if not connect else "#333333")
        sub = sub.sort_values(x) if connect else sub
        if connect:
            ax.plot(sub[x], sub[y], color=c, lw=1.4, zorder=2, label=None if shape else (str(g) if g is not None else None))
        if shape:
            for sg, ssub in sub.groupby(shape, sort=False):
                ax.scatter(ssub[x], ssub[y], s=ssub["_s"], c=[c], marker=shape_map[sg], alpha=alpha,
                           edgecolors=edgecolor, linewidths=0.5, zorder=3)
        else:
            ax.scatter(sub[x], sub[y], s=sub["_s"], c=[c], alpha=alpha, edgecolors=edgecolor,
                       linewidths=0.5, zorder=3, label=(str(g) if g is not None and not connect else None))
        if fit:
            _fit_line(ax, sub[x].to_numpy(float), sub[y].to_numpy(float), fit, c, ci)

    handles = None
    if shape or (color and shape):
        handles = []
        if color:
            if color == shape:
                handles = [Line2D([], [], marker=shape_map[g], ls="", color=cmap_[g], label=str(g), markersize=7)
                           for g in cmap_]
            else:
                handles += [Line2D([], [], marker="o", ls="", color=cmap_[g], label=str(g), markersize=7) for g in cmap_]
        if shape and shape != color:
            handles += [Line2D([], [], marker=m, ls="", color="#444", label=str(g), markersize=7)
                        for g, m in shape_map.items()]
    if label:
        sub = df if not labels_list else df[df[label].astype(str).isin(
            labels_list.split(",") if isinstance(labels_list, str) else labels_list)]
        _label_points(ax, sub[x].to_numpy(float), sub[y].to_numpy(float), sub[label].astype(str).tolist())
    if coord_fixed:
        ax.set_aspect("equal", adjustable="datalim")
    _finish(ax, kw.get("title"), kw.get("xlabel", x), kw.get("ylabel", y), kw.get("xlim"), kw.get("ylim"),
            kw.get("logx", False), kw.get("logy", False), kw.get("legend", "best"),
            kw.get("legend_title", color or shape), kw.get("rotate_x", 0), handles)
    if size and kw.get("legend", "best") not in (None, False, "none"):
        pass
    return fig, ax


def line(df, x, y, color=None, agg=None, error="sd", ax=None, palette="okabe", colors=None,
         order=None, markers=True, figsize=(5, 4), ms=5, lw=1.4, **kw):
    """Đồ thị đường (geom_line + geom_point).
    agg='mean': gộp các lặp lại (replicate) tại mỗi x → trung bình ± error (sd | se | ci95)."""
    if not agg:
        error = None  # không gộp: mỗi x một giá trị, không có thanh sai số
    fig, ax = _new_ax(ax, figsize)
    lv = _levels(df[color], order) if color else [None]
    cmap_ = _palette(lv, palette, colors) if color else {None: "#333333"}
    for i, g in enumerate(lv):
        sub = df if g is None else df[df[color] == g]
        rows = [(xv, *_summary(s[y], error)) for xv, s in sub.groupby(x, sort=True)]
        xs, mvals, es = (np.array([r[k] for r in rows], float) for k in (0, 1, 2))
        mk = (MARKERS[i % len(MARKERS)] if markers is True else markers) if markers else None
        ax.errorbar(xs, mvals, yerr=es if error not in (None, "none") else None, color=cmap_[g], lw=lw,
                    marker=mk, ms=ms, capsize=2.5, elinewidth=0.9,
                    label=None if g is None else str(g), zorder=3)
    ylab = f"{y} (mean ± {error.upper()})" if error not in (None, "none") else y
    _finish(ax, kw.get("title"), kw.get("xlabel", x), kw.get("ylabel", ylab), kw.get("xlim"), kw.get("ylim"),
            kw.get("logx", False), kw.get("logy", False), kw.get("legend", "best"),
            kw.get("legend_title"))
    return fig, ax


def _fit_line(ax, xv, yv, kind, c, ci=True):
    m = np.isfinite(xv) & np.isfinite(yv)
    xv, yv = xv[m], yv[m]
    if len(xv) < 3:
        return
    xs = np.linspace(xv.min(), xv.max(), 200)
    if kind == "lowess":
        try:
            from statsmodels.nonparametric.smoothers_lowess import lowess
            r = lowess(yv, xv, frac=0.66)
            ax.plot(r[:, 0], r[:, 1], color=c, lw=1.5, zorder=4)
            return
        except ImportError:
            kind = "poly2"
    deg = 2 if kind == "poly2" else 1
    X = np.vander(xv, deg + 1)
    beta, *_ = np.linalg.lstsq(X, yv, rcond=None)
    Xs = np.vander(xs, deg + 1)
    ys = Xs @ beta
    ax.plot(xs, ys, color=c, lw=1.5, zorder=4)
    if ci:  # dải tin cậy 95 % của đường hồi quy (như geom_smooth(method='lm'))
        from scipy import stats
        n, p = X.shape
        resid = yv - X @ beta
        s2 = resid @ resid / max(n - p, 1)
        cov = s2 * np.linalg.pinv(X.T @ X)
        se = np.sqrt(np.einsum("ij,jk,ik->i", Xs, cov, Xs))
        t = stats.t.ppf(0.975, max(n - p, 1))
        ax.fill_between(xs, ys - t * se, ys + t * se, color=c, alpha=0.15, lw=0, zorder=1)
    if kind == "linear":
        r2 = 1 - ((yv - X @ beta) ** 2).sum() / ((yv - yv.mean()) ** 2).sum()
        ax._sciplot_fits = getattr(ax, "_sciplot_fits", []) + [(beta, r2)]


def _label_points(ax, xs, ys, labels, fontsize=None):
    fontsize = fontsize or plt.rcParams["font.size"] - 2
    texts = [ax.text(x, y, l, fontsize=fontsize, zorder=6) for x, y, l in zip(xs, ys, labels)]
    try:
        from adjustText import adjust_text
        adjust_text(texts, ax=ax, arrowprops=dict(arrowstyle="-", color="gray", lw=0.6),
                    expand=(1.3, 1.6))
    except Exception:
        for t in texts:
            t.set_position((t.get_position()[0], t.get_position()[1]))
            t.set_va("bottom")


# --------------------------------------------------------------------------------------
# 2. PCA  (Lesson 3)
# --------------------------------------------------------------------------------------
def pca(df, columns=None, group=None, scale=True, ellipse=True, level=0.95, pcs=(1, 2),
        loadings=False, label=None, ax=None, palette="okabe", colors=None, point_size=36,
        figsize=(5.2, 4.2), order=None, coord_fixed=True, return_result=False, **kw):
    """PCA giống prcomp(scale=TRUE) + stat_ellipse(level=0.95). columns: list hoặc 'a,b,c' (mặc định: mọi cột số)."""
    if isinstance(columns, str):
        columns = [c.strip() for c in columns.split(",")]
    if columns is None:
        columns = [c for c in df.select_dtypes("number").columns if c not in (group, label)]
    data = df[columns].apply(pd.to_numeric, errors="coerce")
    keep = data.notna().all(axis=1)
    data, meta = data[keep], df[keep]
    X = data.to_numpy(float)
    X = X - X.mean(axis=0)
    if scale:
        sd = X.std(axis=0, ddof=1)
        X = X / np.where(sd == 0, 1, sd)
    U, S, Vt = np.linalg.svd(X, full_matrices=False)
    scores = U * S
    var = S ** 2 / (len(X) - 1)
    pve = var / var.sum()
    # đồng nhất dấu với prcomp (thành phần lớn nhất của loading dương) — chỉ là quy ước
    i1, i2 = (int(p) - 1 for p in _pair(pcs)) if not isinstance(pcs, tuple) else (pcs[0] - 1, pcs[1] - 1)
    pc_df = pd.DataFrame({f"PC{i1 + 1}": scores[:, i1], f"PC{i2 + 1}": scores[:, i2]}, index=meta.index)
    xcol, ycol = pc_df.columns
    if group:
        pc_df[group] = meta[group].values
    if label:
        pc_df[label] = meta[label].astype(str).values
    fig, ax = _new_ax(ax, figsize)
    lv = _levels(pc_df[group], order) if group else [None]
    cmap_ = _palette(lv, palette, colors) if group else {None: PALETTES["okabe"][0]}
    shape_map = {g: MARKERS[i % len(MARKERS)] for i, g in enumerate(lv)}
    for g in lv:
        sub = pc_df if g is None else pc_df[pc_df[group] == g]
        c = cmap_[g]
        ax.scatter(sub[xcol], sub[ycol], s=point_size, c=[c], marker=shape_map[g], alpha=0.9,
                   edgecolors="none", label=None if g is None else str(g), zorder=3)
        if ellipse and len(sub) > 2:
            _conf_ellipse(ax, sub[xcol].to_numpy(), sub[ycol].to_numpy(), level, c)
    if loadings:
        L = Vt.T[:, [i1, i2]] * S[[i1, i2]] / np.sqrt(len(X) - 1)
        k = 0.8 * np.abs(pc_df[[xcol, ycol]].to_numpy()).max() / np.abs(L).max()
        for name, (lx, ly) in zip(columns, L):
            ax.annotate("", xy=(lx * k, ly * k), xytext=(0, 0),
                        arrowprops=dict(arrowstyle="->", color="#B22222", lw=1))
            ax.text(lx * k * 1.08, ly * k * 1.08, name, color="#B22222",
                    fontsize=plt.rcParams["font.size"] - 2, ha="center", va="center")
    if label:
        _label_points(ax, pc_df[xcol].to_numpy(), pc_df[ycol].to_numpy(), pc_df[label].tolist())
    ax.axhline(0, color="#BBBBBB", lw=0.6, zorder=0)
    ax.axvline(0, color="#BBBBBB", lw=0.6, zorder=0)
    if coord_fixed:
        ax.set_aspect("equal", adjustable="datalim")
    kw.setdefault("xlabel", f"{xcol}: {pve[i1] * 100:.1f}%")
    kw.setdefault("ylabel", f"{ycol}: {pve[i2] * 100:.1f}%")
    _finish(ax, kw.get("title"), kw["xlabel"], kw["ylabel"], kw.get("xlim"), kw.get("ylim"),
            legend=kw.get("legend", "best"), legend_title=kw.get("legend_title", group))
    if return_result:
        return fig, ax, {"scores": pc_df, "pve": pve, "loadings": pd.DataFrame(Vt.T, index=columns,
                         columns=[f"PC{i + 1}" for i in range(Vt.shape[0])])}
    return fig, ax


def _conf_ellipse(ax, x, y, level, color):
    from scipy import stats
    cov = np.cov(x, y)
    vals, vecs = np.linalg.eigh(cov)
    order = vals.argsort()[::-1]
    vals, vecs = vals[order], vecs[:, order]
    # stat_ellipse mặc định dùng phân phối t đa biến; ở đây dùng chuẩn với hệ số F gần tương đương
    n = len(x)
    r = np.sqrt(2 * (n - 1) / (n - 2) * stats.f.ppf(level, 2, n - 2)) if n > 3 else np.sqrt(stats.chi2.ppf(level, 2))
    w, h = 2 * r * np.sqrt(vals)
    ang = np.degrees(np.arctan2(*vecs[:, 0][::-1]))
    ax.add_patch(Ellipse((x.mean(), y.mean()), w, h, angle=ang, facecolor=to_rgba(color, 0.15),
                         edgecolor=color, lw=1, zorder=1))


# --------------------------------------------------------------------------------------
# 3. Volcano  (Lesson 3)
# --------------------------------------------------------------------------------------
def volcano(df, fc="logFC", p="FDR", label=None, fc_thr=1.0, p_thr=0.05, top=10, label_genes=None,
            ax=None, colors=("#3B4992", "#BBBBBB", "#E11F28"), point_size=14, figsize=(5, 4.5),
            show_counts=True, **kw):
    """Volcano plot: x = log2FC, y = -log10(p). top: số gene có ý nghĩa gắn nhãn (theo p nhỏ nhất)."""
    if isinstance(colors, str):
        colors = [c.strip() for c in colors.split(",")]
    d = df.copy()
    d["_fc"] = pd.to_numeric(d[fc], errors="coerce")
    pv = pd.to_numeric(d[p], errors="coerce").clip(lower=np.finfo(float).tiny)
    d["_nlp"] = -np.log10(pv)
    d = d.dropna(subset=["_fc", "_nlp"])
    up = (d["_fc"] >= fc_thr) & (pv.loc[d.index] < p_thr)
    down = (d["_fc"] <= -fc_thr) & (pv.loc[d.index] < p_thr)
    d["_cls"] = np.select([down, up], ["Down", "Up"], "NS")
    fig, ax = _new_ax(ax, figsize)
    cdown, cns, cup = colors
    for cls, c, s, a, z in [("NS", cns, point_size * 0.7, 0.6, 1), ("Down", cdown, point_size, 0.85, 2),
                            ("Up", cup, point_size, 0.85, 2)]:
        sub = d[d["_cls"] == cls]
        lab = {"NS": "NS", "Up": "Up", "Down": "Down"}[cls]
        if show_counts:
            lab += f" ({len(sub)})"
        ax.scatter(sub["_fc"], sub["_nlp"], s=s, c=c, alpha=a, edgecolors="none", label=lab, zorder=z)
    ax.axhline(-np.log10(p_thr), ls="--", color="#666", lw=0.7, zorder=0)
    for v in (-fc_thr, fc_thr):
        ax.axvline(v, ls="--", color="#666", lw=0.7, zorder=0)
    if label:
        if label_genes:
            gl = label_genes.split(",") if isinstance(label_genes, str) else list(label_genes)
            lab_df = d[d[label].astype(str).isin([g.strip() for g in gl])]
        elif top:
            lab_df = d[d["_cls"] != "NS"].sort_values("_nlp", ascending=False).head(int(top))
        else:
            lab_df = d.iloc[0:0]
        _label_points(ax, lab_df["_fc"].to_numpy(), lab_df["_nlp"].to_numpy(), lab_df[label].astype(str).tolist())
    lim = np.nanmax(np.abs(d["_fc"])) * 1.08
    if kw.get("xlim") is None and kw.get("symmetric", True):
        ax.set_xlim(-lim, lim)
    ax.set_ylim(bottom=0)
    _finish(ax, kw.get("title"), kw.get("xlabel", r"log$_2$ fold change"),
            kw.get("ylabel", rf"$-$log$_{{10}}$ {p}"), kw.get("xlim"), kw.get("ylim"),
            legend=kw.get("legend", "best"), legend_title=kw.get("legend_title"))
    return fig, ax


# --------------------------------------------------------------------------------------
# 4. Bar  (Lesson 4)
# --------------------------------------------------------------------------------------
def _summary(vals, error):
    from scipy import stats
    v = pd.to_numeric(vals, errors="coerce").dropna().to_numpy()
    m = v.mean() if len(v) else np.nan
    if error == "sd":
        e = v.std(ddof=1) if len(v) > 1 else 0
    elif error == "se":
        e = v.std(ddof=1) / np.sqrt(len(v)) if len(v) > 1 else 0
    elif error in ("ci", "ci95"):
        e = stats.t.ppf(0.975, len(v) - 1) * v.std(ddof=1) / np.sqrt(len(v)) if len(v) > 1 else 0
    else:
        e = 0
    return m, e, len(v)


def bar(df, x, y=None, hue=None, stat="mean", error="sd", err_col=None, position="dodge",
        points=False, ax=None, palette="okabe", colors=None, order=None, hue_order=None,
        horizontal=False, width=0.8, edgecolor="black", capsize=3, figsize=(5, 4),
        value_labels=False, value_fmt="{:.2f}", gradient=None, errcolor="#333333", **kw):
    """Bar plot.
    gradient = "#F2A3A3,#F2D9A0" – tô cột chuyển màu (trên → dưới), giống hình xuất từ Origin.
    value_labels=True – ghi giá trị phía trên thanh sai số (value_fmt định dạng, vd "{:.1f}").
    stat='count'    – đếm số dòng mỗi nhóm (stat_count)
    stat='mean'     – tính trung bình từ dữ liệu thô, error = sd | se | ci95 | none
    stat='identity' – dùng giá trị y có sẵn (dữ liệu tổng hợp), err_col = cột SD có sẵn
    position = dodge | stack ; points=True vẽ thêm từng điểm dữ liệu thô."""
    d = df.copy()
    d[x] = d[x].astype(str) if not isinstance(d[x].dtype, pd.CategoricalDtype) else d[x]
    xl = [str(v) for v in _levels(d[x], order)]
    if hue:
        d[hue] = d[hue].astype(str)
    hl = [str(v) for v in _levels(d[hue], hue_order)] if hue else [None]
    cmap_ = _palette(hl, palette, colors) if hue else {None: (_palette(["a"], palette, colors)["a"])}
    rows = []
    for xi in xl:
        for hi in hl:
            sub = d[(d[x].astype(str) == xi) & ((d[hue] == hi) if hue else True)]
            if stat == "count":
                m, e, n = len(sub), 0, len(sub)
            elif stat == "identity":
                m = pd.to_numeric(sub[y], errors="coerce").sum() if len(sub) else np.nan
                e = pd.to_numeric(sub[err_col], errors="coerce").iloc[0] if (err_col and len(sub)) else 0
                n = len(sub)
            else:
                m, e, n = _summary(sub[y], error)
            rows.append((xi, hi, m, e, sub))
    fig, ax = _new_ax(ax, figsize)
    nh = len(hl)
    pos = np.arange(len(xl))
    bw = width / nh if position == "dodge" else width
    bottoms = np.zeros(len(xl))
    rng = np.random.default_rng(1)
    vlabels = []
    for j, hi in enumerate(hl):
        r = [row for row in rows if row[1] == hi]
        means = np.array([row[2] for row in r], float)
        errs = np.array([row[3] for row in r], float)
        off = (j - (nh - 1) / 2) * bw if position == "dodge" else 0
        xx = pos + off
        c = cmap_[hi]
        barf = ax.barh if horizontal else ax.bar
        kwb = dict(height=bw * 0.95, left=bottoms if position == "stack" else None) if horizontal else \
            dict(width=bw * 0.95, bottom=bottoms if position == "stack" else None)
        bars = barf(xx, means, color=c, edgecolor=edgecolor, linewidth=0.8, label=hi, zorder=2, **kwb)
        if gradient:
            _gradient_bars(ax, bars, gradient, horizontal)
        if np.any(errs > 0) and position == "dodge":
            if horizontal:
                ax.errorbar(means, xx, xerr=errs, fmt="none", ecolor=errcolor, elinewidth=0.9, capsize=capsize, zorder=3)
            else:
                ax.errorbar(xx, means, yerr=errs, fmt="none", ecolor=errcolor, elinewidth=0.9, capsize=capsize, zorder=3)
        if points and stat == "mean":
            for k, row in enumerate(r):
                v = pd.to_numeric(row[4][y], errors="coerce").dropna().to_numpy()
                jit = rng.uniform(-bw * 0.25, bw * 0.25, len(v))
                if horizontal:
                    ax.scatter(v, xx[k] + jit, s=12, c="black", alpha=0.7, zorder=4, edgecolors="none")
                else:
                    ax.scatter(xx[k] + jit, v, s=12, c="black", alpha=0.7, zorder=4, edgecolors="none")
        if value_labels:
            vlabels.append((xx, means, np.nan_to_num(errs) if position == "dodge" else 0 * errs, bottoms.copy()))
        if position == "stack":
            bottoms = bottoms + np.nan_to_num(means)
    if horizontal:
        ax.set_yticks(pos, xl)
        ax.set_xlim(left=0)
    else:
        ax.set_xticks(pos, xl)
        ax.set_ylim(bottom=0)
    ax.grid(axis="x" if not horizontal else "y", visible=False)
    top_needed = max([np.nanmax(m + e + b) for _, m, e, b in vlabels], default=0)
    if not horizontal and kw.get("ylim") is None:
        lo, hi_ = ax.get_ylim()
        ax.set_ylim(0, max(hi_, top_needed * 1.08) * (1.18 if (hue or kw.get("note")) else 1.05))
    span = (ax.get_xlim()[1] if horizontal else ax.get_ylim()[1])
    for xx, m, e, b in vlabels:
        for xi_, mi, ei, bi in zip(xx, m, e, b):
            if np.isfinite(mi):
                t = value_fmt.format(mi) if "{" in value_fmt else value_fmt % mi
                if horizontal:
                    ax.text(bi + mi + ei + 0.01 * span, xi_, t, va="center", ha="left")
                else:
                    ax.text(xi_, bi + mi + ei + 0.012 * span, t, ha="center", va="bottom")
    _no_minor(ax, "y" if horizontal else "x")
    bar_handles = [Patch(facecolor=cmap_[h], edgecolor=edgecolor, label=h) for h in hl] if hue else None
    ylab = {"count": "Count", "identity": y}.get(stat, f"{y} (mean ± {error.upper()})" if error not in (None, "none") else y)
    xl_, yl_ = (kw.get("xlabel", x), kw.get("ylabel", ylab))
    if horizontal:
        xl_, yl_ = kw.get("xlabel", ylab), kw.get("ylabel", x)
    _finish(ax, kw.get("title"), xl_, yl_, kw.get("xlim"), kw.get("ylim"),
            legend=kw.get("legend", "best") if hue else None, legend_title=kw.get("legend_title", hue),
            rotate_x=kw.get("rotate_x", 0), handles=bar_handles)
    return fig, ax


def _gradient_bars(ax, bars, gradient, horizontal=False):
    cols_ = [c.strip() for c in gradient.split(",")] if isinstance(gradient, str) else list(gradient)
    cm = LinearSegmentedColormap.from_list("grad", cols_[::-1])
    grad = np.linspace(0, 1, 256).reshape(-1, 1)
    if horizontal:
        grad = grad.T
    xlim, ylim = ax.get_xlim(), ax.get_ylim()
    for b in bars:
        x0, y0 = b.get_xy()
        w, h = b.get_width(), b.get_height()
        if not (np.isfinite(w) and np.isfinite(h)) or w == 0 or h == 0:
            continue
        im = ax.imshow(grad, extent=[x0, x0 + w, y0, y0 + h], origin="lower", aspect="auto", cmap=cm,
                       zorder=b.get_zorder() - 0.1, interpolation="bicubic")
        im.set_clip_path(b)
        b.set_facecolor("none")
    ax.set_xlim(xlim)
    ax.set_ylim(ylim)
    ax.set_aspect("auto")


# --------------------------------------------------------------------------------------
# 5. Histogram  (Lesson 4)
# --------------------------------------------------------------------------------------
def histogram(df, x, hue=None, bins=30, binwidth=None, density=False, kde=False, multiple="overlay",
              ax=None, palette="okabe", colors=None, color="cornflowerblue", edgecolor="black",
              alpha=None, order=None, figsize=(5, 4), **kw):
    """Histogram. multiple = overlay | stack | dodge ; kde=True thêm đường mật độ."""
    v_all = pd.to_numeric(df[x], errors="coerce").dropna()
    if binwidth:
        edges = np.arange(v_all.min(), v_all.max() + float(binwidth), float(binwidth))
    else:
        edges = np.histogram_bin_edges(v_all, bins=int(bins))
    fig, ax = _new_ax(ax, figsize)
    if hue:
        lv = _levels(df[hue], order)
        cmap_ = _palette(lv, palette, colors)
        data = [pd.to_numeric(df.loc[df[hue] == g, x], errors="coerce").dropna() for g in lv]
        ht = {"overlay": "stepfilled", "stack": "barstacked", "dodge": "bar"}[multiple]
        if multiple == "overlay":
            for g, v in zip(lv, data):
                ax.hist(v, bins=edges, density=density, color=cmap_[g], alpha=alpha or 0.5,
                        edgecolor=edgecolor, linewidth=0.6, label=str(g))
        else:
            ax.hist(data, bins=edges, density=density, color=[cmap_[g] for g in lv], alpha=alpha or 0.9,
                    edgecolor=edgecolor, linewidth=0.6, label=[str(g) for g in lv], histtype=ht,
                    stacked=(multiple == "stack"))
        if kde:
            for g, v in zip(lv, data):
                _kde(ax, v, edges, density, cmap_[g])
    else:
        ax.hist(v_all, bins=edges, density=density, color=color, alpha=alpha or 1, edgecolor=edgecolor, linewidth=0.6)
        if kde:
            _kde(ax, v_all, edges, density, "#333")
    ax.set_ylim(bottom=0)
    _finish(ax, kw.get("title"), kw.get("xlabel", x), kw.get("ylabel", "Density" if density else "Count"),
            kw.get("xlim"), kw.get("ylim"), legend=kw.get("legend", "best"), legend_title=kw.get("legend_title", hue))
    return fig, ax


def _kde(ax, v, edges, density, c):
    from scipy.stats import gaussian_kde
    if len(v) < 3:
        return
    xs = np.linspace(edges[0], edges[-1], 300)
    ys = gaussian_kde(v)(xs)
    if not density:
        ys = ys * len(v) * (edges[1] - edges[0])
    ax.plot(xs, ys, color=c, lw=1.6)


# --------------------------------------------------------------------------------------
# 6. Box / violin  (Lesson 4)
# --------------------------------------------------------------------------------------
def box(df, x, y, hue=None, kind="box", points=True, show_mean=False, notch=False, ax=None,
        palette="okabe", colors=None, order=None, hue_order=None, width=0.75, filled=False,
        point_size=12, figsize=(5, 4), stats_test=None, **kw):
    """Box plot (hoặc kind='violin'), points=True thêm jitter (position_jitterdodge).
    stats_test='t' | 'mw' : so sánh 2 nhóm hue tại mỗi x, in dấu *, **, ***."""
    d = df.copy()
    d[x] = d[x].astype(str)
    xl = [str(v) for v in _levels(d[x], order)]
    if hue:
        d[hue] = d[hue].astype(str)
    hl = [str(v) for v in _levels(d[hue], hue_order)] if hue else [None]
    cmap_ = _palette(hl, palette, colors) if hue else {None: _palette(["a"], palette, colors)["a"]}
    fig, ax = _new_ax(ax, figsize)
    nh = len(hl)
    bw = width / nh
    rng = np.random.default_rng(7)
    for j, hi in enumerate(hl):
        c = cmap_[hi]
        data, posn = [], []
        for i, xi in enumerate(xl):
            m = (d[x] == xi) & ((d[hue] == hi) if hue else True)
            data.append(pd.to_numeric(d.loc[m, y], errors="coerce").dropna().to_numpy())
            posn.append(i + (j - (nh - 1) / 2) * bw)
        valid = [k for k, v in enumerate(data) if len(v)]
        dv, pv = [data[k] for k in valid], [posn[k] for k in valid]
        if kind == "violin":
            parts = ax.violinplot(dv, positions=pv, widths=bw * 0.9, showextrema=False)
            for b in parts["bodies"]:
                b.set_facecolor(to_rgba(c, 0.35))
                b.set_edgecolor(c)
                b.set_alpha(None)
            for v, p_ in zip(dv, pv):
                q1, med, q3 = np.percentile(v, [25, 50, 75])
                ax.vlines(p_, q1, q3, color=c, lw=3)
                ax.scatter([p_], [med], color="white", s=14, zorder=4, edgecolors=c)
        else:
            bp = ax.boxplot(dv, positions=pv, widths=bw * 0.8, notch=notch, patch_artist=True,
                            showfliers=not points, manage_ticks=False,
                            medianprops=dict(color=c if not filled else "black", lw=1.6),
                            boxprops=dict(edgecolor=c if not filled else "black", lw=1.1),
                            whiskerprops=dict(color=c if not filled else "black", lw=1.1),
                            capprops=dict(color=c if not filled else "black", lw=1.1),
                            flierprops=dict(marker="o", markeredgecolor=c, markersize=4))
            for patch in bp["boxes"]:
                patch.set_facecolor(to_rgba(c, 0.85) if filled else to_rgba(c, 0.08))
        if points:
            for v, p_ in zip(dv, pv):
                jit = rng.uniform(-bw * 0.22, bw * 0.22, len(v))
                ax.scatter(p_ + jit, v, s=point_size, color=c if not filled else "black", alpha=0.75,
                           edgecolors="none", zorder=3)
        if show_mean:
            ax.scatter(pv, [v.mean() for v in dv], marker="D", s=22, color="white", edgecolors="black", zorder=5)
        ax.scatter([], [], marker="s", s=60, color=c, label=hi) if hue else None
    if stats_test and hue and nh == 2:
        from scipy import stats
        ymax = pd.to_numeric(d[y], errors="coerce").max()
        yr = ymax - pd.to_numeric(d[y], errors="coerce").min()
        for i, xi in enumerate(xl):
            a = pd.to_numeric(d.loc[(d[x] == xi) & (d[hue] == hl[0]), y], errors="coerce").dropna()
            b = pd.to_numeric(d.loc[(d[x] == xi) & (d[hue] == hl[1]), y], errors="coerce").dropna()
            if len(a) > 1 and len(b) > 1:
                pval = (stats.ttest_ind(a, b, equal_var=False).pvalue if stats_test == "t"
                        else stats.mannwhitneyu(a, b).pvalue)
                star = "***" if pval < 0.001 else "**" if pval < 0.01 else "*" if pval < 0.05 else "ns"
                top_ = max(a.max(), b.max()) + 0.05 * yr
                ax.plot([i - bw / 2, i - bw / 2, i + bw / 2, i + bw / 2],
                        [top_, top_ + 0.02 * yr, top_ + 0.02 * yr, top_], color="black", lw=0.8)
                ax.text(i, top_ + 0.03 * yr, star, ha="center", va="bottom")
        lo_, hi_ = ax.get_ylim()
        ax.set_ylim(lo_, max(hi_, ymax + 0.16 * yr))
    ax.set_xticks(range(len(xl)), xl)
    ax.set_xlim(-0.6, len(xl) - 0.4)
    _no_minor(ax, "x")
    _finish(ax, kw.get("title"), kw.get("xlabel", x), kw.get("ylabel", y), kw.get("xlim"), kw.get("ylim"),
            legend=kw.get("legend", "best") if hue else None, legend_title=kw.get("legend_title", hue),
            rotate_x=kw.get("rotate_x", 0))
    return fig, ax


# --------------------------------------------------------------------------------------
# 7. Heatmap  (Lesson 5, pheatmap)
# --------------------------------------------------------------------------------------
CMAPS = {
    "navy-white-red": ["navy", "white", "firebrick"],
    "blue-white-red": ["#2166AC", "#F7F7F7", "#B2182B"],
    "green-black-red": ["#00A000", "black", "#E00000"],
    "pheatmap": ["#4575B4", "#91BFDB", "#E0F3F8", "#FFFFBF", "#FEE090", "#FC8D59", "#D73027"],
}


def heatmap(df, index=None, columns=None, scale="row", cluster_rows=True, cluster_cols=True,
            distance="euclidean", method="complete", cmap="navy-white-red", annotation_col=None,
            annotation_row=None, annotation_colors=None, cutree_rows=None, cutree_cols=None,
            show_values=False, fmt=".1f", ax=None, figsize=(6.5, 5.5), row_fontsize=None,
            col_fontsize=None, vlim=None, cbar_label=None, show_rownames=None, show_colnames=None, **kw):
    """Heatmap phân cụm kiểu pheatmap.
    df: bảng rộng (hàng = gene/biến, cột = mẫu). index: cột làm tên hàng.
    scale: 'row' | 'column' | 'none' (z-score).  distance: euclidean | correlation | cityblock | cosine ...
    method: complete | average | ward | single.  annotation_col: dict {mẫu: nhóm} hoặc DataFrame (index = mẫu).
    cutree_rows/cols: số cụm để tách bằng khe trắng."""
    from scipy.cluster import hierarchy as sch
    from scipy.spatial.distance import pdist
    d = df.copy()
    if index:
        d = d.set_index(index)
    if isinstance(columns, str):
        columns = [c.strip() for c in columns.split(",")]
    d = d[columns] if columns else d.select_dtypes("number")
    d = d.apply(pd.to_numeric, errors="coerce")
    M = d.to_numpy(float)
    if scale == "row":
        M = (M - np.nanmean(M, 1, keepdims=True)) / np.nanstd(M, 1, ddof=1, keepdims=True)
    elif scale in ("column", "col"):
        M = (M - np.nanmean(M, 0, keepdims=True)) / np.nanstd(M, 0, ddof=1, keepdims=True)
    M = np.nan_to_num(M)
    rows, cols = list(d.index.astype(str)), list(d.columns.astype(str))

    def _link(A):
        if method == "ward":
            return sch.linkage(A, method="ward", metric="euclidean")
        return sch.linkage(pdist(A, metric=distance), method=method)

    Zr = _link(M) if (cluster_rows and len(rows) > 2) else None
    Zc = _link(M.T) if (cluster_cols and len(cols) > 2) else None
    ro = sch.leaves_list(Zr) if Zr is not None else np.arange(len(rows))
    co = sch.leaves_list(Zc) if Zc is not None else np.arange(len(cols))
    Mo = M[np.ix_(ro, co)]

    if ax is None:
        fig = plt.figure(figsize=figsize)
        ax = fig.add_axes([0, 0, 1, 1])
    fig = ax.figure
    ax.axis("off")
    # bố cục trong khung ax (toạ độ phân số)
    has_ac = annotation_col is not None
    has_ar = annotation_row is not None
    dl = 0.12 if Zr is not None else 0.0
    dt = 0.12 if Zc is not None else 0.0
    ar_w = 0.035 if has_ar else 0
    ac_h = 0.04 if has_ac else 0
    title_h = 0.06 if kw.get("title") else 0.0
    left = 0.01 + dl + ar_w
    right = 0.70
    bottom = 0.11
    top = 0.99 - title_h - dt - ac_h
    hm = ax.inset_axes([left, bottom, right - left, top - bottom])
    if isinstance(cmap, str) and cmap in CMAPS:
        cm = LinearSegmentedColormap.from_list(cmap, CMAPS[cmap], N=256)
    else:
        cm = plt.get_cmap(cmap)
    if vlim is None:
        vmax = np.nanmax(np.abs(Mo)) if scale != "none" else None
        vmin = -vmax if vmax is not None else None
    else:
        vmin, vmax = _pair(vlim)
    im = hm.imshow(Mo, aspect="auto", cmap=cm, vmin=vmin, vmax=vmax, interpolation="nearest")
    rfs = row_fontsize or max(5, min(plt.rcParams["font.size"] - 1, 260 / max(len(rows), 1)))
    cfs = col_fontsize or max(5, min(plt.rcParams["font.size"] - 1, 300 / max(len(cols), 1)))
    hm.set_yticks(range(len(rows)), [rows[i] for i in ro], fontsize=rfs)
    hm.set_xticks(range(len(cols)), [cols[i] for i in co], fontsize=cfs, rotation=90)
    hm.yaxis.tick_right()
    hm.tick_params(length=0, which="both")
    hm.minorticks_off()
    if show_rownames is False or (show_rownames is None and len(rows) > 80):
        hm.set_yticks([])
    if show_colnames is False or (show_colnames is None and len(cols) > 80):
        hm.set_xticks([])
    for s in hm.spines.values():
        s.set_visible(False)
    hm.grid(False)
    if show_values:
        raw = d.to_numpy(float)[np.ix_(ro, co)]
        for i in range(raw.shape[0]):
            for j in range(raw.shape[1]):
                val = Mo[i, j]
                hm.text(j, i, format(raw[i, j], fmt), ha="center", va="center",
                        fontsize=max(5, rfs - 1), color="white" if abs(val) > 0.6 * (vmax or 1) else "black")
    bg = fig.get_facecolor()
    if cutree_rows and Zr is not None:
        cl = sch.fcluster(Zr, int(cutree_rows), "maxclust")[ro]
        for b in np.where(np.diff(cl) != 0)[0]:
            hm.axhline(b + 0.5, color=bg, lw=3)
    if cutree_cols and Zc is not None:
        cl = sch.fcluster(Zc, int(cutree_cols), "maxclust")[co]
        for b in np.where(np.diff(cl) != 0)[0]:
            hm.axvline(b + 0.5, color=bg, lw=3)
    # dendrograms
    if Zr is not None:
        dax = ax.inset_axes([0.01, bottom, dl - 0.005, top - bottom])
        sch.dendrogram(Zr, orientation="left", ax=dax, color_threshold=0, above_threshold_color="#444",
                       no_labels=True)
        dax.invert_yaxis()
        dax.axis("off")
    if Zc is not None:
        dax = ax.inset_axes([left, top + ac_h + 0.005, right - left, dt - 0.01])
        sch.dendrogram(Zc, ax=dax, color_threshold=0, above_threshold_color="#444", no_labels=True)
        dax.axis("off")
    # annotation bars + legends
    legend_items = []

    def _anno(ann, names, order_idx, horizontal):
        if isinstance(ann, dict):
            ann = pd.DataFrame({"group": pd.Series(ann)})
        ann = ann.copy()
        ann.index = ann.index.astype(str)
        out = []
        for k, colname in enumerate(ann.columns):
            vals = ann[colname].reindex([names[i] for i in order_idx]).astype(str).tolist()
            lv = [v for v in pd.unique(ann[colname].astype(str))]
            user = (annotation_colors or {}).get(colname) if isinstance(annotation_colors, dict) else None
            pal = _palette(lv, ["#E69F00", "#000000", "#56B4E9", "#009E73", "#CC79A7", "#D55E00"] if k == 0
                           else PALETTES["npg"], user)
            out.append((colname, vals, pal))
        return out

    if has_ac:
        for colname, vals, pal in _anno(annotation_col, cols, co, True):
            aax = ax.inset_axes([left, top + 0.004, right - left, ac_h - 0.008])
            aax.imshow([[to_rgba(pal[v]) for v in vals]], aspect="auto")
            aax.set_xticks([])
            aax.set_yticks([0], [colname], fontsize=rfs)
            aax.yaxis.tick_right()
            aax.tick_params(length=0, which="both")
            aax.minorticks_off()
            for s in aax.spines.values():
                s.set_visible(False)
            legend_items.append((colname, pal))
            break  # một hàng annotation (đủ cho đa số trường hợp)
    if has_ar:
        for colname, vals, pal in _anno(annotation_row, rows, ro, False):
            aax = ax.inset_axes([0.01 + dl, bottom, ar_w - 0.006, top - bottom])
            aax.imshow([[to_rgba(pal[v])] for v in vals], aspect="auto")
            aax.set_yticks([])
            aax.set_xticks([0], [colname], fontsize=cfs, rotation=90)
            aax.tick_params(length=0, which="both")
            aax.minorticks_off()
            for s in aax.spines.values():
                s.set_visible(False)
            legend_items.append((colname, pal))
            break
    # colorbar
    cax = ax.inset_axes([0.86, top - 0.30 if top > 0.45 else bottom, 0.025, min(0.28, top - bottom)])
    cb = fig.colorbar(im, cax=cax)
    cb.outline.set_visible(False)
    cb.ax.minorticks_off()
    cb.ax.tick_params(labelsize=plt.rcParams["font.size"] - 2, length=2)
    cb.set_label(cbar_label or ("z-score" if scale != "none" else ""), fontsize=plt.rcParams["font.size"] - 2)
    y0 = top - 0.36
    for name, pal in legend_items:
        handles = [Patch(color=c, label=l) for l, c in pal.items()]
        ax.legend(handles=handles, title=name, loc="upper left", bbox_to_anchor=(0.84, y0),
                  fontsize=plt.rcParams["font.size"] - 2, title_fontsize=plt.rcParams["font.size"] - 2,
                  frameon=False, handlelength=1, handleheight=1)
    if kw.get("title"):
        ax.text(0.5 * (left + right), 0.995, kw["title"], ha="center", va="top", transform=ax.transAxes,
                fontsize=plt.rcParams["axes.titlesize"], fontweight="bold")
    return fig, ax


# --------------------------------------------------------------------------------------
# 9. Vật liệu & điện hoá: XRD/Raman/FTIR/XPS/UV-Vis, LSV, Tafel, CV, Cdl, Nyquist, BET, Tauc
# --------------------------------------------------------------------------------------
REF_ELECTRODES = {  # thế điện cực so sánh so với SHE (V, 25 °C)
    "RHE": None, "SHE": 0.0, "NHE": 0.0,
    "Ag/AgCl": 0.197, "Ag/AgCl(sat)": 0.197, "Ag/AgCl(3M)": 0.210, "Ag/AgCl(3.5M)": 0.205,
    "SCE": 0.241, "Hg/HgO": 0.098, "Hg/HgO(1M)": 0.098, "Hg/HgO(0.1M)": 0.165, "Hg/Hg2SO4": 0.640,
}
REF_COLORS = ["#444444", "#B22222", "#1F5FA8", "#2E8B57"]
SPECTRA_PRESETS = {
    "xrd": dict(xlabel=r"2$\theta$ (degree)", ylabel="Intensity (a.u.)", invert_x=False),
    "raman": dict(xlabel=r"Raman shift (cm$^{-1}$)", ylabel="Intensity (a.u.)", invert_x=False),
    "ftir": dict(xlabel=r"Wavenumber (cm$^{-1}$)", ylabel="Transmittance (a.u.)", invert_x=True),
    "xps": dict(xlabel="Binding energy (eV)", ylabel="Intensity (a.u.)", invert_x=True),
    "uvvis": dict(xlabel="Wavelength (nm)", ylabel="Absorbance (a.u.)", invert_x=False),
    "pl": dict(xlabel="Wavelength (nm)", ylabel="PL intensity (a.u.)", invert_x=False),
}


def pairs_to_long(df, xname="x", yname="y", sample="sample"):
    """Bảng dạng cặp cột (x1, y1, x2, y2, …) – kiểu xuất từ Origin/Excel – → dạng dài.
    Tên mẫu lấy theo tiêu đề cột y."""
    out = []
    cols = list(df.columns)
    for i in range(0, len(cols) - 1, 2):
        sub = pd.DataFrame({xname: pd.to_numeric(df[cols[i]], errors="coerce"),
                            yname: pd.to_numeric(df[cols[i + 1]], errors="coerce")}).dropna()
        sub[sample] = str(cols[i + 1])
        out.append(sub)
    return pd.concat(out, ignore_index=True)


def _series(df, x=None, y=None, sample=None, pairs=False, order=None, sort=True):
    """Trả về [(tên, x_array, y_array)] cho 3 kiểu bảng:
    • dạng dài: cột x, cột y, cột sample
    • dạng rộng chung x: x + nhiều cột y (y='A,B,C' hoặc y=None → mọi cột số còn lại)
    • dạng cặp (pairs=True): x1,y1,x2,y2,…"""
    if pairs:
        d = pairs_to_long(df)
        x, y, sample = "x", "y", "sample"
    else:
        d = df
    x = x or d.columns[0]
    out = []
    if sample:
        names = [str(v) for v in pd.unique(d[sample].dropna())]
        if order:
            order = [o.strip() for o in order.split(",")] if isinstance(order, str) else [str(o) for o in order]
            names = [n for n in order if n in names]
        for n in names:
            sub = d[d[sample].astype(str) == n]
            out.append((n, pd.to_numeric(sub[x], errors="coerce").to_numpy(float),
                        pd.to_numeric(sub[y], errors="coerce").to_numpy(float)))
    else:
        ys = ([c.strip() for c in y.split(",")] if isinstance(y, str) else list(y)) if y is not None else \
            [c for c in d.select_dtypes("number").columns if c != x]
        if order:
            order = [o.strip() for o in order.split(",")] if isinstance(order, str) else list(order)
            ys = [c for c in order if c in ys]
        for c in ys:
            out.append((str(c), pd.to_numeric(d[x], errors="coerce").to_numpy(float),
                        pd.to_numeric(d[c], errors="coerce").to_numpy(float)))
    res = []
    for n, xv, yv in out:
        m = np.isfinite(xv) & np.isfinite(yv)
        xv, yv = xv[m], yv[m]
        if sort:
            o = np.argsort(xv, kind="stable")
            xv, yv = xv[o], yv[o]
        res.append((n, xv, yv))
    return res


def _series_colors(names, palette, colors):
    if palette in (None, "auto"):
        palette = "okabe" if len(names) <= 8 else "viridis"
    return _palette(names, palette, colors)


def _smooth(y, window):
    window = int(window or 0)
    if window < 3 or len(y) <= window:
        return y
    from scipy.signal import savgol_filter
    window += (window + 1) % 2
    return savgol_filter(y, window, 2)


def _as_mapping(v):
    """'28.5:(111),33.1:(200)' → {28.5:'(111)', 33.1:'(200)'} ; dict giữ nguyên."""
    if v is None:
        return {}
    if isinstance(v, dict):
        try:
            return {float(k): str(val) for k, val in v.items()}
        except ValueError:
            return {float(val): str(k) for k, val in v.items()}
    out = {}
    for item in str(v).split(","):
        if ":" in item:
            a, b = item.split(":", 1)
            out[float(a)] = b.strip()
    return out


def spectra(df, x=None, y=None, sample=None, pairs=False, kind="xrd", normalize=True, offset=None,
            smooth=0, labels="right", first_on_top=False, refs=None, ref_x="x", ref_y="intensity",
            ref_name=None, hkl=None, hkl_on=-1, phases=None, phase_on=None, invert_x=None, ax=None,
            palette="auto", colors=None, lw=1.2, order=None, figsize=(4.5, 5), fill=False, **kw):
    """Phổ xếp chồng (stacked): XRD, Raman, FTIR, XPS, UV-Vis, PL.
    kind: xrd | raman | ftir | xps | uvvis | pl  (đặt sẵn nhãn trục, FTIR/XPS tự đảo trục x)
    normalize: chuẩn hoá mỗi phổ về [0, 1] ; offset: khoảng cách giữa các phổ ; smooth: cửa sổ Savitzky–Golay
    labels: 'right' (ghi tên ở đầu phải mỗi phổ) | 'legend' | None
    refs: thẻ chuẩn JCPDS/ICDD dạng vạch – DataFrame/CSV cột x, intensity (+ cột name nếu nhiều thẻ)
    hkl: chỉ số mặt mạng, vd '28.5:(111),33.1:(200)' – ghi trên phổ thứ hkl_on (mặc định phổ trên cùng)
    phases: ký hiệu pha, vd {"CuO": [35.5, 38.7], "CeO2": [28.5, 47.5]} – vẽ ký hiệu trên các đỉnh tương ứng."""
    pre = SPECTRA_PRESETS.get(kind, SPECTRA_PRESETS["xrd"])
    invert_x = pre["invert_x"] if invert_x is None else invert_x
    ser = _series(df, x, y, sample, pairs, order)
    xlim = kw.get("xlim")
    if xlim is not None:
        lo, hi = _pair(xlim)
        ser = [(n, xv[(xv >= lo) & (xv <= hi)], yv[(xv >= lo) & (xv <= hi)]) for n, xv, yv in ser]
    proc = []
    for n, xv, yv in ser:
        yv = _smooth(yv, smooth)
        if normalize:
            rng_ = np.nanmax(yv) - np.nanmin(yv)
            yv = (yv - np.nanmin(yv)) / (rng_ if rng_ else 1)
        proc.append((n, xv, yv))
    if first_on_top:
        proc = proc[::-1]
    span_y = max(np.nanmax(p[2]) - np.nanmin(p[2]) for p in proc) if proc else 1
    off = float(offset) if offset is not None else (1.05 if normalize else 1.1 * span_y)
    cmap_ = _series_colors([p[0] for p in proc], palette, colors)
    fig, ax = _new_ax(ax, figsize)
    xmin = min(p[1].min() for p in proc)
    xmax = max(p[1].max() for p in proc)
    xspan = xmax - xmin
    traces = {}
    for i, (n, xv, yv) in enumerate(proc):
        base = i * off - (np.nanmin(yv) if not normalize else 0)
        c = cmap_[n]
        ax.plot(xv, yv + base, color=c, lw=lw, label=n, zorder=3)
        if fill:
            ax.fill_between(xv, base + np.nanmin(yv), yv + base, color=c, alpha=0.15, lw=0)
        traces[n] = (xv, yv + base, c)
        if labels == "right":
            xr = xmin if invert_x else xmax
            xr_in = xr + (0.02 * xspan if invert_x else -0.02 * xspan)
            yr = np.interp(xr_in, xv, yv + base)
            ax.text(xr_in, yr + 0.12 * off, n, color=c, ha="right", va="bottom")
    names = [p[0] for p in proc]
    # ký hiệu pha
    if phases:
        if isinstance(phases, str):
            phases = json.loads(phases)
        syms = ["v", "*", "o", "s", "D", "^", "P", "X"]
        handles = []
        for k, (ph, pos_) in enumerate(phases.items()):
            m_ = syms[k % len(syms)]
            if isinstance(pos_, dict):
                m_ = pos_.get("marker", m_)
                pos_ = pos_["x"]
            targets = phase_on or names
            if isinstance(targets, str):
                targets = [t.strip() for t in targets.split(",")]
            for n in targets:
                if n not in traces:
                    continue
                xv, yv, c = traces[n]
                for p0 in pos_:
                    w = (np.abs(xv - p0) <= 0.006 * xspan + 0.15)
                    if w.any():
                        ymax_ = yv[w].max()
                        xpk = xv[w][yv[w].argmax()]
                        ax.scatter([xpk], [ymax_ + 0.07 * off], marker=m_, s=28, color="#333", zorder=5)
            handles.append(Line2D([], [], marker=m_, ls="", color="#333", label=ph, markersize=6))
        ax._sciplot_phase_handles = handles
    # chỉ số hkl
    hk = _as_mapping(hkl)
    if hk:
        n = names[hkl_on] if isinstance(hkl_on, int) else hkl_on
        xv, yv, c = traces[n]
        for p0, txt in hk.items():
            w = np.abs(xv - p0) <= 0.006 * xspan + 0.15
            yy = yv[w].max() if w.any() else np.interp(p0, xv, yv)
            ax.text(p0, yy + 0.06 * off, txt, ha="center", va="bottom", fontsize=plt.rcParams["font.size"] - 2,
                    rotation=90 if len(hk) > 6 else 0)
    # vạch chuẩn
    if refs is not None:
        R = load_table(refs) if isinstance(refs, (str, Path)) else refs
        groups_ = [(ref_name or "Ref.", R)] if "name" not in R.columns else list(R.groupby("name", sort=False))
        for k, (rn, rsub) in enumerate(groups_):
            rx = pd.to_numeric(rsub[ref_x], errors="coerce").to_numpy()
            ry = pd.to_numeric(rsub[ref_y], errors="coerce").to_numpy() if ref_y in rsub else np.ones(len(rx))
            ry = ry / np.nanmax(ry)
            base0 = -0.45 * off - k * 0.45 * off  # đường nền của thẻ chuẩn
            ax.vlines(rx, base0, base0 + 0.36 * off * ry, color=REF_COLORS[k % len(REF_COLORS)], lw=1.4)
            ax.axhline(base0, color="#444", lw=0.6)
            xl_ = xmax if invert_x else xmin
            ax.text(xl_ + (-0.01 * xspan if invert_x else 0.01 * xspan), base0 + 0.04 * off, str(rn),
                    ha="left", va="bottom", fontsize=plt.rcParams["font.size"] - 2,
                    color=REF_COLORS[k % len(REF_COLORS)])
    if invert_x:
        ax.set_xlim(xmax, xmin)
    else:
        ax.set_xlim(xmin, xmax)
    ax.set_yticks([])
    _no_minor(ax, "y")
    handles = getattr(ax, "_sciplot_phase_handles", None)
    if labels == "legend":
        h, l = ax.get_legend_handles_labels()
        handles = (h[::-1] + (handles or []))
    kw.pop("xlim", None)
    _finish(ax, kw.get("title"), kw.get("xlabel", pre["xlabel"]), kw.get("ylabel", pre["ylabel"]),
            None, kw.get("ylim"), legend=kw.get("legend", "upper left") if handles else None,
            legend_title=kw.get("legend_title"), handles=handles)
    return fig, ax


def xrd(df, **kw):
    """XRD xếp chồng (2θ). Xem spectra()."""
    kw.setdefault("kind", "xrd")
    return spectra(df, **kw)


# ---------- điện hoá ----------
_CUR_FACTOR = {"A": 1e3, "mA": 1.0, "uA": 1e-3, "µA": 1e-3, "nA": 1e-6}  # → mA


def _echem(df, E=None, j=None, sample=None, pairs=False, ref="RHE", pH=14.0, E_ref=None, R=0.0,
           area=None, current_unit="mA/cm2", order=None, sort=True):
    """Chuẩn hoá dữ liệu điện hoá → [(tên, E_RHE_đã_bù_iR, j mA cm-2)]."""
    ser = _series(df, E, j, sample, pairs, order, sort=sort)
    if E_ref is None:
        if ref not in REF_ELECTRODES:
            raise ValueError(f"Không biết điện cực so sánh '{ref}'. Dùng một trong {list(REF_ELECTRODES)} hoặc E_ref=…")
        E_ref = REF_ELECTRODES[ref]
    unit = current_unit.replace("cm-2", "/cm2").replace("cm²", "cm2")
    is_density = "/cm2" in unit
    base = unit.replace("/cm2", "")
    f = _CUR_FACTOR.get(base, 1.0)
    out = []
    for n, ev, iv in ser:
        i_mA = iv * f  # mA hoặc mA/cm2
        if is_density:
            jv = i_mA
            I_A = jv * (area or 1.0) / 1e3
        else:
            jv = i_mA / (area or 1.0)
            I_A = i_mA / 1e3
        Rn = R.get(n, 0.0) if isinstance(R, dict) else float(R or 0)
        e = ev - I_A * Rn
        if E_ref is not None:  # E(RHE) = E(ref) + E°(ref) + 0.0591·pH
            e = e + E_ref + 0.0591 * float(pH)
        out.append((n, e, jv))
    return out


def _cross(e, jv, target):
    """Thế tại đó j đạt target lần đầu (nội suy tuyến tính)."""
    sgn = np.sign(target)
    idx = np.where(sgn * jv >= abs(target))[0]
    if not len(idx) or idx[0] == 0:
        return np.nan
    k = idx[0]
    return float(np.interp(abs(target), [sgn * jv[k - 1], sgn * jv[k]], [e[k - 1], e[k]]))


def lsv(df, E=None, j=None, sample=None, pairs=False, ref="RHE", pH=14.0, E_ref=None, R=0.0, area=None,
        current_unit="mA/cm2", reaction="OER", j_mark=10, mark=True, E0=None, ax=None, palette="auto",
        colors=None, lw=1.6, order=None, figsize=(4.8, 4), eta_in_legend=True, **kw):
    """Đường LSV (phân cực) cho OER/HER/ORR…
    ref: điện cực so sánh khi đo (RHE, Ag/AgCl, Ag/AgCl(3M), SCE, Hg/HgO, …) – tự đổi sang RHE: E + E_ref + 0.0591·pH
    R: điện trở dung dịch (Ω) để bù iR (số chung hoặc dict theo mẫu) ; area: diện tích điện cực (cm²)
    current_unit: A | mA | uA | mA/cm2 | A/cm2 ; reaction: OER | HER | None ; j_mark: mật độ dòng để tính η (mA cm-2)."""
    ser = _echem(df, E, j, sample, pairs, ref, pH, E_ref, R, area, current_unit, order)
    cmap_ = _series_colors([s[0] for s in ser], palette, colors)
    fig, ax = _new_ax(ax, figsize)
    E0 = E0 if E0 is not None else (1.23 if reaction == "OER" else 0.0)
    results = {}
    for n, e, jv in ser:
        lab = n
        if reaction in ("OER", "HER") and j_mark:
            tgt = j_mark if reaction == "OER" else -abs(j_mark)
            Ex = _cross(e, jv, tgt) if reaction == "OER" else _cross(e[::-1], jv[::-1], tgt)
            eta = abs(Ex - E0) * 1000 if np.isfinite(Ex) else np.nan
            results[n] = {"E_at_j": Ex, "eta_mV": eta}
            if eta_in_legend and np.isfinite(eta):
                lab = f"{n} ({eta:.0f} mV)"
            if mark and np.isfinite(Ex):
                ax.plot([Ex], [tgt], "o", ms=4.5, color=cmap_[n], zorder=5)
        ax.plot(e, jv, color=cmap_[n], lw=lw, label=lab, zorder=3)
    if reaction in ("OER", "HER") and j_mark and mark:
        tgt = j_mark if reaction == "OER" else -abs(j_mark)
        ax.axhline(tgt, ls="--", lw=0.8, color="#777", zorder=1)
    ax._sciplot_results = results
    leg_title = kw.get("legend_title")
    if leg_title is None and reaction in ("OER", "HER") and eta_in_legend:
        leg_title = rf"$\eta_{{{int(j_mark)}}}$"
    _finish(ax, kw.get("title"), kw.get("xlabel", "E (V vs. RHE)" + (" (iR-corrected)" if R else "")),
            kw.get("ylabel", r"j (mA cm$^{-2}$)"), kw.get("xlim"), kw.get("ylim"),
            legend=kw.get("legend", "upper left" if reaction != "HER" else "lower right"),
            legend_title=leg_title)
    return fig, ax


def tafel(df, E=None, j=None, sample=None, pairs=False, ref="RHE", pH=14.0, E_ref=None, R=0.0, area=None,
          current_unit="mA/cm2", reaction="OER", E0=None, fit_range=(1, 10), eta_range=None, precomputed=False,
          ax=None, palette="auto", colors=None, order=None, figsize=(4.5, 4), show_data=True,
          slope_labels="legend", **kw):
    """Tafel: η (V) theo log|j|, tự fit đoạn tuyến tính và báo độ dốc (mV dec⁻¹).
    Mặc định tính từ dữ liệu LSV (cùng tham số với lsv()). fit_range: khoảng |j| (mA cm-2) để fit;
    hoặc eta_range (V). precomputed=True: bảng đã có sẵn cột log|j| (E=) và η (j=).
    slope_labels: 'legend' | 'text' (ghi cạnh đường fit)."""
    fig, ax = _new_ax(ax, figsize)
    E0 = E0 if E0 is not None else (1.23 if reaction == "OER" else 0.0)
    if precomputed:
        ser = [(n, xv, yv) for n, xv, yv in _series(df, E, j, sample, pairs, order)]
        data = [(n, xv, yv) for n, xv, yv in ser]  # x = log j, y = η
    else:
        ser = _echem(df, E, j, sample, pairs, ref, pH, E_ref, R, area, current_unit, order)
        data = []
        for n, e, jv in ser:
            m = np.abs(jv) > 0
            eta = np.abs(e[m] - E0)
            data.append((n, np.log10(np.abs(jv[m])), eta))
    cmap_ = _series_colors([d[0] for d in data], palette, colors)
    results = {}
    for n, lx, eta in data:
        c = cmap_[n]
        if eta_range is not None:
            a, b = _pair(eta_range)
            w = (eta >= a) & (eta <= b)
        else:
            a, b = _pair(fit_range)
            w = (lx >= np.log10(a)) & (lx <= np.log10(b))
        lab = n
        if w.sum() >= 3:
            k, b0 = np.polyfit(lx[w], eta[w], 1)
            r2 = np.corrcoef(lx[w], eta[w])[0, 1] ** 2
            results[n] = {"slope_mV_dec": k * 1000, "intercept_V": b0, "R2": r2}
            xs = np.linspace(lx[w].min() - 0.15, lx[w].max() + 0.15, 50)
            ax.plot(xs, k * xs + b0, ls="--", color=c, lw=1.2, zorder=4)
            if slope_labels == "legend":
                lab = f"{n} ({k * 1000:.0f} mV dec$^{{-1}}$)"
            else:
                ax.text(xs[-1] + 0.03, k * xs[-1] + b0, f"{k * 1000:.0f} mV dec$^{{-1}}$", color=c,
                        va="center", ha="left", fontsize=plt.rcParams["font.size"] - 1)
        show = w if not show_data else np.ones_like(w, bool)
        if show_data == "fit":
            show = w
        if precomputed or eta_range is not None:
            sel = show
        else:
            lo_, hi_ = (np.log10(max(v_, 1e-9)) for v_ in _pair(fit_range))
            sel = show & (lx >= lo_ - kw.get("pad_dec", 0.6)) & (lx <= hi_ + kw.get("pad_dec", 0.6))
        o = np.argsort(lx[sel])
        ax.plot(lx[sel][o], eta[sel][o], color=c, lw=1.6, label=lab, zorder=3)
    ax._sciplot_results = results
    _finish(ax, kw.get("title"), kw.get("xlabel", r"log |j| (mA cm$^{-2}$)"),
            kw.get("ylabel", r"Overpotential $\eta$ (V)"), kw.get("xlim"), kw.get("ylim"),
            legend=kw.get("legend", "upper left"), legend_title=kw.get("legend_title"))
    return fig, ax


def cv(df, E=None, j=None, sample=None, pairs=False, ref="RHE", pH=14.0, E_ref=None, R=0.0, area=None,
       current_unit="mA/cm2", ax=None, palette="auto", colors=None, lw=1.3, order=None, figsize=(4.8, 4),
       convert=True, **kw):
    """Cyclic voltammetry – nhiều đường (vd theo tốc độ quét). convert=False để giữ thang thế gốc."""
    if convert:
        ser = _echem(df, E, j, sample, pairs, ref, pH, E_ref, R, area, current_unit, order, sort=False)
        xlabel = "E (V vs. RHE)"
    else:
        ser = _series(df, E, j, sample, pairs, order, sort=False)
        xlabel = f"E (V vs. {ref})"
    cmap_ = _series_colors([s[0] for s in ser], palette, colors)
    fig, ax = _new_ax(ax, figsize)
    for n, e, jv in ser:
        ax.plot(e, jv, color=cmap_[n], lw=lw, label=n)
    if kw.get("ylim") is None:
        lo_, hi_ = ax.get_ylim()
        ax.set_ylim(lo_, hi_ + 0.45 * (hi_ - lo_))
    _finish(ax, kw.get("title"), kw.get("xlabel", xlabel), kw.get("ylabel", r"j (mA cm$^{-2}$)"),
            kw.get("xlim"), kw.get("ylim"), legend=kw.get("legend", "upper left"),
            legend_title=kw.get("legend_title"))
    if kw.get("legend", "upper left") == "upper left" and ax.get_legend():
        ax.get_legend().remove()
        ax.legend(loc="upper left", ncol=min(3, len(ser)), title=kw.get("legend_title"),
                  columnspacing=1.0, handlelength=1.5)
    return fig, ax


def cdl(df, x="scan_rate", y=None, ja=None, jc=None, sample=None, ax=None, palette="okabe", colors=None,
        order=None, figsize=(4.5, 4), half=True, **kw):
    """Điện dung lớp kép Cdl: Δj/2 theo tốc độ quét → độ dốc = Cdl.
    Dùng y = cột Δj có sẵn, hoặc ja & jc (dòng anot/catot tại một thế cố định).
    Đơn vị: j (mA cm-2), tốc độ quét (mV s-1) → Cdl (mF cm-2) = độ dốc × 1000."""
    d = df.copy()
    if y is None:
        d["_dj"] = (pd.to_numeric(d[ja], errors="coerce") - pd.to_numeric(d[jc], errors="coerce")).abs()
        y = "_dj"
    if half:
        d["_djh"] = pd.to_numeric(d[y], errors="coerce") / (2 if y == "_dj" or half == "always" else 1)
    else:
        d["_djh"] = pd.to_numeric(d[y], errors="coerce")
    ser = _series(d, x, "_djh", sample, False, order)
    cmap_ = _series_colors([s[0] for s in ser], palette, colors)
    fig, ax = _new_ax(ax, figsize)
    res = {}
    for i, (n, xv, yv) in enumerate(ser):
        c = cmap_[n]
        k, b = np.polyfit(xv, yv, 1)
        res[n] = k * 1000
        xs = np.linspace(0, xv.max() * 1.05, 50)
        ax.plot(xs, k * xs + b, color=c, lw=1.3, zorder=2)
        ax.scatter(xv, yv, color=c, marker=MARKERS[i % len(MARKERS)], s=36, zorder=3,
                   label=f"{n} ({k * 1000:.2f} mF cm$^{{-2}}$)")
    ax._sciplot_results = res
    ax.set_xlim(left=0)
    _finish(ax, kw.get("title"), kw.get("xlabel", r"Scan rate (mV s$^{-1}$)"),
            kw.get("ylabel", r"$\Delta j$/2 (mA cm$^{-2}$)" if (y == "_dj" or half) else r"$\Delta j$ (mA cm$^{-2}$)"),
            kw.get("xlim"), kw.get("ylim"), legend=kw.get("legend", "upper left"),
            legend_title=kw.get("legend_title", r"C$_{dl}$"))
    return fig, ax


def nyquist(df, zre=None, zim=None, sample=None, pairs=False, ax=None, palette="auto", colors=None,
            order=None, figsize=(4.5, 4.2), equal=True, markers=True, lines=False, unit="Ω", **kw):
    """Đồ thị Nyquist (EIS): Z' theo −Z''. Tự đổi dấu nếu cột Z'' đang âm."""
    ser = _series(df, zre, zim, sample, pairs, order, sort=False)
    cmap_ = _series_colors([s[0] for s in ser], palette, colors)
    fig, ax = _new_ax(ax, figsize)
    for i, (n, a, b) in enumerate(ser):
        if np.nanmedian(b) < 0:
            b = -b
        c = cmap_[n]
        if markers:
            ax.scatter(a, b, s=18, color=c, marker=MARKERS[i % len(MARKERS)], label=n, zorder=3)
        if lines or not markers:
            ax.plot(a, b, color=c, lw=1.2, label=None if markers else n, zorder=2)
    if equal and kw.get("xlim") is None and kw.get("ylim") is None:
        allx = np.concatenate([s_[1] for s_ in ser])
        ally = np.concatenate([np.abs(s_[2]) for s_ in ser])
        m_ = max(np.nanmax(allx), np.nanmax(ally)) * 1.08
        ax.set_xlim(0, m_)
        ax.set_ylim(0, m_)
        ax.set_aspect("equal", adjustable="box")
    else:
        ax.set_xlim(left=min(0, ax.get_xlim()[0]))
        ax.set_ylim(bottom=0)
    _finish(ax, kw.get("title"), kw.get("xlabel", f"Z' ({unit})"), kw.get("ylabel", f"−Z'' ({unit})"),
            kw.get("xlim"), kw.get("ylim"), legend=kw.get("legend", "upper left"),
            legend_title=kw.get("legend_title"))
    return fig, ax


def _bet_area(p, v, lo=0.05, hi=0.30, sigma=0.162):
    """Diện tích BET (m² g⁻¹) từ nhánh hấp phụ N2 (V: cm³ g⁻¹ STP)."""
    w = (p >= lo) & (p <= hi) & (v > 0)
    if w.sum() < 3:
        return np.nan, np.nan
    yv = 1.0 / (v[w] * (1.0 / p[w] - 1.0))
    s, i = np.polyfit(p[w], yv, 1)
    vm = 1.0 / (s + i)
    C = s / i + 1
    area = vm * 6.022e23 * sigma * 1e-18 / 22414.0
    return area, C


def bet(df, p=None, v=None, sample=None, branch=None, pairs=False, calc=True, bet_range=(0.05, 0.30),
        psd_x=None, psd_y=None, inset="upper left", ax=None, palette="okabe", colors=None, order=None,
        figsize=(4.8, 4.2), offset=0.0, **kw):
    """Đẳng nhiệt hấp phụ–giải hấp N2 (BET).
    p: cột P/P0 ; v: lượng hấp phụ (cm³ g⁻¹ STP) ; branch: cột 'ads'/'des' (nếu không có, tự tách tại P/P0 cực đại)
    calc=True: tính S_BET trong khoảng bet_range, ghi vào chú giải.
    psd_x, psd_y: cột phân bố kích thước lỗ (vd BJH: đường kính nm, dV/dlogD) → vẽ hình nhỏ (inset)."""
    d = df.copy()
    if pairs:
        d = pairs_to_long(d, "P/P0", "V")
        p, v, sample = "P/P0", "V", "sample"
    p = p or d.columns[0]
    v = v or d.columns[1]
    names = [str(s) for s in pd.unique(d[sample].dropna())] if sample else ["sample"]
    if order and sample:
        order = [o.strip() for o in order.split(",")] if isinstance(order, str) else list(order)
        names = [n for n in order if n in names]
    cmap_ = _palette(names, palette, colors)
    fig, ax = _new_ax(ax, figsize)
    res = {}
    for i, n in enumerate(names):
        sub = d if not sample else d[d[sample].astype(str) == n]
        pp = pd.to_numeric(sub[p], errors="coerce").to_numpy()
        vv = pd.to_numeric(sub[v], errors="coerce").to_numpy()
        ok = np.isfinite(pp) & np.isfinite(vv)
        if branch and branch in sub:
            br = sub[branch].astype(str).str.lower().to_numpy()[ok]
            pp, vv = pp[ok], vv[ok]
            ads = np.array([b.startswith("a") for b in br])
        else:
            pp, vv = pp[ok], vv[ok]
            kmax = int(np.argmax(pp)) if len(pp) else 0
            ads = np.zeros(len(pp), bool)
            ads[:kmax + 1] = True
        vv = vv + i * float(offset)
        c = cmap_[n]
        m_ = MARKERS[i % len(MARKERS)]
        lab = n
        if calc:
            o = np.argsort(pp[ads])
            area, C = _bet_area(pp[ads][o], (vv - i * float(offset))[ads][o], *_pair(bet_range))
            res[n] = {"S_BET_m2_g": area, "C": C}
            if np.isfinite(area):
                lab = f"{n} ({area:.0f} m$^2$ g$^{{-1}}$)"
        ax.plot(pp[ads], vv[ads], color=c, lw=1.2, marker=m_, ms=4.5, label=lab, zorder=3)
        ax.plot(pp[~ads], vv[~ads], color=c, lw=1.2, marker=m_, ms=4.5, mfc="white", zorder=3)
    ax.set_xlim(0, 1.0)
    ax.set_ylim(bottom=0)
    ax._sciplot_results = res
    leg_handles = None
    h, l = ax.get_legend_handles_labels()
    if h:
        leg_handles = h + [Line2D([], [], marker="o", color="#555", ls="", label="Adsorption"),
                           Line2D([], [], marker="o", color="#555", mfc="white", ls="", label="Desorption")]
    if psd_x and psd_y and kw.get("ylim") is None:
        ax.set_ylim(0, ax.get_ylim()[1] * 1.75)
    if psd_x and psd_y:
        pos = {"upper left": [0.14, 0.58, 0.32, 0.34], "center left": [0.12, 0.32, 0.38, 0.38],
               "lower right": [0.57, 0.12, 0.38, 0.38]}.get(inset, [0.14, 0.58, 0.32, 0.34])
        iax = ax.inset_axes(pos)
        for n in names:
            sub = d if not sample else d[d[sample].astype(str) == n]
            px = pd.to_numeric(sub[psd_x], errors="coerce").to_numpy()
            py = pd.to_numeric(sub[psd_y], errors="coerce").to_numpy()
            ok = np.isfinite(px) & np.isfinite(py)
            o = np.argsort(px[ok])
            iax.plot(px[ok][o], py[ok][o], color=cmap_[n], lw=1.2)
        if kw.get("psd_log", True):
            iax.set_xscale("log")
        fs = plt.rcParams["font.size"] - 3
        iax.set_xlabel(kw.get("psd_xlabel", "Pore diameter (nm)"), fontsize=fs)
        iax.set_ylabel(kw.get("psd_ylabel", "dV/dlogD"), fontsize=fs)
        iax.tick_params(labelsize=fs - 1)
        iax.set_ylim(bottom=0)
        if not kw.get("legend"):
            kw["legend"] = "upper right" if inset == "upper left" else "upper left"
    _finish(ax, kw.get("title"), kw.get("xlabel", r"Relative pressure (P/P$_0$)"),
            kw.get("ylabel", r"Quantity adsorbed (cm$^3$ g$^{-1}$ STP)"), kw.get("xlim"), kw.get("ylim"),
            legend=kw.get("legend", "upper left"), legend_title=kw.get("legend_title"), handles=leg_handles)
    return fig, ax


def tauc(df, wl=None, A=None, sample=None, pairs=False, transition="direct", fit_range=None, ax=None,
         palette="auto", colors=None, order=None, figsize=(4.5, 4), energy_input=False, normalize=True,
         xlim=None, **kw):
    """Đồ thị Tauc để xác định năng lượng vùng cấm Eg từ phổ UV-Vis.
    wl: bước sóng (nm) (energy_input=True nếu cột đã là eV) ; A: độ hấp thụ (hoặc F(R) Kubelka–Munk)
    transition: 'direct' → (αhν)² ; 'indirect' → (αhν)^½
    fit_range: khoảng eV để fit đoạn tuyến tính (vd '2.9,3.2'); bỏ trống → tự tìm đoạn dốc nhất."""
    ser = _series(df, wl, A, sample, pairs, order)
    pw = 2.0 if transition == "direct" else 0.5
    cmap_ = _series_colors([s[0] for s in ser], palette, colors)
    fig, ax = _new_ax(ax, figsize)
    res = {}
    for n, xv, av in ser:
        hv = xv if energy_input else 1239.84 / xv
        yv = np.clip(av * hv, 0, None) ** pw
        o = np.argsort(hv)
        hv, yv = hv[o], yv[o]
        if normalize:
            yv = yv / np.nanmax(yv)
        c = cmap_[n]
        if fit_range is not None:
            a, b = _pair(fit_range)
            w = (hv >= a) & (hv <= b)
        else:
            ys = _smooth(yv, max(5, len(yv) // 40))
            dy = np.gradient(ys, hv)
            cand = np.where((ys > 0.1 * ys.max()) & (ys < 0.85 * ys.max()))[0]
            k0 = cand[np.argmax(dy[cand])] if len(cand) else int(np.argmax(dy))
            half = max(3, len(hv) // 30)
            w = np.zeros(len(hv), bool)
            w[max(0, k0 - half):k0 + half + 1] = True
        lab = n
        if w.sum() >= 3:
            k, b0 = np.polyfit(hv[w], yv[w], 1)
            Eg = -b0 / k
            res[n] = {"Eg_eV": Eg}
            xs = np.linspace(Eg, hv[w].max() + 0.1 * (hv[w].max() - Eg + 0.05), 20)
            ax.plot(xs, k * xs + b0, ls="--", color=c, lw=1.1, zorder=4)
            lab = f"{n} ({Eg:.2f} eV)"
        ax.plot(hv, yv, color=c, lw=1.5, label=lab, zorder=3)
    ax.set_ylim(bottom=0)
    if xlim is not None:
        ax.set_xlim(*_pair(xlim))
    ax._sciplot_results = res
    ylab = r"$(\alpha h\nu)^{2}$ (a.u.)" if pw == 2 else r"$(\alpha h\nu)^{1/2}$ (a.u.)"
    _finish(ax, kw.get("title"), kw.get("xlabel", r"h$\nu$ (eV)"), kw.get("ylabel", ylab), None,
            kw.get("ylim"), legend=kw.get("legend", "upper left"), legend_title=kw.get("legend_title", r"E$_g$"))
    return fig, ax


def results(ax):
    """Lấy kết quả tính toán của hình (η10, độ dốc Tafel, S_BET, Eg, Cdl …) dưới dạng DataFrame."""
    r = getattr(ax, "_sciplot_results", {})
    return pd.DataFrame(r).T if r and isinstance(next(iter(r.values())), dict) else pd.Series(r, dtype=float)


def _noted(f):
    """Thêm tham số note='@ 90 °C' (chữ ở góc trên-trái trong khung) cho mọi hàm vẽ."""
    import functools

    @functools.wraps(f)
    def g(*a, **kw):
        out = f(*a, **kw)
        axo = out[1] if isinstance(out, tuple) and len(out) > 1 else None
        if axo is not None and hasattr(axo, "xaxis"):  # bước tick chính: xstep / ystep (minor = 1/2 bước)
            from matplotlib.ticker import MultipleLocator
            for key_, axis_ in (("xstep", axo.xaxis), ("ystep", axo.yaxis)):
                if kw.get(key_):
                    axis_.set_major_locator(MultipleLocator(float(kw[key_])))
                    if plt.rcParams["xtick.minor.visible"]:
                        axis_.set_minor_locator(MultipleLocator(float(kw[key_]) / 2))
        note = kw.get("note")
        if note is not None and isinstance(out, tuple) and hasattr(out[1], "text"):
            out[1].text(0.04, 0.95, str(note), transform=out[1].transAxes, ha="left", va="top", zorder=10)
        return out
    return g


scatter, line, pca, volcano, bar, histogram, box = (_noted(f) for f in (scatter, line, pca, volcano, bar, histogram, box))
spectra, xrd, lsv, tafel, cv, cdl, nyquist, bet, tauc = (_noted(f) for f in (spectra, xrd, lsv, tafel, cv, cdl,
                                                                              nyquist, bet, tauc))


# --------------------------------------------------------------------------------------
# 8. Multi-panel  (Lesson 6, patchwork/cowplot)
# --------------------------------------------------------------------------------------
PLOTTERS = {"scatter": scatter, "line": line, "pca": pca, "volcano": volcano, "bar": bar,
            "histogram": histogram, "hist": histogram, "box": box, "violin": box, "heatmap": heatmap,
            "spectra": spectra, "xrd": xrd, "lsv": lsv, "tafel": tafel, "cv": cv, "cdl": cdl,
            "nyquist": nyquist, "eis": nyquist, "bet": bet, "tauc": tauc}
for _k in ("raman", "ftir", "xps", "uvvis", "pl"):
    PLOTTERS[_k] = (lambda k: lambda df, **kw: spectra(df, **{"kind": k, **kw}))(_k)


def panel(spec: dict | str, base_dir: str | Path | None = None):
    """Ghép nhiều hình thành một figure. spec (dict hoặc file JSON):
    {
      "layout": [["A","B"],["C","C"]],      # lưới kiểu mosaic (patchwork); chữ trùng = gộp ô
      "figsize": [10, 8], "tags": "A",      # tags: 'A' | 'a' | '1' | null
      "theme": "origin", "font": "sans", "fontsize": 10, "title": "Figure 1",
      "widths": [1, 1], "heights": [1, 1.4],
      "panels": {"A": {"type": "pca", "data": "iris.csv", "group": "Species"}, ...}
    }"""
    if isinstance(spec, (str, Path)):
        base_dir = base_dir or Path(spec).parent
        spec = json.loads(Path(spec).read_text(encoding="utf-8"))
    base_dir = Path(base_dir or ".")
    set_theme(spec.get("theme", "origin"), spec.get("font", "sans"), spec.get("fontsize", 10))
    layout = spec["layout"]
    if isinstance(layout, str):
        layout = [list(r.strip()) for r in layout.strip().split("\n")]
    fig = plt.figure(figsize=spec.get("figsize", (10, 8)), layout="constrained")
    axd = fig.subplot_mosaic(layout, width_ratios=spec.get("widths"), height_ratios=spec.get("heights"),
                             empty_sentinel=".")
    tags = spec.get("tags", "(a)")
    keys = [k for row in layout for k in row if k != "."]
    keys = list(dict.fromkeys(keys))
    for i, key in enumerate(keys):
        p = dict(spec["panels"][key])
        kind = p.pop("type")
        data = p.pop("data", None)
        df = load_table(base_dir / data) if data else None
        for annk in ("annotation_col", "annotation_row"):
            if isinstance(p.get(annk), str):
                p[annk] = load_table(base_dir / p[annk]).set_index(load_table(base_dir / p[annk]).columns[0])
        if isinstance(p.get("refs"), str):
            p["refs"] = load_table(base_dir / p["refs"])
        if kind == "violin":
            p.setdefault("kind", "violin")
        PLOTTERS[kind](df, ax=axd[key], **p)
        if tags:
            tag = _tag(tags, i)
            axd[key].annotate(tag, xy=(0, 1), xycoords="axes fraction", xytext=(-38, 10),
                              textcoords="offset points", fontsize=plt.rcParams["font.size"] + 3,
                              fontweight="bold", ha="left", va="bottom", annotation_clip=False)
    if spec.get("title"):
        fig.suptitle(spec["title"], fontweight="bold")
    return fig, axd


def _tag(style, i):
    if style == "a":
        return chr(97 + i)
    if style == "1":
        return str(i + 1)
    if style in ("(a)",):
        return f"({chr(97 + i)})"
    return chr(65 + i)


# --------------------------------------------------------------------------------------
# I/O
# --------------------------------------------------------------------------------------
def load_table(path, sheet=0) -> pd.DataFrame:
    """Đọc CSV / TSV / TXT / XLSX. Tự đoán dấu phân cách."""
    path = Path(path)
    suf = path.suffix.lower()
    if suf in (".xlsx", ".xls", ".xlsm"):
        return pd.read_excel(path, sheet_name=sheet)
    if suf in (".tsv", ".tab"):
        return pd.read_csv(path, sep="\t")
    return pd.read_csv(path, sep=None, engine="python")


def save(fig, path, dpi=300, transparent=False):
    """Lưu hình: .png .pdf .svg .tif .jpg (định dạng theo đuôi file)."""
    path = Path(path)
    kw = dict(dpi=dpi, transparent=transparent, bbox_inches="tight")
    if path.suffix.lower() in (".tif", ".tiff"):
        kw["pil_kwargs"] = {"compression": "tiff_lzw"}
    fig.savefig(path, **kw)
    return path


# --------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------
def _coerce(v: str):
    lo = v.lower()
    if lo in ("true", "yes", "on"):
        return True
    if lo in ("false", "no", "off"):
        return False
    if lo in ("none", "null"):
        return None
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    if v.startswith(("{", "[")):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            pass
    return v


def main(argv=None):
    ap = argparse.ArgumentParser(
        prog="sciplot",
        description="Vẽ hình khoa học từ file CSV/TSV/XLSX. Mọi tham số của hàm đều truyền được bằng --ten-tham-so giá_trị.",
        epilog=("Ví dụ:\n"
                "  python sciplot.py scatter iris.csv --x Petal.Length --y Petal.Width --color Species --fit linear -o a.png\n"
                "  python sciplot.py pca iris.csv --group Species -o pca.pdf\n"
                "  python sciplot.py volcano de.csv --fc logFC --p FDR --label gene --top 8 -o volcano.png\n"
                "  python sciplot.py bar tooth.csv --x dose --y len --hue supp --error sd --points true -o bar.png\n"
                "  python sciplot.py box tooth.csv --x dose --y len --hue supp --stats_test t -o box.png\n"
                "  python sciplot.py heatmap expr.csv --index gene --scale row --cutree_rows 2 "
                "--annotation_col annot.csv -o hm.png\n"
                "  python sciplot.py panel panel.json -o figure1.pdf\n"),
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("kind", choices=sorted(PLOTTERS) + ["panel"], help="loại hình")
    ap.add_argument("data", help="file dữ liệu (hoặc file JSON với 'panel')")
    ap.add_argument("-o", "--out", default=None, help="file xuất (.png/.pdf/.svg/.tif); mặc định <loại>.png")
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--theme", default="origin", choices=THEMES)
    ap.add_argument("--font", default="sans", help="sans | serif | mono | tên font")
    ap.add_argument("--fontsize", type=float, default=11)
    ap.add_argument("--width", type=float, default=None, help="chiều rộng hình (inch)")
    ap.add_argument("--height", type=float, default=None, help="chiều cao hình (inch)")
    ap.add_argument("--sheet", default=0, help="tên/số sheet Excel")
    args, extra = ap.parse_known_args(argv)

    opts = {}
    i = 0
    while i < len(extra):
        tok = extra[i]
        if not tok.startswith("--"):
            ap.error(f"Không hiểu tham số: {tok}")
        key = tok[2:].replace("-", "_")
        if "=" in key:
            key, val = key.split("=", 1)
            opts[key] = _coerce(val)
            i += 1
        elif i + 1 < len(extra) and not extra[i + 1].startswith("--"):
            opts[key] = _coerce(extra[i + 1])
            i += 2
        else:
            opts[key] = True
            i += 1

    out = args.out or f"{args.kind}.png"
    if args.kind == "panel":
        fig, _ = panel(args.data)
    else:
        set_theme(args.theme, args.font, args.fontsize)
        df = load_table(args.data, sheet=_coerce(str(args.sheet)))
        for annk in ("annotation_col", "annotation_row"):
            if isinstance(opts.get(annk), str):
                a = load_table(opts[annk])
                opts[annk] = a.set_index(a.columns[0])
        if isinstance(opts.get("refs"), str):
            opts["refs"] = load_table(opts["refs"])
        if args.width and args.height:
            opts["figsize"] = (args.width, args.height)
        if args.kind == "violin":
            opts.setdefault("kind", "violin")
        for k in ("columns", "order", "hue_order"):
            if isinstance(opts.get(k), str) and "," in opts[k]:
                opts[k] = [s.strip() for s in opts[k].split(",")]
        fig, _ = PLOTTERS[args.kind](df, **opts)
    save(fig, out, dpi=args.dpi)
    print(f"Đã lưu: {out}")
    if args.kind != "panel":
        ax0 = _[0] if isinstance(_, tuple) else _
        try:
            r = results(_ if hasattr(_, "text") else ax0)
            if len(r):
                print("Kết quả tính:\n" + r.to_string())
        except Exception:
            pass


if __name__ == "__main__":
    main()
