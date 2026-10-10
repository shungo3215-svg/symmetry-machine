/* sw.js — Service Worker（オフライン対応・network-first）
   https または localhost の secure context でのみ登録される（app.js側でガード）。
   network-first: オンライン時は常に最新を取り（キャッシュ更新）、オフライン時はキャッシュで動く。
   開発中に古いJSが残る事故を避けるための方針。 */
const CACHE = "symmetry-machine-v10";   // v10: 初回だけ青い短い曲線を置く（INIT-01）・⌘C は選択が無ければ図版全体をSVGコピー・Esc の null 参照を修正・同じ通知の再表示。v9: activate は symmetry-machine- で始まる自分のキャッシュだけ消す（同じ github.io の他アプリのキャッシュを消さない）。v8: 初回の案内文を削除・全消去をヘッダーへ。v6: 重ね順のイラレ準拠(1段階)＋出自(封筒/キャプション/ファイル名)＋数値行。旧キャッシュはactivateで破棄される
const ASSETS = [
  "./",
  "./index.html",
  "./js/geom.js",
  "./js/groups.js",
  "./js/store.js",
  "./js/render.js",
  "./js/export.js",
  "./js/svgimport.js",
  "./js/app.js",
  "./js/workbench.js",
  "./workbench.css",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("symmetry-machine-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // 正常応答のみキャッシュ更新（404/500や206でオフラインコピーを壊さない）
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(hit =>
          hit || (e.request.mode === "navigate" ? caches.match("./index.html") : Response.error())
        )
      )
  );
});
