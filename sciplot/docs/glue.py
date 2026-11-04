"""Cầu nối giữa trang web (JavaScript) và sciplot.py, chạy bên trong Pyodide.
Mọi hàm nhận/trả chuỗi JSON để JS gọi đơn giản."""
import base64
import io
import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

import sciplot as sp

# Font Liberation Sans/Serif (thay thế tương đương Arial/Times New Roman, giấy phép SIL OFL)
def _register_fonts(folder="fonts"):
    import os
    from matplotlib import font_manager
    if os.path.isdir(folder):
        for f in sorted(os.listdir(folder)):
            if f.lower().endswith(".ttf"):
                font_manager.fontManager.addfont(os.path.join(folder, f))


_register_fonts()

DATA = {}          # tên bộ dữ liệu → DataFrame
STATE = {"fig": None, "ax": None}


def _clean(v):
    if isinstance(v, float) and not np.isfinite(v):
        return None
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return None if not np.isfinite(v) else float(v)
    return v


def load_csv(name, text, decimal=".", sep="auto"):
    """Đọc văn bản CSV/TSV (từ file .csv/.txt, hoặc do SheetJS chuyển từ Excel)."""
    kw = dict(decimal=decimal)
    if sep == "auto":
        kw.update(sep=None, engine="python")
    else:
        kw.update(sep={"tab": "\t", "comma": ",", "semicolon": ";", "space": r"\s+"}[sep])
        if sep == "space":
            kw["engine"] = "python"
    df = pd.read_csv(io.StringIO(text), **kw)
    df = df.dropna(axis=1, how="all").dropna(axis=0, how="all")
    df.columns = [str(c).strip() for c in df.columns]
    # chuỗi số có dấu phẩy thập phân hoặc khoảng trắng → số (khi pandas chưa tự nhận)
    for c in df.columns:
        if df[c].dtype == object:
            conv = pd.to_numeric(df[c].astype(str).str.strip().str.replace(",", ".", regex=False)
                                 if decimal == "," else df[c], errors="coerce")
            if conv.notna().sum() >= max(1, 0.9 * df[c].notna().sum()):
                df[c] = conv
    DATA[name] = df
    return info(name)


def info(name):
    df = DATA[name]
    num = [str(c) for c in df.select_dtypes("number").columns]
    head = df.head(30)
    return json.dumps({
        "name": name, "nrows": int(len(df)), "ncols": int(df.shape[1]),
        "cols": [str(c) for c in df.columns], "num": num,
        "preview": [[_clean(v) for v in row] for row in head.itertuples(index=False)],
    })


def _prep(opts):
    o = dict(opts)
    for key in ("annotation_col", "annotation_row"):
        if isinstance(o.get(key), str) and o[key] in DATA:
            a = DATA[o[key]]
            o[key] = a.set_index(a.columns[0])
    if isinstance(o.get("refs"), str) and o["refs"] in DATA:
        o["refs"] = DATA[o["refs"]]
    for key in ("phases", "annotation_colors"):
        if isinstance(o.get(key), str) and o[key].strip().startswith("{"):
            o[key] = json.loads(o[key])
    if "figsize" in o:
        o["figsize"] = tuple(o["figsize"])
    if "pcs" in o and isinstance(o["pcs"], list):
        o["pcs"] = tuple(o["pcs"])
    return o


def render(kind, opts_json, theme="boxed", font="sans", fontsize=11, preview_dpi=110):
    opts = json.loads(opts_json)
    data_name = opts.pop("_data", "main")
    if STATE["fig"] is not None:
        plt.close(STATE["fig"])
        STATE["fig"] = None
    sp.set_theme(theme, font, float(fontsize))
    df = DATA[data_name]
    o = _prep(opts)
    melt = o.pop("_melt", None)
    if melt:  # bảng rộng (mỗi mẫu một cột) → dạng dài
        df = df.melt(id_vars=[melt["x"]], value_vars=melt["ys"], var_name="series", value_name="value")
        o.update(y="value", color="series")
        o.setdefault("ylabel", "y")
    if kind == "violin":
        o.setdefault("kind", "violin")
    fig, ax = sp.PLOTTERS[kind](df, **o)
    STATE["fig"], STATE["ax"] = fig, ax
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=float(preview_dpi), bbox_inches="tight")
    res = []
    try:
        r = sp.results(ax if hasattr(ax, "text") else None)
        if len(r):
            r = r.round(3)
            if isinstance(r, pd.Series):
                res = [{"Mẫu": str(k), "Giá trị": _clean(v)} for k, v in r.items()]
            else:
                res = [{"Mẫu": str(k), **{str(c): _clean(v) for c, v in row.items()}} for k, row in r.iterrows()]
    except Exception:
        res = []
    return json.dumps({"png": base64.b64encode(buf.getvalue()).decode(), "results": res,
                       "code": _code(kind, opts, theme, font, fontsize, data_name)})


def _code(kind, opts, theme, font, fontsize, data_name):
    extra, shown = [], {}
    opts = dict(opts)
    melt = opts.pop("_melt", None)
    if melt:
        extra.append(f"df = df.melt(id_vars=[{melt['x']!r}], value_vars={melt['ys']!r}, "
                     f"var_name='series', value_name='value')")
        opts = {"x": opts.pop("x", melt["x"]), "y": "value", "color": "series", **opts}
    for k, v in opts.items():
        if k in ("annotation_col", "refs") and isinstance(v, str):
            extra.append(f"{k}_df = sp.load_table({v!r})" + (".pipe(lambda a: a.set_index(a.columns[0]))"
                                                             if k == "annotation_col" else ""))
            shown[k] = f"@@{k}_df"
        else:
            shown[k] = v
    args = ", ".join(f"{k}={v[2:]}" if isinstance(v, str) and v.startswith("@@") else f"{k}={v!r}"
                     for k, v in shown.items())
    lines = ["import sciplot as sp", f"sp.set_theme({theme!r}, {font!r}, {fontsize})",
             f"df = sp.load_table({DATA_FILES.get(data_name, data_name)!r})", *extra,
             f"fig, ax = sp.{kind}(df, {args})", f"sp.save(fig, '{kind}.png', dpi=600)"]
    if kind in ("lsv", "tafel", "cdl", "bet", "tauc"):
        lines.append("print(sp.results(ax))")
    return "\n".join(lines)


DATA_FILES = {}


def set_file_name(name, filename):
    DATA_FILES[name] = filename


def export(fmt, dpi=300, transparent=False):
    fig = STATE["fig"]
    if fig is None:
        return ""
    buf = io.BytesIO()
    kw = dict(format=fmt, dpi=float(dpi), bbox_inches="tight", transparent=bool(transparent))
    if fmt == "tiff":
        kw["pil_kwargs"] = {"compression": "tiff_lzw"}
    fig.savefig(buf, **kw)
    return base64.b64encode(buf.getvalue()).decode()


def results_csv():
    try:
        r = sp.results(STATE["ax"])
        return r.to_csv() if len(r) else ""
    except Exception:
        return ""
