# SciPlot: công cụ vẽ hình khoa học bằng Python

SciPlot chuyển nội dung giáo trình **Data Visualization with R** (NIH BTEP: ggplot2, pheatmap, patchwork) sang Python. Hình xuất ra theo chuẩn bài báo: font Arial hoặc Times, PNG/TIFF 300–1200 dpi, PDF/SVG dạng vector (chữ vẫn sửa được trong Illustrator/Inkscape).

Có ba cách dùng:

1. **Giao diện bấm chọn (SciPlot Studio)**: `streamlit run app.py`
2. **Dòng lệnh**: `python sciplot.py <loại_hình> data.csv --tham_so giá_trị -o hinh.png`
3. **Thư viện trong script hoặc Jupyter**: `import sciplot as sp`

## Bản web (GitHub Pages)

Thư mục `docs/` là bản web tĩnh: Python chạy ngay trong trình duyệt (Pyodide), không cần máy chủ, dữ liệu không rời khỏi máy người dùng. Trang hỗ trợ:
- tải file Excel (nhiều sheet, tiêu đề nhiều dòng kiểu Origin), CSV, TXT;
- dán dữ liệu trực tiếp;
- xuất PNG/PDF/SVG/TIFF;
- hiện code Python tương ứng.

Cách đưa lên GitHub và cách trang xử lý file Excel: xem `docs/HUONG_DAN_GITHUB.md`. Sau khi sửa `sciplot.py`, chạy `python build_docs.py` để cập nhật bản web.

## Cài đặt

```bash
pip install -r requirements.txt
```
Cần Python 3.9 trở lên. Gói `adjustText` (giúp nhãn gene/điểm không đè lên nhau) và `statsmodels` (cho đường lowess) không bắt buộc.

Trên Windows: nhấp đúp `run_app.bat`. Trên macOS/Linux: chạy `./run_app.sh`. Trình duyệt sẽ mở SciPlot Studio.

## Các loại hình (đối chiếu với giáo trình)

| Loại (`kind`) | Tương ứng trong R | Bài | Tham số chính |
|---|---|---|---|
| `scatter` | `geom_point`, `facet_wrap`, `geom_smooth`, `coord_fixed` | L2–3 | `x, y, color, shape, size, facet, fit=linear/poly2/lowess, label` |
| `line` | `geom_line` + `geom_point` | L2 | `x, y, color, agg="mean", error=sd/se/ci95` |
| `pca` | `prcomp(scale=TRUE)` + `stat_ellipse(level=0.95)` | L3 | `columns, group, scale, ellipse, level, loadings, pcs` |
| `volcano` | volcano + `geom_text_repel` | L3 | `fc, p, label, fc_thr, p_thr, top, label_genes` |
| `bar` | `geom_bar(stat=count/identity)` + `geom_errorbar` | L4 | `x, y, hue, stat=mean/count/identity, error, err_col, position=dodge/stack, points` |
| `histogram` | `geom_histogram(bins, binwidth)` | L4 | `x, hue, bins, binwidth, density, kde, multiple` |
| `box` / `violin` | `geom_boxplot` + `position_jitterdodge` | L4 | `x, y, hue, kind=box/violin, points, show_mean, stats_test=t/mw` |
| `heatmap` | `pheatmap` | L5 | `index, scale=row/column/none, distance, method, cmap, annotation_col, cutree_rows/cols` |
| `panel` | `patchwork` / `cowplot::plot_grid` | L6 | file JSON mô tả lưới và từng hình con, tự gắn nhãn A, B, C |

### Vật liệu & điện hoá (mới)

| Loại | Dùng cho | Tự tính | Tham số chính |
|---|---|---|---|
| `xrd` / `spectra` | XRD, Raman, FTIR, XPS, UV-Vis, PL xếp chồng (`kind=xrd/raman/ftir/xps/uvvis/pl`; FTIR/XPS tự đảo trục) | — | `x, y, sample, normalize, offset, smooth, refs` (thẻ JCPDS dạng vạch), `phases` (ký hiệu ▼★ trên đỉnh), `hkl`, `first_on_top` |
| `lsv` | Đường phân cực OER/HER | **η tại j = 10 mA cm⁻²** | `E, j, sample, ref` (Ag/AgCl, SCE, Hg/HgO… → tự đổi sang RHE), `pH, R` (bù iR, Ω), `area` (cm²), `current_unit` (A/mA/µA/mA/cm2), `reaction, j_mark` |
| `tafel` | η theo log\|j\| | **Độ dốc Tafel (mV dec⁻¹), R²** | như `lsv` + `fit_range=(1,10)` (mA cm⁻²) hoặc `eta_range`; `slope_labels=legend/text` |
| `cv` | CV nhiều tốc độ quét | — | như `lsv`, `convert=False` để giữ thang thế gốc |
| `cdl` | Δj/2 theo tốc độ quét | **C_dl (mF cm⁻²)** | `x` (mV/s), `ja, jc` hoặc `y` (Δj) |
| `nyquist` | Phổ tổng trở EIS | — | `zre, zim, sample` (tự đổi dấu −Z''), tỉ lệ 1:1 |
| `bet` | Đẳng nhiệt N₂ hấp phụ/giải hấp | **S_BET (m² g⁻¹), hằng số C** | `p, v, branch, sample, psd_x, psd_y` (inset phân bố lỗ BJH) |
| `tauc` | Năng lượng vùng cấm từ UV-Vis | **E_g (eV)** | `wl, A, transition=direct/indirect, fit_range` (bỏ trống = tự tìm đoạn tuyến tính) |

Các giá trị tính được ghi vào chú giải, in ra màn hình khi chạy dòng lệnh, và lấy ra được bằng `sp.results(ax)`.

Ba dạng bảng dữ liệu đều đọc được:
- **dạng dài**: cột x, cột y, cột `sample`;
- **dạng rộng**: một cột x, mỗi mẫu một cột y (`--y "A,B,C"`, hoặc bỏ trống để lấy mọi cột số);
- **dạng cặp cột** kiểu Origin/Excel: x1, y1, x2, y2… (`--pairs true`, tên mẫu lấy theo tiêu đề cột y).

### Khung hình kiểu Origin (mặc định)

`--theme origin` là mặc định: khung kín 4 cạnh, tick chính và tick phụ hướng ra ngoài ở trục trái/dưới, giống hình xuất từ OriginLab.
Các lựa chọn khác:
- `origin-in`: tick hướng vào trong, có ở cả 4 cạnh;
- `classic`: chỉ có trục trái và dưới, kiểu ggplot2;
- `bw`;
- `minimal`.

Một số tuỳ chọn tạo đúng kiểu hình trong bài báo:
- `gradient="#F2A0A0,#F0D9A0"`: cột tô chuyển màu;
- `value_labels=true`: ghi số trên thanh sai số;
- `note="@ At 90$^{o}$C"`: ghi chú ở góc trên;
- `xstep/ystep`: bước giữa các tick;
- `palette=pastel`;
- `markers=o`;
- panel gắn nhãn `(a) (b) (c)`.

Ví dụ dựng lại hình CO oxidation: `python sciplot.py panel examples/co_oxidation_figure.json -o fig.pdf`. Ví dụ figure vật liệu 6 ô (XRD, LSV, Tafel, EIS, BET, Tauc): `examples/materials_figure.json`.

```bash
python sciplot.py xrd examples/xrd_demo.csv --x two_theta --y intensity --sample sample \
       --refs examples/xrd_refs_demo.csv --phases '{"CeO2":[28.55,33.08,47.48],"CuO":[35.54,38.71]}' -o xrd.png
python sciplot.py lsv examples/lsv_oer_demo.csv --E E_V --j I_mA --sample sample \
       --ref Hg/HgO --pH 14 --R 2.5 --area 0.196 --current_unit mA --reaction OER -o lsv.png
python sciplot.py tafel examples/lsv_oer_demo.csv --E E_V --j I_mA --sample sample \
       --ref Hg/HgO --pH 14 --R 2.5 --area 0.196 --current_unit mA --fit_range 1,10 -o tafel.png
python sciplot.py bet examples/bet_demo.csv --p P_P0 --v V_cm3g --branch branch --sample sample \
       --psd_x pore_nm --psd_y dVdlogD -o bet.png
python sciplot.py tauc examples/uvvis_demo.csv --wl wavelength_nm --A absorbance --sample sample -o tauc.png
python sciplot.py raman my_raman.csv --pairs true -o raman.png          # file dạng cặp cột
```

Quy đổi thế: E(RHE) = E(đo) + E°(ref) + 0.0591·pH − I·R. Các giá trị E°(ref) dùng sẵn:
- Ag/AgCl (KCl bão hoà): 0.197 V;
- Ag/AgCl (3 M): 0.210 V;
- SCE: 0.241 V;
- Hg/HgO (1 M): 0.098 V.

Nếu điện cực của thầy/cô dùng giá trị khác, nhập bằng `E_ref=…`.

Tham số dùng chung cho mọi loại: `title, xlabel, ylabel, xlim, ylim, xstep, ystep, logx, logy, note, legend (best/right/bottom/top/upper left/none), palette (okabe/pastel/npg/aaas/bold/tableau/gray/viridis), colors ("setosa=blue,versicolor=black"), figsize`. Nhãn trục viết được chỉ số trên/dưới theo cú pháp `$^{o}$C`, `cm$^{-2}$`, `g$_{cat}$`.

## Ví dụ dòng lệnh (chạy được ngay với dữ liệu mẫu trong `examples/`)

```bash
python sciplot.py scatter examples/iris.csv --x Petal.Length --y Petal.Width --color Species --shape Species --fit linear -o scatter.png
python sciplot.py line examples/catalyst_kinetics_demo.csv --x time_min --y conversion --color catalyst --agg mean --ylabel "Conversion (%)" -o kinetics.png
python sciplot.py pca examples/iris.csv --group Species --loadings true -o pca.pdf
python sciplot.py volcano examples/de_results_demo.csv --fc logFC --p FDR --label gene --top 10 -o volcano.png
python sciplot.py bar examples/toothgrowth_demo.csv --x dose --y len --hue supp --error sd --points true -o bar.png
python sciplot.py box examples/toothgrowth_demo.csv --x dose --y len --hue supp --stats_test t -o box.png
python sciplot.py heatmap examples/rnaseq_top20_demo.csv --index gene --scale row \
       --annotation_col examples/sample_annotation_demo.csv \
       --annotation_colors '{"dex":{"trt":"orange","untrt":"black"}}' --cutree_rows 2 --cutree_cols 2 -o heatmap.png
python sciplot.py panel examples/panel.json -o figure1.pdf
```
Các tuỳ chọn chung trên dòng lệnh: `--theme origin|origin-in|classic|bw|minimal`, `--font sans|serif|"Tên font"`, `--fontsize 11`, `--width 6 --height 4` (đơn vị inch), `--dpi 600`, `--sheet Sheet1` (với file Excel). Xem đầy đủ bằng `python sciplot.py --help`.

## Dùng trong Python hoặc Jupyter

```python
import sciplot as sp
sp.set_theme("classic", font="serif", fontsize=10)      # Times New Roman, cỡ 10
df = sp.load_table("my_data.xlsx")
fig, ax = sp.bar(df, x="catalyst", y="j_mA_cm2", hue="electrolyte", error="se", points=True)
ax.axhline(10, ls="--", color="gray")                    # ax là matplotlib Axes, chỉnh tiếp thoải mái
sp.save(fig, "Fig2a.tiff", dpi=600)

fig, ax, res = sp.pca(df, group="Sample", return_result=True)   # lấy điểm số, % phương sai, loadings
```

## Ghép nhiều hình (panel.json)

```json
{
  "figsize": [12, 9], "tags": "A", "font": "sans", "fontsize": 10,
  "layout": [["A","B","C"],
             ["D","E","E"]],
  "panels": {
    "A": {"type": "pca", "data": "iris.csv", "group": "Species"},
    "E": {"type": "heatmap", "data": "rnaseq_top20_demo.csv", "index": "gene",
          "annotation_col": "sample_annotation_demo.csv"}
  }
}
```
Trong `layout`, cùng một chữ lặp lại sẽ gộp ô (như `E` ở trên), dấu `"."` là ô trống (giống `plot_spacer()`). `tags` nhận `"(a)"` (mặc định), `"A"`, `"a"`, `"1"` hoặc `null`. Đường dẫn file dữ liệu tính từ thư mục chứa file JSON.

## Định dạng dữ liệu

- **Dạng dài** (scatter, line, bar, box, histogram, pca, volcano): mỗi dòng là một quan sát, mỗi cột là một biến (ví dụ `len, supp, dose`).
- **Dạng rộng** (heatmap): mỗi hàng là gene/biến, mỗi cột là mẫu. Cột tên hàng chỉ định bằng `index`.
- **annotation_col** (heatmap): file 2 cột `sample, nhóm`, tên mẫu phải trùng với tên cột của bảng heatmap.

## Lưu ý

- `examples/iris.csv` là dữ liệu iris thật. Các file có đuôi `_demo` là **dữ liệu mô phỏng** để thử công cụ: `toothgrowth_demo` mô phỏng theo mean/SD trong giáo trình; các file còn lại (DE, RNA-seq, XRD, LSV, CV, Cdl, EIS, BET, UV-Vis, động học) là số liệu giả. Hai file `co_oxidation_*.csv` là số liệu đọc xấp xỉ bằng mắt từ hình mẫu, chỉ dùng để minh hoạ kiểu hình.
- Vị trí các đỉnh trong `xrd_refs_demo.csv` (CeO₂ 34-0394, CuO 45-0937) chỉ là giá trị gần đúng để minh hoạ. Khi dùng thật, nhập thẻ chuẩn chính thức (cột `x`, `intensity`, `name`).
- Elip PCA được tính theo hiệp phương sai với hệ số F. `stat_ellipse` của R mặc định dùng phân phối t đa biến, nên kích thước elip có thể chênh nhẹ.
- Dấu của các PC có thể ngược so với `prcomp`. Đây chỉ là quy ước, không ảnh hưởng ý nghĩa.
