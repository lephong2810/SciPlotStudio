Cài như một app trên máy tính
Safari (macOS 14 Sonoma trở lên): mở trang, chọn menu File → Add to Dock…
Chrome / Edge: bấm biểu tượng cài đặt ở cuối thanh địa chỉ (hoặc menu ⋮ → Cast, save and share → Install page as app).
Hoặc trong SciPlot: menu File → Cài SciPlot như một app.

Sau lần mở đầu tiên có mạng (tải khoảng 30–40 MB), app chạy được cả khi không có Internet. Khi có bản mới, thanh trạng thái sẽ nhắc tải lại trang.

Cách dùng: các thao tác giống Origin
Việc cần làm	Thao tác
Nhập dữ liệu	File → Nhập dữ liệu (Excel/CSV/TXT), kéo-thả file vào cửa sổ, hoặc dán thẳng (Ctrl/⌘ V). Dòng tên cột thành Long Name, dòng đơn vị thành Units
Đặt kiểu cột	Chuột phải lên tiêu đề cột → X / Y / Y Error / Label / Disregard
Vẽ	Bấm tiêu đề cột Y (Ctrl/Shift để chọn nhiều) → menu Plot hoặc nút trên thanh công cụ. Mỗi cột Y dùng cột X gần nhất bên trái; cột Y Error ngay bên phải thành thanh sai số
Dữ liệu dạng dài (có cột tên mẫu)	Trang tự đề nghị tách theo nhóm (Unstack), hoặc dùng menu Column → Tách theo nhóm
Chỉnh trục	Bấm đúp vào trục để chỉnh: khoảng From/To, bước tick, số tick phụ, log, đảo trục, hướng tick, cỡ chữ, số chữ số thập phân
Sửa tên trục	Bấm đúp vào nhãn trục. Chỉ số trên: $^{o}$C, cm$^{-2}$; chỉ số dưới: g$_{cat}$; chữ Hy Lạp: $\eta$
Màu, ký hiệu, nét từng đường	Bấm đúp vào tên series trong chú giải, hoặc F4 (Plot Details)
Trục Y bên phải	Plot Details → chọn series → Vẽ theo trục Y bên phải
Chú giải, chữ	Kéo để di chuyển; mũi tên bàn phím để dịch từng chút (Shift = bước lớn); bấm đúp để sửa
Thêm chữ, đường ngang/dọc	Chọn công cụ trên thanh công cụ rồi bấm vào hình
Phóng to	Công cụ kính lúp → kéo khung chọn; Ctrl/⌘ R để trở lại
Cỡ hình, font, độ dày khung	Bấm đúp vào vùng trống ngoài hình, hoặc Graph → Trang & khung
Mọi hình cùng kiểu	Graph → Copy Format / Paste Format, hoặc Lưu làm template để dùng lại
Tính cột mới	Chọn cột → Ctrl/⌘ Q (Set Column Values), ví dụ col(B)/0.196, log10(abs(col(B)))
Xuất hình	Ctrl/⌘ E: PNG/TIFF 300–1200 dpi, PDF/SVG vector. Edit → Sao chép hình để dán vào PowerPoint
Figure nhiều ô	File → Ghép nhiều hình thành 1 figure (a)(b)(c)
Lưu để làm tiếp	Ctrl/⌘ S lưu file .sciplot.json; File → Mở project để mở lại. Trình duyệt cũng tự lưu tạm phiên gần nhất
Hoàn tác	Ctrl/⌘ Z, làm lại Ctrl/⌘ Y
Thử trên máy trước khi đưa lên

Không mở index.html bằng cách nhấp đúp (dạng file://), vì trình duyệt sẽ chặn việc nạp file Python. Thay vào đó, chạy:

bash
cd docs
python -m http.server 8000

rồi mở http://localhost:8000.

Ghi chú kỹ thuật
Hình được vẽ bằng matplotlib, nên file xuất ra giống hệt hình xem trên màn hình. Mỗi lần chỉnh, hình được vẽ lại sau khoảng 0,2–1 giây.
Font dùng Liberation Sans/Serif (kích thước chữ tương đương Arial/Times New Roman, giấy phép SIL OFL).
Pyodide và SheetJS được tải từ CDN jsDelivr ở lần đầu, sau đó lưu trong bộ nhớ của app.
