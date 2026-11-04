/* Service worker của SciPlot Studio: cho phép cài như app và chạy offline.
   VERSION được build_docs.py cập nhật tự động mỗi khi mã nguồn thay đổi. */
const VERSION = "a33e5e0df9";
const CACHE = "sciplot-" + VERSION;
const SHELL = [
  "./", "index.html", "studio.css", "app.js", "sciplot.py", "studio.py", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "wheels/adjusttext-1.3.0-py3-none-any.whl",
  ...["Sans", "Serif"].flatMap(f => ["Regular", "Bold", "Italic", "BoldItalic"].map(s => `fonts/Liberation${f}-${s}.ttf`)),
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("sciplot-") && k !== CACHE && k !== "sciplot-cdn").map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const isCdn = url.hostname === "cdn.jsdelivr.net";
  const sameOrigin = url.origin === self.location.origin;
  if (!isCdn && !sameOrigin) return;
  // Python, thư viện (CDN) ít khi đổi: lưu riêng để không phải tải lại 30–40 MB khi cập nhật app
  const cacheName = isCdn ? "sciplot-cdn" : CACHE;
  e.respondWith(caches.open(cacheName).then(async c => {
    const hit = await c.match(req, { ignoreSearch: sameOrigin });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && (isCdn || sameOrigin)) c.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === "navigate") { const idx = await c.match("index.html"); if (idx) return idx; }
      throw err;
    }
  }));
});
