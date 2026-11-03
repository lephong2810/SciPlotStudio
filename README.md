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
