"""Đồng bộ bản web (thư mục docs/) với sciplot.py và dữ liệu mẫu, rồi đánh số phiên bản mới cho app.
Chạy lại mỗi khi sửa sciplot.py hoặc các file trong docs/:   python build_docs.py"""
import hashlib
import re
import shutil
from pathlib import Path

root = Path(__file__).parent
docs = root / "docs"
shutil.copy2(root / "sciplot.py", docs / "sciplot.py")
(docs / "examples").mkdir(exist_ok=True)
for f in (root / "examples").glob("*.csv"):
    shutil.copy2(f, docs / "examples" / f.name)
(docs / ".nojekyll").write_text("")
shutil.copy2(root / "LICENSE", docs / "LICENSE")
shutil.copy2(root / "THIRD_PARTY_NOTICES.md", docs / "THIRD_PARTY_NOTICES.md")  # GitHub Pages phục vụ nguyên file, không xử lý Jekyll

# phiên bản = mã băm nội dung → app đã cài (PWA) tự nhận bản mới
h = hashlib.sha1()
for name in ["index.html", "app.js", "i18n.js", "simple.html", "studio.css", "studio.py", "sciplot.py", "manifest.webmanifest"]:
    h.update((docs / name).read_bytes())
version = h.hexdigest()[:10]
sw = docs / "sw.js"
sw.write_text(re.sub(r'const VERSION = "[^"]*";', f'const VERSION = "{version}";', sw.read_text(encoding="utf-8")),
              encoding="utf-8")
print(f"Đã cập nhật docs/ (phiên bản {version}) — commit và push lên GitHub là xong.")
