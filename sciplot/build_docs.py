"""Đồng bộ bản web (thư mục docs/) với sciplot.py và dữ liệu mẫu.
Chạy lại mỗi khi sửa sciplot.py:   python build_docs.py"""
import shutil
from pathlib import Path

root = Path(__file__).parent
docs = root / "docs"
shutil.copy2(root / "sciplot.py", docs / "sciplot.py")
(docs / "examples").mkdir(exist_ok=True)
for f in (root / "examples").glob("*.csv"):
    shutil.copy2(f, docs / "examples" / f.name)
(docs / ".nojekyll").write_text("")  # để GitHub Pages phục vụ nguyên file, không xử lý Jekyll
print("Đã cập nhật docs/ — commit và push lên GitHub là xong.")
