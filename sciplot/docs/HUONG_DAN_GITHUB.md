# Đưa SciPlot Web lên GitHub Pages

Thư mục `docs/` là một trang web tĩnh hoàn chỉnh. Python (numpy, pandas, matplotlib, scipy) chạy ngay trong trình duyệt nhờ Pyodide, nên không cần máy chủ. Dữ liệu người dùng tải lên chỉ nằm trong trình duyệt của họ, không gửi đi đâu.

## Các bước (khoảng 5 phút)

1. Tạo repository mới trên GitHub, ví dụ `sciplot`, chọn **Public**.
2. Đưa toàn bộ thư mục `sciplot/` lên repo. Có hai cách:
   - **Kéo-thả:** trên trang repo chọn *Add file → Upload files*, kéo cả thư mục vào rồi bấm *Commit*.
   - **Dòng lệnh:**
     ```bash
     cd sciplot
     git init && git add . && git commit -m "SciPlot"
     git branch -M main
     git remote add origin https://github.com/<tài-khoản>/sciplot.git
     git push -u origin main
     ```
3. Vào repo, chọn **Settings → Pages**:
   - *Source*: **Deploy from a branch**
   - *Branch*: **main**, thư mục **/docs**, rồi bấm **Save**.
4. Đợi 1–2 phút. Trang sẽ có địa chỉ `https://<tài-khoản>.github.io/sciplot/`.

## Khi sửa `sciplot.py`

Bản web dùng một bản sao của `sciplot.py` nằm trong `docs/`. Sau mỗi lần sửa, chạy lệnh sau rồi commit và push lại:
```bash
python build_docs.py
```

## Thử trên máy trước khi đưa lên

Không mở `index.html` bằng cách nhấp đúp (dạng `file://`), vì trình duyệt sẽ chặn việc nạp `sciplot.py`. Thay vào đó, chạy:
```bash
cd docs
python -m http.server 8000
```
rồi mở `http://localhost:8000`.

## Lưu ý

- **Lần mở đầu tiên** trang tải khoảng 30–40 MB (Python và các thư viện), mất 10–60 giây tuỳ mạng. Từ lần sau, trình duyệt dùng bản đã lưu nên mở nhanh hơn nhiều.
- **Trình duyệt hỗ trợ:** Chrome, Edge, Firefox, Safari bản mới. Máy yếu hoặc điện thoại vẫn chạy được, nhưng chậm hơn.
- **Font:** bản web dùng Liberation Sans/Serif, có kích thước chữ tương đương Arial/Times New Roman và giấy phép SIL OFL (xem `fonts/LICENSE-Liberation.txt`). Bản desktop dùng Arial/Times thật nếu máy có cài.
- **Các tệp ngoài:** trang nạp Pyodide và SheetJS (thư viện đọc Excel) từ CDN jsDelivr, nên cần có Internet khi mở trang.

## Cách trang xử lý file Excel

Việc đọc file diễn ra hoàn toàn trong trình duyệt, bằng SheetJS:

| Tình huống | Trang xử lý thế nào |
|---|---|
| File `.xlsx`, `.xls`, `.xlsm`, `.ods` | Đọc trực tiếp, không cần lưu lại thành CSV |
| Nhiều sheet | Tự chọn sheet có nhiều ô số nhất (bỏ qua sheet ghi chú). Muốn đổi thì chọn lại ở ô *Sheet* |
| Dòng ghi chú ở đầu (vd "LSV 5 mV/s, 1 M KOH") | Tự bỏ các dòng chỉ có 1 ô chữ. Có thể đặt thêm *Bỏ qua … dòng đầu* |
| Tiêu đề nhiều dòng: tên cột + đơn vị (+ ghi chú) kiểu Origin | *Số dòng tiêu đề = tự nhận*: gộp các dòng chữ ở đầu, vd `E` + `V vs RHE` → cột `E V vs RHE`. Có thể chọn cố định 1/2/3 dòng |
| Tên cột trùng nhau | Tự thêm hậu tố `_2`, `_3` |
| Ô trống, dòng/cột trống | Bỏ qua |
| Số do công thức tính ra | Lấy giá trị đã tính (giá trị Excel lưu lần lưu file gần nhất) |
| Số bị lưu dạng chữ kiểu "1,23" | Chọn *Dấu thập phân = phẩy* để đổi thành số |
| Cột chữ (tên mẫu, nhóm) | Giữ nguyên, dùng để tô màu hoặc nhóm. Trang báo rõ cột nào không phải số |

Ngoài Excel, trang còn đọc được:
- **CSV/TXT xuất từ thiết bị:** tự nhận dấu phân cách (tab, `;`, `,`, khoảng trắng) và bảng mã (UTF-8, UTF-16, Windows-1258).
- **Dữ liệu dán thẳng từ Excel/Origin:** bôi đen vùng dữ liệu → Ctrl+C → dán vào ô *Dán từ Excel*.

Bảng dạng rộng (một cột x, mỗi mẫu một cột y) cũng dùng được trực tiếp cho Line, XRD, LSV, Tafel, CV, Nyquist và Tauc. Nếu là cặp cột x1, y1, x2, y2… như file xuất từ Origin, chọn *Dạng bảng → cặp cột*.
