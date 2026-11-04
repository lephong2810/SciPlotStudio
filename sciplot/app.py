"""
SciPlot Studio — giao diện bấm-chọn cho sciplot.py
Chạy:  streamlit run app.py
"""
import io
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import streamlit as st

import sciplot as sp

HERE = Path(__file__).parent
EX = HERE / "examples"
SAMPLES = {
    "iris.csv (PCA, scatter)": "iris.csv",
    "toothgrowth_demo.csv (bar, box, histogram)": "toothgrowth_demo.csv",
    "de_results_demo.csv (volcano)": "de_results_demo.csv",
    "rnaseq_top20_demo.csv (heatmap)": "rnaseq_top20_demo.csv",
    "catalyst_kinetics_demo.csv (line)": "catalyst_kinetics_demo.csv",
    "photocatalysis_demo.csv (line + symbol)": "photocatalysis_demo.csv",
    "her_rate_demo.csv (bar gradient)": "her_rate_demo.csv",
    "xrd_demo.csv (XRD xếp chồng)": "xrd_demo.csv",
    "lsv_oer_demo.csv (LSV / Tafel)": "lsv_oer_demo.csv",
    "cv_scanrate_demo.csv (CV)": "cv_scanrate_demo.csv",
    "cdl_demo.csv (Cdl)": "cdl_demo.csv",
    "eis_demo.csv (Nyquist)": "eis_demo.csv",
    "bet_demo.csv (BET + PSD)": "bet_demo.csv",
    "uvvis_demo.csv (Tauc)": "uvvis_demo.csv",
}
TYPES = {
    "Scatter (phân tán)": "scatter",
    "Line (đường, có thể gộp replicate)": "line",
    "PCA + elip 95%": "pca",
    "Volcano": "volcano",
    "Bar (cột ± SD/SE)": "bar",
    "Histogram": "histogram",
    "Box / Violin": "box",
    "Heatmap phân cụm": "heatmap",
    "XRD / Raman / FTIR / XPS (xếp chồng)": "spectra",
    "LSV (OER/HER, η@j)": "lsv",
    "Tafel (tự fit độ dốc)": "tafel",
    "CV": "cv",
    "Cdl (Δj/2 theo tốc độ quét)": "cdl",
    "Nyquist (EIS)": "nyquist",
    "BET (đẳng nhiệt N₂ + PSD)": "bet",
    "Tauc (Eg từ UV-Vis)": "tauc",
}
AUTO_TYPE = {"xrd_demo.csv": "spectra", "lsv_oer_demo.csv": "lsv", "cv_scanrate_demo.csv": "cv",
             "cdl_demo.csv": "cdl", "eis_demo.csv": "nyquist", "bet_demo.csv": "bet", "uvvis_demo.csv": "tauc",
             "photocatalysis_demo.csv": "line", "her_rate_demo.csv": "bar",
             "iris.csv": "pca", "toothgrowth_demo.csv": "box", "de_results_demo.csv": "volcano",
             "rnaseq_top20_demo.csv": "heatmap", "catalyst_kinetics_demo.csv": "line"}

st.set_page_config(page_title="SciPlot Studio", layout="wide")
st.title("SciPlot Studio")
st.caption("Vẽ hình khoa học chuẩn bài báo (khung kín 4 cạnh) — ggplot2 → Python, kèm XRD, LSV, Tafel, CV, EIS, BET, Tauc")

# ---------------- data ----------------
with st.sidebar:
    st.header("1. Dữ liệu")
    up = st.file_uploader("Tải file CSV / TSV / TXT / XLSX", type=["csv", "tsv", "txt", "xlsx", "xls"])
    sample = st.selectbox("…hoặc dùng dữ liệu mẫu", list(SAMPLES))


@st.cache_data
def _read(name, raw):
    p = Path(name)
    if p.suffix.lower() in (".xlsx", ".xls"):
        return pd.read_excel(io.BytesIO(raw))
    sep = "\t" if p.suffix.lower() in (".tsv", ".txt") and b"\t" in raw[:2000] else None
    return pd.read_csv(io.BytesIO(raw), sep=sep, engine="python")


if up is not None:
    df = _read(up.name, up.getvalue())
    data_name = up.name
else:
    data_name = SAMPLES[sample]
    df = sp.load_table(EX / data_name)

cols = list(df.columns)
num_cols = list(df.select_dtypes("number").columns)
cat_cols = [c for c in cols if c not in num_cols or df[c].nunique() <= 12]
NONE = "— không —"

with st.expander(f"Xem dữ liệu: {data_name}  ({df.shape[0]} dòng × {df.shape[1]} cột)"):
    st.dataframe(df.head(200), width="stretch")

# ---------------- plot type & options ----------------
with st.sidebar:
    st.header("2. Loại hình")
    labels_ = list(TYPES)
    auto = AUTO_TYPE.get(data_name)
    idx0 = [TYPES[l] for l in labels_].index(auto) if auto in TYPES.values() else 0
    kind = TYPES[st.radio("Chọn", labels_, index=idx0, label_visibility="collapsed", key=f"kind_{data_name}")]

    st.header("3. Giao diện")
    theme = st.selectbox("Theme (khung)", sp.THEMES, format_func=lambda t: {
        "boxed": "khung kín 4 cạnh, tick ra ngoài",
        "boxed-in": "khung kín, tick vào trong 4 cạnh",
        "classic": "classic – chỉ trục trái/dưới", "bw": "bw – khung + lưới", "minimal": "minimal"}[t])
    font = st.selectbox("Font", ["sans", "serif"], format_func=lambda f: {"sans": "Arial / Sans", "serif": "Times New Roman"}[f])
    fontsize = st.slider("Cỡ chữ", 6, 18, 11)
    c1, c2 = st.columns(2)
    w0, h0 = {"heatmap": (6.5, 5.5), "spectra": (4.5, 5.0), "nyquist": (4.5, 4.5)}.get(kind, (5.0, 4.0))
    w = c1.number_input("Rộng (inch)", 2.0, 20.0, w0, 0.5, key=f"w_{kind}")
    h = c2.number_input("Cao (inch)", 2.0, 20.0, h0, 0.5, key=f"h_{kind}")
    palette = st.selectbox("Bảng màu", ["auto"] + list(sp.PALETTES) + ["viridis", "plasma", "coolwarm"])
    colors = st.text_input("Màu tuỳ chỉnh (vd: setosa=blue,versicolor=black)", "")


def pick(label, options, default=None, none=False, key=None):
    opts = ([NONE] if none else []) + list(options)
    idx = opts.index(default) if default in opts else 0
    v = st.selectbox(label, opts, index=idx, key=key)
    return None if v == NONE else v


def guess(names, pool):
    for n in names:
        for c in pool:
            if c.lower() == n.lower():
                return c
    return None


opts = {}
left, right = st.columns([1, 2.2])
with left:
    st.subheader("Tham số")
    if kind in ("scatter", "line"):
        opts["x"] = pick("Trục X", cols, num_cols[0] if num_cols else cols[0])
        opts["y"] = pick("Trục Y", cols, num_cols[1] if len(num_cols) > 1 else cols[-1])
        opts["color"] = pick("Màu theo nhóm", cols, guess(["Species", "catalyst", "group", "supp", "sample"], cols), none=True)
        if kind == "scatter":
            opts["shape"] = pick("Hình dạng điểm theo", cols, none=True)
            opts["size"] = pick("Kích thước điểm theo (cột số)", num_cols, none=True)
            opts["facet"] = pick("Tách ô (facet_wrap)", cols, none=True)
            fit = st.selectbox("Đường hồi quy", ["không", "linear", "poly2", "lowess"])
            opts["fit"] = None if fit == "không" else fit
            opts["label"] = pick("Gắn nhãn điểm theo cột", cols, none=True)
            opts["coord_fixed"] = st.checkbox("coord_fixed (tỉ lệ 1:1)")
            opts["point_size"] = st.slider("Cỡ điểm", 5, 150, 36)
        else:
            agg = st.checkbox("Gộp replicate (mean ± error)", value=data_name.startswith("catalyst"))
            if agg:
                opts["agg"] = "mean"
                opts["error"] = st.selectbox("Thanh sai số", ["sd", "se", "ci95", "none"])
        opts["logx"] = st.checkbox("Trục X log")
        opts["logy"] = st.checkbox("Trục Y log")
    elif kind == "pca":
        default_num = [c for c in num_cols]
        opts["columns"] = st.multiselect("Các cột biến số", num_cols, default_num)
        opts["group"] = pick("Nhóm (màu + elip)", cols, guess(["Species", "group"], cols), none=True)
        opts["scale"] = st.checkbox("Chuẩn hoá (scale = TRUE)", True)
        opts["ellipse"] = st.checkbox("Elip tin cậy", True)
        opts["level"] = st.slider("Mức tin cậy elip", 0.50, 0.99, 0.95, 0.01)
        opts["loadings"] = st.checkbox("Biplot (mũi tên loading)")
        opts["label"] = pick("Gắn nhãn mẫu theo", cols, none=True)
        npc = min(len(opts["columns"]), 6) if opts["columns"] else 2
        c1, c2 = st.columns(2)
        pa = c1.number_input("PC trục X", 1, max(npc, 2), 1)
        pb = c2.number_input("PC trục Y", 1, max(npc, 2), 2)
        opts["pcs"] = (int(pa), int(pb))
    elif kind == "volcano":
        opts["fc"] = pick("Cột log2 fold change", num_cols, guess(["logFC", "log2FoldChange", "log2FC"], num_cols))
        opts["p"] = pick("Cột p-value / FDR", num_cols, guess(["FDR", "padj", "adj.P.Val", "PValue", "pvalue"], num_cols))
        opts["label"] = pick("Cột tên gene", cols, guess(["gene", "transcript", "symbol", "feature"], cols), none=True)
        opts["fc_thr"] = st.number_input("Ngưỡng |log2FC|", 0.0, 10.0, 1.0, 0.25)
        opts["p_thr"] = st.number_input("Ngưỡng p", 0.0, 1.0, 0.05, 0.01, format="%.3f")
        opts["top"] = st.slider("Số gene gắn nhãn (p nhỏ nhất)", 0, 40, 10)
        genes = st.text_input("…hoặc liệt kê gene cần gắn nhãn (cách nhau dấu phẩy)")
        opts["label_genes"] = genes or None
        opts["colors"] = st.text_input("Màu Down, NS, Up", "#3B4992,#BBBBBB,#E11F28")
        colors = ""  # volcano dùng ô màu riêng
    elif kind == "bar":
        opts["x"] = pick("Trục X (nhóm)", cols, guess(["dose", "treat", "group", "sample"], cols) or cols[0])
        opts["hue"] = pick("Nhóm con (fill)", cols, guess(["supp"], cols), none=True)
        stat = st.selectbox("Kiểu thống kê", ["mean", "count", "identity"],
                            index=2 if data_name == "her_rate_demo.csv" else 0,
                            format_func=lambda s: {"mean": "mean ± error (từ dữ liệu thô)",
                                                   "count": "count (đếm số dòng)",
                                                   "identity": "identity (giá trị có sẵn)"}[s])
        opts["stat"] = stat
        if stat != "count":
            opts["y"] = pick("Trục Y (giá trị)", num_cols, guess(["len", "mean_len", "rate", "value"], num_cols))
        if stat == "mean":
            opts["error"] = st.selectbox("Thanh sai số", ["sd", "se", "ci95", "none"])
            opts["points"] = st.checkbox("Hiện từng điểm dữ liệu", True)
        if stat == "identity":
            opts["err_col"] = pick("Cột SD/SE có sẵn", num_cols, guess(["sd", "se"], num_cols), none=True)
        opts["position"] = st.selectbox("Sắp xếp", ["dodge", "stack"])
        opts["horizontal"] = st.checkbox("Cột nằm ngang (coord_flip)")
        opts["value_labels"] = st.checkbox("Ghi giá trị trên cột")
        order = st.text_input("Thứ tự trục X (vd: 2,1,0.5)")
        opts["order"] = order or None
    elif kind == "histogram":
        opts["x"] = pick("Biến", num_cols, guess(["len", "Petal.Length"], num_cols))
        opts["hue"] = pick("Theo nhóm", cols, none=True)
        mode = st.radio("Chia khoảng theo", ["bins", "binwidth"], horizontal=True)
        if mode == "bins":
            opts["bins"] = st.slider("Số bins", 3, 100, 20)
        else:
            opts["binwidth"] = st.number_input("Độ rộng bin", 0.0001, 1e6, 1.0)
        if opts["hue"]:
            opts["multiple"] = st.selectbox("Nhiều nhóm", ["overlay", "stack", "dodge"])
        opts["density"] = st.checkbox("Trục Y = mật độ")
        opts["kde"] = st.checkbox("Thêm đường KDE")
        opts["color"] = st.color_picker("Màu (khi không chia nhóm)", "#6495ED")
    elif kind == "box":
        opts["x"] = pick("Trục X (nhóm)", cols, guess(["dose", "Species"], cols) or cols[0])
        opts["y"] = pick("Trục Y (giá trị)", num_cols, guess(["len"], num_cols))
        opts["hue"] = pick("Nhóm con (màu)", cols, guess(["supp"], cols), none=True)
        opts["kind"] = st.radio("Kiểu", ["box", "violin"], horizontal=True)
        opts["points"] = st.checkbox("Jitter điểm dữ liệu", True)
        opts["filled"] = st.checkbox("Tô đặc hộp")
        opts["show_mean"] = st.checkbox("Đánh dấu trung bình (◇)")
        opts["notch"] = st.checkbox("Notch")
        tst = st.selectbox("Kiểm định 2 nhóm con", ["không", "t (Welch)", "Mann–Whitney"])
        opts["stats_test"] = {"không": None, "t (Welch)": "t", "Mann–Whitney": "mw"}[tst]
    elif kind == "heatmap":
        idx = pick("Cột tên hàng (gene/biến)", cols, guess(["gene", "name", "id"], cols), none=True)
        opts["index"] = idx
        cand = [c for c in num_cols if c != idx]
        opts["columns"] = st.multiselect("Các cột giá trị (mẫu)", cand, cand)
        opts["scale"] = st.selectbox("Scale (z-score)", ["row", "column", "none"])
        opts["cluster_rows"] = st.checkbox("Phân cụm hàng", True)
        opts["cluster_cols"] = st.checkbox("Phân cụm cột", True)
        opts["distance"] = st.selectbox("Khoảng cách", ["euclidean", "correlation", "cityblock", "cosine"])
        opts["method"] = st.selectbox("Phương pháp phân cụm", ["complete", "average", "ward", "single"])
        opts["cmap"] = st.selectbox("Thang màu", list(sp.CMAPS) + ["viridis", "magma", "RdBu_r", "coolwarm"])
        c1, c2 = st.columns(2)
        cr = c1.number_input("cutree_rows", 0, 20, 0)
        cc = c2.number_input("cutree_cols", 0, 20, 0)
        opts["cutree_rows"] = int(cr) or None
        opts["cutree_cols"] = int(cc) or None
        opts["show_values"] = st.checkbox("Ghi giá trị trong ô")
        st.markdown("**Chú thích mẫu (annotation_col)**")
        ann_up = st.file_uploader("File 2 cột: tên mẫu, nhóm", type=["csv", "tsv", "txt", "xlsx"], key="ann")
        if ann_up is not None:
            a = _read(ann_up.name, ann_up.getvalue())
            opts["annotation_col"] = a.set_index(a.columns[0])
        elif data_name == "rnaseq_top20_demo.csv":
            a = sp.load_table(EX / "sample_annotation_demo.csv")
            opts["annotation_col"] = a.set_index("sample")
            opts["annotation_colors"] = {"dex": {"trt": "orange", "untrt": "black"}}
            st.caption("Đang dùng sample_annotation_demo.csv")

    elif kind in ("spectra", "lsv", "tafel", "cv", "nyquist", "tauc"):
        fmt = st.radio("Dạng bảng", ["dài (x, y, sample)", "rộng (x + nhiều cột y)", "cặp cột (x1,y1,x2,y2…)"],
                       index=0 if guess(["sample", "scan"], cols) else 1)
        xk, yk = {"spectra": ("x", "y"), "lsv": ("E", "j"), "tafel": ("E", "j"), "cv": ("E", "j"),
                  "nyquist": ("zre", "zim"), "tauc": ("wl", "A")}[kind]
        xg = {"spectra": ["two_theta", "2theta", "x", "wavenumber", "shift"], "lsv": ["E_V", "E", "potential"],
              "tafel": ["E_V", "E"], "cv": ["E_V", "E"], "nyquist": ["Zre_ohm", "Zre", "Z'"],
              "tauc": ["wavelength_nm", "wavelength", "nm"]}[kind]
        yg = {"spectra": ["intensity", "y", "counts"], "lsv": ["I_mA", "j", "current", "j_mA_cm2"],
              "tafel": ["I_mA", "j"], "cv": ["j_mA_cm2", "I_mA", "j"], "nyquist": ["Zim_ohm", "Zim", "Z''"],
              "tauc": ["absorbance", "A", "abs"]}[kind]
        if fmt.startswith("cặp"):
            opts["pairs"] = True
        else:
            opts[xk] = pick("Cột trục X", cols, guess(xg, cols) or cols[0])
            if fmt.startswith("dài"):
                opts[yk] = pick("Cột trục Y", num_cols, guess(yg, num_cols))
                opts["sample"] = pick("Cột tên mẫu", cols, guess(["sample", "scan"], cols))
            else:
                ys = st.multiselect("Các cột Y (mỗi cột 1 mẫu)", [c for c in num_cols if c != opts[xk]],
                                    [c for c in num_cols if c != opts[xk]])
                opts[yk] = ",".join(ys)
        if kind == "spectra":
            k_ = st.selectbox("Loại phổ", list(sp.SPECTRA_PRESETS), format_func=str.upper)
            opts["kind"] = k_
            opts["normalize"] = st.checkbox("Chuẩn hoá mỗi phổ về [0,1]", True)
            off = st.number_input("Khoảng cách giữa các phổ (0 = tự động)", 0.0, 1e7, 0.0)
            opts["offset"] = off or None
            opts["smooth"] = st.slider("Làm mượt Savitzky–Golay (cửa sổ, 0 = tắt)", 0, 51, 0)
            opts["labels"] = st.selectbox("Tên mẫu", ["right", "legend"],
                                          format_func=lambda v: {"right": "ghi ở đầu phải mỗi phổ", "legend": "chú giải"}[v])
            opts["first_on_top"] = st.checkbox("Mẫu đầu tiên nằm trên cùng")
            lo, hi = st.columns(2)
            xa = lo.text_input("x từ", "")
            xb = hi.text_input("x đến", "")
            if xa and xb:
                opts["xlim"] = (float(xa), float(xb))
            ph = st.text_area("Ký hiệu pha (JSON)", '{"Phase I": [28.55, 33.08, 47.48, 56.33], "Phase II": [35.54, 38.71]}'
                              if data_name == "xrd_demo.csv" else "")
            if ph.strip():
                opts["phases"] = json.loads(ph)
            hk = st.text_input("Chỉ số hkl trên phổ trên cùng (vd 28.5:(111),33.1:(200))")
            opts["hkl"] = hk or None
            ref_up = st.file_uploader("Thẻ chuẩn JCPDS (cột x, intensity, name)", type=["csv", "xlsx", "txt"], key="ref")
            if ref_up is not None:
                opts["refs"] = _read(ref_up.name, ref_up.getvalue())
            elif data_name == "xrd_demo.csv" and st.checkbox("Dùng thẻ chuẩn mẫu (Phase I, II)", True):
                opts["refs"] = sp.load_table(EX / "xrd_refs_demo.csv")
        if kind in ("lsv", "tafel", "cv"):
            st.markdown("**Quy đổi thế & dòng**")
            opts["ref"] = st.selectbox("Điện cực so sánh khi đo", list(sp.REF_ELECTRODES),
                                       index=list(sp.REF_ELECTRODES).index("Hg/HgO") if data_name.startswith("lsv") else 0)
            if opts["ref"] != "RHE":
                opts["pH"] = st.number_input("pH dung dịch", 0.0, 14.0, 14.0, 0.5)
            opts["current_unit"] = st.selectbox("Đơn vị cột dòng", ["mA/cm2", "mA", "A", "uA", "A/cm2"],
                                                index=1 if data_name.startswith("lsv") else 0)
            ar = st.number_input("Diện tích điện cực (cm², 0 = bỏ qua)", 0.0, 100.0,
                                 0.196 if data_name.startswith("lsv") else 0.0, 0.001, format="%.3f")
            opts["area"] = ar or None
            rr = st.number_input("R dung dịch để bù iR (Ω, 0 = không bù)", 0.0, 1e4,
                                 2.5 if data_name.startswith("lsv") else 0.0)
            opts["R"] = rr
        if kind in ("lsv", "tafel"):
            opts["reaction"] = st.selectbox("Phản ứng", ["OER", "HER", "ORR/khác"])
            if opts["reaction"] == "ORR/khác":
                opts["reaction"] = None
        if kind == "lsv" and opts.get("reaction"):
            opts["j_mark"] = st.number_input("Tính η tại |j| (mA cm⁻²)", 0.1, 1000.0, 10.0)
        if kind == "tafel":
            a_, b_ = st.columns(2)
            j1 = a_.number_input("Fit từ |j| =", 0.001, 1e4, 1.0)
            j2 = b_.number_input("đến |j| =", 0.001, 1e4, 10.0)
            opts["fit_range"] = (j1, j2)
            opts["slope_labels"] = st.radio("Ghi độ dốc", ["legend", "text"], horizontal=True)
        if kind == "nyquist":
            opts["lines"] = st.checkbox("Nối điểm", True)
            opts["equal"] = st.checkbox("Tỉ lệ trục 1:1", True)
        if kind == "tauc":
            opts["transition"] = st.radio("Chuyển mức", ["direct", "indirect"], horizontal=True,
                                          format_func=lambda v: {"direct": "trực tiếp (αhν)²", "indirect": "gián tiếp (αhν)^½"}[v])
            fr = st.text_input("Khoảng fit (eV), vd 3.25,3.45 – bỏ trống = tự tìm", "")
            opts["fit_range"] = fr or None
            xr = st.text_input("Giới hạn trục hν (eV)", "1.8,4.2" if data_name == "uvvis_demo.csv" else "")
            opts["xlim"] = xr or None
    elif kind == "cdl":
        opts["x"] = pick("Cột tốc độ quét (mV/s)", num_cols, guess(["scan_rate", "v"], num_cols))
        mode = st.radio("Dữ liệu", ["ja & jc", "Δj có sẵn"], horizontal=True)
        if mode == "ja & jc":
            opts["ja"] = pick("Cột j anot", num_cols, guess(["ja"], num_cols))
            opts["jc"] = pick("Cột j catot", num_cols, guess(["jc"], num_cols))
        else:
            opts["y"] = pick("Cột Δj", num_cols)
            opts["half"] = st.checkbox("Chia đôi (Δj/2)", True)
        opts["sample"] = pick("Cột tên mẫu", cols, guess(["sample"], cols), none=True)
    elif kind == "bet":
        opts["p"] = pick("Cột P/P0", num_cols, guess(["P_P0", "P/P0", "p"], num_cols))
        opts["v"] = pick("Cột lượng hấp phụ", num_cols, guess(["V_cm3g", "V", "quantity"], num_cols))
        opts["branch"] = pick("Cột nhánh (ads/des)", cols, guess(["branch"], cols), none=True)
        opts["sample"] = pick("Cột tên mẫu", cols, guess(["sample"], cols), none=True)
        opts["calc"] = st.checkbox("Tính S_BET (P/P0 = 0.05–0.30)", True)
        opts["psd_x"] = pick("PSD: cột đường kính lỗ", num_cols, guess(["pore_nm", "D"], num_cols), none=True)
        opts["psd_y"] = pick("PSD: cột dV/dlogD", num_cols, guess(["dVdlogD"], num_cols), none=True)

    if kind == "bar":
        if st.checkbox("Tô gradient", data_name in ("her_rate_demo.csv",)):
            g1, g2 = st.columns(2)
            opts["gradient"] = f"{g1.color_picker('Màu trên', '#82D0FF')},{g2.color_picker('Màu dưới', '#BC75FF')}"
            opts["edgecolor"] = "#666666"
    opts["note"] = st.text_input("Ghi chú góc trên-trái (vd: @ At 90$^{o}$C)", "") or None
    if kind in ("scatter", "line", "bar", "box"):
        rx = st.slider("Xoay nhãn trục X (độ)", 0, 90, 30 if data_name.startswith("her_rate") else 0, 15)
        opts["rotate_x"] = rx or None

    st.markdown("---")
    opts["title"] = st.text_input("Tiêu đề") or None
    if kind != "heatmap":
        xl = st.text_input("Nhãn trục X (để trống = tên cột)")
        yl = st.text_input("Nhãn trục Y (để trống = tự động)")
        if xl:
            opts["xlabel"] = xl
        if yl:
            opts["ylabel"] = yl
        opts["legend"] = st.selectbox("Vị trí chú giải", ["best", "right", "bottom", "top", "upper left",
                                                          "upper right", "lower right", "none"])
    if colors and kind != "volcano":
        opts["colors"] = colors
    if kind not in ("volcano", "heatmap"):
        opts["palette"] = palette if palette != "auto" else ("pastel" if data_name.startswith("photocatalysis")
                                                             else ("auto" if kind in ("spectra", "lsv", "tafel", "cv",
                                                                                      "nyquist", "tauc") else "okabe"))

# ---------------- render ----------------
opts = {k: v for k, v in opts.items() if isinstance(v, pd.DataFrame) or (v is not None and v is not False and not (isinstance(v, str) and v == ""))}
opts["figsize"] = (w, h)
with right:
    try:
        sp.set_theme(theme, font, fontsize)
        fig, ax_ = sp.PLOTTERS[kind](df, **opts)
        st.pyplot(fig, width="content")
        try:
            res_ = sp.results(ax_)
            if len(res_):
                st.markdown("**Kết quả tính từ dữ liệu**")
                st.dataframe(res_.round(3), width="content")
        except Exception:
            pass
        st.subheader("Xuất hình")
        c1, c2, c3 = st.columns(3)
        dpi = c1.selectbox("DPI", [300, 600, 1200, 150], index=0)
        fname = c2.text_input("Tên file", f"{kind}_plot")
        transp = c3.checkbox("Nền trong suốt")
        bcols = st.columns(4)
        for col, ext, mime in zip(bcols, ["png", "pdf", "svg", "tiff"],
                                  ["image/png", "application/pdf", "image/svg+xml", "image/tiff"]):
            buf = io.BytesIO()
            kw = {"pil_kwargs": {"compression": "tiff_lzw"}} if ext == "tiff" else {}
            fig.savefig(buf, format=ext, dpi=dpi, bbox_inches="tight", transparent=transp, **kw)
            col.download_button(f"⬇ {ext.upper()}", buf.getvalue(), f"{fname}.{ext}", mime)
        plt.close(fig)
    except Exception as e:  # thông báo lỗi dễ hiểu
        st.error(f"Chưa vẽ được hình: {e}")
        st.info("Kiểm tra lại các cột đã chọn (cột số / cột nhóm) cho phù hợp với loại hình.")

    # code tái lập
    shown = {k: v for k, v in opts.items() if k not in ("annotation_col", "refs")}
    args = ", ".join(f"{k}={v!r}" for k, v in shown.items())
    code = (f"import sciplot as sp\n"
            f"sp.set_theme({theme!r}, {font!r}, {fontsize})\n"
            f"df = sp.load_table({data_name!r})\n"
            + ("ann = sp.load_table('annotation.csv'); ann = ann.set_index(ann.columns[0])\n"
               if "annotation_col" in opts else "")
            + ("refs = sp.load_table('jcpds_refs.csv')\n" if "refs" in opts else "")
            + f"fig, ax = sp.{kind}(df, {args}"
            + (", annotation_col=ann" if "annotation_col" in opts else "")
            + (", refs=refs" if "refs" in opts else "") + ")\n"
            + ("print(sp.results(ax))\n" if kind in ("lsv", "tafel", "cdl", "bet", "tauc") else "")
            + f"sp.save(fig, '{kind}_plot.png', dpi=600)")
    with st.expander("Code Python để tái lập hình này (dùng trong script / Jupyter)"):
        st.code(code, language="python")
