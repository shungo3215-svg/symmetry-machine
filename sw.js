/* sw.js — Service Worker（オフライン対応・network-first）
   https または localhost の secure context でのみ登録される（app.js側でガード）。
   network-first: オンライン時は常に最新を取り（キャッシュ更新）、オフライン時はキャッシュで動く。
   開発中に古いJSが残る事故を避けるための方針。 */
const CACHE = "symmetry-machine-v15";   // v15: 帯の「段を重ねる」（既定オン・画面と書き出し一致）・補助線を全群（回転対称は中心・区切り・鏡映の軸）・何も描かなくても中心と軸に吸着。v14: タイルの操作（展開面の吸着を全コピー横断＋格子・間隔と大きさ・右に4枚・スマホの全消去とペン入口・イラレ寄せのアイコン・別コピーを掴める）。v13: 見直し（MOCK-layout-261026）＝Serendie アイコン・3つ並びの表示切替・群の帯・1段の行・十字候補・PC は左に道具列/上に設定行/右に群。v12: 使いにくい所35件（PLAN-usability-261025）＝選択に効く操作・⇧⌥拘束・Space/⌘+−・⌘Z後の選択保持・通知の位置・スマホのフリック操作列。v11: 形成の塗りを実体化・ペンは切替で確定・Tab=展開なし・Shiftタップで一覧・直近の群を右に表示・描いた直後を選択。v10: 初回だけ青い短い曲線を置く（INIT-01）・⌘C は選択が無ければ図版全体をSVGコピー・Esc の null 参照を修正・同じ通知の再表示。v9: activate は symmetry-machine- で始まる自分のキャッシュだけ消す（同じ github.io の他アプリのキャッシュを消さない）。v8: 初回の案内文を削除・全消去をヘッダーへ。v6: 重ね順のイラレ準拠(1段階)＋出自(封筒/キャプション/ファイル名)＋数値行。旧キャッシュはactivateで破棄される
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
