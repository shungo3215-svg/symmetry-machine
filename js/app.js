/* app.js — UI結線（ロジックは持たない）
   描画パッドのpointer処理 / モード切替（LIVE/GRID）/ ライブ集中ビュー /
   ガイド / 保存 / キーボード / Prefs永続化 / 起動 */
(() => {
  "use strict";

  const PAD_W = 280;          // パッドの論理サイズ(px)
  const SW = 190;             // スワッチの辺(px)
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const $ = id => document.getElementById(id);

  const pad = $("pad");
  const pctx = pad.getContext("2d");

  let pngScale = 2;
  let pngBg = "white";            // "white" | "clear"(透明)
  let viewMode = "grid";          // "grid" | "live"
  let guide = "off";              // "off" | "grid" | "circle"
  let tool = "freehand";          // freehand | pen | line | rect | ellipse | polygon | erase
  let sides = 6;                  // 多角形の辺数
  // 新規itemに与えるスタイルの既定（選択が無いときのstyle行の編集対象）。
  // 選択があるとき、style行は選択にだけ効く（既定は変わらない=誤爆防止）
  let defSty = { fill: "none", stroke: "ink", sw: 3, alpha: 1, r: 0 };
  const newSty = () => ({ fill: defSty.fill, stroke: defSty.stroke, sw: defSty.sw, alpha: defSty.alpha, r: defSty.r });
  let snapOn = false;             // ガイドへのスナップ（pen/図形のみ。freehandは対象外）
  let axis = null;                // ロゼット回転中心（パッド座標）。null=中心
  let motif = null;               // 現ドキュメントのモチーフ（Path2D等）

  // パッドは表示サイズ（CSS）に追従。論理座標は常に PAD_W(280)、描画は padScale で拡縮
  let padScale = dpr;
  function sizePad() {
    const disp = pad.getBoundingClientRect().width || PAD_W;
    pad.width = Math.round(disp * dpr);
    pad.height = Math.round(disp * dpr);
    padScale = pad.width / PAD_W;
  }
  sizePad();

  const specName = spec => spec.def ? spec.def.name : spec.name;   // rosette/customはdef.name
  const fileName = spec => specName(spec).replace(/\s+/g, "-");   // "spinning hop"等の空白対策

  /* ==== スワッチDOM（GRID） ==== */
  const swatches = [];
  function buildSwatches(host, specs) {
    for (const spec of specs) {
      const wrap = document.createElement("div");
      wrap.className = "sw";
      const cv = document.createElement("canvas");
      cv.width = SW * dpr; cv.height = SW * dpr;
      const lb = document.createElement("div");
      lb.className = "lb";
      lb.textContent = specName(spec);
      wrap.append(cv, lb);
      wrap.addEventListener("click", () => { wrap.classList.toggle("sel"); savePrefs(); });
      host.appendChild(wrap);
      swatches.push({ cv, spec, wrap });
    }
  }
  buildSwatches($("rosettesC"), Groups.ROSETTES_C.map(def => ({ kind: "rosette", def })));
  buildSwatches($("rosettesD"), Groups.ROSETTES_D.map(def => ({ kind: "rosette", def })));
  buildSwatches($("friezes"), Groups.FRIEZE_ORDER.map(name => ({ kind: "frieze", name })));
  buildSwatches($("wallpapers"), Groups.WALLPAPER_ORDER.map(name => ({ kind: "wallpaper", name })));

  const selected = () => swatches.filter(s => s.wrap.classList.contains("sel"));

  /* ==== ライブ集中ビュー ====
     ライブ対象 = 選択中スワッチのspec（無ければお気に入り）。最大4群。 */
  const LIVE_MAX = 4;
  const liveHost = $("livePanel");
  let liveCanvases = [];   // [{cv, spec}]
  let liveKey = "";        // 現パネルの対象群キー（変化時のみDOM再構築）

  function liveSpecs() {
    const sel = selected().map(s => s.spec);
    const base = sel.length ? sel : Groups.FAVORITES.map(name => ({ kind: "wallpaper", name }));
    return base.slice(0, LIVE_MAX);
  }
  function liveSize(n) { return n <= 1 ? 560 : n === 2 ? 360 : 280; }

  function buildLivePanel() {
    const specs = liveSpecs();
    // コンテナ実測でサイズを決める（狭い右カラムでは全幅=論理サイズ。バッファと表示を一致させボケ/縮小を防ぐ）
    const avail = liveHost.clientWidth || liveSize(specs.length);
    const size = Math.min(liveSize(specs.length), Math.max(avail, 120));
    const key = specs.map(specName).join(",") + "@" + size;
    if (key === liveKey && liveCanvases.length) return;
    liveKey = key;
    liveHost.textContent = "";
    liveCanvases = specs.map(spec => {
      const box = document.createElement("div");
      const cv = document.createElement("canvas");
      // フリーズ（帯）は横長キャンバスで見せる（正方だと上下が広大な余白になる）
      const h = spec.kind === "frieze" ? Math.round(size / 2.5) : size;
      cv.width = size * dpr; cv.height = h * dpr;
      cv.style.width = size + "px";   // heightはCSSの height:auto（バッファ比率から追従）
      const lb = document.createElement("div");
      lb.className = "lb"; lb.textContent = specName(spec);
      box.append(cv, lb);
      liveHost.appendChild(box);
      return { cv, spec };
    });
    const sel = selected().length;
    $("liveHint").textContent = sel > LIVE_MAX ? `選択${sel}群のうち先頭${LIVE_MAX}群をライブ表示` : "";
    updateParamRowState();
  }
  function renderLive(m) {
    for (const { cv, spec } of liveCanvases)
      Render.swatchInto(cv.getContext("2d"), cv.width / dpr, dpr, spec, m, PAD_W, Render.colors().paper, cv.height / dpr);
  }

  // cell/scale は壁紙/フリーズにだけ効く。LIVEの対象がロゼット/カスタムのみのときはスライダー行を薄く
  function updateParamRowState() {
    const relevant = viewMode !== "live" || liveSpecs().some(s => s.kind === "wallpaper" || s.kind === "frieze");
    $("paramRow").style.opacity = relevant ? "" : ".35";
  }

  /* ==== 再描画 ==== */
  function renderPad() {
    Render.pad(pctx, PAD_W, motif, padScale, guide, axis);
    if (padEdit) {
      const it = Store.items[padEdit.idx];
      if (!it || it.kind !== "shape" || it.shape !== "path") padEdit = null;   // undo等で消えたら抜ける
    }
    if (padEdit) drawPadAnchors();
    else if (selIdxs.length || marquee) drawSelOverlay();
    if (tool === "form" && padHoverFaces.length) drawPadForm();
  }

  let swatchTimer = null;
  function scheduleSwatches(delay = 100) {
    clearTimeout(swatchTimer);
    swatchTimer = setTimeout(() => {
      /* 形成があるときは**選択中のスワッチだけ**形成込みで描く。46枚すべてに面計算(polyFaces)を
         回すと群によっては何秒も固まる。形成は「いま見ている1つの群」に対する編集なので、
         他の群のスワッチは素の展開のままでよい（＝群を選び直す前の下見） */
      const withForm = Store.hasForm();
      const selSet = withForm ? new Set(selected().map(s => s.spec)) : null;
      const jobs = swatches.map(s => () => {
        const formed = (withForm && selSet.has(s.spec)) ? formedItems(s.spec) : null;
        Render.swatchInto(s.cv.getContext("2d"), SW, dpr, s.spec, motif, PAD_W, undefined, SW, formed);
      });
      Render.queueSwatches(jobs);
    }, delay);
  }
  function refresh() {
    motif = Render.buildMotif(Store.items, PAD_W);
    renderPad();
    if (viewMode === "live") {
      renderLive(motif);
      // PC(≥1024)はライブ中もグリッドが見えているので一緒に更新する（従来はモード切替まで古いままだった）
      if (matchMedia("(min-width: 1024px)").matches) scheduleSwatches();
    }
    else if (viewMode === "edit") renderEdit();
    else scheduleSwatches();
    if (cgOpen) updateCgPreview();   // カスタムビルダーのプレビューも描画に追従
    updateHints();
  }
  Store.onChange(refresh);
  Render.setBitmapReadyHandler(refresh);

  /* ==== 描画パッド ====
     freehand=増分描画→pointerupで清書 / 図形=ドラッグ配置 / pen=タップでアンカー追加 / erase=タップで削除 */
  const BOX_TOOLS = ["line", "rect", "ellipse", "polygon"];
  const CLOSE_TOL = 12;   // ペンの始点吸着（論理px）
  const TAP_TOL = 14;     // タップ判定（論理px）。タッチの指ブレを許容（表示460pxでも快適に）
  let raw = null, lastPt = null;   // freehand
  let shapeDrag = null;            // {x0,y0,x1,y1} 図形ツール
  let penPts = [], hoverPt = null; // pen
  let penSmooth = [];              // penPtsと同じ長さ。true=スムース点（ドラッグで確定）/false=角（クリックで確定）
  let downPt = null;               // タップ判定用（pen/erase）
  let activePointer = null;        // 1本目のポインタのみ処理（2本目/手のひらの誤爆を防ぐ）

  const pos = e => {
    const r = pad.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * PAD_W, (e.clientY - r.top) / r.height * PAD_W, e.timeStamp];
  };

  /* ==== S4 スナップの共通エンジン（パッドと編集モードで同じ実装を使う） ====
     itemの輪郭をパッド座標のリング列にして、アンカー > 中点 > 輪郭上（エッジ）の優先で最近傍を返す。
     ガイド専用だった旧snapは「ガイドが無いと何にも吸かない」ので、まずオブジェクトに吸くようにした。 */
  function editRings(items) {
    const out = [];
    items.forEach((it, idx) => {
      if (it.kind === "stroke") {   // 手描き: 表示と同じ簡略化点列（アンカーの位置と一致させる）
        out.push({ idx, ring: -1, pts: Geom.simplifyDP(Geom.resample(it.raw, 3), editStrokeEps()), closed: false });
        return;
      }
      if (it.kind !== "shape") return;
      if (it.shape === "path") {
        // 曲線パスは折れ線化して輪郭に吸けるようにする（アンカー判定には raw を使う）
        const pts = it.curve ? Geom.flattenBeziers(Geom.pathBeziers(it.points, !!it.closed, it.corners, it.curveMode)) : it.points;
        out.push({ idx, ring: -1, pts, raw: it.points, closed: !!it.closed });
        (it.holes || []).forEach((rg, ri) => out.push({ idx, ring: ri, pts: rg, raw: rg, closed: true }));
        return;
      }
      if (it.shape === "line") { out.push({ idx, ring: -1, pts: [[it.x0, it.y0], [it.x1, it.y1]], closed: false }); return; }
      const p = shapeToPath(it);   // rect / polygon / ellipse（円は編集できないが吸着先にはなる）
      if (p !== it) out.push({ idx, ring: -1, pts: p.points, closed: true });
    });
    return out;
  }
  let ringsCache = { key: null, val: null };   // Store.itemsは不変配列なので参照で判定できる
  const ringsOf = items => {
    if (ringsCache.key !== items) ringsCache = { key: items, val: editRings(items) };
    return ringsCache.val;
  };
  /* v=探索点, views=パッド座標→探索座標の行列列（パッドは恒等1つ / 編集モードは全コピー）,
     ex={ring識別, pt} 自分自身（動いている点とその両隣の辺）の除外。戻り: {x,y,kind,dir?} or null */
  function snapSearch(v, rings, views, ex, tol) {
    let bestA = null, bestM = null, bestE = null;
    const tolM = tol * 0.85, tolE = tol * 0.75;   // 曖昧さを避けるため下位ほど狭く
    for (const V of views) for (const rg of rings) {
      const mine = ex && rg.idx === ex.idx && rg.ring === ex.ring;
      const src = mine ? (rg.raw || rg.pts) : rg.pts;   // 自分の辺を除外するにはアンカー列で見る必要がある
      const n = src.length;
      if (n < 2) continue;
      const tv = src.map(p => Geom.apply(V, p[0], p[1]));
      for (let i = 0; i < n; i++) {
        if (mine && i === ex.pt) continue;
        const d = Math.hypot(tv[i][0] - v[0], tv[i][1] - v[1]);
        if (d < tol && (!bestA || d < bestA.d)) bestA = { d, x: tv[i][0], y: tv[i][1], kind: "anchor" };
      }
      const nseg = rg.closed ? n : n - 1;
      for (let i = 0; i < nseg; i++) {
        const j = (i + 1) % n;
        if (mine && (i === ex.pt || j === ex.pt)) continue;   // 掴んでいる点に繋がる辺は動くので対象外
        const a = tv[i], b = tv[j];
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        const dm = Math.hypot(mx - v[0], my - v[1]);
        if (dm < tolM && (!bestM || dm < bestM.d)) bestM = { d: dm, x: mx, y: my, kind: "mid" };
        const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        if (L2 < 1e-9) continue;
        const t = Geom.clamp(((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / L2, 0, 1);
        const px = a[0] + dx * t, py = a[1] + dy * t;
        const de = Math.hypot(px - v[0], py - v[1]);
        if (de < tolE && (!bestE || de < bestE.d)) bestE = { d: de, x: px, y: py, kind: "edge", dir: [dx, dy] };
      }
    }
    return { anchor: bestA, mid: bestM, edge: bestE };
  }
  /* 交点への吸着: カーソル近傍の線分どうしが交わる点を拾う。
     **「ベースの曲線と、その複製が交わるところ」を掴む**のが目的なので、views に全コピーの行列を
     渡してコピー跨ぎの交点も拾う（展開ビューではこれが主用途）。同じ形の自己交差も対象。
     全ペアを見るが、探索はカーソルの3tol近傍を通る線分だけに絞るので実際は数本×数本で済む。 */
  function crossSnap(v, rings, views, tol) {
    const segs = [];
    const R = tol * 3;
    for (const V of views) for (const rg of rings) {
      const pts = rg.pts;
      const n = pts.length;
      if (n < 2) continue;
      const nseg = rg.closed ? n : n - 1;
      const tv = pts.map(p => Geom.apply(V, p[0], p[1]));
      for (let i = 0; i < nseg; i++) {
        const a = tv[i], b = tv[(i + 1) % n];
        if (Math.min(a[0], b[0]) > v[0] + R || Math.max(a[0], b[0]) < v[0] - R) continue;
        if (Math.min(a[1], b[1]) > v[1] + R || Math.max(a[1], b[1]) < v[1] - R) continue;
        segs.push([a, b]);
      }
    }
    let best = null;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const [a, b] = segs[i], [c, d] = segs[j];
      const d1x = b[0] - a[0], d1y = b[1] - a[1], d2x = d[0] - c[0], d2y = d[1] - c[1];
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-12) continue;   // 平行
      const ex = c[0] - a[0], ey = c[1] - a[1];
      const t = (ex * d2y - ey * d2x) / den, u = (ex * d1y - ey * d1x) / den;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;   // 線分の外＝延長線上の交点は採らない
      const x = a[0] + d1x * t, y = a[1] + d1y * t;
      const dd = Math.hypot(x - v[0], y - v[1]);
      if (dd < tol && (!best || dd < best.d)) best = { d: dd, x, y, kind: "cross" };
    }
    return { cross: best };
  }

  // 吸着先の優先順（曖昧なときは構造的に強いものを勝たせる）
  const SNAP_RANK = ["anchor", "cross", "center", "mid", "axis", "edge"];
  /* 種類ごとのオンオフ。「アンカーには吸わせたいが輪郭には吸わせたくない」のような
     使い分けを作れる（吸着そのもののオン／オフは snapOn＝造形パネルの「吸着」） */
  let snapKinds = { anchor: true, cross: true, center: true, mid: true, axis: true, edge: true };
  const pickSnap = c => { for (const k of SNAP_RANK) if (c[k] && snapKinds[k]) return c[k]; return null; };
  const SNAP_BTN = { anchor: "snAnchor", cross: "snCross", center: "snCenter", mid: "snMid", axis: "snAxis", edge: "snEdge" };
  function setSnapKind(k, on, persist = true) {
    snapKinds[k] = !!on;
    $(SNAP_BTN[k]).classList.toggle("on", snapKinds[k]);
    if (persist) savePrefs();
  }
  for (const [k, id] of Object.entries(SNAP_BTN)) $(id).onclick = () => setSnapKind(k, !snapKinds[k]);

  /* 対称要素（回転中心・鏡映軸）への吸着（S5の一部）。
     群テーブルには触らず、コピーの行列から T = Vj∘V0⁻¹ を作って固定点解析で導出する。
     det>0=回転→固定点 / det<0かつ軸方向の並進成分なし=鏡映→軸直線（映進は固定点が無いので対象外） */
  function symSnap(v, views, tol) {
    if (views.length < 2) return {};
    const inv0 = Geom.invert(views[0]);
    let bestC = null, bestX = null;
    const tolC = tol * 0.9, tolX = tol * 0.8;
    for (let i = 1; i < views.length; i++) {
      const [a, b, c, d, e, f] = Geom.mul(views[i], inv0);
      if (a * d - c * b > 0) {   // 回転（または並進）
        const det = (1 - a) * (1 - d) - c * b;
        if (Math.abs(det) < 1e-6) continue;   // 並進＝固定点なし
        const x = ((1 - d) * e + c * f) / det, y = (b * e + (1 - a) * f) / det;
        const dd = Math.hypot(x - v[0], y - v[1]);
        if (dd < tolC && (!bestC || dd < bestC.d)) bestC = { d: dd, x, y, kind: "center" };
      } else {                   // 鏡映系
        const th = Math.atan2(c, a) / 2;                 // 軸の向き（L=[[cos2θ,sin2θ],[sin2θ,−cos2θ]]）
        const ux = Math.cos(th), uy = Math.sin(th);
        if (Math.abs(e * ux + f * uy) > 1e-6) continue;  // 軸方向の並進あり＝映進
        const px = (e - (e * ux + f * uy) * ux) / 2, py = (f - (e * ux + f * uy) * uy) / 2;   // 軸上の一点
        const t = (v[0] - px) * ux + (v[1] - py) * uy;
        const qx = px + ux * t, qy = py + uy * t;
        const dd = Math.hypot(qx - v[0], qy - v[1]);
        if (dd < tolX && (!bestX || dd < bestX.d)) bestX = { d: dd, x: qx, y: qy, kind: "axis", dir: [ux, uy] };
      }
    }
    return { center: bestC, axis: bestX };
  }

  // 吸着（pen/図形/axisのみ）。優先順: オブジェクトのアンカー > 中点 > 輪郭 > ガイド（grid=交点 / circle=リング×15°）
  function snapPoint(p) {
    if (!snapOn) return p;
    const rings = ringsOf(Store.items), I = [Geom.identity()], v = [p[0], p[1]];
    const hit = pickSnap({ ...snapSearch(v, rings, I, null, 7), ...crossSnap(v, rings, I, 7) });
    if (hit) return [hit.x, hit.y, p[2]];
    return guideSnap(p);
  }
  // ガイド（格子の交点 / 同心円×15°）への吸着。オブジェクトに吸かなかったときのフォールバック
  function guideSnap(p) {
    if (guide === "off") return p;
    if (guide === "grid") {
      const step = PAD_W / 16;   // gridガイド(render.js drawGuides)の16分割と一致
      return [Math.round(p[0] / step) * step, Math.round(p[1] / step) * step, p[2]];
    }
    const c = PAD_W / 2;
    const acx = axis ? axis[0] : c, acy = axis ? axis[1] : c;
    const dx = p[0] - acx, dy = p[1] - acy;
    const r = Math.hypot(dx, dy);
    let best = 0;
    for (const rr of [0, c * 0.25, c * 0.5, c * 0.75, c * 0.98])
      if (Math.abs(rr - r) < Math.abs(best - r)) best = rr;
    if (best === 0) return [acx, acy, p[2]];
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
    return [acx + best * Math.cos(a), acy + best * Math.sin(a), p[2]];
  }

  /* ==== moveツール: 選択と変換（変換は座標に焼き込む=SVG書き出しは無改修で正確なまま）
     複数選択: shift+クリック=追加/除外・空所ドラッグ=マーキー（スマホの複数選択もこれ） ==== */
  let selIdxs = [];                // 選択中itemのindex列（空=なし）
  let previewMat = null, previewItems = null, previewScheduled = false;
  let dragSel = null;              // 移動ドラッグの開始点
  /* パッド直接編集（ダイレクト選択・イラレのA相当をパッド上でも）: 単一pathのアンカーを掴んで動かす。
     編集モード(展開ビュー)と違い、パッド座標=item座標なので写像は恒等。真実はパッドのitem。 */
  let padEdit = null;              // {idx} 編集中のpath item（null=通常のmove）
  let padSel = null;               // {pt, ring} 選択中アンカー
  let padDrag = null;              // {pt, ring} ドラッグ中アンカー
  let padPreview = null;           // ドラッグ中のpatched item（未確定）
  let padSnapHit = null;           // 吸着マーカー（画面のみ）
  let dupDrag = false;             // option(alt)+ドラッグ=複製ドラッグ（原本は残し複製が動く）
  let marquee = null;              // {x0,y0,x1,y1,add} 範囲選択ドラッグ
  let smartLines = [];             // スマートガイドの整列線 [{axis,v,a,b}]（画面のみ・書き出し不混入）
  let nudgeAcc = null, nudgeTimer = null;   // 矢印キーのコアレス（連打を1 undoに）

  const xformPts = (pts, m) => pts.map(p => {
    const [x, y] = Geom.apply(m, p[0], p[1]);
    return p.length > 2 ? [x, y, p[2]] : [x, y];
  });
  const isAxisAligned = m => Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[0] - m[3]) < 1e-9 && m[0] > 0;

  // itemを再構成する関数はスタイル欄を必ず運ぶ（落とすとpaper塗り等が消える）
  const STYLE_KEYS = ["fill", "stroke", "sw", "alpha", "r"];
  const carryStyle = it => { const o = {}; for (const k of STYLE_KEYS) if (it[k] !== undefined) o[k] = it[k]; return o; };

  // 回転で箱表現を失う図形はpathへ変換（スタイル・閉じを保持）
  function shapeToPath(item) {
    const { x0, y0, x1, y1 } = item;
    const pts = [];
    if (item.shape === "rect") {
      const xa = Math.min(x0, x1), ya = Math.min(y0, y1), xb = Math.max(x0, x1), yb = Math.max(y0, y1);
      pts.push([xa, ya], [xb, ya], [xb, yb], [xa, yb]);
    } else if (item.shape === "polygon") {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const r = Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2;
      const n = Math.max(3, Math.min(12, item.sides || 6));
      for (let k = 0; k < n; k++) {
        const a = -Math.PI / 2 + 2 * Math.PI * k / n;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    } else if (item.shape === "ellipse") {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
      for (let k = 0; k < 48; k++) {
        const a = 2 * Math.PI * k / 48;
        pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
      }
    } else return item;
    return { kind: "shape", shape: "path", points: pts, closed: true, ...carryStyle(item) };
  }

  /* 円/楕円 → 8アンカーの曲線パス（アンカー編集の materialize 用）。
     48点の折れ線化(shapeToPath)と違い「掴んで動かせる密度」にする。
     centripetal CRの45°弧はハンドル長が理論値の3.8%短いだけ＝半径の0.1%未満のズレ（見た目は同じ円） */
  function ellipseToCurve(item) {
    const cx = (item.x0 + item.x1) / 2, cy = (item.y0 + item.y1) / 2;
    const rx = Math.abs(item.x1 - item.x0) / 2, ry = Math.abs(item.y1 - item.y0) / 2;
    const pts = [];
    for (let k = 0; k < 8; k++) {
      const a = 2 * Math.PI * k / 8;
      pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return { kind: "shape", shape: "path", points: pts, closed: true, curve: true, corners: [], ...carryStyle(item) };
  }

  // itemにアフィン変換を適用した新itemを返す（元は不変）。スケール時は角Rも等倍する
  function transformItem(item, m) {
    const s = Math.sqrt(Math.abs(Geom.det2(m)));   // 等方スケール成分（等長変換なら1）
    const rScaled = it => (it.r > 0 && Math.abs(s - 1) > 1e-9) ? { ...it, r: it.r * s } : it;
    if (item.kind === "stroke") return { ...item, raw: xformPts(item.raw, m) };
    if (item.kind !== "shape") return item;
    if (item.shape === "path") return rScaled({
      ...item,
      points: xformPts(item.points, m),
      ...(item.holes ? { holes: item.holes.map(ring => xformPts(ring, m)) } : {}),   // 穴も一緒に動かす
    });
    if (item.shape === "line") {
      const [ax, ay] = Geom.apply(m, item.x0, item.y0), [bx, by] = Geom.apply(m, item.x1, item.y1);
      return { ...item, x0: ax, y0: ay, x1: bx, y1: by };
    }
    if (isAxisAligned(m)) {   // 平行移動+等方スケール → 箱のまま（rect/circle/polyがnativeで残る）
      const [ax, ay] = Geom.apply(m, item.x0, item.y0), [bx, by] = Geom.apply(m, item.x1, item.y1);
      return rScaled({ ...item, x0: ax, y0: ay, x1: bx, y1: by });
    }
    // 正円は回転しても正円（中心を回して箱を再構成）
    if (item.shape === "ellipse" && Math.abs(Math.abs(item.x1 - item.x0) - Math.abs(item.y1 - item.y0)) < 1e-6) {
      const cx = (item.x0 + item.x1) / 2, cy = (item.y0 + item.y1) / 2;
      const [ncx, ncy] = Geom.apply(m, cx, cy);
      const r = Math.abs(item.x1 - item.x0) / 2;
      return rScaled({ ...item, x0: ncx - r, y0: ncy - r, x1: ncx + r, y1: ncy + r });
    }
    return transformItem(shapeToPath(item), m);   // 回転はpath化してから
  }

  const selItems = () => selIdxs.map(i => Store.items[i]).filter(Boolean);

  /* ---- 変形ハンドル（イラレ式）----
     角=拡大縮小（shift=等比・辺=一方向）・角の少し外側=回転（shift=15°吸着） */
  let handleDrag = null;   // {mode:"scale", anchor, h0, axis} | {mode:"rotate", center, a0}
  const HANDLES = [
    { u: 0, v: 0 }, { u: 0.5, v: 0, axis: "y" }, { u: 1, v: 0 },
    { u: 0, v: 0.5, axis: "x" }, { u: 1, v: 0.5, axis: "x" },
    { u: 0, v: 1 }, { u: 0.5, v: 1, axis: "y" }, { u: 1, v: 1 },
  ];
  const hPos = (b, h) => [b.x0 + (b.x1 - b.x0) * h.u, b.y0 + (b.y1 - b.y0) * h.v];
  function handleAt(p, forTouch) {
    if (!selIdxs.length) return null;
    const b = selUnionBBox(); if (!b) return null;
    const tol = forTouch ? 12 : 7;
    for (const h of HANDLES) {
      const [hx, hy] = hPos(b, h);
      if (Math.hypot(p[0] - hx, p[1] - hy) <= tol)
        return { mode: "scale", h, pos: [hx, hy], anchor: hPos(b, { u: 1 - h.u, v: 1 - h.v }), bbox: b };
    }
    // 回転ゾーン: bboxの外側・角の近く（イラレ/Figmaと同じ操作感）
    const out = p[0] < b.x0 - 1 || p[0] > b.x1 + 1 || p[1] < b.y0 - 1 || p[1] > b.y1 + 1;
    if (out) for (const h of HANDLES) {
      if (h.axis) continue;
      const [hx, hy] = hPos(b, h);
      if (Math.hypot(p[0] - hx, p[1] - hy) <= (forTouch ? 26 : 22)) return { mode: "rotate", bbox: b };
    }
    return null;
  }

  // 選択枠（各itemのbbox）+ 全体bbox・変形ハンドル + マーキー矩形。プレビュー中はプレビュー側を描く
  function drawSelOverlay() {
    pctx.setTransform(padScale, 0, 0, padScale, 0, 0);
    for (const g of smartLines) {   // スマートガイドの整列線（画面のみ・書き出し不混入）
      pctx.strokeStyle = "rgba(0,68,204,.55)";
      pctx.lineWidth = 1;
      pctx.setLineDash([2, 2]);
      pctx.beginPath();
      if (g.axis === "x") { pctx.moveTo(g.v, g.a - 8); pctx.lineTo(g.v, g.b + 8); }
      else { pctx.moveTo(g.a - 8, g.v); pctx.lineTo(g.b + 8, g.v); }
      pctx.stroke();
      pctx.setLineDash([]);
    }
    pctx.strokeStyle = "rgba(0,68,204,.35)";
    pctx.lineWidth = 1;
    let u = null;
    for (const it of (previewItems || selItems())) {
      const b = Render.itemBBox(it); if (!b) continue;
      pctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      if (!u) u = { ...b };
      else {
        u.x0 = Math.min(u.x0, b.x0); u.y0 = Math.min(u.y0, b.y0);
        u.x1 = Math.max(u.x1, b.x1); u.y1 = Math.max(u.y1, b.y1);
      }
    }
    if (u && !marquee) {
      pctx.strokeStyle = "rgba(0,68,204,.6)";
      pctx.strokeRect(u.x0, u.y0, u.x1 - u.x0, u.y1 - u.y0);
      for (const h of HANDLES) {   // 8つのハンドル（白地+ネイビー枠の小さな正方形）
        const [hx, hy] = hPos(u, h);
        pctx.fillStyle = "#fff";
        pctx.fillRect(hx - 2.5, hy - 2.5, 5, 5);
        pctx.strokeRect(hx - 2.5, hy - 2.5, 5, 5);
      }
    }
    if (marquee) {
      pctx.setLineDash([4, 3]);
      pctx.strokeStyle = "rgba(0,68,204,.5)";
      pctx.strokeRect(Math.min(marquee.x0, marquee.x1), Math.min(marquee.y0, marquee.y1),
        Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
      pctx.setLineDash([]);
    }
  }

  /* 「選択」パネルの出し入れと件数表示。**左右どちらの選択でも同じUIが出る**ように
     targetIdxs() を見る（展開ビューで選んだのに34個の操作へ到達できない、を作らない） */
  function syncSelUI() {
    const t = targetIdxs();
    document.body.classList.toggle("editing", t.length > 0);
    $("selCount").textContent = t.length > 1 ? `${t.length}個` : "";
    $("objStill").classList.toggle("on",
      t.length > 0 && t.every(i => Store.items[i] && Store.items[i].still));
    updateStyleUI();
  }
  function setSel(idxs) {
    selIdxs = [...new Set(idxs)].filter(i => i >= 0 && i < Store.items.length).sort((a, b) => a - b);
    syncSelUI();
    if (motif) renderPad();
  }

  /* ==== パッド直接編集（ダイレクト選択）====
     move中に item をダブルクリックで入る。図形/手描き/線は掴んだ瞬間 path 化して1コミット。
     以後そのpathのアンカーを掴んで動かせる（＝編集モードのパッド版・写像は恒等）。Escで抜ける。 */
  function enterPadEdit(hit) {
    const it = Store.items[hit];
    const p = toPathItem(it);
    if (!p) { alertHint("直接編集できるのは線・パス・図形です（画像は不可）"); return false; }
    if (p !== it) Store.replaceAt(hit, p);   // path化を1コミット（onChangeで再描画）
    padEdit = { idx: hit };
    padSel = null; padDrag = null;
    setSel([hit]);
    alertHint("直接編集: アンカーをドラッグ / 線上をダブルクリック=追加 / アンカーをダブルクリック=角⇄スムース / delete=削除 / Esc=解除");
    renderPad();
    return true;
  }
  function exitPadEdit() {
    if (!padEdit) return;
    padEdit = null; padSel = null; padDrag = null; padSnapHit = null;
    renderPad();
  }
  // 編集中itemのアンカー一覧（パッド座標）。curveの角=四角/スムース=丸
  function padAnchors() {
    if (!padEdit) return [];
    const it = padPreview || Store.items[padEdit.idx];
    if (!it || it.kind !== "shape" || it.shape !== "path") return [];
    const cs = it.curve ? new Set(it.corners || []) : null;
    const out = it.points.map((p, pi) => ({ ring: -1, pt: pi, x: p[0], y: p[1], smooth: !!(cs && !cs.has(pi)) }));
    (it.holes || []).forEach((rg, ri) => rg.forEach((p, pi) => out.push({ ring: ri, pt: pi, x: p[0], y: p[1], smooth: false })));
    return out;
  }
  // 直接編集のアンカー描画（padScale座標系で。白地+ネイビー枠・選択は塗り）
  function drawPadAnchors() {
    const anchors = padAnchors();
    if (!anchors.length) return;
    pctx.setTransform(padScale, 0, 0, padScale, 0, 0);
    pctx.lineWidth = 1 / padScale;
    const r = 3 / padScale;
    for (const a of anchors) {
      const on = padSel && padSel.ring === a.ring && padSel.pt === a.pt;
      pctx.fillStyle = on ? "#0044cc" : "#fff";
      pctx.strokeStyle = "#0044cc";
      if (a.smooth) {
        pctx.beginPath(); pctx.arc(a.x, a.y, r, 0, 2 * Math.PI); pctx.fill(); pctx.stroke();
      } else {
        pctx.fillRect(a.x - r, a.y - r, r * 2, r * 2);
        pctx.strokeRect(a.x - r, a.y - r, r * 2, r * 2);
      }
    }
    if (padSnapHit) drawSnapMark(pctx, padSnapHit, 1 / padScale);
  }
  // カーソル近傍のアンカー（tolは論理px）
  function padAnchorAt(p, tol) {
    let best = null, bd = tol;
    for (const a of padAnchors()) {
      const d = Math.hypot(a.x - p[0], a.y - p[1]);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  // 選択全体のbbox（回転/拡大の中心・複数整列の基準）
  function selUnionBBox() {
    let u = null;
    for (const it of selItems()) {
      const b = Render.itemBBox(it); if (!b) continue;
      if (!u) u = { ...b };
      else {
        u.x0 = Math.min(u.x0, b.x0); u.y0 = Math.min(u.y0, b.y0);
        u.x1 = Math.max(u.x1, b.x1); u.y1 = Math.max(u.y1, b.y1);
      }
    }
    return u;
  }

  /* ==== スマートガイド（moveツールの移動ドラッグ・吸着ONのとき）====
     選択bboxの「端と中心」を、他itemのbbox・パッドの端/中心・回転中心(axis)に揃える。
     x/yは独立に判定（片方だけ揃うのが普通）。shiftドラッグで一時無効。ガイド線は画面のみ。 */
  const SMART_TOL = 5;   // パッド座標のしきい値（PAD_W=280基準）

  function smartTargets() {
    const set = new Set(dupDrag ? [] : selIdxs);   // 複製ドラッグでは原本も整列先になる
    const xs = [], ys = [];
    const push = (b, from) => {
      xs.push({ v: b.x0, b, from }, { v: (b.x0 + b.x1) / 2, b, from }, { v: b.x1, b, from });
      ys.push({ v: b.y0, b, from }, { v: (b.y0 + b.y1) / 2, b, from }, { v: b.y1, b, from });
    };
    Store.items.forEach((it, i) => {
      if (set.has(i)) return;
      const b = Render.itemBBox(it);
      if (b) push(b, "item");
    });
    push({ x0: 0, y0: 0, x1: PAD_W, y1: PAD_W }, "pad");   // パッドの端と中心
    if (axis) {                                            // 回転中心
      xs.push({ v: axis[0], b: null, from: "axis" });
      ys.push({ v: axis[1], b: null, from: "axis" });
    }
    return { xs, ys };
  }
  // 移動量(dx,dy)を整列に吸わせて返す。ついでに smartLines を更新（画面表示用）
  function smartSnapMove(dx, dy) {
    smartLines = [];
    if (!snapOn) return [dx, dy];
    const b0 = selUnionBBox();
    if (!b0) return [dx, dy];
    const { xs, ys } = smartTargets();
    const fit = (moving, targets) => {
      let best = null;
      for (const m of moving) for (const t of targets) {
        const d = Math.abs(t.v - m);
        if (d < SMART_TOL && (!best || d < best.d)) best = { d, delta: t.v - m, t };
      }
      return best;
    };
    const mx = [b0.x0 + dx, (b0.x0 + b0.x1) / 2 + dx, b0.x1 + dx];
    const my = [b0.y0 + dy, (b0.y0 + b0.y1) / 2 + dy, b0.y1 + dy];
    const bx = fit(mx, xs), by = fit(my, ys);
    if (bx) dx += bx.delta;
    if (by) dy += by.delta;
    // 整列線は「揃った相手」と「動かした選択」を結ぶ範囲に引く
    const sb = { x0: b0.x0 + dx, y0: b0.y0 + dy, x1: b0.x1 + dx, y1: b0.y1 + dy };
    if (bx) smartLines.push({ axis: "x", v: bx.t.v,
      a: Math.min(sb.y0, bx.t.b ? bx.t.b.y0 : sb.y0), b: Math.max(sb.y1, bx.t.b ? bx.t.b.y1 : sb.y1) });
    if (by) smartLines.push({ axis: "y", v: by.t.v,
      a: Math.min(sb.x0, by.t.b ? by.t.b.x0 : sb.x0), b: Math.max(sb.x1, by.t.b ? by.t.b.x1 : sb.x1) });
    return [dx, dy];
  }

  // プレビュー（rAFスロットル・storeは触らない）。選択中の全itemに同じ行列を適用
  function schedulePreview() {
    if (previewScheduled) return;
    previewScheduled = true;
    nextFrame(() => {
      previewScheduled = false;
      if (!selIdxs.length || !previewMat) return;
      let patched;
      if (dupDrag) {   // 複製ドラッグ: 原本は動かさず、変換した複製を重ねてプレビュー
        previewItems = selItems().map(it => transformItem(it, previewMat));
        patched = [...Store.items, ...previewItems];
      } else {
        const set = new Set(selIdxs);
        previewItems = [];
        patched = Store.items.map((x, k) => {
          if (!set.has(k)) return x;
          const t = transformItem(x, previewMat);
          previewItems.push(t);
          return t;
        });
      }
      motif = Render.buildMotif(patched, PAD_W);
      renderPad();
      if (viewMode === "live") renderLive(motif);
    });
  }

  function commitSel(m) {
    if (!selIdxs.length || !m) return;
    previewMat = null; previewItems = null;
    Store.replaceMany(selIdxs.map(i => [i, transformItem(Store.items[i], m)]));   // 1undo・onChange→refreshで再描画
  }

  function nudgeSel(dx, dy) {
    if (!selItems().length) return;
    if (!nudgeAcc) nudgeAcc = { dx: 0, dy: 0 };
    nudgeAcc.dx += dx; nudgeAcc.dy += dy;
    previewMat = Geom.translate(nudgeAcc.dx, nudgeAcc.dy);
    schedulePreview();
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(flushNudge, 500);   // 連打を1回のundoにまとめる
  }
  function flushNudge() {
    clearTimeout(nudgeTimer);
    if (nudgeAcc && selItems().length) {
      const m = Geom.translate(nudgeAcc.dx, nudgeAcc.dy);
      nudgeAcc = null;
      commitSel(m);
    }
    nudgeAcc = null; previewMat = null; previewItems = null;
  }

  // 回転/拡大（選択全体のbbox中心基準）・整列（1個=パッド基準 / 複数=選択範囲基準で互いに揃える）
  function editXform(kind, val) {
    flushNudge();
    if (!selIdxs.length) return;
    const b = selUnionBBox(); if (!b) return;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    if (kind === "rot") {
      const th = val * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
      commitSel(Geom.mul(Geom.translate(cx, cy), Geom.mul([c, sn, -sn, c, 0, 0], Geom.translate(-cx, -cy))));
    } else if (kind === "scale") {
      commitSel(Geom.mul(Geom.translate(cx, cy), Geom.mul(Geom.scaleMat(val), Geom.translate(-cx, -cy))));
    } else if (kind === "align") {
      // 基準枠: 1個ならパッド、複数なら選択全体のbbox（オブジェクト同士を揃える）
      const F = selIdxs.length > 1 ? b : { x0: 0, y0: 0, x1: PAD_W, y1: PAD_W };
      const fcx = (F.x0 + F.x1) / 2, fcy = (F.y0 + F.y1) / 2;
      const entries = [];
      for (const i of selIdxs) {
        const ib = Render.itemBBox(Store.items[i]); if (!ib) continue;
        const icx = (ib.x0 + ib.x1) / 2, icy = (ib.y0 + ib.y1) / 2;
        let dx = 0, dy = 0;
        if (val === "L") dx = F.x0 - ib.x0; else if (val === "C") dx = fcx - icx; else if (val === "R") dx = F.x1 - ib.x1;
        else if (val === "T") dy = F.y0 - ib.y0; else if (val === "M") dy = fcy - icy; else if (val === "B") dy = F.y1 - ib.y1;
        if (dx || dy) entries.push([i, transformItem(Store.items[i], Geom.translate(dx, dy))]);
      }
      if (entries.length) Store.replaceMany(entries);
    }
  }

  /* 等間隔分布: 3個以上を横/縦に等間隔で並べる。**端の2個は動かさず中間だけ**動かす
     （イラレ・Figma準拠。選択範囲そのものは変えない）。基準は中心どうしの間隔。 */
  function distributeSel(axis) {
    flushNudge();
    const boxes = selIdxs.map(i => ({ i, b: Render.itemBBox(Store.items[i]) })).filter(e => e.b);
    if (boxes.length < 3) { alertHint("等間隔 → 3個以上選んでください"); return; }
    const cen = e => axis === "h" ? (e.b.x0 + e.b.x1) / 2 : (e.b.y0 + e.b.y1) / 2;
    boxes.sort((p, q) => cen(p) - cen(q));
    const first = cen(boxes[0]), step = (cen(boxes[boxes.length - 1]) - first) / (boxes.length - 1);
    const entries = [];
    for (let k = 1; k < boxes.length - 1; k++) {
      const d = (first + step * k) - cen(boxes[k]);
      if (Math.abs(d) < 1e-6) continue;
      const m = axis === "h" ? Geom.translate(d, 0) : Geom.translate(0, d);
      entries.push([boxes[k].i, transformItem(Store.items[boxes[k].i], m)]);
    }
    if (!entries.length) { alertHint("等間隔 → すでに等間隔です"); return; }
    Store.replaceMany(entries);   // 1コミット=1undo
    alertHint(`等間隔（${axis === "h" ? "横" : "縦"}）→ 中間の${entries.length}個を動かしました`);
  }

  // 進行中(未確定)item: freehand/図形/pen。ライブ更新・preview共用（確定と同じスタイルで見せる）
  function liveItem() {
    if (shapeDrag) return { kind: "shape", shape: tool, ...shapeDrag, sides, ...newSty() };
    if (tool === "pen" && (penPts.length || downPt)) {
      const pts = [...penPts], sm = [...penSmooth];
      if (downPt && hoverPt) {
        // ドラッグ中（ダウン位置から閾値を超えて動いた）＝いま置いているアンカーはスムース点。
        // カーソル位置も仮点として足す（コミットはしない）ことで、曲線がドラッグに追従して見える
        const dragging = Math.hypot(hoverPt[0] - downPt[0], hoverPt[1] - downPt[1]) > TAP_TOL;
        if (dragging) { pts.push([downPt[0], downPt[1]]); sm.push(true); }
        pts.push([hoverPt[0], hoverPt[1]]); sm.push(false);
      }
      if (pts.length >= 2) {
        const item = { kind: "shape", shape: "path", points: pts, closed: false, ...newSty() };
        if (sm.some(Boolean)) {   // 角のままなら curve は付けない（従来と同一出力）
          item.curve = true;
          item.corners = sm.reduce((a, s, i) => { if (!s) a.push(i); return a; }, []);
        }
        return item;
      }
      return null;
    }
    if (raw && raw.length >= 2) return { kind: "stroke", raw, sw: defSty.sw, alpha: defSty.alpha };
    return null;
  }

  // 描画中：進行中itemを含めてライブパネルをrAFスロットルで更新
  // タブ非表示時はrAFが止まるのでsetTimeoutにフォールバック（queueSwatchesと同方針）
  const nextFrame = fn => document.hidden ? setTimeout(fn, 16) : requestAnimationFrame(fn);
  let liveScheduled = false;
  function scheduleLive() {
    if (viewMode !== "live" || liveScheduled) return;
    liveScheduled = true;
    nextFrame(() => {
      liveScheduled = false;
      renderLive(Render.buildMotif(Store.items, PAD_W, liveItem()));
    });
  }

  // 図形ドラッグの終点（shift拘束: 正方/正円/45°）
  function shapeEnd(e) {
    const p = snapPoint(pos(e));
    let x1 = p[0], y1 = p[1];
    if (e.shiftKey) {
      const dx = x1 - shapeDrag.x0, dy = y1 - shapeDrag.y0;
      if (tool === "line") {   // 45°スナップ
        const L = Math.hypot(dx, dy), a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        x1 = shapeDrag.x0 + L * Math.cos(a); y1 = shapeDrag.y0 + L * Math.sin(a);
      } else {                 // 正方形/正円/正多角形の外接正方
        const s = Math.max(Math.abs(dx), Math.abs(dy));
        x1 = shapeDrag.x0 + Math.sign(dx || 1) * s; y1 = shapeDrag.y0 + Math.sign(dy || 1) * s;
      }
    }
    return [x1, y1];
  }

  /* ---- ペン ---- */
  function penReset() { penPts = []; penSmooth = []; hoverPt = null; document.body.classList.remove("penning"); renderPad(); scheduleLive(); }
  function penCommit(closed) {
    if (penPts.length >= (closed ? 3 : 2)) {
      const item = { kind: "shape", shape: "path", points: penPts, closed, ...newSty() };   // 開いた線はstyleOfが塗りを外す
      if (penSmooth.some(Boolean)) {   // 全点が角のままなら従来どおりcurveを付けない（後方互換）
        item.curve = true;
        item.corners = penSmooth.reduce((a, s, i) => { if (!s) a.push(i); return a; }, []);
      }
      Store.add(item);
    }
    penReset();
  }
  // アンカーを1点確定する。smooth=false=角（クリック） / true=スムース（ドラッグ。イラレ準拠でアンカーはダウン位置に固定）
  function penPlace(p, smooth) {
    if (penPts.length && Math.hypot(p[0] - penPts[0][0], p[1] - penPts[0][1]) < CLOSE_TOL) { penCommit(true); return; }
    penPts.push([p[0], p[1]]);
    penSmooth.push(smooth);
    hoverPt = null;   // 確定直後は下書き/ドラッグの仮点を残さない（次のpointermoveで張り直す）
    document.body.classList.add("penning");
    Render.previewShape(pctx, PAD_W, motif, padScale, guide, liveItem(), axis);
    scheduleLive();
  }
  function penTap(p) { penPlace(p, false); }   // クリック＝角の点(従来どおり)

  pad.addEventListener("pointerdown", e => {
    if (padLocked) { alertHint("造形はロック中です（「描く > 造形 > ロック」で解除）"); return; }
    if (activePointer !== null) return;   // 既に描画中なら2本目/手のひらは無視
    activePointer = e.pointerId;
    try { pad.setPointerCapture(e.pointerId); } catch (_) { /* 稀に無効なpointerIdで投げる */ }
    const p = pos(e);
    downPt = p;
    const tol = e.pointerType === "touch" ? 16 : 10;
    if (padEdit && isAnchorTool(tool)) {   // 直接編集: アンカーを掴む
      const a = padAnchorAt(p, tol);
      if (a) {
        padSel = { ring: a.ring, pt: a.pt };
        padDrag = { ring: a.ring, pt: a.pt };
        renderPad();
        e.preventDefault();
        return;
      }
      exitPadEdit();   // 空所や他itemをクリック → いったん抜ける（下でツールごとの処理へ）
    }
    if (tool === "form") {   // シェイプ形成（モチーフ側・なぞって集め、離したときに1操作で確定）
      e.preventDefault();
      padForm = { alt: e.altKey, seen: new Set() };
      const f = padFaces().find(x => faceHas(x, p));
      if (f) padForm.seen.add(f);
      padHoverFaces = [...padForm.seen];
      renderPad();
      return;
    }
    /* アンカー選択ツール（A・イラレのダイレクト選択）: クリックした形にそのまま入る。
       moveのダブルクリックと違い、1クリックでアンカーが出る */
    if (tool === "anchor") {
      const hit = Render.itemAt(pctx, Store.items, p[0], p[1], PAD_W);
      if (hit < 0) { setSel([]); renderPad(); return; }
      if (Store.items[hit].kind === "image") { alertHint("画像にアンカーはありません"); return; }
      if (!enterPadEdit(hit)) return;
      const a = padAnchorAt(p, tol);   // 掴んだ場所にアンカーがあればそのままドラッグへ
      if (a) { padSel = { ring: a.ring, pt: a.pt }; padDrag = { ring: a.ring, pt: a.pt }; }
      renderPad();
      e.preventDefault();
      return;
    }
    if (tool === "move") {
      flushNudge();
      // 変形ハンドルが最優先（shift+角=等比スケールなので shift でも拾う）
      const hd = handleAt(p, e.pointerType === "touch");
      if (hd) {
        if (hd.mode === "scale") handleDrag = { mode: "scale", anchor: hd.anchor, h0: hd.pos, axis: hd.h.axis || null };
        else {
          const b = hd.bbox, c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
          handleDrag = { mode: "rotate", center: c, a0: Math.atan2(p[1] - c[1], p[0] - c[0]) };
        }
        e.preventDefault();
        return;
      }
      const hit = Render.itemAt(pctx, Store.items, p[0], p[1], PAD_W);
      if (hit >= 0 && Store.items[hit].kind === "image") { alertHint("画像は移動できません（v1）"); setSel([]); }
      else if (hit >= 0) {
        if (e.shiftKey) {   // shift+クリック=追加/除外（ドラッグ移動はしない）
          setSel(selIdxs.includes(hit) ? selIdxs.filter(i => i !== hit) : [...selIdxs, hit]);
        } else {
          if (!selIdxs.includes(hit)) setSel([hit]);   // 選択済みを掴んだら選択保持のまま移動へ
          dupDrag = e.altKey;   // option+ドラッグ=複製ドラッグ
          dragSel = p;
        }
      } else {
        // 空所 → マーキー（範囲選択）。shiftなら既存選択に追加
        if (!e.shiftKey) setSel([]);
        marquee = { x0: p[0], y0: p[1], x1: p[0], y1: p[1], add: e.shiftKey };
      }
    }
    else if (tool === "freehand") { raw = [p]; lastPt = p; }
    else if (BOX_TOOLS.includes(tool)) {
      const sp = snapPoint(p);
      shapeDrag = { x0: sp[0], y0: sp[1], x1: sp[0], y1: sp[1] };
    }
    // pen/erase は pointerup（タップ）で確定
    e.preventDefault();
  });
  // 直接編集のアンカーを新座標へ動かした item（元は不変）
  function padMoved(np) {
    const it = Store.items[padEdit.idx];
    if (padDrag.ring < 0) return { ...it, points: it.points.map((p, i) => i === padDrag.pt ? [np[0], np[1]] : p) };
    return { ...it, holes: it.holes.map((rg, ri) => ri !== padDrag.ring ? rg
      : rg.map((p, i) => i === padDrag.pt ? [np[0], np[1]] : p)) };
  }
  /* 形成ツールのホバー（ボタンを押していなくても効かせたいので独立したリスナーにする）。
     なぞり中はここで面を集める＝pointerId のアクティブ判定に依存しない */
  pad.addEventListener("pointermove", e => {
    if (tool !== "form" || padLocked) return;
    const q = pos(e);
    const f = padFaces().find(x => faceHas(x, q)) || null;
    if (padForm) {
      if (f && !padForm.seen.has(f)) { padForm.seen.add(f); padHoverFaces = [...padForm.seen]; renderPad(); }
      return;
    }
    if (padHoverFaces[0] !== f) { padHoverFaces = f ? [f] : []; renderPad(); }
  });
  pad.addEventListener("pointerleave", () => {
    if (tool === "form" && !padForm && padHoverFaces.length) { padHoverFaces = []; renderPad(); }
  });

  pad.addEventListener("pointermove", e => {
    if (e.pointerId !== activePointer) return;   // アクティブなポインタ以外は無視
    if (padDrag) {   // 直接編集: アンカーのドラッグ（吸着つき・恒等写像）
      let np = pos(e);
      padSnapHit = null;
      if (snapOn) {
        const rings = ringsOf(Store.items), I = [Geom.identity()], v = [np[0], np[1]];
        const hit = pickSnap({
          ...snapSearch(v, rings, I, { idx: padEdit.idx, ring: padSel.ring, pt: padSel.pt }, 8),
          ...crossSnap(v, rings, I, 8),
        });
        if (hit) { padSnapHit = hit; np = [hit.x, hit.y]; }
        else { const g = guideSnap([np[0], np[1]]); np = [g[0], g[1]]; }
      }
      padPreview = padMoved(np);
      motif = Render.buildMotif(Store.items.map((x, k) => k === padEdit.idx ? padPreview : x), PAD_W);
      renderPad();
      if (viewMode === "live") renderLive(motif);
      return;
    }
    if (tool === "freehand") {
      if (!raw) return;
      // 合成イベント(untrusted)ではgetCoalescedEventsが空配列を返すのでフォールバック
      const co = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const evs = co.length ? co : [e];
      if (defSty.alpha < 1) {
        // 半透明は増分セグメントの継ぎ目が二重合成で濃くなる（ビーズ状）→ 全体を1パスで描き直す
        for (const ev of evs) { const q = pos(ev); raw.push(q); lastPt = q; }
        Render.previewShape(pctx, PAD_W, motif, padScale, guide, liveItem(), axis);
      } else {
        pctx.setTransform(padScale, 0, 0, padScale, 0, 0);
        pctx.strokeStyle = Render.colors().ink;
        pctx.lineWidth = defSty.sw;          // 増分描画も確定と同じ太さで（プレビュー等価）
        pctx.lineCap = "round";
        for (const ev of evs) {
          const q = pos(ev);
          raw.push(q);
          pctx.beginPath();
          pctx.moveTo(lastPt[0], lastPt[1]);
          pctx.lineTo(q[0], q[1]);
          pctx.stroke();
          lastPt = q;
        }
      }
    } else if (BOX_TOOLS.includes(tool)) {
      if (!shapeDrag) return;
      [shapeDrag.x1, shapeDrag.y1] = shapeEnd(e);
      Render.previewShape(pctx, PAD_W, motif, padScale, guide, liveItem(), axis);
    } else if (tool === "move") {
      const q = pos(e);
      if (handleDrag) {   // 変形ハンドルのドラッグ（イラレ式）
        if (handleDrag.mode === "scale") {
          const [ax, ay] = handleDrag.anchor, [hx, hy] = handleDrag.h0;
          let sx = handleDrag.axis === "y" || Math.abs(hx - ax) < 1e-6 ? 1 : (q[0] - ax) / (hx - ax);
          let sy = handleDrag.axis === "x" || Math.abs(hy - ay) < 1e-6 ? 1 : (q[1] - ay) / (hy - ay);
          if (e.shiftKey && !handleDrag.axis) {   // shift=等比（ハンドル方向への射影）
            const dx = hx - ax, dy = hy - ay;
            sx = sy = ((q[0] - ax) * dx + (q[1] - ay) * dy) / (dx * dx + dy * dy);
          }
          const cl = v => Math.abs(v) < 0.02 ? (v < 0 ? -0.02 : 0.02) : v;   // 0倍で潰さない（負=反転は許す）
          previewMat = Geom.mul(Geom.translate(ax, ay), Geom.mul([cl(sx), 0, 0, cl(sy), 0, 0], Geom.translate(-ax, -ay)));
        } else {
          const c = handleDrag.center;
          let th = Math.atan2(q[1] - c[1], q[0] - c[0]) - handleDrag.a0;
          if (e.shiftKey) th = Math.round(th / (Math.PI / 12)) * (Math.PI / 12);   // shift=15°吸着
          const co = Math.cos(th), sn = Math.sin(th);
          previewMat = Geom.mul(Geom.translate(c[0], c[1]), Geom.mul([co, sn, -sn, co, 0, 0], Geom.translate(-c[0], -c[1])));
        }
        schedulePreview();
        return;
      }
      if (marquee) {
        marquee.x1 = q[0]; marquee.y1 = q[1];
        renderPad();   // マーキー矩形を重ねて描く
        return;
      }
      if (!dragSel || !selIdxs.length) return;
      // スマートガイド: 吸着ONなら整列に吸わせる（shift押しで一時無効）
      const [mdx, mdy] = e.shiftKey ? [q[0] - dragSel[0], q[1] - dragSel[1]]
        : smartSnapMove(q[0] - dragSel[0], q[1] - dragSel[1]);
      previewMat = Geom.translate(mdx, mdy);
      schedulePreview();
      return;   // scheduleLiveはpreview側で行う
    } else if (tool === "pen") {
      // ダウン位置から閾値を超えて動いたら「ドラッグ＝スムース点」。penPts.length===0(最初のアンカー)でも同様に反応する
      hoverPt = snapPoint(pos(e));   // 次アンカーまでの下書き線 / ドラッグ中は仮の追従点（スナップ込み）
      Render.previewShape(pctx, PAD_W, motif, padScale, guide, liveItem(), axis);
    } else return;
    scheduleLive();
  });
  function finishDraw(e) {
    if (e && e.pointerId !== activePointer) return;   // アクティブなポインタのup/cancelのみ処理
    if (tool === "form") { padFormUp(); activePointer = null; downPt = null; return; }
    if (padDrag) {   // 直接編集: アンカー移動を確定（1コミット=1undo）
      if (padPreview) Store.replaceAt(padEdit.idx, padPreview);
      padDrag = null; padPreview = null; padSnapHit = null;
      activePointer = null; downPt = null;
      return;
    }
    if (tool === "freehand") {
      if (raw) {
        if (raw.length === 1) raw.push([raw[0][0] + 0.1, raw[0][1], raw[0][2] + 8]);  // タップ=点
        Store.add({ kind: "stroke", raw, sw: defSty.sw, alpha: defSty.alpha });
      }
      raw = null; lastPt = null;
    } else if (BOX_TOOLS.includes(tool)) {
      if (shapeDrag) {
        const item = liveItem();
        shapeDrag = null;
        // 実際に描画される幾何を持つときだけ確定（幅0で不可視の幽霊アイテムを防ぐ）
        if (item && Render.itemHasGeometry(item)) Store.add(item);
        else renderPad();   // 破棄しpreviewを消す
      }
    } else if (tool === "move") {
      if (handleDrag) {   // 変形ハンドルの確定（1コミット=1undo）
        if (previewMat) commitSel(previewMat);
        handleDrag = null;
      } else if (marquee) {
        // マーキー内のitemを選択（bboxが交差するもの。画像は対象外）
        const R = { x0: Math.min(marquee.x0, marquee.x1), y0: Math.min(marquee.y0, marquee.y1),
                    x1: Math.max(marquee.x0, marquee.x1), y1: Math.max(marquee.y0, marquee.y1) };
        const picked = [];
        if (R.x1 - R.x0 > 3 || R.y1 - R.y0 > 3) {   // タップ（微小矩形）は選択解除のみ
          Store.items.forEach((it, i) => {
            const b = Render.itemBBox(it);
            if (b && b.x0 <= R.x1 && b.x1 >= R.x0 && b.y0 <= R.y1 && b.y1 >= R.y0) picked.push(i);
          });
        }
        const keep = marquee.add ? selIdxs : [];
        marquee = null;
        setSel([...keep, ...picked]);
      } else if (dupDrag && dragSel && previewMat) {
        // 複製ドラッグ確定: 原本を残し、ずらした複製を追加して複製側を選択（1undo）
        const copies = selItems().map(it => transformItem(it, previewMat));
        const base = Store.items.length;
        Store.addMany(copies);
        setSel(copies.map((_, k) => base + k));
      } else if (dragSel && previewMat) commitSel(previewMat);
      dragSel = null; dupDrag = false; previewMat = null; previewItems = null;
      smartLines = [];
    } else if (tool === "axis") {
      const p = e ? pos(e) : downPt;
      if (downPt && p && Math.hypot(p[0] - downPt[0], p[1] - downPt[1]) <= TAP_TOL) setAxis(snapPoint(p));
    } else if (tool === "pen" || tool === "erase") {
      const p = e ? pos(e) : downPt;
      if (downPt && p && Math.hypot(p[0] - downPt[0], p[1] - downPt[1]) <= TAP_TOL) {
        if (tool === "pen") penTap(snapPoint(p));   // クリック＝角の点
        else { const i = Render.itemAt(pctx, Store.items, p[0], p[1], PAD_W); if (i >= 0) Store.removeAt(i); }
      } else if (tool === "pen") {
        // ドラッグ＝スムース点。アンカーはダウン位置に固定（イラレ準拠。上のpointermoveのプレビューと一致させる）
        if (downPt) penPlace(snapPoint(downPt), true);
        else renderPad();
      }
    }
    downPt = null;
    activePointer = null;
  }
  pad.addEventListener("pointerup", finishDraw);
  pad.addEventListener("pointercancel", finishDraw);
  pad.addEventListener("lostpointercapture", finishDraw);

  /* 直接編集の角⇄スムース切替 / アンカー追加（パッド版。編集モードのeditCv版と同じ規則） */
  function padToggleSmooth(a) {
    if (a.ring >= 0) { alertHint("穴のアンカーは角のみ"); return; }
    const it = Store.items[padEdit.idx];
    let next;
    if (!it.curve) next = { ...it, curve: true, corners: it.points.map((_, i) => i).filter(i => i !== a.pt) };
    else {
      const set = new Set(it.corners || []);
      set.has(a.pt) ? set.delete(a.pt) : set.add(a.pt);
      const corners = [...set].sort((x, y) => x - y);
      if (corners.length === it.points.length) { const { curve, corners: _c, ...rest } = it; next = rest; }
      else next = { ...it, curve: true, corners };
    }
    Store.replaceAt(padEdit.idx, next);
    padSel = { ring: a.ring, pt: a.pt };
    const smooth = next.curve && !(next.corners || []).includes(a.pt);
    alertHint(smooth ? "スムース点に（もう一度で角に戻る）" : "角に戻しました");
  }
  function padAddAnchorAt(p) {
    const it = Store.items[padEdit.idx];
    const rings = [{ ring: -1, pts: it.points, closed: !!it.closed },
      ...(it.holes || []).map((rg, ri) => ({ ring: ri, pts: rg, closed: true }))];
    let best = null, bd = 8;
    for (const rg of rings) {
      const n = rg.pts.length, nseg = rg.closed ? n : n - 1;
      for (let i = 0; i < nseg; i++) {
        const a = rg.pts[i], b = rg.pts[(i + 1) % n];
        const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        if (L2 < 1e-9) continue;
        const t = Math.max(0.05, Math.min(0.95, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
        const px = a[0] + dx * t, py = a[1] + dy * t;
        const d = Math.hypot(px - p[0], py - p[1]);
        if (d < bd) { bd = d; best = { ring: rg.ring, at: i + 1, px, py }; }
      }
    }
    if (!best) return false;
    let next;
    if (best.ring < 0) {
      next = { ...it, points: [...it.points.slice(0, best.at), [best.px, best.py], ...it.points.slice(best.at)] };
      if (it.curve && it.corners) next.corners = it.corners.map(c => c >= best.at ? c + 1 : c);   // 新点はスムース
    } else {
      next = { ...it, holes: it.holes.map((rg, ri) => ri !== best.ring ? rg
        : [...rg.slice(0, best.at), [best.px, best.py], ...rg.slice(best.at)]) };
    }
    Store.replaceAt(padEdit.idx, next);
    padSel = { ring: best.ring, pt: best.at };
    alertHint("アンカーを追加（ドラッグで調整・⌘Zで戻る）");
    return true;
  }
  pad.addEventListener("dblclick", e => {
    if (!isAnchorTool(tool)) return;
    e.preventDefault();
    const p = pos(e);
    if (padEdit) {
      const a = padAnchorAt(p, 10);
      if (a) { padToggleSmooth(a); return; }
      if (padAddAnchorAt(p)) return;
      return;   // 直接編集中の空ダブルクリックは無視（抜けはEsc）
    }
    // 選択ツールでのダブルクリックは「その形の中に入る」＝アンカーツールへ切り替える（イラレと同じ感覚）
    const hit = Render.itemAt(pctx, Store.items, p[0], p[1], PAD_W);
    if (hit >= 0 && Store.items[hit].kind !== "image") { setTool("anchor"); enterPadEdit(hit); }
  });

  // ハンドルのホバーカーソル（選択ツール・非ドラッグ時のみ。ゾーンごとにイラレ風の矢印）
  const ROT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><path d="M4.5 9a4.5 4.5 0 1 1 1.3 3.2" fill="none" stroke="#0044cc" stroke-width="1.6"/><path d="M3.2 8l1.5 4.4 4-1.8z" fill="#0044cc"/></svg>'
  )}") 9 9, auto`;
  pad.addEventListener("pointermove", e => {
    if (tool !== "move" || activePointer !== null) return;
    const hd = handleAt(pos(e), false);
    pad.style.cursor = !hd ? "pointer"
      : hd.mode === "rotate" ? ROT_CURSOR
      : hd.h.axis === "x" ? "ew-resize"
      : hd.h.axis === "y" ? "ns-resize"
      : (hd.h.u === hd.h.v ? "nwse-resize" : "nesw-resize");
  });

  // ペンのコントロール
  $("penClose").onclick = () => penCommit(true);
  $("penDone").onclick = () => penCommit(false);
  $("penCancel").onclick = () => penReset();

  // 編集バー（move選択中のみ表示）
  $("rotL").onclick = () => editXform("rot", -15);
  $("rotR").onclick = () => editXform("rot", 15);
  $("scDown").onclick = () => editXform("scale", 1 / 1.1);
  $("scUp").onclick = () => editXform("scale", 1.1);
  for (const k of ["L", "C", "R", "T", "M", "B"]) $("al" + k).onclick = () => editXform("align", k);
  $("disH").onclick = () => distributeSel("h");
  $("disV").onclick = () => distributeSel("v");
  // 複製: 選択を少しずらして複製し、複製側を選択（1コミット=1undo）。dupボタン/option+ドラッグ共通
  function dupSel() {
    flushNudge();
    if (!selIdxs.length) return;
    const copies = selItems().map(it => transformItem(it, Geom.translate(8, 8)));
    const base = Store.items.length;
    Store.addMany(copies);
    setSel(copies.map((_, k) => base + k));
  }
  $("objDup").onclick = dupSel;
  $("objDel").onclick = () => { flushNudge(); if (selIdxs.length) { Store.removeMany(selIdxs); setSel([]); } };
  $("objDone").onclick = () => { flushNudge(); setSel([]); };

  /* ==== オブジェクトのコピー/カット/ペースト（⌘C/⌘X/⌘V・イラレ流） ====
     システムclipboardへ自前JSON（marker付き）を書く。書けない環境用にアプリ内クリップボードも持つ。
     pasteイベントは marker付きJSON → SVGテキスト → 画像 → アプリ内 の優先順で解釈 */
  const CLIP_MARK = "symmetry-machine/clip";
  let clipItems = null;
  function copySel(cut) {
    flushNudge();
    if (!selIdxs.length) { alertHint("コピーする対象を選択してください"); return; }
    clipItems = selItems();
    const payload = JSON.stringify({ app: CLIP_MARK, v: 2, items: clipItems });
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(payload).catch(() => { /* アプリ内クリップボードが受け皿 */ });
    alertHint(`${cut ? "カット" : "コピー"} ${clipItems.length}個（⌘Vでペースト）`);
    if (cut) { Store.removeMany(selIdxs); setSel([]); }
  }
  function pasteClip(items) {
    const ok = (items || []).filter(it => it && (it.kind === "stroke" || it.kind === "shape" || it.kind === "image"));
    if (!ok.length) return false;
    const copies = ok.map(it => transformItem(it, Geom.translate(8, 8)));   // 少しずらして置く
    const base = Store.items.length;
    Store.addMany(copies);   // 1コミット=1undo
    setTool("move");
    setSel(copies.map((_, k) => base + k));
    clipItems = copies;      // 連続ペーストは階段状にずれていく
    alertHint(`ペースト ${copies.length}個`);
    return true;
  }

  // 重ね順: 選択を最前面/最背面へ（1コミット=1undo）。後ろのitemほど前面に描かれる
  function reorderSel(where) {
    flushNudge();
    if (!selIdxs.length) return;
    const ni = Store.reorder(selIdxs, where);
    if (ni) setSel(ni);
  }
  $("objFront").onclick = () => reorderSel("front");
  $("objBack").onclick = () => reorderSel("back");

  /* ==== シェイプ演算: unite=和 / minus=最背面から前面を引く（前面マイナス） ====
     対象は閉じた図形（rect/ellipse/polygon/閉pen・演算結果の再入力可）。
     手描き線・開いた線・画像は対象外（v1）。スキップ品は選択に残して見失わない。
     スタイル継承はIllustrator準拠: unite=最前面 / minus=最背面 ==== */
  const isBoolable = it => !!it && it.kind === "shape" &&
    (["rect", "ellipse", "polygon"].includes(it.shape) || (it.shape === "path" && it.closed));
  const OP_LABEL = { unite: "合体", minus: "型抜き", cross: "交差" };

  // roundedSegsの円弧を折れ線へ焼き込む（ブール演算の入力用・1弧8分割）
  function flattenSegs(rs, perArc = 8) {
    const out = [[rs.start[0], rs.start[1]]];
    let cur = rs.start;
    for (const s of rs.segs) {
      if (s.t === "L") { out.push([s.to[0], s.to[1]]); cur = s.to; continue; }
      // 円心 = 角の二等分線上・角からの距離 r/sin(φ/2)
      const v1x = cur[0] - s.corner[0], v1y = cur[1] - s.corner[1];
      const v2x = s.to[0] - s.corner[0], v2y = s.to[1] - s.corner[1];
      const l1 = Math.hypot(v1x, v1y) || 1, l2 = Math.hypot(v2x, v2y) || 1;
      const u1x = v1x / l1, u1y = v1y / l1, u2x = v2x / l2, u2y = v2y / l2;
      let bx = u1x + u2x, by = u1y + u2y;
      const bl = Math.hypot(bx, by);
      const cosPhi = Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y));
      const sinHalf = Math.sqrt((1 - cosPhi) / 2);
      if (bl < 1e-9 || sinHalf < 1e-6) { out.push([s.to[0], s.to[1]]); cur = s.to; continue; }   // ほぼ直線
      bx /= bl; by /= bl;
      const cx = s.corner[0] + bx * (s.r / sinHalf), cy = s.corner[1] + by * (s.r / sinHalf);
      const a0 = Math.atan2(cur[1] - cy, cur[0] - cx);
      const a1 = Math.atan2(s.to[1] - cy, s.to[0] - cx);
      let da = a1 - a0;
      if (s.sweep === 1) { while (da <= 0) da += 2 * Math.PI; }   // SVGのsweep=1=正角方向。フィレット弧は常に<π
      else { while (da >= 0) da -= 2 * Math.PI; }
      for (let k = 1; k <= perArc; k++) {
        const a = a0 + da * k / perArc;
        out.push([cx + s.r * Math.cos(a), cy + s.r * Math.sin(a)]);
      }
      cur = s.to;
    }
    if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
    return out;
  }

  // item → ブール演算入力（ring列: [外周, 穴...]）。楕円は96点・角Rは円弧をサンプルして焼き込む
  function itemRings(item) {
    const st = Store.styleOf(item);
    if (item.shape === "ellipse") {
      const cx = (item.x0 + item.x1) / 2, cy = (item.y0 + item.y1) / 2;
      const rx = Math.abs(item.x1 - item.x0) / 2, ry = Math.abs(item.y1 - item.y0) / 2;
      const ring = [];
      for (let k = 0; k < 96; k++) {
        const a = 2 * Math.PI * k / 96;
        ring.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
      }
      return [ring];
    }
    let rings;
    if (item.shape === "path") {
      const outer = item.curve
        ? Geom.flattenBeziers(Geom.pathBeziers(item.points, true, item.corners, item.curveMode))   // 曲線はサンプルして焼き込む
        : item.points.map(p => [p[0], p[1]]);
      rings = [outer, ...(item.holes || [])];
    }
    else rings = [shapeToPath(item).points];   // rect/polygon → 頂点列
    if (st.r > 0) rings = rings.map(ring => {
      const rs = Geom.roundedSegs(ring, true, st.r);
      return rs ? flattenSegs(rs) : ring;
    });
    return rings;
  }

  function shapeOp(op) {
    flushNudge();
    const eligIdx = selIdxs.filter(i => isBoolable(Store.items[i]));
    if (eligIdx.length < 2) { alertHint("対象は閉じた図形2個以上（手描き線・開いた線は対象外）"); return; }
    const skippedIdx = selIdxs.filter(i => !eligIdx.includes(i));
    const polys = eligIdx.map(i => itemRings(Store.items[i]));   // index昇順=背面→前面
    let result;
    if (op === "unite") result = Geom.polyBool(polys, [], "unite");
    else if (op === "cross") {
      // 交差=全部の共通部分。polyBoolのBは「いずれかの中」なので逐次適用で A∩B∩C… にする
      let acc = [polys[0]];
      for (let i = 1; i < polys.length && acc.length; i++) {
        const r = Geom.polyBool(acc, [polys[i]], "intersect");
        acc = r.map(p => [p.outer, ...p.holes]);
      }
      result = acc.map(rings => ({ outer: rings[0], holes: rings.slice(1) }));
    }
    else result = Geom.polyBool([polys[0]], polys.slice(1), "subtract");   // minus: 最背面 − 前面すべて
    const donor = Store.items[op === "minus" ? eligIdx[0] : eligIdx[eligIdx.length - 1]];   // 交差/合体=最前面 / 型抜き=最背面
    const sty = {};
    for (const k of ["fill", "stroke", "sw", "alpha"]) if (donor[k] !== undefined) sty[k] = donor[k];   // rは幾何に焼き込み済み
    const newItems = result
      .filter(poly => poly.outer && poly.outer.length >= 3)
      .map(poly => ({
        kind: "shape", shape: "path", points: poly.outer, closed: true,
        ...(poly.holes && poly.holes.length ? { holes: poly.holes } : {}), ...sty,
      }));
    if (!newItems.length) {   // minusで全て消えた（対象外itemは契約どおり選択に残す）
      const skippedNew = skippedIdx.map(j => j - eligIdx.filter(i => i < j).length);
      Store.removeMany(eligIdx);
      setSel(skippedNew);
      alertHint(op === "cross" ? "交差 → 共通部分がありません（⌘Zで戻せます）" : "形が全て消えました（⌘Zで戻せます）");
      return;
    }
    const at = Store.replaceWith(eligIdx, newItems);   // 1コミット=1undo・最背面の位置に挿入
    const k = newItems.length;
    const skippedNew = skippedIdx.map(j => {   // 置換後のindexへ写像（スキップ品も選択に残す）
      const pos = j - eligIdx.filter(i => i < j).length;
      return pos >= at ? pos + k : pos;
    });
    setSel([...Array.from({ length: k }, (_, x) => at + x), ...skippedNew]);
    alertHint(`${OP_LABEL[op]} → ${k}個` +
      (skippedIdx.length ? `（対象外${skippedIdx.length}個は選択のまま）` : ""));
  }
  $("opUnite").onclick = () => shapeOp("unite");
  $("opMinus").onclick = () => shapeOp("minus");
  $("opCross").onclick = () => shapeOp("cross");

  /* 間引く（アンカーを減らす）: Douglas-Peucker を1段かける。押すたびに減る。
     `Geom.simplifyDP` は**元の配列要素をそのまま返す**ので、点に元indexを埋めておけば
     corners（角のまま残す点）の対応を正確に追える。 */
  /* 許容誤差を倍々にして「必ず一段は減る」ようにする（押したのに何も起きない、を作らない）。
     形によって密度が違うので固定epsだと効いたり効かなかったりする */
  const THIN_EPS = 1.5, THIN_EPS_MAX = 48;
  function thinOnce(pts) {
    for (let eps = THIN_EPS; eps <= THIN_EPS_MAX; eps *= 2) {
      const kept = Geom.simplifyDP(pts, eps);
      if (kept.length < pts.length && kept.length >= 3) return kept;
    }
    return null;
  }
  function thinSel() {
    flushNudge();
    const entries = [];
    let before = 0, after = 0;
    for (const i of selIdxs) {
      const it = Store.items[i];
      const p = toPathItem(it);
      if (!p || p.points.length <= 3) continue;
      const tagged = p.points.map((q, k) => [q[0], q[1], k]);
      const kept = thinOnce(tagged);
      if (!kept) continue;
      const keptIdx = kept.map(q => q[2]);
      const next = { ...p, points: kept.map(q => [q[0], q[1]]) };
      if (p.curve) {
        const cs = (p.corners || []).map(c => keptIdx.indexOf(c)).filter(k => k >= 0).sort((a, b) => a - b);
        if (cs.length && cs.length < next.points.length) next.corners = cs;
        else { delete next.corners; if (cs.length) { delete next.curve; } }   // 全部が角なら曲線をやめる
      }
      before += p.points.length; after += next.points.length;
      entries.push([i, next]);
    }
    if (!entries.length) {
      // 手描きの細かさは raw ではなく「整え」スライダーが持つ（座標列が唯一の真実、の原則）
      const hasStroke = selIdxs.some(i => Store.items[i] && Store.items[i].kind === "stroke");
      alertHint(hasStroke
        ? "間引く → 手描き線の細かさは「整え」スライダーで調整します（パスにしてから間引くなら「なめらかに」）"
        : "間引く → これ以上減らせません（すでに最小のアンカー数です）");
      return;
    }
    Store.replaceMany(entries);   // 1コミット=1undo
    alertHint(`間引く → アンカー ${before} → ${after}（もう一度押すとさらに減る・⌘Zで戻る）`);
  }
  $("objThin").onclick = thinSel;

  /* ==== 展開を確定（実体化）====
     展開された全コピーを実体のitemに焼き込む。イラレの「アピアランスを分割」に相当。
     **対称の連動は失われる**（真実がモチーフでなくなるので当然）が、その代わり
     以降は分割・合体・交差・削除など通常のパス操作が全部使えるようになる。
     ＝「複製と重なっている領域を消したい」は これ＋合体（or 面に分割→削除）で叶う。
     地（静止）と画像は展開に参加しないのでそのまま残す。 */
  function flattenExpansion(specIn) {
    // 展開ビューの「確定」からは、いま見ている群をそのまま渡す（一覧での選択を要求しない）
    const sel = specIn ? [{ spec: specIn }] : selected();
    if (sel.length !== 1) { alertHint("一覧で群をひとつだけ選んでください（枠をクリック）"); return; }
    const motif = Render.buildMotif(Store.items, PAD_W);
    if (!motif.bbox) { alertHint("展開を確定 → 展開する断片がありません"); return; }
    /* 形成で手を入れているなら、**面ベースで実体化**する（けずった領域が本当に無い形になり、
       つないだ領域は1つのパスに融合する）。中身は formedItems（純関数）と共有＝
       画面・SVG・PNG・スワッチ・確定がすべて同じ形になる */
    if (Store.hasForm()) {
      const out = formedItems(sel[0].spec);
      if (!out) { alertHint("展開を実体にする → 残る領域がありません"); return; }
      Store.replaceWith(Store.items.map((_, i) => i), out);
      clearFormRec(); setEditSel([]); updateCutCount(); setSel([]);
      alertHint(`対称を解きました → ${out.length}個のパスになりました。以後は手で1つずつ触れます（⌘Zで戻る）`);
      return;
    }
    const { place, insts } = Groups.layout(sel[0].spec, PAD_W, PAD_W, motif.bbox);
    const src = Store.items.filter(it => it.kind !== "image" && !it.still);
    const keep = Store.items.filter(it => it.kind === "image" || it.still);   // 地はそのまま
    const total = src.length * insts.length;
    if (!total) { alertHint("展開を確定 → 対象がありません"); return; }
    if (total > 600 && !confirm(`${total}個のオブジェクトになります。対称の連動は解けます（⌘Zで戻せます）。続けますか？`)) return;
    const out = [...keep];
    for (const inst of insts) {
      const m = Geom.mul(inst, place.mat);
      for (const it of src) out.push(transformItem(it, m));
    }
    Store.replaceWith(Store.items.map((_, i) => i), out);   // 全置換=1コミット=1undo
    setSel([]);
    alertHint(`展開を確定 → ${out.length}個になりました。重なりを消すなら 全選択→「合体」、` +
      `一部だけ残すなら「面に分割」→不要な面を削除（⌘Zで元に戻せます）`);
  }
  $("flattenExp").onclick = () => flattenExpansion();

  /* 重なりの扱い（展開の後処理・完全に可逆）。モチーフには触れないので
     対称の連動・アンカー編集・undo はそのまま。トグルで即座に行き来できる */
  const OV_BTN = { each: "ovEach", merge: "ovMerge", punch: "ovPunch" };
  function setOverlapMode(v, persist = true) {
    const mode = OV_BTN[v] ? v : "each";
    Render.setOverlap(mode);
    for (const [k, id] of Object.entries(OV_BTN)) $(id).classList.toggle("on", k === mode);
    if (persist) {
      savePrefs();
      alertHint(mode === "each" ? "重なり: そのまま（コピーごとに描く）"
        : mode === "merge" ? "重なり: 合体（重なった部分が埋まって1つの輪郭に見える）"
        : "重なり: 抜く（重なった領域が穴になる）");
    }
    if (!motif) return;   // 起動直後はまだモチーフが無い（描画は初回buildに任せる）
    scheduleSwatches(0); renderPad();
    if (viewMode === "edit") renderEdit(); else if (viewMode === "live") renderLive(motif);
  }
  for (const [v, id] of Object.entries(OV_BTN)) $(id).onclick = () => setOverlapMode(v);

  /* ==== シェイプ形成（イラレのシェイプ形成ツール ⇧M 相当）====
     イラレと同じ2つの操作を「対称を保ったまま」やる。
       なぞる     → なぞった領域を **つなぐ**（内部の重なり線が消えて1つの塊になる）
       ⌥＋なぞる  → なぞった領域を **けずる**（紙色＝穴になる）

     鍵は「触った面の**対称の兄弟も同時に処理する**」こと。面はコピー同士の重なりから
     生まれるのでモチーフ側に書き戻せないが、**軌道（群の作用で移る先の集合）として
     記録すれば** モチーフは無傷のまま対称が保たれる。記録するだけなので完全に可逆。

     描画は「けずった面＝紙色で塗る（白抜きと同じ扱い）／つないだ面群＝unionの輪郭を
     インクで描き直す」。どちらも既存の描画経路に乗るので canvas/SVG/透明PNG で規則が揃う。 */
  /* 形成の記録は **Store（ドキュメント）が持つ**。ここは読み取りの別名で、更新は必ず setFormRec を通す。
     ローカル変数に持っていた頃は ⌘Z が効かず・JSONに入らず・prefs に残って別の絵へ持ち越された
     （2026-07-25 の全面点検で最上位の欠陥）。どれも size正規化した 0..1 のビュー座標。 */
  const cutOrbits = () => Store.form.cuts;      // けずった面の軌道
  const mergeGroups = () => Store.form.merges;  // つないだ面グループ（1グループ＝1なぞり）
  const cutEdges = () => Store.form.edges;      // 消した線の軌道（エッジの中点1点だけ）
  // 形成の記録を1コミットで更新（1操作=1undo）。渡した種類だけ差し替える
  function setFormRec(patch) {
    const f = Store.form;
    return Store.setForm({
      cuts: patch.cuts !== undefined ? patch.cuts : f.cuts,
      merges: patch.merges !== undefined ? patch.merges : f.merges,
      edges: patch.edges !== undefined ? patch.edges : f.edges,
    });
  }
  const clearFormRec = () => Store.setForm({ cuts: [], merges: [], edges: [] });

  /* 展開の全コピーから面を作る。mats は「モチーフ座標→ビュー座標」の行列列（=群の元）。
     subset を渡すと**面を作る対象だけ**を絞れる（＝イラレのシェイプ形成が選択中のパスにしか
     効かないのと同じ）。**配置行列は常に全itemのbboxから決める**——絞った分で組み直すと
     展開のスケールと位置がズレて、画面に見えている形と面が食い違う */
  function expansionInput(items, spec, size, subset) {
    const motif = Render.buildMotif(items, PAD_W);
    if (!motif.bbox) return null;
    const { place, insts } = Groups.layout(spec, size, PAD_W, motif.bbox, size);
    const mats = insts.map(inst => Geom.mul(inst, place.mat));
    /* **平面分割に入れるのは、ビューに掛かるコピーだけ**。壁紙は画面外にもタイルが並び
       （p6m は 256枚）、polyFaces の交点分割は辺数の二乗で効くので、見えない分まで入れると
       手描き1本でも1万辺＝数千万回になって固まる。**mats は全部返す**——軌道（対称の兄弟）は
       画面外のコピーにも送る必要があり、そこに面が無ければ何も当たらないだけで害はない。 */
    const bb = motif.bbox, pad = 8;
    const onView = m => {
      const cs = [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]]
        .map(pt => Geom.apply(m, pt[0], pt[1]));
      const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
      return Math.max(...xs) >= -pad && Math.min(...xs) <= size + pad
          && Math.max(...ys) >= -pad && Math.min(...ys) <= size + pad;
    };
    const vis = mats.filter(onView);
    const src = (subset && subset.length) ? subset : items;
    /* **itemごとの折れ線は1回だけ作る**。ここでコピーの数だけ knifePolyline/itemRings を呼ぶと、
       手描き（resample + simplifyDP）が 256回走って9秒以上かかっていた（p6m）。
       行列を掛けるのはコピーごとで正しいが、元の形を作り直す必要はない */
    const prepped = [];
    for (const it of src) {
      if (it.still || it.kind === "image") continue;
      if (isBoolable(it)) prepped.push({ rings: itemRingsCoarse(it) });
      else { const k = knifePolyline(it, true); if (k) prepped.push({ knife: k }); }
    }
    const closed = [], knives = [];
    for (const m of vis) for (const pp of prepped) {
      if (pp.rings) closed.push(pp.rings.map(rg => rg.map(p => Geom.apply(m, p[0], p[1]))));
      else knives.push(pp.knife.map(p => Geom.apply(m, p[0], p[1])));
    }
    /* span＝コピー1枚の対角（ビュー座標）。面はコピーの bbox の中にしかできないので、
       軌道の照合をビュー±span に絞ってよい根拠になる（orbitClip） */
    const sc = Math.hypot(mats[0][0], mats[0][1]);
    const span = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) * sc;
    return { closed, knives, mats, omats: completeMats(mats, size), span, visible: vis.length };
  }
  // 面（塗り分けの単位）と、線（消す単位）は**同じ平面グラフ**から作る。
  // 面は枝を刈るが、線は刈らない＝「ぴょっと出たパス」も線としては触れる
  function expansionFaces(items, spec, size, subset) {
    const inp = expansionInput(items, spec, size, subset);
    if (!inp) return { faces: [], mats: [], omats: [], span: 0, input: null };
    return { faces: Geom.polyFaces(inp.closed, inp.knives),
             mats: inp.mats, omats: inp.omats, span: inp.span, input: inp };
  }

  // 面の内部の代表点（第1辺の中点＋左法線わずか＝polyBool/polyFacesと同じ流儀で必ず内側に入る）
  function faceRep(face) {
    const a = face.outer[0], b = face.outer[1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(a[0] + b[0]) / 2 - (b[1] - a[1]) / len * 1e-3,
            (a[1] + b[1]) / 2 + (b[0] - a[0]) / len * 1e-3];
  }
  /* 点の軌道: mats は群の元の集合なので、どれか1つ（M0）の逆で基準へ引き戻し、
     全元で送れば軌道になる（M0⁻¹∘Mj が群の元。placeは打ち消える） */
  function orbitOf(p, mats) {
    if (mats.length < 2) return [p];
    const inv0 = Geom.invert(mats[0]);
    const q = Geom.apply(inv0, p[0], p[1]);
    return mats.map(M => Geom.apply(M, q[0], q[1]));
  }

  /* ==== 軌道の完全化（壁紙群の歯抜け対策）====
     Mj∘M0⁻¹ で作れる元は「たまたま並んだコピーの組」256個だけで、無限群の部分集合にすぎない。
     クリックした面と合同な面がビュー内にあっても、そこへ送る元が揃っている保証はない
     （p6m 実測: 軌道256点のうち面に当たるのは70点＝残りは歯抜け）。
     そこで mats から 格子（純並進の最短独立2本）と 剰余類代表（並進を法とした線形部+還元並進）を
     検出し、「ビューに届く並進 × 全剰余類」の完全な元集合を組み直す。
     並進が無い群（ロゼット等）はそのまま mats を返す＝従来と同一。
     返り値は mats と同じ「モチーフ→ビュー」形式で、先頭は必ず mats[0]（orbitOf の基準）。 */
  function completeMats(mats, size) {
    if (mats.length < 2) return mats;
    const inv0 = Geom.invert(mats[0]);
    const gs = mats.map(M => Geom.mul(M, inv0));   // ビュー→ビューの群の元（gs[0]=恒等）
    const EPS = 1e-4;
    const isI = g => Math.abs(g[0] - 1) < EPS && Math.abs(g[3] - 1) < EPS
                  && Math.abs(g[1]) < EPS && Math.abs(g[2]) < EPS;
    // 純並進を集めて格子基底を探す（2Dでは最短の独立2本が必ず基底になる）
    const trs = [];
    for (const g of gs) if (isI(g)) {
      const L = Math.hypot(g[4], g[5]);
      if (L > 1e-6) trs.push([g[4], g[5], L]);
    }
    if (!trs.length) return mats;   // 並進なし＝ロゼット等。従来どおり
    trs.sort((a, b) => a[2] - b[2]);
    const v1 = trs[0];
    const v2 = trs.find(t => Math.abs(v1[0] * t[1] - v1[1] * t[0]) > 1e-3 * v1[2] * t[2]) || null;
    const det = v2 ? v1[0] * v2[1] - v2[0] * v1[1] : 0;
    // 剰余類代表: 並進成分を格子で基本セルへ還元し、（線形部, 還元並進）で重複排除。
    // floor は境界すれすれで割れるので 1e-6 だけ押してから落とす（割れても重複が出るだけで害はない）
    const fl = x => Math.floor(x + 1e-6);
    const reps = new Map();
    for (const g of gs) {
      let fa = 0, fb = 0;
      if (v2) {
        fa = fl((g[4] * v2[1] - g[5] * v2[0]) / det);
        fb = fl((v1[0] * g[5] - v1[1] * g[4]) / det);
      } else {
        fa = fl((g[4] * v1[0] + g[5] * v1[1]) / (v1[2] * v1[2]));
      }
      const s = [g[0], g[1], g[2], g[3],
                 g[4] - fa * v1[0] - (v2 ? fb * v2[0] : 0),
                 g[5] - fa * v1[1] - (v2 ? fb * v2[1] : 0)];
      const key = s.map((x, i) => Math.round(x * (i < 4 ? 1e4 : 10))).join(",");
      if (!reps.has(key)) reps.set(key, s);
    }
    /* ビューに届く並進の範囲: s の線形部は原点まわりの直交変換なので、
       ビュー内の点の像は半径 √2·size＋セル程度に収まる。余裕をもって取る */
    const R = 1.6 * size + v1[2] + (v2 ? v2[2] : 0) + 64;
    const corners = [[-R, -R], [size + R, -R], [-R, size + R], [size + R, size + R]];
    let i0, i1, j0 = 0, j1 = 0;
    if (v2) {
      const as = corners.map(w => (w[0] * v2[1] - w[1] * v2[0]) / det);
      const bs = corners.map(w => (v1[0] * w[1] - v1[1] * w[0]) / det);
      i0 = Math.floor(Math.min(...as)) - 1; i1 = Math.ceil(Math.max(...as)) + 1;
      j0 = Math.floor(Math.min(...bs)) - 1; j1 = Math.ceil(Math.max(...bs)) + 1;
    } else {   // フリーズ＝1次元格子
      const L2 = v1[2] * v1[2];
      const as = corners.map(w => (w[0] * v1[0] + w[1] * v1[1]) / L2);
      i0 = Math.floor(Math.min(...as)) - 1; i1 = Math.ceil(Math.max(...as)) + 1;
    }
    const cells = (i1 - i0 + 1) * (j1 - j0 + 1);
    if (reps.size * cells > 20000) return mats;   // 想定外の群（巨大カスタム等）では従来どおり＝安全側
    const out = [mats[0]];
    for (const s of reps.values())
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        if (i === 0 && j === 0 && isI(s) && Math.abs(s[4]) < 1e-3 && Math.abs(s[5]) < 1e-3)
          continue;   // 恒等は先頭に置いた
        const gf = [s[0], s[1], s[2], s[3],
                    s[4] + i * v1[0] + (v2 ? j * v2[0] : 0),
                    s[5] + i * v1[1] + (v2 ? j * v2[1] : 0)];
        out.push(Geom.mul(gf, mats[0]));
      }
    return out;
  }

  /* 軌道はビューの外まで含む（omats は完全な元集合）が、面は vis コピーの bbox 内にしかできない。
     照合・記録に使う点は「面が存在しうる範囲」＝視野±（コピーの対角 span＋余白）に絞る */
  const orbitClip = (fc, extra) => {
    const m = (fc.span || 0) + 16 + (extra || 0);
    return { lo: -m, hi: FORM_SIZE + m };
  };
  const inClip = (p, cl) => p[0] >= cl.lo && p[0] <= cl.hi && p[1] >= cl.lo && p[1] <= cl.hi;
  /* 記録点1つ（0..1正規化）を現在の群の完全な軌道に展開する。omats が変われば作り直す。
     記録は「クリックした点そのもの」だけ持てばよく、旧版の保存データ（部分軌道）も
     先頭の点から展開し直すことで完全になる（＝過去のドキュメントの歯抜けも直る） */
  const orbCache = new WeakMap();
  function orbitOfRec(c, fc) {
    const key = fc.omats || fc.mats;
    let e = orbCache.get(c);
    if (!e || e.key !== key) {
      const cl = orbitClip(fc);
      e = { key, pts: orbitOf(formAbs(c), key).filter(p => inClip(p, cl)) };
      orbCache.set(c, e);
    }
    return e.pts;
  }
  const faceHas = (face, p) => Geom.inRings([face.outer, ...(face.holes || [])], p[0], p[1]);
  /* ==== 形成の座標系は常に PAD_W に固定する（FORM_SIZE） ====
     以前は「そのときの表示サイズ(editSize)で割った0..1」で記録していたが、壁紙・フリーズの配置は
     size に依存せず CELL の絶対座標で並ぶので、正規化の前提（size に比例する）が成り立たない。
     結果ウィンドウ幅を変えるだけでけずり跡がズレ、実体化（PAD_W で照合）とも食い違っていた。
     面・線・記録・照合・実体化を**すべて PAD_W 基準の1つの座標系**に揃えることで根から消す。
     表示は canvas 側でスケールするだけ（見た目は変わらない）。 */
  const FORM_SIZE = PAD_W;
  const formNorm = p => [p[0] / FORM_SIZE, p[1] / FORM_SIZE];   // 記録は 0..1（サイズに依らない）
  const formAbs = c => [c[0] * FORM_SIZE, c[1] * FORM_SIZE];
  /* その面が消されているか。fc は照合の文脈（currentFaces() か、formedItems 内の自前の展開結果）。
     記録の先頭点だけを信じて omats で展開し直す＝部分軌道しか持たない旧保存データも完全に当たる。
     全面×全軌道点の走査は 926面で数十msかかるので、（面集合, 記録）の参照が同じ間は
     消えた面のSetを使い回す（renderEdit が毎描画で全面を聞いてくるため） */
  const cutSetCache = new WeakMap();
  function cutFaceSet(fc) {
    const cuts = cutOrbits();
    let e = cutSetCache.get(fc);
    if (!e || e.cuts !== cuts) {
      const set = new Set();
      for (const orb of cuts) for (const p of orbitOfRec(orb[0], fc))
        for (const f of fc.faces) if (!set.has(f) && faceHas(f, p)) set.add(f);
      e = { cuts, set };
      cutSetCache.set(fc, e);
    }
    return e.set;
  }
  const faceIsCut = (face, fc) => cutFaceSet(fc).has(face);

  /* ==== 消せる「線」＝エッジ ====
     イラレのシェイプ形成は ⌥ で**領域も線も**消せる。線のほうは「交点から交点までの一続き」が単位。
     面リングの頂点のうち **3つ以上のリングに現れるもの＝分岐点（交点）** で区切ればそれが取れる
     （2つの面が接しているだけの頂点は、各面から1回ずつ＝2回しか現れない）。
     面から作るので「面を囲まない枝」は対象外——そこは polyFaces が刈っている。 */
  /* 消せる「線」= 平面グラフのエッジ（交点から交点まで／端点まで）。
     **面からではなく線から作る**——面リング由来にすると polyFaces が刈った枝（ぴょっと出たパス）に
     永久に触れなくなる。記録は面と同じ軌道（中点1点）なので対称は保たれ完全に可逆 */
  let edgeCache = { faces: null, val: [] };
  function currentEdges() {
    const fc = currentFaces();
    if (edgeCache.faces !== fc) {
      const inp = fc.input;
      const segs = inp ? Geom.planarEdges(inp.closed, inp.knives) : [];
      edgeCache = { faces: fc, val: segs.map(seg => ({ seg })) };
    }
    return edgeCache.val;
  }
  const edgeMid = seg => seg[Math.floor(seg.length / 2)];
  // その線が消されているか（記録は中点だけ）。面と同じく先頭点を完全軌道に展開してから照合する
  const edgeCutIn = (arr, seg, fc) => {
    const m = edgeMid(seg);
    return arr.findIndex(orb => orbitOfRec(orb[0], fc).some(a =>
      Math.hypot(a[0] - m[0], a[1] - m[1]) < 2));
  };
  const edgeCutAt = (seg, fc) => edgeCutIn(cutEdges(), seg, fc);
  const edgeIsCut = (seg, fc) => edgeCutAt(seg, fc) >= 0;
  // カーソル（FORM座標）に最も近いエッジ（tol以内・点列への距離）。線を消すときの当たり判定
  function edgeAt(v, tol) {
    let best = null, bd = tol;
    for (const e of currentEdges()) {
      const seg = e.seg;
      for (let i = 0; i + 1 < seg.length; i++) {
        const a = seg[i], b = seg[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        if (L2 < 1e-9) continue;
        const t = Geom.clamp(((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / L2, 0, 1);
        const d = Math.hypot(a[0] + dx * t - v[0], a[1] + dy * t - v[1]);
        if (d < bd) { bd = d; best = e; }
      }
    }
    return best;
  }

  /* つないだグループの輪郭（ビュー座標のリング群）。面のunionは重いので
     面キャッシュと記録の**参照**が変わったときだけ作り直す（Store.form は常に新オブジェクトで置換される） */
  let mergeCache = { faces: null, groups: null, val: [] };
  function mergedRings() {
    if (!mergeGroups().length) return [];
    const fc = currentFaces();
    if (mergeCache.faces === fc && mergeCache.groups === Store.form.merges) return mergeCache.val;
    const val = [];
    for (const g of mergeGroups()) {
      /* グループ内の各代表点を軌道で送り、**同じ添字k同士**を集めるとk番目のコピーのグループになる。
         omats（完全化した元集合）はビューの外まで含むので、添字を揃えたまま先頭メンバーの像で間引く
         （メンバー同士は近接した面なので、span分の余白があれば取りこぼさない） */
      const om = fc.omats || fc.mats;
      const orbits = g.map(c => orbitOf(formAbs(c), om));
      const cl = orbitClip(fc, fc.span || 0);
      const n = orbits.length ? orbits[0].length : 0;
      for (let k = 0; k < n; k++) {
        if (!inClip(orbits[0][k], cl)) continue;
        const reps = orbits.map(o => o[k]);
        const sel = fc.faces.filter(f => reps.some(p => faceHas(f, p)));
        if (!sel.length) continue;
        // 1面だけでも通す＝イラレの「クリックでその領域を独立した形にする」（囲まれた面が塗られる）
        for (const poly of Geom.polyBool(sel.map(f => [f.outer, ...(f.holes || [])]), [], "unite"))
          if (poly.outer && poly.outer.length >= 3) val.push([poly.outer, ...(poly.holes || [])]);
      }
    }
    mergeCache = { faces: fc, groups: Store.form.merges, val };
    return val;
  }
  /* ==== 形成の結果を「実体のitem列」にする（純関数・Storeは触らない）====
     **これが唯一の変換経路**。確定（実体化）も、SVG/PNGの書き出しも、スワッチも同じ関数を通るので
     「画面で見ているもの」と「出てくるもの」が構造的に一致する。
     座標系は FORM_SIZE(=PAD_W)。出力側は size/PAD_W の等方スケールを掛けるだけでよい。 */
  function formedItems(spec) {
    if (!Store.hasForm()) return null;
    const subset = formSubset();
    const fcx = expansionFaces(Store.items, spec, FORM_SIZE, subset);
    const { faces, mats } = fcx;
    const alive = faces.filter(f => !faceIsCut(f, fcx));
    if (!alive.length) return null;
    /* 面をまとめる規則は2つ——**つないだグループ**と**消した線の両側**。
       どちらも「この面とこの面は1つ」と言っているだけなので、union-find で1本化してから
       成分ごとに union する（別々に処理すると、両方が絡む面で取り合いになる） */
    const parent = new Map(alive.map(f => [f, f]));
    const find = f => { while (parent.get(f) !== f) { parent.set(f, parent.get(parent.get(f))); f = parent.get(f); } return f; };
    const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    /* つないだ面は画面では ink で塗られている（mergedRings）。実体化でも同じ見た目にするため、
       どの面が「つないだ側」だったかを覚えておき、その成分だけ塗りにする＝画面と出力が一致する */
    const mergedFaces = new Set();
    for (const g of mergeGroups()) {
      // mergedRings と同じ規則: 完全化した元集合で送り、添字を揃えたまま先頭メンバーの像で間引く
      const om = fcx.omats || mats;
      const orbits = g.map(c => orbitOf(formAbs(c), om));
      const cl = orbitClip(fcx, fcx.span || 0);
      const n = orbits.length ? orbits[0].length : 0;
      for (let k = 0; k < n; k++) {
        if (!inClip(orbits[0][k], cl)) continue;
        const reps = orbits.map(o => o[k]);
        const grp = alive.filter(f => reps.some(pt => faceHas(f, pt)));
        grp.forEach(f => mergedFaces.add(f));
        for (let i = 1; i < grp.length; i++) uni(grp[0], grp[i]);
      }
    }
    if (cutEdges().length) {   // 線を消す＝その境界が無くなる＝両側の面が1つになる
      const inp = expansionInput(Store.items, spec, FORM_SIZE, subset);
      for (const seg of (inp ? Geom.planarEdges(inp.closed, inp.knives) : [])) {
        if (!edgeIsCut(seg, fcx)) continue;
        const i = Math.floor(seg.length / 2);
        const a = seg[Math.max(0, i - 1)], b = seg[Math.min(seg.length - 1, i + 1)];
        const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
        const m = edgeMid(seg), nx = -dy / L * 0.6, ny = dx / L * 0.6;   // 中点の法線±ε＝両側
        const f1 = alive.find(f => faceHas(f, [m[0] + nx, m[1] + ny]));
        const f2 = alive.find(f => faceHas(f, [m[0] - nx, m[1] - ny]));
        if (f1 && f2 && f1 !== f2) uni(f1, f2);
      }
    }
    const comp = new Map();
    for (const f of alive) {
      const r = find(f);
      if (!comp.has(r)) comp.set(r, []);
      comp.get(r).push(f);
    }
    const polys = [];
    for (const grp of comp.values()) {
      const filled = grp.some(f => mergedFaces.has(f));   // つないだ側＝塗り
      if (grp.length === 1) { polys.push({ poly: grp[0], filled }); continue; }
      for (const poly of Geom.polyBool(grp.map(f => [f.outer, ...(f.holes || [])]), [], "unite"))
        if (poly.outer && poly.outer.length >= 3) polys.push({ poly, filled });
    }
    const donor = Store.items.find(it => isBoolable(it)) || Store.items[0] || {};
    const sty = {};
    for (const k of ["fill", "stroke", "sw", "alpha"]) if (donor[k] !== undefined) sty[k] = donor[k];
    /* 形成の対象外だった item は面になっていないので、**通常どおり展開して実体化**する
       （ここで落とすと「選択して形成したら他の形が消えた」になる） */
    const rest = subset.length
      ? Store.items.filter(it => !subset.includes(it) && it.kind !== "image" && !it.still) : [];
    const restOut = [];
    for (const M of mats) for (const it of rest) restOut.push(transformItem(it, M));
    return Store.items.filter(it => it.kind === "image" || it.still).concat(
      polys.map(({ poly: f, filled }) => ({
        kind: "shape", shape: "path", points: f.outer, closed: true,
        ...(f.holes && f.holes.length ? { holes: f.holes } : {}), ...sty,
        ...(filled ? { fill: "ink", stroke: "ink", sw: mergeSW() } : {}),
      })), restOut);
  }

  // つないだ塊の線幅: モチーフの代表itemに合わせる（線画をつないでも太さが揃う）
  const mergeSW = () => {
    const it = Store.items.find(x => x && x.kind === "shape" && x.sw > 0) || {};
    return it.sw > 0 ? it.sw : defSty.sw || 2;
  };

  /* ==== シェイプ形成（パッド側）====
     同じ ⇧M を造形パネルでも。展開ビューと違いここは**真実そのもの**なので、
     イラレと同じく実体を書き換える（＝パスが面に分かれる・⌘Zで戻せる）。
     展開ビュー側が非破壊なのは「対称の連動を壊さないため」で、性格の違いは意図的。 */
  let padForm = null;            // {alt, seen:Set} なぞり中
  let padHoverFaces = [];        // ホバー／なぞり中の面（画面のみ）
  let padFacesCache = { items: null, faces: [] };
  function padFaces() {
    if (padFacesCache.items !== Store.items) {
      const closed = [], knives = [];
      for (const it of Store.items) {
        if (it.still || it.kind === "image") continue;
        if (isBoolable(it)) closed.push(itemRings(it));
        else { const k = knifePolyline(it); if (k) knives.push(k); }
      }
      padFacesCache = { items: Store.items, faces: Geom.polyFaces(closed, knives) };
    }
    return padFacesCache.faces;
  }
  function drawPadForm() {
    pctx.setTransform(padScale, 0, 0, padScale, 0, 0);
    pctx.fillStyle = (padForm && padForm.alt) ? "rgba(190,60,60,.20)" : "rgba(39,93,114,.18)";
    for (const f of padHoverFaces) {
      pctx.beginPath();
      for (const rg of [f.outer, ...(f.holes || [])]) {
        if (!rg || rg.length < 3) continue;
        pctx.moveTo(rg[0][0], rg[0][1]);
        for (let i = 1; i < rg.length; i++) pctx.lineTo(rg[i][0], rg[i][1]);
        pctx.closePath();
      }
      pctx.fill("evenodd");
    }
  }
  function padFormUp() {
    const d = padForm;
    padForm = null;
    padHoverFaces = [];
    if (!d || !d.seen.size) { renderPad(); return; }
    const all = padFaces(), picked = [...d.seen];
    const donor = Store.items.find(it => isBoolable(it)) || Store.items[0] || {};
    const sty = {};
    for (const k of ["fill", "stroke", "sw", "alpha"]) if (donor[k] !== undefined) sty[k] = donor[k];
    const toItem = f => ({
      kind: "shape", shape: "path", points: f.outer, closed: true,
      ...(f.holes && f.holes.length ? { holes: f.holes } : {}), ...sty,
    });
    const rest = all.filter(f => !d.seen.has(f)).map(toItem);
    let out;
    if (d.alt) out = rest;   // けずる: 触った面を捨てる
    // 面にする: 1面なら「その領域を独立した形に」／複数なら「つなぐ」（イラレのクリックとドラッグ）
    else out = [...rest, ...Geom.polyBool(picked.map(f => [f.outer, ...(f.holes || [])]), [], "unite")
      .filter(p => p.outer && p.outer.length >= 3).map(toItem)];
    if (!out.length) { alertHint("形成 → 残る領域がありません"); renderPad(); return; }
    const keep = Store.items.filter(it => it.kind === "image" || it.still);   // 地と画像はそのまま
    Store.replaceWith(Store.items.map((_, i) => i), [...keep, ...out]);   // 全置換=1コミット=1undo
    setSel([]);
    alertHint(d.alt ? `${picked.length}か所けずりました（⌘Zで戻る）`
      : picked.length < 2 ? "この領域を1つの形にしました（⌘Zで戻る）"
      : `${picked.length}つの領域をつなぎました（⌘Zで戻る）`);
  }

  /* 造形のロック: パッド（左）を触れなくする。展開ビューだけをいじりたいときに、
     誤って断片を描き足す／動かす事故を防ぐ。展開側の編集は妨げない */
  function setPadLock(on, persist = true) {
    padLocked = !!on;
    $("padLock").classList.toggle("on", padLocked);
    document.body.classList.toggle("pad-locked", padLocked);
    if (padLocked) { flushNudge(); setSel([]); if (padEdit) exitPadEdit(); }
    if (persist) { savePrefs(); alertHint(padLocked ? "造形をロックしました（展開の編集はできます）" : "造形のロックを解除しました"); }
  }
  $("padLock").onclick = () => setPadLock(!padLocked);

  /* 静止（地）: 対称展開に参加しないitem。展開の背後に1回だけ描かれるので、
     figure/ground（地と図）の対比が一撃で作れる（v2レビューの筆頭提案）。
     bboxにも入らないので、地を足してもモチーフの配置・スケールは動かない。 */
  function toggleStill() {
    flushNudge();
    const elig = selIdxs.filter(i => Store.items[i] && Store.items[i].kind !== "image");   // 画像は常に展開側
    if (!elig.length) { alertHint("静止 → 線か図形を選んでください（画像は対象外）"); return; }
    const on = !elig.every(i => Store.items[i].still);   // 全部が静止なら解除・混在なら全部を静止に
    Store.replaceMany(elig.map(i => {
      const o = { ...Store.items[i] };
      if (on) o.still = true; else delete o.still;
      return [i, o];
    }));
    setSel(selIdxs);
    alertHint(on ? `静止 ${elig.length}個（対称展開に参加しない＝地。もう一度押すと戻る）`
                 : `静止を解除 ${elig.length}個（展開に参加）`);
  }
  $("objStill").onclick = toggleStill;

  /* ==== パス操作: 閉じる / 接続（Join・⌘J）/ 分割（シェイプ形成の基本）====
     手描き線・直線・図形は path化してから扱う（幾何は保つ）。1コミット=1undo。 */
  // 任意itemを path 化（幾何を保つ）。閉じた図形はそのまま閉path、開いた線は開path。対象外はnull
  function toPathItem(it) {
    if (!it) return null;
    if (it.kind === "stroke") {   // 手描き→曲線パス（editと同じCRパイプライン=見た目を保つ）
      const pts = Geom.simplifyDP(Geom.resample(it.raw, 3), editStrokeEps()).map(p => [p[0], p[1]]);
      if (pts.length < 2) return null;
      return { kind: "shape", shape: "path", points: pts, closed: false, curve: true, ...carryStyle(it) };
    }
    if (it.kind !== "shape") return null;
    if (it.shape === "path") return it;
    if (it.shape === "line") return { kind: "shape", shape: "path", points: [[it.x0, it.y0], [it.x1, it.y1]], closed: false, ...carryStyle(it) };
    if (it.shape === "ellipse") return ellipseToCurve(it);
    return shapeToPath(it);   // rect / polygon
  }
  const isOpenPath = it => { const p = toPathItem(it); return p && !p.closed; };
  const CLOSE_WELD = 8;   // 端点をこの距離未満で重ねると1点に融合（論理px）

  // 選択した開いたパスを閉じる（端点が近ければ融合・そうでなければ最終点→始点を直線で結ぶ）
  function closeSel() {
    flushNudge();
    const entries = [];
    for (const i of selIdxs) {
      const p = toPathItem(Store.items[i]);
      if (!p || p.closed || p.points.length < 3) continue;
      const pts = p.points.map(q => [q[0], q[1]]);
      const cs = p.curve ? new Set(p.corners || []) : null;
      if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < CLOSE_WELD) {
        pts.pop();   // 端点が重なっている＝最後の点を捨てて閉じる
        if (cs) cs.delete(p.points.length - 1);
      }
      const next = { ...p, points: pts, closed: true };
      if (cs) next.corners = [...cs].filter(c => c < pts.length).sort((a, b) => a - b);
      entries.push([i, next]);
    }
    if (!entries.length) { alertHint("閉じる → 開いたパス（手描き線・図形は掴んで確定済みの線）を選んでから"); return; }
    Store.replaceMany(entries);
    alertHint(`パスを閉じました → ${entries.length}個`);
  }
  $("objClose").onclick = closeSel;

  /* 接続（Join・⌘J）: 端点どうしをつなぐ。
     ・開いたパス1本を選択 → 両端を結んで閉じる（＝closeSel）
     ・開いたパス2本を選択 → 一番近い端点どうしを繋いで1本の開いたパスに（近ければ1点に融合）
     スタイルは最前面（index最大）の線を継承。1コミット=1undo。曲線パスは接続点を角にする（滑らかは後でスムーズ）*/
  function joinSel() {
    flushNudge();
    const openIdx = selIdxs.filter(i => isOpenPath(Store.items[i]));
    if (openIdx.length === 1) { closeSel(); return; }   // 1本＝自分の両端を閉じる
    if (openIdx.length !== 2) { alertHint("接続 → 開いたパスを1本（閉じる）か2本（つなぐ）選んでから"); return; }
    const [ia, ib] = openIdx;
    const A = toPathItem(Store.items[ia]), B = toPathItem(Store.items[ib]);
    const donor = Store.items[Math.max(ia, ib)];   // 最前面のスタイルを継承
    // 4通りの端点ペアから最短を選ぶ。必要ならA/Bを反転して「Aの終点=Bの始点」に揃える
    const endA = A.points.length - 1, endB = B.points.length - 1;
    const cand = [
      { a: endA, b: 0, ra: false, rb: false },
      { a: endA, b: endB, ra: false, rb: true },
      { a: 0, b: 0, ra: true, rb: false },
      { a: 0, b: endB, ra: true, rb: true },
    ];
    let best = cand[0], bd = Infinity;
    for (const c of cand) {
      const pa = A.points[c.a], pb = B.points[c.b];
      const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
      if (d < bd) { bd = d; best = c; }
    }
    const seq = (item, rev) => {
      const pts = item.points.map(p => [p[0], p[1]]);
      const cs = item.curve ? new Set(item.corners || []) : new Set(item.points.map((_, k) => k));   // 非curveは全点角
      const n = pts.length;
      if (!rev) return { pts, corners: [...cs] };
      return { pts: pts.reverse(), corners: [...cs].map(c => n - 1 - c) };   // 反転で角indexも反転
    };
    const sa = seq(A, best.ra), sb = seq(B, best.rb);
    const weld = bd < CLOSE_WELD;   // 端点が近ければ融合（Bの先頭を落とす）
    const aN = sa.pts.length;
    const joinIdx = aN - 1;         // 接続点（Aの最終点）
    const points = weld ? [...sa.pts, ...sb.pts.slice(1)] : [...sa.pts, ...sb.pts];
    const cornerSet = new Set(sa.corners);
    for (const c of sb.corners) cornerSet.add(aN - (weld ? 1 : 0) + c);
    cornerSet.add(joinIdx);   // 接続点は角（滑らかにしたいときは後でスムーズ）
    const curve = A.curve || B.curve;
    const next = { kind: "shape", shape: "path", points, closed: false, ...carryStyle(donor) };
    if (curve) {
      const corners = [...cornerSet].filter(c => c >= 0 && c < points.length).sort((a, b) => a - b);
      if (corners.length < points.length) { next.curve = true; next.corners = corners; }
    }
    const at = Store.replaceWith([ia, ib], [next]);   // 2本→1本・最背面の位置へ（1undo）
    setSel([at]);
    alertHint(weld ? "端点を接続しました（近い端は1点に融合）" : "端点を直線で接続しました");
  }
  $("objJoin").onclick = joinSel;

  /* 分割（シェイプ形成の基本・イラレの「パスファインダー: 分割」相当）:
     重なった閉じた図形と、切る線（開いたパス）から、囲まれた最小の面をすべて取り出す。
     各面は選択できる独立itemになる（クリックで消す＝選択して削除・組み合わせる＝合体で再構成）。 */
  /* 開いたパス/線/手描きを折れ線に（ナイフ用）。
     coarse=true は**面の計算用**。曲線の見た目ではなく「どこで交わるか」だけが要るので粗くてよい。
     細かいまま展開に配ると、壁紙群（p6m=256コピー）で辺が 22,000 を超え、交点分割は辺数の二乗で
     効くので何秒も固まる（実測 7.8秒）。0.6px のふくらみは面の形に出ない。 */
  const FORM_EPS = 0.6;
  function knifePolyline(it, coarse) {
    const p = toPathItem(it);
    if (!p || p.closed) return null;
    if (!p.curve) return p.points.map(q => [q[0], q[1]]);
    const flat = Geom.flattenBeziers(Geom.pathBeziers(p.points, false, p.corners, p.curveMode));
    return coarse ? Geom.simplifyDP(flat, FORM_EPS) : flat;
  }
  // 閉じた図形の輪郭も同じ理由で粗くする（面の計算に渡すとき）
  const itemRingsCoarse = it => itemRings(it).map(rg => Geom.simplifyDP(rg, FORM_EPS));
  function divideSel() {
    flushNudge();
    const closedIdx = selIdxs.filter(i => isBoolable(Store.items[i]));
    if (!closedIdx.length) { alertHint("分割 → 閉じた図形を1個以上（切る線を一緒に選ぶと線でも割れます）"); return; }
    const knifeIdx = selIdxs.filter(i => isOpenPath(Store.items[i]));
    const usedIdx = [...closedIdx, ...knifeIdx].sort((a, b) => a - b);
    const closed = closedIdx.map(i => itemRings(Store.items[i]));
    const knives = knifeIdx.map(i => knifePolyline(Store.items[i])).filter(Boolean);
    const faces = Geom.polyFaces(closed, knives);
    if (faces.length <= 1 && !knives.length) { alertHint("分割 → 重なりや切る線がありません（面は1つのまま）"); return; }
    const donor = Store.items[closedIdx[closedIdx.length - 1]];   // 最前面の閉図形のスタイルを全面に
    const sty = {};
    for (const k of ["fill", "stroke", "sw", "alpha"]) if (donor[k] !== undefined) sty[k] = donor[k];
    const newItems = faces.filter(f => f.outer && f.outer.length >= 3).map(f => ({
      kind: "shape", shape: "path", points: f.outer, closed: true,
      ...(f.holes && f.holes.length ? { holes: f.holes } : {}), ...sty,
    }));
    if (!newItems.length) { alertHint("分割 → 面ができませんでした"); return; }
    const at = Store.replaceWith(usedIdx, newItems);
    setSel(newItems.map((_, k) => at + k));
    alertHint(`分割 → ${newItems.length}面（不要な面は選んで削除・組むには合体）`);
  }
  $("opDivide").onclick = divideSel;

  /* オフセット（イラレの「パスのオフセット」相当）:
     閉じた図形 → 内側/外側に平行線（角はマイター・凹角の自己交差はGeom側で掃除）。
     開いた線 → 輪郭化して面にする（線が「太さを持ったかたち」になる＝線と面の往復ができる）。
     距離は離散チップ（外/内 × 2/4/8/16px）＝量子化された入力の美学。 */
  function offsetSel(d) {
    flushNudge();
    const eligIdx = selIdxs.filter(i => isBoolable(Store.items[i]) || isOpenPath(Store.items[i]));
    if (!eligIdx.length) { alertHint("輪郭 → 閉じた図形か線を選んでください（画像は対象外）"); return; }
    const skippedIdx = selIdxs.filter(i => !eligIdx.includes(i));
    const newItems = [];
    let lost = 0, outlined = 0;
    for (const i of eligIdx) {
      const it = Store.items[i];
      const open = !isBoolable(it);
      const polys = open
        ? Geom.outlinePath(knifePolyline(it) || [], d)     // 線 → 幅2|d|の面
        : Geom.offsetPoly(itemRings(it), d);               // 面 → 内外へ平行移動
      if (!polys.length) { lost++; continue; }             // 細らせすぎて消えた
      const sty = {};
      for (const k of ["fill", "stroke", "sw", "alpha"]) if (it[k] !== undefined) sty[k] = it[k];
      if (open) { sty.fill = "ink"; sty.stroke = "none"; outlined++; }   // 線色を塗りへ移す（二重線に見せない）
      for (const p of polys) newItems.push({
        kind: "shape", shape: "path", points: p.outer, closed: true,
        ...(p.holes && p.holes.length ? { holes: p.holes } : {}), ...sty,
      });
    }
    const label = `輪郭 ${d > 0 ? "外" : "内"}${Math.abs(d)}`;
    if (!newItems.length) { alertHint(`${label} → 全て消えました（細らせすぎ・そのまま残しました）`); return; }
    const k = newItems.length;
    const at = Store.replaceWith(eligIdx, newItems);   // 1コミット=1undo
    const skippedNew = skippedIdx.map(j => {           // 置換後のindexへ写像（対象外itemは選択に残す）
      const pos = j - eligIdx.filter(i => i < j).length;
      return pos >= at ? pos + k : pos;
    });
    setSel([...Array.from({ length: k }, (_, x) => at + x), ...skippedNew]);
    alertHint(`${label} → ${k}個` + (outlined ? `（線${outlined}本は面に）` : "") +
      (lost ? `・消えた形${lost}個` : "") + (skippedIdx.length ? `・対象外${skippedIdx.length}個は選択のまま` : ""));
  }
  /* 輪郭のUI: 「方向トグル × 距離チップ」（8ボタン→6ボタン。方向は状態として残る） */
  let ofDir = 1;   // 1=外へ（太る） / -1=内へ（細る）
  function setOfDir(d, persist = true) {
    ofDir = d;
    $("ofOut").classList.toggle("on", d > 0);
    $("ofIn").classList.toggle("on", d < 0);
    if (persist) savePrefs();
  }
  $("ofOut").onclick = () => setOfDir(1);
  $("ofIn").onclick = () => setOfDir(-1);
  for (const [id, px] of [["of2", 2], ["of4", 4], ["of8", 8], ["of16", 16]])
    $(id).onclick = () => offsetSel(ofDir * px);

  // 選択の健全性: itemが減ってindexが無効になったら間引く
  Store.onChange(() => { if (selIdxs.some(i => i >= Store.items.length)) setSel(selIdxs); });

  // ウィンドウリサイズ：パッドとライブパネルの表示サイズに追従
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      sizePad(); renderPad();
      if (viewMode === "live" && motif) { buildLivePanel(); renderLive(motif); }
      if (viewMode === "edit") renderEdit();
    }, 120);
  });

  /* ==== カスタム対称ルール: 生成元を組んで自分の群を作る（Q24=生成元を組む） ====
     編集中は cgGens をライブプレビュー。保存で customs[] + localStorage + スワッチ登録。
     以後は他の群と完全に同じ経路（選択・LIVE・SVG/PNG・axis追従） */
  const CUSTOMS_KEY = "symmetry-machine.customs.v1";
  let customs = [];        // [{name, gens}]（defは不変。Groups側で閉包をWeakMapキャッシュ）
  let cgGens = [];         // 編集中の生成元
  let cgOpen = false;
  let cgEditing = null;    // 編集対象の既存def（null=新規作成）

  const validAt = at => at === undefined ||
    (Array.isArray(at) && at.length === 2 && at.every(v => Number.isFinite(v) && Math.abs(v) <= 1));
  const validGen = g => g && (
    (g.type === "rot" && Number.isInteger(g.n) && g.n >= 2 && g.n <= 12 && validAt(g.at)) ||
    (g.type === "mirror" && Number.isFinite(g.deg)) ||
    ((g.type === "glide" || g.type === "trans") && Number.isFinite(g.deg) && Number.isFinite(g.d) && g.d > 0));

  function saveCustoms() {
    try { localStorage.setItem(CUSTOMS_KEY, JSON.stringify(customs)); }
    catch (_) { alertHint("カスタム群を保存できませんでした（容量超過）"); }
  }
  function loadCustoms() {
    try {
      const raw = JSON.parse(localStorage.getItem(CUSTOMS_KEY));
      if (!Array.isArray(raw)) return;
      for (const d of raw) {
        if (!d || typeof d.name !== "string" || !Array.isArray(d.gens)) continue;
        const gens = d.gens.filter(validGen).map(g => ({ ...g }));
        if (gens.length) customs.push({ name: d.name, gens });
      }
    } catch (_) { /* 壊れたデータは無視 */ }
  }

  /* スワッチ登録（右上に ×=削除 / e=編集）。swatches[]に足すので選択・書き出し・ライブは自動で対象になる */
  function addCustomSwatch(def) {
    buildSwatches($("customs"), [{ kind: "custom", def }]);
    const sw = swatches[swatches.length - 1];
    const del = document.createElement("button");
    del.className = "swDel";
    del.textContent = "×";
    del.title = "このルールを削除";
    del.addEventListener("click", ev => { ev.stopPropagation(); removeCustom(def); });
    const ed = document.createElement("button");
    ed.className = "swEdit";
    ed.textContent = "e";
    ed.title = "このルールを編集（生成元をビルダーに読み戻す）";
    ed.addEventListener("click", ev => { ev.stopPropagation(); openCg(def); });
    sw.wrap.appendChild(del);
    sw.wrap.appendChild(ed);
    return sw;
  }
  /* 見た目の位置（DOM順）だけ元に戻して差し込む（編集の差し替え・削除のundo用）。
     swatches[] は末尾でよい＝配列順が意味を持つのは書き出し対象の列挙だけで、
     並びの見た目は #customs のDOM順が決める（リロード時は customs 配列順で再構築される） */
  function insertCustomSwatch(def, domAt, sel) {
    const host = $("customs");
    const sw = addCustomSwatch(def);
    const ref = host.children[domAt] || null;
    if (ref && ref !== sw.wrap) host.insertBefore(sw.wrap, ref);
    if (sel) sw.wrap.classList.add("sel");
    return sw;
  }
  function replaceCustomSwatch(oldDef, def) {
    const k = swatches.findIndex(s => s.spec.kind === "custom" && s.spec.def === oldDef);
    if (k < 0) { addCustomSwatch(def); return; }
    const wasSel = swatches[k].wrap.classList.contains("sel");
    const at = [...$("customs").children].indexOf(swatches[k].wrap);
    swatches[k].wrap.remove();
    swatches.splice(k, 1);
    insertCustomSwatch(def, at < 0 ? Math.max(0, customs.indexOf(def)) : at, wasSel);
    liveKey = "";   // ライブ対象の中身が変わったのでパネル再構築を促す
  }
  function removeCustom(def) {
    if (!confirm(`カスタム群 ${def.name} を削除しますか？（「戻す」で1件だけ復元できます）`)) return;
    const at = customs.indexOf(def);
    const k = swatches.findIndex(s => s.spec.kind === "custom" && s.spec.def === def);
    const wasSel = k >= 0 && swatches[k].wrap.classList.contains("sel");
    const domAt = k >= 0 ? [...$("customs").children].indexOf(swatches[k].wrap) : at;
    customs = customs.filter(d => d !== def);
    saveCustoms();
    if (k >= 0) { swatches[k].wrap.remove(); swatches.splice(k, 1); }
    removedCustom = { def, at: Math.max(0, domAt), wasSel };   // 直近1件だけ戻せる
    $("cgUndo").style.display = "";
    if (cgEditing === def) closeCg();     // 編集中のものを消したらビルダーも畳む
    liveKey = "";   // ライブ対象が変わり得るのでパネル再構築を促す
    savePrefs();
    alertHint(`${def.name} を削除しました（「戻す」で復元できます）`);
  }

  /* ---- ビルダー ---- */
  const GEN_DEFAULTS = {
    rot:    { type: "rot", n: 4 },
    mirror: { type: "mirror", deg: 90 },
    glide:  { type: "glide", deg: 90, d: 0.25 },
    trans:  { type: "trans", deg: 0, d: 0.35 },
  };
  const GEN_LABEL = { rot: "回転", mirror: "鏡映", glide: "映進", trans: "並進" };
  const cgDef = () => ({ name: "preview", gens: cgGens.map(g => ({ ...g })) });

  /* 回転中心のオフセット at:[x,y] は「距離d（スワッチ辺比）× 方向deg」で編集する
     （glide/transのd・degと同じ刻み＝0.05 / 15°）。d=0 のときは at を落として従来のdefに戻す。 */
  const r2 = v => Math.round(Math.max(0, Math.min(0.6, v)) * 100) / 100;
  const atOf = g => {
    if (!g.at) return { d: 0, deg: 0 };
    const d = r2(Math.hypot(g.at[0], g.at[1]));
    let deg = Math.round(Math.atan2(g.at[1], g.at[0]) * 180 / Math.PI / 15) * 15;
    if (deg < 0) deg += 360;
    return { d, deg: deg % 360 };
  };
  const setAt = (g, d, deg) => {
    if (!(d > 0)) { delete g.at; return; }
    const rad = deg * Math.PI / 180;
    g.at = [Math.round(Math.cos(rad) * d * 1e4) / 1e4, Math.round(Math.sin(rad) * d * 1e4) / 1e4];
  };

  /* def を渡すと「そのルールの編集」（生成元をコピーして読み戻す。**旧defは書き換えない**＝
     閉包のWeakMapキャッシュが古い結果を返さないように、保存時は必ず新しいdefオブジェクトを作る） */
  function openCg(def) {
    cgOpen = true;
    cgEditing = def || null;
    cgGens = def ? def.gens.map(g => ({ ...g })) : [];
    $("cgPanel").style.display = "";
    $("cgNew").style.display = "none";
    $("cgSave").textContent = def ? "更新" : "保存";
    $("cgTitle").textContent = def ? `${def.name} を編集` : "";
    renderGenChips(); updateCgPreview();
  }
  function closeCg() {
    cgOpen = false; cgGens = []; cgEditing = null;
    $("cgPanel").style.display = "none"; $("cgNew").style.display = "";
    $("cgSave").textContent = "保存"; $("cgTitle").textContent = "";
  }

  function renderGenChips() {
    const host = $("cgGens");
    host.textContent = "";
    const upd = () => { renderGenChips(); updateCgPreview(); };
    const mkBtn = (txt, fn) => { const b = document.createElement("button"); b.textContent = txt; b.addEventListener("click", fn); return b; };
    const mkSpan = (txt, cls) => { const s = document.createElement("span"); s.textContent = txt; if (cls) s.className = cls; return s; };
    cgGens.forEach((g, i) => {
      const chip = document.createElement("span");
      chip.className = "genChip";
      chip.appendChild(mkSpan(GEN_LABEL[g.type]));
      if (g.type === "rot") {
        chip.appendChild(mkBtn("−", () => { g.n = Math.max(2, g.n - 1); upd(); }));
        chip.appendChild(mkSpan(`n${g.n}`));
        chip.appendChild(mkBtn("＋", () => { g.n = Math.min(12, g.n + 1); upd(); }));
        /* 回転中心のオフセット（0=軸=従来の挙動）。中心の違う回転を2つ並べると
           合成が並進になり、ロゼットが帯や格子に育つ ＝「2つの回転体を組み合わせる」 */
        const at = atOf(g);
        chip.appendChild(mkSpan("中心", "lbl"));
        chip.appendChild(mkBtn("−", () => { setAt(g, r2(at.d - 0.05), at.deg); upd(); }));
        chip.appendChild(mkSpan(at.d > 0 ? at.d.toFixed(2) : "軸"));
        chip.appendChild(mkBtn("＋", () => { setAt(g, r2(at.d + 0.05), at.deg); upd(); }));
        if (at.d > 0) {   // 中心をずらしたときだけ方向を出す（軸のままなら意味がない）
          chip.appendChild(mkBtn("−", () => { setAt(g, at.d, (at.deg - 15 + 360) % 360); upd(); }));
          chip.appendChild(mkSpan(`${at.deg}°`));
          chip.appendChild(mkBtn("＋", () => { setAt(g, at.d, (at.deg + 15) % 360); upd(); }));
        }
      } else {
        const degMod = g.type === "trans" ? 360 : 180;   // 鏡映/映進の軸は180°周期
        chip.appendChild(mkBtn("−", () => { g.deg = (g.deg - 15 + degMod) % degMod; upd(); }));
        chip.appendChild(mkSpan(`${g.deg}°`));
        chip.appendChild(mkBtn("＋", () => { g.deg = (g.deg + 15) % degMod; upd(); }));
        if (g.type !== "mirror") {
          chip.appendChild(mkSpan("d", "lbl"));
          chip.appendChild(mkBtn("−", () => { g.d = Math.max(0.05, Math.round((g.d - 0.05) * 100) / 100); upd(); }));
          chip.appendChild(mkSpan(g.d.toFixed(2)));
          chip.appendChild(mkBtn("＋", () => { g.d = Math.min(0.6, Math.round((g.d + 0.05) * 100) / 100); upd(); }));
        }
      }
      chip.appendChild(mkBtn("×", () => { cgGens.splice(i, 1); upd(); }));
      host.appendChild(chip);
    });
    if (!cgGens.length) host.appendChild(mkSpan("↓ add から生成元を足す", "lbl"));
  }

  function updateCgPreview() {
    if (!cgOpen) return;
    const cv = $("cgPreview");
    const w = Math.min(280, cv.parentElement.clientWidth || 280);
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = w * dpr; cv.style.width = w + "px"; cv.style.height = w + "px"; }
    const def = cgDef();
    Render.swatchInto(cv.getContext("2d"), w, dpr, { kind: "custom", def }, motif, PAD_W, Render.colors().paper);
    if (!cgGens.length) { $("cgInfo").textContent = ""; return; }
    const info = Groups.customInfo(def);
    $("cgInfo").textContent = `位数 ${info.order}` +
      (info.capped ? `（発散 → 上限${Groups.CUSTOM_CAP}で打ち切り）` : "") +
      (motif && motif.bbox ? "" : "・断片を描くとプレビューが見える");
  }

  const sigFromGens = gens => gens.map(g =>
    g.type === "rot" ? `r${g.n}${g.at ? `@${Math.round(atOf(g).d * 100)}` : ""}`   // 中心をずらした回転は @距離 を付ける
      : g.type === "mirror" ? `m${g.deg}` : g.type === "glide" ? `g${g.deg}` : `t${g.deg}`).join("+");
  function uniqueCustomName(base, except) {
    const names = new Set(customs.filter(d => d !== except).map(d => d.name));
    if (!names.has(base)) return base;
    for (let k = 2; ; k++) if (!names.has(`${base}-${k}`)) return `${base}-${k}`;
  }

  $("cgNew").onclick = () => openCg();
  $("cgCancel").onclick = closeCg;
  const CG_ADD = { cgAddRot: "rot", cgAddMirror: "mirror", cgAddGlide: "glide", cgAddTrans: "trans" };
  for (const [id, t] of Object.entries(CG_ADD))
    $(id).onclick = () => { cgGens.push({ ...GEN_DEFAULTS[t] }); renderGenChips(); updateCgPreview(); };
  $("cgSave").onclick = () => {
    if (!cgGens.length) { alertHint("生成元がありません（add から足してください）"); return; }
    const gens = cgGens.map(g => ({ ...g }));
    const old = cgEditing;
    if (old) {   // ---- 既存ルールの更新（旧defは書き換えない＝閉包WeakMapキャッシュの前提）----
      const k = customs.indexOf(old);
      if (k < 0) { closeCg(); alertHint("このルールは既に削除されています"); return; }
      const def = { name: uniqueCustomName(sigFromGens(gens), old), gens };
      customs[k] = def;
      saveCustoms();
      replaceCustomSwatch(old, def);   // 同じ位置・同じ選択状態を保ったまま差し替え
      closeCg();
      scheduleSwatches(0);
      savePrefs();                     // prefs.sel は新しい名前で保存し直す
      alertHint(`${def.name} に更新しました`);
      return;
    }
    const def = { name: uniqueCustomName(sigFromGens(gens)), gens };
    customs.push(def);
    saveCustoms();
    addCustomSwatch(def);
    closeCg();
    scheduleSwatches(0);
    alertHint(`${def.name} を保存しました（スワッチをクリックで選択）`);
  };

  /* 直近1件の削除を戻す（confirmだけでは取り返しがつかないので）。
     復元は「元の位置へ・元の選択状態で」 */
  let removedCustom = null;
  function undoRemoveCustom() {
    if (!removedCustom) return;
    const { def, at, wasSel } = removedCustom;
    removedCustom = null;
    $("cgUndo").style.display = "none";
    customs.splice(Math.min(at, customs.length), 0, def);
    saveCustoms();
    insertCustomSwatch(def, at, wasSel);
    liveKey = "";
    scheduleSwatches(0);
    savePrefs();
    alertHint(`${def.name} を戻しました`);
  }
  $("cgUndo").onclick = undoRemoveCustom;

  /* ==== 取り込み: 画像（暗部→ネイビー透過）/ SVG（ベクター）==== */
  // 画像 → ネイティブ解像度（上限1120px）で暗部をネイビー透過に
  function importRasterImage(img, onDone) {
    const cap = 1120;   // 280×4: 4x書き出しまでボケない
    const sc = Math.min(1, cap / Math.max(img.width, img.height));
    const t = document.createElement("canvas");
    t.width = Math.max(1, Math.round(img.width * sc));
    t.height = Math.max(1, Math.round(img.height * sc));
    const tc = t.getContext("2d");
    tc.drawImage(img, 0, 0, t.width, t.height);
    const d = tc.getImageData(0, 0, t.width, t.height), px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      const lum = px[i] * .3 + px[i + 1] * .59 + px[i + 2] * .11;
      const a = Geom.clamp((200 - lum) * 2, 0, 255);   // 暗いほど不透明
      px[i] = 0; px[i + 1] = 68; px[i + 2] = 204; px[i + 3] = a;
    }
    tc.putImageData(d, 0, 0);
    Store.add({ kind: "image", dataURL: t.toDataURL("image/png"), w: t.width, h: t.height });
    onDone && onDone();
  }
  function importImageFile(file) {
    const img = new Image();
    img.onload = () => importRasterImage(img, () => URL.revokeObjectURL(img.src));
    img.src = URL.createObjectURL(file);
  }
  // SVGテキスト → ベクターitem群。取り込めたら true
  function importSvgText(text) {
    const items = SvgImport.parse(text, PAD_W);
    if (!items.length) return false;
    Store.addMany(items);
    alertHint(`SVGを${items.length}要素として取り込みました`);
    return true;
  }
  const isSvgFile = f => f.type === "image/svg+xml" || /\.svg$/i.test(f.name || "");

  $("file").addEventListener("change", e => {
    const f = e.target.files?.[0]; if (!f) return;
    if (isSvgFile(f)) f.text().then(t => { if (!importSvgText(t)) alertHint("SVGを取り込めませんでした"); });
    else importImageFile(f);
    e.target.value = "";
  });

  // ペースト取り込み（⌘V）: アプリ内オブジェクト → SVGテキスト → 画像 → アプリ内クリップボード
  window.addEventListener("paste", e => {
    const cd = e.clipboardData; if (!cd) return;
    const text = cd.getData("text/plain") || cd.getData("text/html") || "";
    if (text.includes(CLIP_MARK)) {   // ⌘Cした自前オブジェクト
      try {
        const data = JSON.parse(text);
        if (data && data.app === CLIP_MARK && pasteClip(data.items)) { e.preventDefault(); return; }
      } catch (_) { /* 通常テキストとして続行 */ }
    }
    if (/<svg[\s>]/i.test(text) || /<path[\s>]/i.test(text)) {
      if (importSvgText(text)) { e.preventDefault(); return; }
    }
    for (const it of cd.items || []) {
      if (it.kind === "file" && it.type && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (!f) continue;
        e.preventDefault();
        if (isSvgFile(f)) f.text().then(t => { if (!importSvgText(t)) alertHint("SVGを取り込めませんでした"); });
        else importImageFile(f);
        return;
      }
    }
    // 最後の受け皿: システムclipboardが空同然なら、アプリ内クリップボードをペースト
    if (!text && !(cd.items && cd.items.length) && clipItems && clipItems.length) {
      e.preventDefault();
      pasteClip(clipItems);
    }
  });

  /* ==== ボタン・トグル ==== */
  // undo/redoは選択を外す（reorder等「位置を変えるコミット」を戻すと selIdxs が別itemを指すため）
  /* 取り消し。展開ビュー側の選択も外す——戻したあとに index がずれたまま delete を押すと
     「別の形が消える」ため（左右どちらの選択も、版が変われば指す先が変わる） */
  function doUndo() { flushNudge(); if (selIdxs.length) setSel([]); if (editSelIdxs.length) setEditSel([]); Store.undo(); }
  function doRedo() { flushNudge(); if (selIdxs.length) setSel([]); if (editSelIdxs.length) setEditSel([]); Store.redo(); }
  // アプリバー（画面上部に貼り付いて追従する）。狭い画面ではここが唯一の窓口になる
  function syncBarActs() {
    $("barUndo").disabled = !Store.canUndo();
    $("barRedo").disabled = !Store.canRedo();
    $("barClear").disabled = !Store.items.length && !Store.hasForm();
  }
  $("barUndo").onclick = doUndo;
  $("barRedo").onclick = doRedo;
  $("barClear").onclick = () => { flushNudge(); setSel([]); setEditSel([]); Store.clear(); alertHint("ぜんぶ消しました（⌘Zで戻せます）"); };
  Store.onChange(syncBarActs);
  $("undo").onclick = doUndo;
  $("redo").onclick = doRedo;
  // 全削除（clearボタン/⌘D共通）。進行中のペン下書き・選択も一緒に片付ける
  function clearAll() {
    if (penPts.length) penReset();
    flushNudge();
    setSel([]);
    Store.clear();
  }
  $("clear").onclick = clearAll;

  function setViewMode(v) {
    if (padEdit && v === "edit") exitPadEdit();   // 展開ビュー編集(A)へ移るときはパッド直接編集を畳む
    viewMode = v;
    document.body.classList.toggle("mode-live", v === "live");
    document.body.classList.toggle("mode-grid", v === "grid");
    document.body.classList.toggle("mode-edit", v === "edit");
    if (v !== "edit") document.documentElement.style.removeProperty("--sp-edit-h");
    $("modeLive").classList.toggle("on", v === "live");
    $("modeGrid").classList.toggle("on", v === "grid");
    $("modeEdit").classList.toggle("on", v === "edit");
    // モバイルではモードでパッドのCSS幅が変わる（LIVE=左右分割）→ バッファを表示サイズに追従させないとぼやける
    sizePad();
    if (motif) renderPad();
    if (v === "live") { buildLivePanel(); if (motif) renderLive(motif); }
    else if (v === "edit") renderEdit();
    else scheduleSwatches(0);
    updateParamRowState();
    savePrefs();
  }
  $("modeLive").onclick = () => setViewMode("live");
  $("modeGrid").onclick = () => setViewMode("grid");
  $("modeEdit").onclick = () => setViewMode("edit");

  // 探索パラメータ: セルサイズ / 断片スケール（壁紙・フリーズに効く。Phase 2）
  function applySymParams() {
    const changed = Groups.setParams({ cell: +$("cellRange").value, scale: +$("scaleRange").value });
    if (!changed || !motif) return;
    if (viewMode === "live") renderLive(motif);
    else scheduleSwatches(60);
    savePrefs();
  }
  $("cellRange").addEventListener("input", applySymParams);
  $("scaleRange").addEventListener("input", applySymParams);

  // tidy: 手描き線の「整える」量（Douglas-Peucker eps）。raw座標は不変で描画/出力時に適用
  function setTidy(eps, { persist = true } = {}) {
    Render.setSimplify(eps);
    if ($("tidyRange").value !== String(eps)) $("tidyRange").value = eps;
    motif = Render.buildMotif(Store.items, PAD_W);   // 幾何を組み直して即反映
    renderPad();
    if (viewMode === "live") renderLive(motif);
    else scheduleSwatches(60);
    if (persist) savePrefs();
  }
  $("tidyRange").addEventListener("input", e => setTidy(+e.target.value));

  /* ==== style行: fill(ink/paper/off) × stroke(on/off) × w × a × R ====
     選択があれば選択にだけ適用（1コミット=1undo・既定は変えない=誤爆防止）、なければ新規の既定を変更。
     値はチップ=量子化された入力（15°刻み・16分割と同じ美学）。適用先は毎回alertHintで明示 ==== */
  const W_STEPS = [1, 1.5, 3, 6, 12];
  const A_STEPS = [1, 0.7, 0.45, 0.25];
  const R_STEPS = [0, 4, 8, 16];
  const styleChips = [];   // [{field, value, btn}]
  function makeChips(hostId, field, steps, fmt) {
    const host = $(hostId);
    for (const v of steps) {
      const b = document.createElement("button");
      b.className = "tg";
      b.textContent = fmt(v);
      b.addEventListener("click", () => applyStyleChange(field, v, `${field === "sw" ? "太さ" : field === "alpha" ? "濃度" : "角丸"} ${fmt(v)}`));
      host.appendChild(b);
      styleChips.push({ field, value: v, btn: b });
    }
  }
  makeChips("wChips", "sw", W_STEPS, String);
  makeChips("aChips", "alpha", A_STEPS, v => String(Math.round(v * 100)));
  makeChips("rChips", "r", R_STEPS, String);
  const FILL_BTN = { fillInk: "ink", fillPaper: "paper", fillNone: "none" };
  const STROKE_BTN = { strokeOn: "ink", strokeOff: "none" };
  for (const [id, v] of Object.entries(FILL_BTN))
    $(id).addEventListener("click", () => applyStyleChange("fill", v, `fill ${$(id).textContent}`));
  for (const [id, v] of Object.entries(STROKE_BTN))
    $(id).addEventListener("click", () => applyStyleChange("stroke", v, `stroke ${$(id).textContent}`));

  /* いま操作の対象になっている item index 列。展開ビューでは**展開側の選択**を見る
     （右で選んだものに、左のスタイルチップ・スムーズなどがそのまま効くようにする）。
     宣言は下（編集モードのブロック）だが、呼ばれるのは実行時なので参照できる */
  const targetIdxs = () => viewMode === "edit"
    ? (editSelIdxs.length ? editSelIdxs : editSel ? [editSel.idx] : [])
    : selIdxs;

  function applyStyleChange(field, value, label) {
    const tgt = targetIdxs();
    if (tgt.length) {
      flushNudge();
      // styleOfの解釈が実際に変わるitemだけコミット（手描き線へのfill等のno-opでundo/redo履歴を汚さない）
      const entries = tgt.map(i => {
        const it = Store.items[i];
        const next = { ...it, [field]: value };
        if (JSON.stringify(Store.styleOf(next)) === JSON.stringify(Store.styleOf(it))) return null;
        return [i, next];
      }).filter(Boolean);
      if (!entries.length) { alertHint(`${label} → 適用できる対象がありません`); return; }
      Store.replaceMany(entries);   // 1コミット=1undo（frozen itemはspreadで新オブジェクト化）
      alertHint(`${label} → 選択${entries.length}個`);
    } else {
      defSty = { ...defSty, [field]: value };
      savePrefs();
      alertHint(`${label} → 新規の既定`);
    }
    updateStyleUI();
  }

  /* 塗り／線の反転（イラレのXに相当・⇧X）。fill と stroke を入れ替える。
     strokeにpaperは無い（隠し線はガイドの役目）ので paper塗り→線 は ink線になる（逆は塗りへpaperを戻す）。
     styleOfの解釈が変わらないitem（手描き・開いたpen・line＝塗れない）はスキップ＝no-opコミットしない */
  function swapFillStroke() {
    const swapped = it => {
      const s = Store.styleOf(it);
      const fill = s.stroke === "ink" ? (it.fill === "paper" ? "paper" : "ink") : "none";
      const stroke = s.fill === "none" ? "none" : "ink";
      if (fill === "none" && stroke === "none") return null;   // 不可視は作らない
      return { ...it, fill, stroke };
    };
    if (selIdxs.length) {
      flushNudge();
      const entries = selIdxs.map(i => {
        const it = Store.items[i], next = swapped(it);
        if (!next || JSON.stringify(Store.styleOf(next)) === JSON.stringify(Store.styleOf(it))) return null;
        return [i, next];
      }).filter(Boolean);
      if (!entries.length) { alertHint("塗り／線の反転 → 反転できる対象がありません（手描き線・開いた線は塗れません）"); return; }
      Store.replaceMany(entries);   // 1コミット=1undo
      alertHint(`塗り／線の反転 → 選択${entries.length}個`);
    } else {
      const next = swapped({ kind: "shape", shape: "rect", ...defSty });
      if (!next) return;
      defSty = { ...defSty, fill: next.fill, stroke: next.stroke };
      savePrefs();
      alertHint("塗り／線の反転 → 新規の既定");
    }
    updateStyleUI();
  }
  $("objSwap").onclick = swapFillStroke;

  /* スムーズ（選択パスの全アンカーをスムース点に。もう一度で全部角＝素の直線パスに戻る）。
     図形・手描きはここでpath化する（編集モードで掴んだときと同じ materialize を使う） */
  function smoothSel() {
    flushNudge();
    const idxs = targetIdxs();
    if (!idxs.length) { alertHint("スムーズ → 対象を選んでから（展開ビューなら形かアンカーを選択）"); return; }
    const conv = { stroke: "stroke", line: "line", rect: "shape", polygon: "shape", ellipse: "shape" };
    const entries = [];
    for (const i of idxs) {
      const it = Store.items[i];
      const key = it.kind === "stroke" ? "stroke" : (it.kind === "shape" ? conv[it.shape] : null);
      if (!key && !(it.kind === "shape" && it.shape === "path")) continue;   // 画像などは対象外
      const p = key ? editMaterialize(i, key)[i] : it;
      // トグル判定は「元から全部スムースだったか」で見る（path化した直後を戻り扱いにしない）
      const allSmooth = !key && it.curve && !(it.corners || []).length;
      let next;
      if (allSmooth) { const { curve, corners, ...rest } = p; next = rest; }   // トグル: 全部角に戻す
      else next = { ...p, curve: true, corners: [] };
      if (JSON.stringify(next) !== JSON.stringify(it)) entries.push([i, next]);
    }
    if (!entries.length) { alertHint("スムーズ → 対象がありません"); return; }
    Store.replaceMany(entries);   // 1コミット=1undo（path化を含む）
    alertHint(entries.length === 1 && entries[0][1].curve ? "スムーズ（もう一度で角に戻す）" : `スムーズ → ${entries.length}個`);
  }
  $("objSmooth").onclick = smoothSel;

  /* Bスプライン化（トグル）。曲線の解釈を切り替えるだけで、点は動かさない＝いつでも戻せる。
     Catmull-Rom は点が曲線に乗る／B-スプラインは乗らない（角が丸まり、点を動かしても暴れない）。
     図形・手描き・直線は掴んだときと同じ materialize で path 化してから切り替える。 */
  function splineSel() {
    flushNudge();
    const idxs = targetIdxs();
    if (!idxs.length) { alertHint("Bスプライン → 対象を選んでから（展開ビューなら形かアンカーを選択）"); return; }
    const conv = { stroke: "stroke", line: "line", rect: "shape", polygon: "shape", ellipse: "shape" };
    const entries = [];
    let on = 0, off = 0;
    for (const i of idxs) {
      const it = Store.items[i];
      const key = it.kind === "stroke" ? "stroke" : (it.kind === "shape" ? conv[it.shape] : null);
      let base = it;
      if (key) {                                  // path でないものは先に path 化
        const mat = editMaterialize(i, key);
        base = mat[i];
      } else if (it.kind !== "shape" || it.shape !== "path") continue;
      if (base.curveMode === "bspline") {
        const { curveMode, ...rest } = base;
        entries.push([i, rest]);
        off++;
      } else {
        entries.push([i, { ...base, curve: true, curveMode: "bspline" }]);
        on++;
      }
    }
    if (!entries.length) { alertHint("Bスプライン → 対象になる線がありません（画像は対象外）"); return; }
    Store.replaceMany(entries);                   // 1コミット=1undo
    alertHint(on && off ? `Bスプライン: ${on}個をON・${off}個をOFF`
      : on ? `Bスプラインにしました（${on}個・もう一度押すと戻る）` : `Bスプラインを解除しました（${off}個）`);
  }
  $("objSpline").onclick = splineSel;

  // style行の表示: 選択あり=選択の共通値（混在は無印）/ なし=既定。ラベルで適用先を明示（style·n）
  function updateStyleUI() {
    const tgt = targetIdxs();
    const sts = tgt.map(i => Store.items[i]).filter(Boolean).map(it => Store.styleOf(it));
    const src = f => sts.length ? (sts.every(s => s[f] === sts[0][f]) ? sts[0][f] : undefined) : defSty[f];
    const cur = { fill: src("fill"), stroke: src("stroke"), sw: src("sw"), alpha: src("alpha"), r: src("r") };
    for (const [id, v] of Object.entries(FILL_BTN)) $(id).classList.toggle("on", cur.fill === v);
    for (const [id, v] of Object.entries(STROKE_BTN)) $(id).classList.toggle("on", cur.stroke === v);
    for (const c of styleChips) c.btn.classList.toggle("on", cur[c.field] === c.value);
    $("styleLbl").textContent = sts.length
      ? `見た目 — 選んだ${sts.length}個に効く${viewMode === "edit" && editSelIdxs.length ? "（展開で選択中）" : ""}`
      : "見た目 — 次に描くものの既定";
    // unite/minusは閉じた図形2個以上で有効（.dis=薄表示。押すと理由がヒントに出る）
    const eligN = tgt.filter(i => isBoolable(Store.items[i])).length;
    $("opUnite").classList.toggle("dis", eligN < 2);
    $("opMinus").classList.toggle("dis", eligN < 2);
    $("opCross").classList.toggle("dis", eligN < 2);
    $("disH").classList.toggle("dis", selIdxs.length < 3);   // 等間隔は3個以上で意味を持つ
    $("disV").classList.toggle("dis", selIdxs.length < 3);
  }
  Store.onChange(updateStyleUI);   // undo/redoでスタイルが戻ったときも表示を追従

  // ヘルプ（浮遊パネル。Escでも閉じる）
  $("helpBtn").onclick = () => { $("cheat").hidden = !$("cheat").hidden; };
  $("cheatClose").onclick = () => { $("cheat").hidden = true; };

  /* パネルの Disclosure（役割ごとに畳む）。開閉は prefs に残す＝
     「自分がよく使うグループだけ開いている」状態が次回も続く。
     セクション（grp*）も畳める＝見出しが入口として必ず視野に残る */
  const SUB_IDS = [
    "grpDraw", "grpStyle", "grpExpand", "grpIO",       // パネルのセクション
    "subDrawOpt", "subStyleMore",                       // セクションの中の畳み
    "subXform", "subPath", "subBool", "subOffset",      // 選択パネル
  ];
  for (const id of SUB_IDS) $(id).addEventListener("toggle", () => savePrefs());

  /* ==== 出力の2色（ink=線・塗り / paper=地）。UIクロームはネイビーのまま ==== */
  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  function applyColors(ink, paper, { persist = true } = {}) {
    if (!HEX_RE.test(ink)) ink = "#0044cc";
    if (!HEX_RE.test(paper)) paper = "#ffffff";
    Render.setColors({ ink, paper });
    document.documentElement.style.setProperty("--paper", paper);
    $("inkColor").value = ink; $("paperColor").value = paper;
    if (motif) {
      renderPad();
      if (viewMode === "live") renderLive(motif);
      else scheduleSwatches(60);
    }
    if (persist) savePrefs();
  }
  $("inkColor").addEventListener("input", e => applyColors(e.target.value, $("paperColor").value));
  $("paperColor").addEventListener("input", e => applyColors($("inkColor").value, e.target.value));

  // ツール: free/pen/line/rect/ellipse/polygon/erase/axis
  const TOOL_LABEL = {
    move: "選択", anchor: "アンカー", form: "形成", freehand: "手描き", pen: "ペン",
    line: "直線", rect: "矩形", ellipse: "円", polygon: "多角形", erase: "消しゴム", axis: "回転中心",
  };
  const TOOL_BTN = { freehand: "tFree", move: "tMove", anchor: "tAnchor", form: "tForm", pen: "tPen", line: "tLine", rect: "tRect", ellipse: "tEllipse", polygon: "tPoly", erase: "tErase", axis: "tAxis" };
  const isAnchorTool = t => t === "move" || t === "anchor";   // どちらもアンカー編集を続けられる
  let toolPrev = "move";   // 形成に入る前のツール（⇧M のトグル用）
  function setTool(t) {
    if (t === "form" && tool !== "form") toolPrev = tool;
    if (tool === "pen" && t !== "pen" && penPts.length) penReset();   // ペン中断は破棄
    if (padEdit && !isAnchorTool(t)) exitPadEdit();
    if (tool === "move" && t !== "move") { flushNudge(); marquee = null; dupDrag = false; handleDrag = null; setSel([]); }
    if (tool === "form" && t !== "form") { padForm = null; padHoverFaces = []; }
    /* ツールを跨ぐ途中状態は必ず捨てる（前のツールの選択が残って誤操作になるのを防ぐ）。
       展開ビュー側も同じ tool を見ているので、ここ1箇所で両方の面倒をみる */
    if (t !== tool) {
      hoverFaces = []; hoverEdges = []; formDrag = null;
      editSel = null; editDrag = null; editPreview = null; editSnapHit = null;
      editXf = null; editMarquee = null;
      if (t !== "form") { editSelIdxs = []; updateEditSelInfo(); }   // 形成は選択で対象を絞れるので持ち越す
    }
    tool = t;
    for (const [k, id] of Object.entries(TOOL_BTN)) $(id).classList.toggle("on", k === t);
    document.body.classList.toggle("tool-poly", t === "polygon");
    document.body.classList.toggle("tool-anchor", t === "anchor");
    pad.style.cursor = t === "freehand" || t === "pen" ? "crosshair"
      : t === "erase" || t === "move" || t === "anchor" || t === "form" ? "pointer" : "cell";
    syncEditToolUI();   // 展開ビューのセグメント・設定行・カーソルも同じ tool に合わせる
    if (viewMode === "edit") renderEdit();
    savePrefs();
  }
  for (const [t, id] of Object.entries(TOOL_BTN)) $(id).onclick = () => {
    if (t === "axis" && tool === "axis") { setAxis(null); return; }   // axis再タップで中心リセット
    setTool(t);
  };

  // 回転対称の中心（ロゼットに効く）。マーカーはパッド専用・書き出し非混入
  function setAxis(pt) {
    axis = pt ? [pt[0], pt[1]] : null;
    Groups.setParams({ center: axis });
    renderPad();
    if (motif) { if (viewMode === "live") renderLive(motif); else scheduleSwatches(60); }
    savePrefs();
  }

  function setSnap(on) {
    snapOn = on;
    $("snapBtn").classList.toggle("on", on);
    savePrefs();
  }
  $("snapBtn").onclick = () => setSnap(!snapOn);
  function setSides(n) {
    sides = Geom.clamp(n, 3, 12);
    $("sidesVal").textContent = sides;
    savePrefs();
  }
  $("sidesDown").onclick = () => setSides(sides - 1);
  $("sidesUp").onclick = () => setSides(sides + 1);

  function setGuide(g) {
    guide = g;
    $("gOff").classList.toggle("on", g === "off");
    $("gGrid").classList.toggle("on", g === "grid");
    $("gCircle").classList.toggle("on", g === "circle");
    renderPad();
    if (viewMode === "edit") renderEdit();   // 展開ビューにも同じガイドを出す
    savePrefs();
  }
  $("gOff").onclick = () => setGuide("off");
  $("gGrid").onclick = () => setGuide("grid");
  $("gCircle").onclick = () => setGuide("circle");

  function setPngScale(s) {
    pngScale = s;
    $("s2").classList.toggle("on", s === 2);
    $("s4").classList.toggle("on", s === 4);
    savePrefs();
  }
  $("s2").onclick = () => setPngScale(2);
  $("s4").onclick = () => setPngScale(4);

  function setPngBg(b) {
    pngBg = b;
    $("bgWhite").classList.toggle("on", b === "white");
    $("bgClear").classList.toggle("on", b === "clear");
    savePrefs();
  }
  $("bgWhite").onclick = () => setPngBg("white");
  $("bgClear").onclick = () => setPngBg("clear");

  // undo/redo の「今は効かない」を薄く表示
  function updateUndoState() {
    $("undo").classList.toggle("dis", !Store.canUndo());
    $("redo").classList.toggle("dis", !Store.canRedo());
  }
  Store.onChange(updateUndoState);

  /* ==== 書き出し（GRID） ==== */
  $("saveSvg").onclick = () => {
    for (const s of selected()) {
      const text = Exporter.svg(s.spec, Store.items, PAD_W, SW, formedItems(s.spec));
      if (text) Exporter.downloadText(text, `sym-${fileName(s.spec)}-${Exporter.stamp()}.svg`);
    }
  };
  const savePngFor = list => {
    for (const s of list) {
      Exporter.png(s.spec, Store.items, PAD_W, SW, pngScale, blob =>
        Exporter.downloadBlob(blob, `sym-${fileName(s.spec)}-${pngScale}x-${Exporter.stamp()}.png`),
        pngBg === "clear" ? null : Render.colors().paper, formedItems(s.spec));
    }
  };
  $("copySvg").onclick = async () => {
    const sel = selected();
    if (!sel.length) { alertHint("一覧で群をひとつ選んでください（枠をクリック）"); return; }
    const text = Exporter.svg(sel[0].spec, Store.items, PAD_W, SW, formedItems(sel[0].spec));
    if (!text) { alertHint("ベクターがありません"); return; }
    try {
      // SVGコードをテキストとして書く（Illustrator 2022以降/Figmaは⌘Vでベクター貼り付け可）
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          "image/svg+xml": new Blob([text], { type: "image/svg+xml" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      alertHint(`${specName(sel[0].spec)} のSVGをコピーしました（Illustrator/Figmaに⌘V）` + (sel.length > 1 ? `※先頭1枚のみ` : ""));
    } catch (_) {
      try { await navigator.clipboard.writeText(text); alertHint("SVGコードをコピーしました"); }
      catch (e2) { alertHint("コピーできませんでした（保存を使ってください）"); }
    }
  };
  $("savePng").onclick = () => savePngFor(selected());
  $("saveAllPng").onclick = () => savePngFor(swatches);

  /* ==== 公開ギャラリーへ投稿（Q25=公開ギャラリー） ====
     galleryブランチ items/ にGitHub Contents APIで1ファイル追加。
     デプロイ(gh-pages force-push)と独立なので消えない。スマホからも投稿できる。
     初回はFine-grainedトークン（このリポのContents: Read and write）を貼り付け→localStorage */
  const GH_REPO = "shungo3215-svg/symmetry-machine";
  const GH_TOKEN_KEY = "symmetry-machine.ghtoken";
  function b64utf8(s) {   // UTF-8安全なbase64（大きな文字列でも壊れないようチャンク処理）
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  $("galleryUp").onclick = async () => {
    const sel = selected();
    if (!sel.length) { alertHint("ギャラリーに載せるスワッチを選択してください"); return; }
    if (!motif || !motif.bbox) { alertHint("まだ何も描かれていません"); return; }
    let token = localStorage.getItem(GH_TOKEN_KEY) || "";
    if (!token) {
      token = (prompt("GitHubトークンを貼り付け\n（github.com/settings/personal-access-tokens → Fine-grained token → Repository: symmetry-machine のみ → Permissions: Contents = Read and write）") || "").trim();
      if (!token) return;
      localStorage.setItem(GH_TOKEN_KEY, token);
    }
    const spec = sel[0].spec;
    const cv = document.createElement("canvas");
    cv.width = SW * 2; cv.height = SW * 2;   // 2x PNG（380px）をエントリに埋め込む
    Render.swatchInto(cv.getContext("2d"), SW, 2, spec, motif, PAD_W, Render.colors().paper);
    const d = new Date(), p = n => String(n).padStart(2, "0");
    const entry = {
      v: 1,
      date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
      group: specName(spec),
      gens: spec.kind === "custom" ? spec.def.gens : undefined,   // カスタム群はレシピも残す
      ink: $("inkColor").value, paper: $("paperColor").value,
      params: Groups.getParams(),
      png: cv.toDataURL("image/png"),
      doc: Store.toJSON({ noImages: true }),   // 後で開き直せるようベクターも保存
    };
    alertHint("ギャラリーへ投稿中…");
    try {
      const res = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/items/${Exporter.stamp()}.json`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        body: JSON.stringify({ message: `gallery: ${entry.group}`, branch: "gallery", content: b64utf8(JSON.stringify(entry)) }),
      });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem(GH_TOKEN_KEY);
        alertHint("トークンが無効でした（もう一度押すと再入力できます）");
      } else if (!res.ok) {
        alertHint(`投稿できませんでした（HTTP ${res.status}）`);
      } else {
        alertHint(`ギャラリーに追加しました${sel.length > 1 ? "（先頭1枚のみ）" : ""}`);
      }
    } catch (_) {
      alertHint("投稿できませんでした（オフライン？）");
    }
  };

  /* doc JSON にカスタム群も同梱する（別ブラウザ・別端末へ持っていける）。
     後方互換: customs が無いJSONはそのまま読める / 既存のカスタムは消さずにマージする */
  $("jsonOut").onclick = () =>
    Exporter.downloadText(JSON.stringify({ ...Store.toJSON(), customs }),
      `sym-doc-${Exporter.stamp()}.json`, "application/json");
  $("jsonIn").addEventListener("change", e => {
    const f = e.target.files?.[0]; if (!f) return;
    f.text().then(text => {
      let data;
      try { data = JSON.parse(text); Store.fromJSON(data); }
      catch (err) { alertHint("JSONを読めませんでした"); return; }
      const added = mergeCustoms(data.customs);
      if (added) { scheduleSwatches(0); alertHint(`読み込みました（カスタム群 ${added}件を追加）`); }
    });
    e.target.value = "";
  });
  // 同じ生成元のルールが既にあれば足さない（名前は違っても中身で判定）
  function mergeCustoms(raw) {
    if (!Array.isArray(raw)) return 0;
    const have = new Set(customs.map(d => JSON.stringify(d.gens)));
    let added = 0;
    for (const d of raw) {
      if (!d || !Array.isArray(d.gens)) continue;
      const gens = d.gens.filter(validGen).map(g => ({ ...g }));
      if (!gens.length) continue;
      const key = JSON.stringify(gens);
      if (have.has(key)) continue;
      have.add(key);
      const def = { name: uniqueCustomName(typeof d.name === "string" && d.name ? d.name : sigFromGens(gens)), gens };
      customs.push(def);
      addCustomSwatch(def);
      added++;
    }
    if (added) saveCustoms();
    return added;
  }

  /* ==== 編集モード（S1）: 展開ビューでアンカーを直接編集 ====
     真実はモチーフ・展開は純関数（Groups.layout）なので、掴んだコピーの行列の逆写像で
     ビュー座標→パッド座標に引き戻して item.points を書き換えるだけで、
     全コピー（回転・鏡映・映進を含む）が構造的に追従する（DESIGN-direct-edit.md §1）。
     S1の対象はpath（ペン・シェイプ演算の結果・穴含む）。図形/手描きのpath化はS2 ==== */
  const editCv = $("editCv");
  const ectx = editCv.getContext("2d");
  let padLocked = false;    // 造形（パッド）のロック
  let anchorView = "one";   // 展開ビューのアンカー表示: "one"(既定) | "all" | "off"
  let editSel = null;       // {idx, ring(-1=外周 | 穴index), pt}
  let editDrag = null;      // {inv} 掴んだコピーの逆行列（ドラッグ中固定=リスト順の揺れに依存しない）
  let editPreview = null;   // ドラッグ中のpatched items
  let editSnapHit = null;   // {x,y,kind,dir?} 吸着先（ビュー座標・画面表示のみ／書き出しには出さない）
  let editSize = 280;
  let editScheduled = false;

  const editSpecNow = () => {
    const sel = selected();
    return sel.length ? sel[0].spec : { kind: "wallpaper", name: Groups.FAVORITES[0] };
  };
  // 手描きのアンカー化の細かさ: tidyに追従（最低2=見た目の変化を1〜2px以内に抑えつつ点数を絞る）
  const editStrokeEps = () => Math.max(+$("tidyRange").value || 0, 2);
  // 編集できるアンカー一覧（パッド座標）。path以外は conv 印つき=掴んだ瞬間にpath化して編集
  function editablePoints(items) {
    const out = [];
    items.forEach((it, idx) => {
      if (it.kind === "stroke") {   // 手描き: 表示と同じ簡略化の点列をアンカーにする（掴むと曲線パス化）
        Geom.simplifyDP(Geom.resample(it.raw, 3), editStrokeEps())
          .forEach((p, pi) => out.push({ idx, ring: -1, pt: pi, x: p[0], y: p[1], conv: "stroke", smooth: true }));
        return;
      }
      if (it.kind !== "shape") return;
      if (it.shape === "path") {
        const cs = it.curve ? new Set(it.corners || []) : null;
        it.points.forEach((p, pi) => out.push({ idx, ring: -1, pt: pi, x: p[0], y: p[1], smooth: !!(cs && !cs.has(pi)) }));
        (it.holes || []).forEach((ring, ri) => ring.forEach((p, pi) => out.push({ idx, ring: ri, pt: pi, x: p[0], y: p[1] })));
        return;
      }
      if (it.shape === "line") {
        out.push({ idx, ring: -1, pt: 0, x: it.x0, y: it.y0, conv: "line" });
        out.push({ idx, ring: -1, pt: 1, x: it.x1, y: it.y1, conv: "line" });
        return;
      }
      if (it.shape === "ellipse") {   // 円/楕円は8アンカーの曲線パス化（見た目の差は半径の0.1%以下）
        ellipseToCurve(it).points.forEach((p, pi) =>
          out.push({ idx, ring: -1, pt: pi, x: p[0], y: p[1], conv: "ellipse", smooth: true }));
        return;
      }
      if (it.shape === "rect" || it.shape === "polygon") {   // 頂点をアンカーとして掴める（掴むとpath化）
        shapeToPath(it).points.forEach((p, pi) => out.push({ idx, ring: -1, pt: pi, x: p[0], y: p[1], conv: "shape" }));
      }
    });
    return out;
  }
  // 掴んだitemをpath化した作業用items（コミットは pointerup で1回=変換+移動が1undo）
  function editMaterialize(idx, conv) {
    const it = Store.items[idx];
    let next = it;
    if (conv === "stroke") {
      // 手描き→曲線パス（スムース点）: 表示と同じCRパイプラインなので見た目をほぼ保ったまま疎なアンカーになる
      const pts = Geom.simplifyDP(Geom.resample(it.raw, 3), editStrokeEps()).map(p => [p[0], p[1]]);
      next = { kind: "shape", shape: "path", points: pts, closed: false, curve: true, ...carryStyle(it) };
    } else if (conv === "ellipse") next = ellipseToCurve(it);
    else if (conv === "shape") next = shapeToPath(it);
    else if (conv === "line") next = { kind: "shape", shape: "path", points: [[it.x0, it.y0], [it.x1, it.y1]], closed: false, ...carryStyle(it) };
    return Store.items.map((x, k) => k === idx ? next : x);
  }
  // 全コピーの合成行列（パッド座標→ビュー座標）。逆写像はこの逆行列
  const editViews = bbox => {
    const { place, insts } = Groups.layout(editSpecNow(), editSize, PAD_W, bbox);
    return insts.map(inst => Geom.mul(inst, place.mat));
  };
  const editPos = e => {
    const r = editCv.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * editSize, (e.clientY - r.top) / r.height * editSize];
  };

  /* 吸着マーカー（画面のみ・スワッチ/SVG/PNGには絶対に出さない）。
     点=丸 / 輪郭=短い接線 / 鏡映軸=長い線。線の上でも見えるよう白フチ→ネイビーの2度描き。
     k=座標スケール（パッドは padScale 済みの座標系なので 1/padScale で見た目の太さを揃える） */
  function drawSnapMark(ctx, s, k) {
    const path = () => {
      ctx.beginPath();
      if (s.kind === "cross") {   // 交点は×印（丸＝点、線＝方向、と見分けがつく）
        const r = 5.5 * k;
        ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y + r);
        ctx.moveTo(s.x + r, s.y - r); ctx.lineTo(s.x - r, s.y + r);
        return;
      }
      if (s.dir) {
        const L = Math.hypot(s.dir[0], s.dir[1]) || 1;
        const len = (s.kind === "axis" ? 26 : 9) * k;
        const ux = s.dir[0] / L * len, uy = s.dir[1] / L * len;
        ctx.moveTo(s.x - ux, s.y - uy);
        ctx.lineTo(s.x + ux, s.y + uy);
      }
      const rad = (s.kind === "anchor" ? 5.5 : 4) * k;
      ctx.moveTo(s.x + rad, s.y);
      ctx.arc(s.x, s.y, rad, 0, 2 * Math.PI);
    };
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 3.5 * k; path(); ctx.stroke();
    ctx.strokeStyle = "#0044cc"; ctx.lineWidth = 1.25 * k; path(); ctx.stroke();
  }

  function renderEdit() {
    if (viewMode !== "edit") return;
    /* 展開は正方形なので、**幅と高さの小さいほう**に収める。スマホで幅いっぱいに広げると
       画面より縦に長くなり、編集しているものがスクロールしないと見えなくなる */
    const narrow = window.innerWidth < 900;
    const availW = narrow ? Math.round(window.innerWidth * 0.86) : ($("edit").clientWidth || 560);
    const availH = (window.innerHeight || 800) * (narrow ? 0.46 : 1) - (narrow ? 0 : 200);
    const size = Math.max(240, Math.min(640, availW, Math.max(240, availH)));
    if (editCv.width !== Math.round(size * dpr)) {
      editCv.width = Math.round(size * dpr);
      editCv.height = Math.round(size * dpr);
      editCv.style.width = size + "px";
    }
    editSize = size;
    const items = editPreview || Store.items;
    const m = Render.buildMotif(items, PAD_W);
    Render.swatchInto(ectx, size, dpr, editSpecNow(), m, PAD_W, Render.colors().paper);
    /* ガイド（格子／同心円）。パッドでは作品の背後だが、ここは swatchInto が地を塗り直すので上に置く。
       位置合わせの目安なので上でも機能する。画面のみ＝書き出しには出ない */
    if (guide !== "off") {
      ectx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ectx.save();
      ectx.globalAlpha = 0.55;
      Render.drawGuides(ectx, size, guide, null);
      ectx.restore();
    }
    if (!m.bbox) { $("editHint").textContent = "左のパッドで断片を描くと、ここに展開が出ます"; return; }
    const views = editViews(m.bbox);
    const pts = editablePoints(items);
    if (editSel && !pts.some(q => q.idx === editSel.idx && q.ring === editSel.ring && q.pt === editSel.pt))
      editSel = null;   // undo等で消えた選択は捨てる
    ectx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let overflow = false;
    if (editToolOf(tool) === "anchor" && views.length && pts.length) {
      // 基準コピー=モチーフ中心がビュー中心に最も近い1枚（全アンカーを表示する）
      const cx0 = (m.bbox.x0 + m.bbox.x1) / 2, cy0 = (m.bbox.y0 + m.bbox.y1) / 2;
      let base = views[0], bd = Infinity;
      for (const V of views) {
        const [x, y] = Geom.apply(V, cx0, cy0);
        const d = Math.hypot(x - size / 2, y - size / 2);
        if (d < bd) { bd = d; base = V; }
      }
      // 角=四角 / スムース点=丸（イラレの見分けと同じ）
      const mark = (x, y, s, fillCol, strokeCol, round) => {
        if (round) {
          ectx.beginPath();
          ectx.arc(x, y, s, 0, 2 * Math.PI);
          if (fillCol) { ectx.fillStyle = fillCol; ectx.fill(); }
          if (strokeCol) { ectx.strokeStyle = strokeCol; ectx.lineWidth = 1; ectx.stroke(); }
        } else {
          if (fillCol) { ectx.fillStyle = fillCol; ectx.fillRect(x - s, y - s, s * 2, s * 2); }
          if (strokeCol) { ectx.strokeStyle = strokeCol; ectx.lineWidth = 1; ectx.strokeRect(x - s, y - s, s * 2, s * 2); }
        }
      };
      /* アンカーの表示量は制作者が選ぶ（位数が大きい群だと全コピー表示は一瞬で溢れる）。
         1コピーだけ=既定 / すべて / 隠す。**当たり判定は表示と一致させる**
         （見えないのに掴める、を作らない。「隠す」は形だけ見たいときのモード） */
      overflow = views.length * pts.length > 2400;   // 安全弁（重さ対策）
      const showViews = anchorView === "off" ? []
        : (anchorView === "one" || overflow) ? [base] : views;
      for (const V of showViews) {
        const isBase = V === base;
        for (const p of pts) {
          const [x, y] = Geom.apply(V, p.x, p.y);
          if (x < -4 || y < -4 || x > size + 4 || y > size + 4) continue;
          mark(x, y, isBase ? 2.5 : 2, "#fff", isBase ? "rgba(0,68,204,.6)" : "rgba(0,68,204,.3)", p.smooth);
        }
      }
      if (editSel && anchorView !== "off") {   // 選択アンカーは全コピーで強調（=どこが連動するかの可視化）
        const p = pts.find(q => q.idx === editSel.idx && q.ring === editSel.ring && q.pt === editSel.pt);
        for (const V of views) {
          const [x, y] = Geom.apply(V, p.x, p.y);
          mark(x, y, V === base ? 3.5 : 2.5, V === base ? "#0044cc" : "rgba(0,68,204,.35)", null, p.smooth);
        }
      }
    }
    /* シェイプ形成: つないだ面群は union の輪郭をインクで描き直し（＝内部の重なり線が消えて
       1つの塊に見える）、けずった面は紙色で塗る（＝白抜きと同じ扱い）。
       面の計算は重いので、記録があるか形成ツールのときだけ通る */
    if (cutOrbits().length || mergeGroups().length || cutEdges().length || editToolOf(tool) === "shape") {
      /* 面・線は FORM_SIZE(=PAD_W) 座標で計算されている。表示サイズへはここでスケールするだけ
         ＝計算はサイズに依らず1つの座標系、表示はcanvasの都合、という分離 */
      const fk = size / FORM_SIZE;
      ectx.setTransform(dpr * fk, 0, 0, dpr * fk, 0, 0);
      const lw = v => v / fk;   // 線幅は見た目を保つため逆補正する
      const strokeSeg = seg => {
        ectx.beginPath();
        ectx.moveTo(seg[0][0], seg[0][1]);
        for (let i = 1; i < seg.length; i++) ectx.lineTo(seg[i][0], seg[i][1]);
        ectx.stroke();
      };
      const ringPath = rings => {
        const p = new Path2D();
        for (const rg of rings) {
          if (!rg || rg.length < 3) continue;
          p.moveTo(rg[0][0], rg[0][1]);
          for (let i = 1; i < rg.length; i++) p.lineTo(rg[i][0], rg[i][1]);
          p.closePath();
        }
        return p;
      };
      const pathOf = f => ringPath([f.outer, ...(f.holes || [])]);
      for (const rings of mergedRings()) {   // つないだ塊（塗り＋外周線＝1オブジェクトに見える）
        const p = ringPath(rings);
        ectx.fillStyle = Render.colors().ink;
        ectx.fill(p, "evenodd");
        ectx.strokeStyle = Render.colors().ink;
        ectx.lineWidth = lw(mergeSW());
        ectx.lineJoin = "round";
        ectx.stroke(p);
      }
      if (cutOrbits().length) {
        /* 塗るだけだと元の輪郭線が線幅の半分だけはみ出して「消したのに縁が残る」ので、
           同じ紙色で輪郭もなぞる（イラレの形成ツールで線ごと消えるのに合わせる） */
        const fcv = currentFaces();
        ectx.fillStyle = ectx.strokeStyle = Render.colors().paper;
        ectx.lineWidth = lw(mergeSW());
        ectx.lineJoin = "round";
        for (const f of fcv.faces) if (faceIsCut(f, fcv)) {
          const p = pathOf(f);
          ectx.fill(p, "evenodd");
          ectx.stroke(p);
        }
      }
      if (cutEdges().length) {   // 消した線を紙色で上書き（元の線を確実に隠すため少し太く）
        ectx.strokeStyle = Render.colors().paper;
        ectx.lineWidth = lw(mergeSW() + 2);
        ectx.lineCap = "round";
        ectx.lineJoin = "round";
        for (const e of currentEdges()) if (edgeIsCut(e.seg, currentFaces())) strokeSeg(e.seg);
        ectx.lineCap = "butt";
      }
      if (editToolOf(tool) === "shape") {   // 画面のみのハイライト（書き出しには出ない）
        if (hoverFaces.length) {
          ectx.fillStyle = (formDrag && formDrag.alt) ? "rgba(190,60,60,.20)" : "rgba(39,93,114,.18)";
          for (const f of hoverFaces) ectx.fill(pathOf(f), "evenodd");
        }
        if (formDrag && formDrag.trail.length > 1) {   // なぞった跡（イラレの赤い軌跡と同じ役目）
          ectx.strokeStyle = formDrag.alt ? "rgba(190,60,60,.7)" : "rgba(39,93,114,.7)";
          ectx.lineWidth = lw(1.5);
          ectx.setLineDash([lw(4), lw(3)]);
          strokeSeg(formDrag.trail);
          ectx.setLineDash([]);
        }
        if (hoverEdges.length) {   // 線は「これが消える」と分かるよう赤で太くなぞる
          ectx.strokeStyle = "rgba(190,60,60,.8)";
          ectx.lineWidth = lw(mergeSW() + 3);
          ectx.lineCap = "round";
          ectx.lineJoin = "round";
          for (const e of hoverEdges) strokeSeg(e.seg);
          ectx.lineCap = "butt";
        }
      }
      ectx.setTransform(dpr, 0, 0, dpr, 0, 0);   // 以降（枠・吸着マーカー）はビュー座標に戻す
    }
    if (editToolOf(tool) === "select") drawEditBox();
    else if (editToolOf(tool) === "shape" && editSelIdxs.length) {
      // 形成の対象を絞っているときは、その範囲を破線で示す（「なぜここは反応しないのか」を無くす）
      const V = editSelView(Store.items);
      if (V) for (const i of editSelIdxs) {
        const bb = Render.itemBBox(Store.items[i]);
        if (bb) strokeBoxVia(bb, V, "rgba(0,68,204,.45)", [3, 3]);
      }
    }
    if (editSnapHit) drawSnapMark(ectx, editSnapHit, 1);
    $("editHint").textContent = editHintText(overflow);
    syncEditBandHeight();
  }
  /* 縦積み（スマホ）では展開ビューを画面に固定するので、本文をその分だけ下げる。
     帯の高さはツールの設定行で変わるため、描画のたびに実測して CSS 変数へ入れる */
  function syncEditBandHeight() {
    if (window.innerWidth >= 900 || viewMode !== "edit") {
      document.documentElement.style.removeProperty("--sp-edit-h");
      return;
    }
    const h = $("edit").getBoundingClientRect().height;
    if (h > 0) document.documentElement.style.setProperty("--sp-edit-h", Math.round(h + 8) + "px");
  }

  // 展開ビューのヒント（いま選んでいるツールの操作だけを書く＝読む量を増やさない）
  function editHintText(overflow) {
    const g = specName(editSpecNow());
    if (!editToolOf(tool))
      return `${g} — いまのツール（${TOOL_LABEL[tool] || tool}）は左の造形パッド用です。`
        + `展開をさわるには 選択 V / アンカー A / 形成 ⇧M のどれかに持ち替えてください`;
    if (editToolOf(tool) === "shape")
      return `${g} — 領域をクリック＝その領域を1つの形にする／⌥＋クリック＝けずる／⌥＋線の上＝その線だけ消す（赤くなぞられたところ）／なぞればまとめて。`
        + `対称の兄弟も同時に処理するので対称は保たれます。モチーフは無傷なので「全部もどす」でいつでも元通り`
        + (editSelIdxs.length ? `。いまは選んだ${editSelIdxs.length}個だけを対象にしています（Escで全部に戻る）` : "");
    if (editToolOf(tool) === "select")
      return `${g} — 形をクリックで選択（⇧＝追加／空所ドラッグ＝まとめて選ぶ／⌘A＝全部）。`
        + `枠の中をドラッグ＝移動／角＝拡大縮小（⇧＝等比）／辺＝一方向／角の少し外＝回転（⇧＝15°）／矢印キー＝1pxずつ／⌫＝削除。`
        + `左のスタイルチップ（塗り・線・太さ）もこの選択に効きます。掴んだコピーの見た目どおりに動きます`;
    return anchorView === "off"
      ? `${g} — アンカーを隠しています（形だけ見るモード）。触るには「1コピー」か「すべて」に戻す`
      : `${g} — ドラッグ＝移動（全コピー連動）／線の上をダブルクリック＝アンカー追加／アンカーをダブルクリック＝角⇄スムース／delete＝削除／Esc＝解除`
        + (anchorView === "one" ? "。いまは中央のコピーだけにアンカーを出しています（動かせば全部が連動）" : "")
        + (overflow && anchorView === "all" ? "。数が多いので中央のコピーに絞りました" : "");
  }

  /* ---- 選択ツールの枠と変形ハンドル（展開ビュー）----
     掴んだコピーの行列Vでbboxの4隅を送るので、枠は回転・鏡映したコピーの上に正しく乗る。
     ハンドルの当たり判定・ドラッグの計算は **逆写像でパッド座標へ引き戻してから** 行う
     ＝「鏡の中の手」（掴んだコピーの見た目どおりに動き、モチーフ側は鏡映に応じて逆に動く）。 */
  /* 掴んだコピーは「何番目か（vi）」で覚える。形を変えるとモチーフのbboxが動いて
     展開の配置行列も変わるので、行列そのものを持つと枠が置き去りになる */
  const unionBBox = bs => bs.reduce((u, b) => !u ? { ...b } : {
    x0: Math.min(u.x0, b.x0), y0: Math.min(u.y0, b.y0),
    x1: Math.max(u.x1, b.x1), y1: Math.max(u.y1, b.y1),
  }, null);
  // 選択中のコピー行列（views の editSelVi 番目）。展開が組めないときは null
  function editSelView(items) {
    const m = Render.buildMotif(items, PAD_W);
    if (!m.bbox) return null;
    const views = editViews(m.bbox);
    return views[Math.min(editSelVi, views.length - 1)] || null;
  }
  function editBoxGeom() {
    if (!editSelIdxs.length) return null;
    const items = editPreview || Store.items;
    const b = unionBBox(editSelIdxs.map(i => Render.itemBBox(items[i])).filter(Boolean));
    if (!b) return null;
    const V = editSelView(items);
    if (!V) return null;
    return { b, V, hs: HANDLES.map(h => ({ h, v: Geom.apply(V, ...hPos(b, h)) })) };
  }
  // パッド座標の矩形を、コピー行列Vで送った四角として描く（枠は回転・鏡映したコピーの上に乗る）
  function strokeBoxVia(b, V, style, dash) {
    const cs = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(p => Geom.apply(V, p[0], p[1]));
    ectx.strokeStyle = style;
    ectx.lineWidth = 1;
    ectx.setLineDash(dash || []);
    ectx.beginPath();
    ectx.moveTo(cs[0][0], cs[0][1]);
    for (let i = 1; i < 4; i++) ectx.lineTo(cs[i][0], cs[i][1]);
    ectx.closePath();
    ectx.stroke();
    ectx.setLineDash([]);
  }
  function drawEditBox() {
    if (editMarquee) {   // 範囲選択の矩形（画面のみ）
      const r = editMarquee;
      ectx.strokeStyle = "rgba(0,68,204,.55)";
      ectx.lineWidth = 1;
      ectx.setLineDash([3, 3]);
      ectx.strokeRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
      ectx.setLineDash([]);
    }
    const g = editBoxGeom();
    if (!g) return;
    const items = editPreview || Store.items;
    if (editSelIdxs.length > 1)   // 個々の形の枠（何が選ばれているかを示す）
      for (const i of editSelIdxs) {
        const bb = Render.itemBBox(items[i]);
        if (bb) strokeBoxVia(bb, g.V, "rgba(0,68,204,.3)");
      }
    strokeBoxVia(g.b, g.V, "rgba(0,68,204,.6)");
    for (const { v } of g.hs) {   // 白フチ＋ネイビー＝作品の色に紛れない（パッドの変形ハンドルと同じ流儀）
      ectx.fillStyle = "#fff";
      ectx.strokeStyle = "#0044cc";
      ectx.fillRect(v[0] - 3.5, v[1] - 3.5, 7, 7);
      ectx.strokeRect(v[0] - 3.5, v[1] - 3.5, 7, 7);
    }
  }
  // ビュー座標vが枠のどこを掴んだか。角=拡大縮小 / 辺=一方向 / 枠の外側の角付近=回転 / 中=移動
  function editHandleAt(v, forTouch) {
    const g = editBoxGeom();
    if (!g) return null;
    const tol = forTouch ? 14 : 8;
    for (const { h, v: hv } of g.hs)
      if (Math.hypot(v[0] - hv[0], v[1] - hv[1]) <= tol) return { mode: "scale", h, b: g.b };
    const p = Geom.apply(Geom.invert(g.V), v[0], v[1]);   // パッド座標で内外を見る（枠は回転しているため）
    const inside = p[0] >= g.b.x0 - 1 && p[0] <= g.b.x1 + 1 && p[1] >= g.b.y0 - 1 && p[1] <= g.b.y1 + 1;
    if (!inside) {
      for (const { h, v: hv } of g.hs) {
        if (h.axis) continue;
        if (Math.hypot(v[0] - hv[0], v[1] - hv[1]) <= (forTouch ? 30 : 24)) return { mode: "rotate", b: g.b };
      }
      return null;
    }
    return { mode: "move", b: g.b };
  }
  /* 面は重いので items/spec/size が変わったときだけ作り直す */
  let facesCache = { items: null, spec: null, sub: null, faces: [], mats: [] };
  // 形成の対象: 選択されていればそれだけ／未選択なら全部（イラレは未選択だと使えないが、
  // ここは「すぐ触れて、絞りたければ選ぶ」を採る＝制作者の選択）
  const formSubset = () => editSelIdxs.map(i => Store.items[i]).filter(Boolean);
  function currentFaces() {
    const spec = editSpecNow();
    const sub = editSelIdxs.join(",");
    // 群が変わると「どの領域か」の意味も変わるので、形成の記録は捨てる
    if (facesCache.spec && facesCache.spec !== spec && (cutOrbits().length || mergeGroups().length || cutEdges().length)) {
      clearFormRec(); updateCutCount();
      alertHint("群が変わったので、形成していた領域はリセットしました");
    }
    if (facesCache.items !== Store.items || facesCache.spec !== spec || facesCache.sub !== sub)
      facesCache = { items: Store.items, spec, sub, ...expansionFaces(Store.items, spec, FORM_SIZE, formSubset()) };
    return facesCache;
  }

  /* 展開ビューの主ツール: 選択 / アンカー / 形成。
     「掴んだ場所で挙動が変わる」曖昧さを無くすため、いま何ができるかを1つに決める。
     イラレのツールバーと同じ考え方（V=選択・A=ダイレクト選択・⇧M=シェイプ形成）。 */
  /* 展開ビューのツールは **パッドと同じ `tool` を使う**（ツールは1組しかない）。
     2026-07-29 まで editTool という別の状態を持っていたため、同じラベル・同じキー（V/A/⇧M）の
     ツールが左右に2組あり、常に2つ同時に選ばれていて、しかも破壊性が正反対だった。
     ここは tool を「展開ビューでの意味」に読み替えるだけの写像にする。 */
  const ET_OF_TOOL = { move: "select", anchor: "anchor", form: "shape" };
  const TOOL_OF_ET = { select: "move", anchor: "anchor", shape: "form" };
  const editToolOf = t => ET_OF_TOOL[t] || null;   // 描画系ツールのときは null＝展開ビューは反応しない
  let hoverFaces = [];      // 形成ツールでホバー／なぞり中の面（画面のみ）
  let hoverEdges = [];      // 同・線（⌥のときだけ出る）
  let formDrag = null;      // {alt, seen:Set(face), edges:Set(seg)} なぞり中
  let editSelIdxs = [];     // 選択ツールで選んでいるitem index列（複数可・パッドの selIdxs と同じ役割）
  let editSelVi = 0;        // 掴んだコピー（editViews の添字）。行列でなく添字で覚える＝形が変わっても追従する
  let editXf = null;        // {mode, inv, from, center, a0, anchor, h0, h} 枠のドラッグ
  let editMarquee = null;   // {x0,y0,x1,y1,add} 空所ドラッグでまとめて選択（ビュー座標）
  const ET_BTN = { select: "etSelect", anchor: "etAnchor", shape: "etShape" };
  const ET_OPT = { select: "etOptSelect", anchor: "etOptAnchor", shape: "etOptShape" };
  const ET_HINT = {
    select: "選択ツール: 形をクリックで選ぶ（⇧で追加・空所ドラッグでまとめて）。枠が出たら移動・拡大縮小・回転",
    anchor: "アンカーツール: アンカーをドラッグすると全コピーが連動します",
    shape: "形成ツール: 領域をクリック＝1つの形にする／⌥＋クリック＝けずる／⌥＋線の上＝その線だけ消す",
  };
  /* 展開ビュー側のUIを現在の tool に合わせる（setTool から呼ばれる）。
     ここは表示の同期だけ＝状態は tool 1つしかない */
  function syncEditToolUI() {
    const et = editToolOf(tool);
    for (const [k, id] of Object.entries(ET_BTN)) $(id).classList.toggle("on", k === et);
    for (const [k, id] of Object.entries(ET_OPT)) $(id).classList.toggle("on", k === et);
    editCv.style.cursor = et === "shape" ? "pointer" : et === "select" ? "default"
      : et === "anchor" ? "crosshair" : "not-allowed";
    $("editHint").textContent = editHintText(false);
  }
  // 展開ビューのセグメントは tool そのものを切り替える（左のツール行と同じ状態を指す）
  for (const [t, id] of Object.entries(ET_BTN)) $(id).onclick = () => setTool(TOOL_OF_ET[t]);

  $("shapeReset").onclick = () => {
    const n = cutOrbits().length + mergeGroups().length + cutEdges().length;
    if (!n) { alertHint("形成しているところはありません"); return; }
    clearFormRec(); updateCutCount();
    renderEdit(); scheduleSwatches(0);
    alertHint(`形成をリセットしました（${n}か所・⌘Zで戻せます）`);
  };
  function updateCutCount() {
    const p = [];
    if (mergeGroups().length) p.push(`${mergeGroups().length}か所つないでいます`);
    if (cutOrbits().length) p.push(`${cutOrbits().length}か所けずっています`);
    if (cutEdges().length) p.push(`線を${cutEdges().length}本消しています`);
    $("cutCount").textContent = p.join(" / ");
  }

  const ANCHOR_BTN = { one: "anOne", all: "anAll", off: "anOff" };
  function setAnchorView(v, persist = true) {
    anchorView = ANCHOR_BTN[v] ? v : "one";
    for (const [k, id] of Object.entries(ANCHOR_BTN)) $(id).classList.toggle("on", k === anchorView);
    if (anchorView === "off") { editSel = null; editDrag = null; editPreview = null; }
    if (persist) savePrefs();
    renderEdit();
  }
  for (const [v, id] of Object.entries(ANCHOR_BTN)) $(id).onclick = () => setAnchorView(v);

  const scheduleEdit = () => {
    if (editScheduled) return;
    editScheduled = true;
    nextFrame(() => { editScheduled = false; renderEdit(); });
  };

  // 選択アンカーをパッド座標 padPt に動かしたitems（元は不変。基準はドラッグ開始時のpath化済み配列）
  function editPatched(padPt) {
    const base = (editDrag && editDrag.base) || Store.items;
    const it = base[editSel.idx];
    if (!it || it.kind !== "shape" || it.shape !== "path") return null;
    let next;
    if (editSel.ring < 0) {
      next = { ...it, points: it.points.map((p, i) => i === editSel.pt ? [padPt[0], padPt[1]] : p) };
    } else {
      next = { ...it, holes: it.holes.map((ring, ri) => ri !== editSel.ring ? ring
        : ring.map((p, i) => i === editSel.pt ? [padPt[0], padPt[1]] : p)) };
    }
    return base.map((x, k) => k === editSel.idx ? next : x);
  }

  /* ---- 形成ツール: なぞって面を集め、離したときに1操作として確定する ---- */
  function formAddFace(f) {
    if (!f || formDrag.seen.has(f)) return;
    formDrag.seen.add(f);
    hoverFaces = [...formDrag.seen];
  }
  /* 形成ツールの当たり判定: ⌥のときだけ「線の上か」を先に見る。
     線が近ければ線を消す／遠ければ領域を扱う＝イラレと同じ自動判定（⌥なしは常に領域）。
     戻り: {kind:"edge", seg} | {kind:"face", face} | null */
  const toForm = v => [v[0] * FORM_SIZE / editSize, v[1] * FORM_SIZE / editSize];   // ビュー座標→FORM座標
  function formTargetAt(vIn, alt, touch) {
    const v = toForm(vIn);
    const tolK = FORM_SIZE / editSize;   // 許容距離も同じ倍率で縮める（見た目のtolを保つ）
    if (alt) {
      const e = edgeAt(v, (touch ? 10 : 6) * tolK);
      if (e) return { kind: "edge", seg: e };
    }
    const f = currentFaces().faces.find(x => faceHas(x, v));
    return f ? { kind: "face", face: f } : null;
  }
  function formAdd(t) {
    if (!t || !formDrag) return;
    if (t.kind === "edge") formDrag.edges.add(t.seg);
    else formDrag.seen.add(t.face);
    hoverFaces = [...formDrag.seen];
    hoverEdges = [...formDrag.edges];
  }
  function formUp() {
    const d = formDrag;
    formDrag = null;
    hoverFaces = []; hoverEdges = [];
    if (!d || (!d.seen.size && !d.edges.size)) { scheduleEdit(); return; }
    const fc = currentFaces();
    const norm = formNorm;
    /* 記録は「触った点そのもの」1点だけ持つ（[点] の1要素軌道）。
       照合時に orbitOfRec が現在の完全な元集合（omats）で展開し直すので、
       部分軌道を保存する必要がない＝JSONも軽く、群の完全化の恩恵を保存データも受ける */
    if (d.edges.size) {   // 線を消す（⌥で線の上を触ったときだけ入る）。もう一度触れば戻る
      let add = 0, back = 0;
      const nextEdges = [...cutEdges()];   // 1回のなぞりを1コミットにまとめる
      for (const e of d.edges) {
        const hit = edgeCutIn(nextEdges, e.seg, fc);
        if (hit >= 0) { nextEdges.splice(hit, 1); back++; }
        else { nextEdges.push([norm(edgeMid(e.seg))]); add++; }
      }
      setFormRec({ edges: nextEdges });
      alertHint(add && back ? `線を${add}本消し・${back}本もどしました`
        : add ? `線を${add}本消しました（対称の兄弟も一緒に・もう一度触ると戻る）` : `線を${back}本もどしました`);
      savePrefs(); updateCutCount(); renderEdit(); scheduleSwatches(0);
      return;
    }
    const list = [...d.seen];
    if (d.alt) {   // けずる: 触った面をそれぞれトグル（もう一度なぞれば戻る）
      let add = 0, back = 0;
      const nextCuts = [...cutOrbits()];   // 同上（なぞった面をまとめて1undo）
      for (const f of list) {
        // 兄弟コピーの面を触っても同じ記録に当たる（展開した軌道で照合）＝どのコピーからでも戻せる
        const hit = nextCuts.findIndex(orb => orbitOfRec(orb[0], fc).some(p => faceHas(f, p)));
        if (hit >= 0) { nextCuts.splice(hit, 1); back++; }
        else { nextCuts.push([norm(faceRep(f))]); add++; }
      }
      setFormRec({ cuts: nextCuts });
      alertHint(add && back ? `${add}か所けずり・${back}か所もどしました`
        : add ? `${add}か所けずりました（もう一度なぞると戻ります）` : `${back}か所もどしました`);
    } else {
      /* 面にする: 1面だけなら「その領域を独立した形にする」（イラレのクリック）、
         複数なら「つなぐ」（イラレのドラッグ）。どちらも同じ記録＝1グループで表せる。
         触った面が既にどれかのグループに属していれば、そのグループを解除（もう一度で戻る） */
      // つなぎも兄弟コピーから解除できるよう、記録点を軌道に展開してから照合する
      const hit = mergeGroups().findIndex(g =>
        g.some(c => orbitOfRec(c, fc).some(p => list.some(f => faceHas(f, p)))));
      if (hit >= 0) {
        setFormRec({ merges: mergeGroups().filter((_, i) => i !== hit) });
        alertHint("元に戻しました");
      } else {
        setFormRec({ merges: [...mergeGroups(), list.map(f => norm(faceRep(f)))] });
        alertHint(list.length < 2 ? "この領域を1つの形にしました（もう一度クリックで戻る）"
          : `${list.length}つの領域をつなぎました（もう一度なぞると戻る）`);
      }
    }
    savePrefs(); updateCutCount(); renderEdit(); scheduleSwatches(0);
  }

  /* ---- 選択ツール: 枠のハンドルを掴む／枠の中で移動／形をクリックで選ぶ（shift=追加）／空所ドラッグ=範囲選択 ---- */
  // ビュー座標 v の位置にある item を全コピー横断で探す。戻り: {idx, vi} or null
  function editItemAt(v) {
    const m = Render.buildMotif(Store.items, PAD_W);
    if (!m.bbox) return null;
    const views = editViews(m.bbox);
    for (let vi = 0; vi < views.length; vi++) {
      const [px, py] = Geom.apply(Geom.invert(views[vi]), v[0], v[1]);
      if (px < -20 || py < -20 || px > PAD_W + 20 || py > PAD_W + 20) continue;
      const hit = Render.itemAt(pctx, Store.items, px, py, PAD_W, 12);
      if (hit >= 0 && Store.items[hit].kind !== "image") return { idx: hit, vi };
    }
    return null;
  }
  function setEditSel(idxs, vi) {
    editSelIdxs = [...new Set(idxs)].sort((a, b) => a - b);
    if (vi !== undefined) editSelVi = vi;
    updateEditSelInfo();
    syncSelUI();   // 左の「選択」パネル・「見た目」も同じ選択を見る
  }
  function selectDown(v, e) {
    const g = editBoxGeom();
    const hd = g && !e.shiftKey && editHandleAt(v, e.pointerType === "touch");
    if (hd) {
      const V = g.V, inv = Geom.invert(V), b = hd.b;
      const from = Geom.apply(inv, v[0], v[1]);   // 逆写像でパッド座標へ＝以降の計算はすべてパッド座標
      if (hd.mode === "scale")
        editXf = { mode: "scale", inv, h: hd.h, anchor: hPos(b, { u: 1 - hd.h.u, v: 1 - hd.h.v }), h0: hPos(b, hd.h) };
      else if (hd.mode === "rotate") {
        const c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
        editXf = { mode: "rotate", inv, center: c, a0: Math.atan2(from[1] - c[1], from[0] - c[0]) };
      } else editXf = { mode: "move", inv, from };
      return;
    }
    const hit = editItemAt(v);
    if (hit) {
      if (e.shiftKey) setEditSel(editSelIdxs.includes(hit.idx)   // shift=追加／除外
        ? editSelIdxs.filter(i => i !== hit.idx) : [...editSelIdxs, hit.idx], hit.vi);
      else if (!editSelIdxs.includes(hit.idx)) setEditSel([hit.idx], hit.vi);
      renderEdit();
      return;
    }
    editMarquee = { x0: v[0], y0: v[1], x1: v[0], y1: v[1], add: e.shiftKey };   // 空所＝範囲選択の開始
    renderEdit();
  }
  /* 範囲選択の確定: ビュー座標の矩形に、いずれかのコピーの item bbox が重なれば選ぶ。
     どのコピーで当たったかを editSelVi にするので、枠はその場に出る */
  function editMarqueeCommit(r) {
    const R = { x0: Math.min(r.x0, r.x1), y0: Math.min(r.y0, r.y1), x1: Math.max(r.x0, r.x1), y1: Math.max(r.y0, r.y1) };
    const m = Render.buildMotif(Store.items, PAD_W);
    if (!m.bbox) return;
    const views = editViews(m.bbox);
    const hits = new Set(r.add ? editSelIdxs : []);
    let vi = editSelVi, found = false;
    Store.items.forEach((it, i) => {
      if (it.kind === "image") return;
      const b = Render.itemBBox(it);
      if (!b) return;
      for (let k = 0; k < views.length; k++) {
        const cs = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(p => Geom.apply(views[k], p[0], p[1]));
        const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
        if (Math.max(...xs) >= R.x0 && Math.min(...xs) <= R.x1
         && Math.max(...ys) >= R.y0 && Math.min(...ys) <= R.y1) {
          hits.add(i);
          if (!found) { vi = k; found = true; }   // 最初に当たったコピーを枠の置き場にする
          break;
        }
      }
    });
    setEditSel([...hits], vi);
  }
  function updateEditSelInfo() {
    const n = editSelIdxs.length;
    $("etSelInfo").textContent = n ? `${n}個を選択中` : "";
  }

  editCv.addEventListener("pointerdown", e => {
    if (viewMode !== "edit") return;
    e.preventDefault();
    try { editCv.setPointerCapture(e.pointerId); } catch (_) { /* 合成イベント等 */ }
    const v = editPos(e);
    if (editToolOf(tool) === "shape") {
      formDrag = { alt: e.altKey, seen: new Set(), edges: new Set(), trail: [v] };
      formAdd(formTargetAt(v, e.altKey, e.pointerType === "touch"));
      scheduleEdit();
      return;
    }
    if (editToolOf(tool) === "select") { selectDown(v, e); return; }
    if (editToolOf(tool) !== "anchor") {   // 描画系ツール（手描き・ペン・図形…）は展開ビューでは効かない
      alertHint("いまのツールは左の造形パッド用です。展開をさわるには 選択 V / アンカー A / 形成 ⇧M");
      return;
    }
    if (anchorView === "off") return;   // 隠しているときは掴めない（表示と当たり判定を一致させる）
    const m = Render.buildMotif(Store.items, PAD_W);
    if (!m.bbox) return;
    const views = editViews(m.bbox);
    const pts = editablePoints(Store.items);
    const tol = e.pointerType === "touch" ? 18 : 11;
    let best = null, bd = tol;
    for (const V of views) for (const p of pts) {   // 最近傍アンカー（全コピー横断=どのコピーを掴んでもよい）
      const [x, y] = Geom.apply(V, p.x, p.y);
      const d = Math.hypot(x - v[0], y - v[1]);
      if (d < bd) { bd = d; best = { p, V }; }
    }
    if (!best) { editSel = null; renderEdit(); return; }   // 形ごと動かしたいときは選択ツール（V）へ
    // V=掴んだコピーの行列（接続=継ぎ目合わせで「どのコピーを見ていたか」が要るので持っておく）
    editSel = { idx: best.p.idx, ring: best.p.ring, pt: best.p.pt, V: best.V };
    editDrag = {
      inv: Geom.invert(best.V),
      base: best.p.conv ? editMaterialize(best.p.idx, best.p.conv) : Store.items,   // 図形/手描きは掴んだ瞬間にpath化
    };
    renderEdit();
  });
  /* 選択ツールのドラッグ。ビュー座標を**逆写像でパッド座標に引き戻してから**変形を組み立てる
     ＝掴んだコピーの見た目どおりに動く（鏡に映ったコピーならモチーフ側は左右逆に動く＝鏡の中の手） */
  function selectMove(e) {
    if (editMarquee) {
      const v = editPos(e);
      editMarquee.x1 = v[0]; editMarquee.y1 = v[1];
      scheduleEdit();
      return;
    }
    if (!editXf || !editSelIdxs.length) return;
    const v = editPos(e);
    const p = Geom.apply(editXf.inv, v[0], v[1]);
    let m;
    if (editXf.mode === "move") m = Geom.translate(p[0] - editXf.from[0], p[1] - editXf.from[1]);
    else if (editXf.mode === "scale") {
      const [ax, ay] = editXf.anchor, [hx, hy] = editXf.h0;
      let sx = editXf.h.axis === "y" || Math.abs(hx - ax) < 1e-6 ? 1 : (p[0] - ax) / (hx - ax);
      let sy = editXf.h.axis === "x" || Math.abs(hy - ay) < 1e-6 ? 1 : (p[1] - ay) / (hy - ay);
      if (e.shiftKey && !editXf.h.axis) {   // shift=等比（ハンドル方向への射影）
        const dx = hx - ax, dy = hy - ay;
        sx = sy = ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy);
      }
      const cl = q => Math.abs(q) < 0.02 ? (q < 0 ? -0.02 : 0.02) : q;   // 0倍で潰さない（負=反転は許す）
      m = Geom.mul(Geom.translate(ax, ay), Geom.mul([cl(sx), 0, 0, cl(sy), 0, 0], Geom.translate(-ax, -ay)));
    } else {
      const c = editXf.center;
      let th = Math.atan2(p[1] - c[1], p[0] - c[0]) - editXf.a0;
      if (e.shiftKey) th = Math.round(th / (Math.PI / 12)) * (Math.PI / 12);   // shift=15°吸着
      const co = Math.cos(th), sn = Math.sin(th);
      m = Geom.mul(Geom.translate(c[0], c[1]), Geom.mul([co, sn, -sn, co, 0, 0], Geom.translate(-c[0], -c[1])));
    }
    editPreview = Store.items.map((it, i) => editSelIdxs.includes(i) ? transformItem(it, m) : it);
    scheduleEdit();
    Render.pad(pctx, PAD_W, Render.buildMotif(editPreview, PAD_W), padScale, guide, axis);   // パッドも追従
  }

  editCv.addEventListener("pointermove", e => {
    if (viewMode !== "edit") return;
    if (editToolOf(tool) === "shape") {   // カーソル／なぞりが乗っている領域・線をハイライト
      const v = editPos(e);
      const touch = e.pointerType === "touch";
      if (formDrag) {
        formDrag.trail.push(v);
        const t = formTargetAt(v, formDrag.alt, touch);
        if (t && !(t.kind === "edge" ? formDrag.edges.has(t.seg) : formDrag.seen.has(t.face))) formAdd(t);
        scheduleEdit();
        return;
      }
      const t = formTargetAt(v, e.altKey, touch);
      const nf = (t && t.kind === "face") ? [t.face] : [];
      const ne = (t && t.kind === "edge") ? [t.seg] : [];
      if (nf[0] !== hoverFaces[0] || ne[0] !== hoverEdges[0]) { hoverFaces = nf; hoverEdges = ne; scheduleEdit(); }
      return;
    }
    if (editToolOf(tool) === "select") { selectMove(e); return; }
    if (!editDrag || !editSel) return;
    const v = editPos(e);
    let pp = Geom.apply(editDrag.inv, v[0], v[1]);   // 逆写像: ビュー→パッド座標
    let patched = editPatched(pp);
    if (!patched) return;
    // S4: 展開ビューでのスナップ（全コピー横断＝対応点・他コピーの輪郭にも吸く）
    editSnapHit = null;
    if (snapOn) {
      const m0 = Render.buildMotif(patched, PAD_W);
      if (m0.bbox) {
        const tol = e.pointerType === "touch" ? 12 : 8;
        const bb = m0.bbox;
        const all = editViews(bb);
        const near = all.filter(V => {   // 輪郭探索はカーソル近傍のコピーだけ（壁紙は数十枚あるため）
          const xs = [], ys = [];
          for (const c of [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]]) {
            const q = Geom.apply(V, c[0], c[1]); xs.push(q[0]); ys.push(q[1]);
          }
          return v[0] >= Math.min(...xs) - tol && v[0] <= Math.max(...xs) + tol
              && v[1] >= Math.min(...ys) - tol && v[1] <= Math.max(...ys) + tol;
        });
        const rings = editRings(patched);
        const hit = pickSnap({ ...snapSearch(v, rings, near, editSel, tol), ...symSnap(v, all, tol),
          ...crossSnap(v, rings, near, tol) });   // 複製どうしが交わる点＝展開ビューで一番欲しい足場
        if (hit) {
          editSnapHit = hit;
          pp = Geom.apply(editDrag.inv, hit.x, hit.y);
          patched = editPatched(pp) || patched;
        }
      }
    }
    editPreview = patched;
    scheduleEdit();
    Render.pad(pctx, PAD_W, Render.buildMotif(patched, PAD_W), padScale, guide, axis);   // パッドも追従
  });
  const editUp = () => {
    if (viewMode !== "edit") return;
    if (editToolOf(tool) === "shape") { formUp(); return; }
    if (editMarquee) {
      const r = editMarquee;
      editMarquee = null;
      if (Math.hypot(r.x1 - r.x0, r.y1 - r.y0) < 4) { if (!r.add) setEditSel([]); }   // ほぼ動いていない＝空所クリック
      else editMarqueeCommit(r);
      renderEdit();
      return;
    }
    if (editXf) {   // 移動・拡大縮小・回転を確定（1コミット=1undo）
      const prev = editPreview;
      editXf = null; editPreview = null;
      if (prev) Store.replaceMany(editSelIdxs.map(i => [i, prev[i]]));
      else renderEdit();
      return;
    }
    if (!editDrag) return;
    editDrag = null;
    editSnapHit = null;
    if (editPreview && editSel) {
      const it = editPreview[editSel.idx];
      editPreview = null;
      Store.replaceAt(editSel.idx, it);   // 1コミット=1undo（onChange→refresh→renderEdit）
    } else editPreview = null;
  };
  editCv.addEventListener("pointerup", editUp);
  editCv.addEventListener("pointercancel", editUp);

  /* ホバーカーソル: アンカーの上に来たら「掴める」と分かるようにする（再描画はしない=安い）。
     行列は表示用のキャッシュ（多少古くてもカーソルの見た目だけなので害がない） */
  let hoverCache = { items: null, size: 0, val: [] };
  editCv.addEventListener("pointermove", e => {
    if (viewMode !== "edit" || editDrag || editXf || formDrag || editMarquee) return;
    if (editToolOf(tool) === "select") {   // 枠のどこを掴もうとしているかをカーソルで示す
      const v = editPos(e);
      const hd = editHandleAt(v, false);
      editCv.style.cursor = hd
        ? (hd.mode === "rotate" ? "grab" : hd.mode === "move" ? "move"
          : hd.h.axis === "x" ? "ew-resize" : hd.h.axis === "y" ? "ns-resize" : "nwse-resize")
        : editItemAt(v) ? "pointer" : "default";
      return;
    }
    if (editToolOf(tool) !== "anchor") return;
    if (hoverCache.items !== Store.items || hoverCache.size !== editSize) {
      const m = Render.buildMotif(Store.items, PAD_W);
      hoverCache = { items: Store.items, size: editSize, val: m.bbox ? editViews(m.bbox) : [] };
    }
    const v = editPos(e);
    const pts = editablePoints(Store.items);
    let near = false;
    for (const V of hoverCache.val) {
      for (const p of pts) {
        const [x, y] = Geom.apply(V, p.x, p.y);
        if (Math.abs(x - v[0]) < 11 && Math.abs(y - v[1]) < 11) { near = true; break; }
      }
      if (near) break;
    }
    editCv.style.cursor = near ? "move" : "crosshair";
  });

  /* ---- S2/S3: アンカー追加（セグメントをダブルクリック）・角⇄スムース切替（アンカーをダブルクリック）・削除（delete） ---- */
  // selが指すitemを（必要なら）path化した作業配列。conv情報はeditablePointsから引き直す
  function editBaseFor(sel) {
    const entry = editablePoints(Store.items).find(q => q.idx === sel.idx && q.ring === sel.ring && q.pt === sel.pt);
    if (!entry) return null;
    return entry.conv ? editMaterialize(sel.idx, entry.conv) : Store.items;
  }

  // 角⇄スムースの切替（S3）。非curveのpathは「この点だけスムース」から始まる
  function toggleSmooth(entry) {
    if (entry.ring >= 0) { alertHint("穴のアンカーは角のみ（次段で対応）"); return; }
    const base = entry.conv ? editMaterialize(entry.idx, entry.conv) : Store.items;
    const it = base[entry.idx];
    let next;
    if (!it.curve) {
      next = { ...it, curve: true, corners: it.points.map((_, i) => i).filter(i => i !== entry.pt) };
    } else {
      const set = new Set(it.corners || []);
      set.has(entry.pt) ? set.delete(entry.pt) : set.add(entry.pt);
      const corners = [...set].sort((a, b) => a - b);
      if (corners.length === it.points.length) {   // 全部角＝素の直線パスに戻す
        const { curve, corners: _c, ...rest } = it;
        next = rest;
      } else next = { ...it, curve: true, corners };
    }
    Store.replaceAt(entry.idx, next);   // 1undo（path化を含む）
    editSel = { idx: entry.idx, ring: entry.ring, pt: entry.pt };
    const smooth = next.curve && !(next.corners || []).includes(entry.pt);
    alertHint(smooth ? "スムース点に（もう一度ダブルクリックで角に戻る）" : "角に戻しました");
  }

  /* アンカーポイントでパスをカット（イラレの「選択したアンカーでパスを分割」相当・⌘⇧K）。
     閉パス→そのアンカーを始終点にした1本の開パス / 開パス→2本の開パス（境界の点は両方に複製）。
     itemが増えるだけなので対称連動の構造は変わらない */
  // いま選択中のアンカー（編集モード or パッド直接編集のどちらでも）
  function currentAnchorSel() {
    if (viewMode === "edit" && editSel) return { idx: editSel.idx, ring: editSel.ring, pt: editSel.pt, base: editBaseFor(editSel), src: "edit" };
    if (padEdit && padSel) return { idx: padEdit.idx, ring: padSel.ring, pt: padSel.pt, base: Store.items, src: "pad" };
    return null;
  }
  function cutAtAnchor() {
    const sel = currentAnchorSel();
    if (!sel) { alertHint("カット → 編集モードかパッドの直接編集でアンカーを選んでから"); return; }
    if (sel.ring >= 0) { alertHint("穴のパスはカットできません"); return; }
    const base = sel.base;
    if (!base) return;
    const it = base[sel.idx], pt = sel.pt;
    if (it.kind !== "shape" || it.shape !== "path") return;
    const pts = it.points, n = pts.length;
    const cs = new Set(it.curve ? (it.corners || []) : []);
    const sty = { ...carryStyle(it) };
    const mk = (points, corners) => {
      const o = { kind: "shape", shape: "path", points, closed: false, ...sty };
      if (it.curve) {
        if (corners.length === points.length) return o;   // 全部角＝素の直線パス
        o.curve = true; o.corners = corners;
      }
      return o;
    };
    let parts;
    if (it.closed) {
      if (n < 3) return;
      const points = [], corners = [];
      for (let k = 0; k <= n; k++) {          // pt から一周して pt に戻る（境界の点を複製）
        const src = (pt + k) % n;
        if (cs.has(src)) corners.push(k);
        points.push([pts[src][0], pts[src][1]]);
      }
      parts = [mk(points, corners)];
      alertHint("閉じたパスを開きました（⌘Zで戻る）");
    } else {
      if (pt === 0 || pt === n - 1) { alertHint("端のアンカーではカットできません"); return; }
      const aPts = pts.slice(0, pt + 1).map(p => [p[0], p[1]]);
      const bPts = pts.slice(pt).map(p => [p[0], p[1]]);
      const aC = [...cs].filter(c => c <= pt).sort((x, y) => x - y);
      const bC = [...cs].filter(c => c >= pt).map(c => c - pt).sort((x, y) => x - y);
      parts = [mk(aPts, aC), mk(bPts, bC)];   // 元の位置に2本を挿入（replaceWithが重ね順を保つ）
      alertHint("パスを2本に分割（⌘Zで戻る）");
    }
    Store.replaceWith([editSel.idx], parts);   // 1コミット=1undo（path化を含む）
    editSel = null;
  }
  $("objCut").onclick = cutAtAnchor;

  // セグメント上へのアンカー追加（S2）。対象はpath item（図形は一度掴んでpath化してから）
  function addAnchorAt(v, views) {
    let best = null, bd = 7;
    Store.items.forEach((it, idx) => {
      if (it.kind !== "shape" || it.shape !== "path") return;
      for (const V of views) {
        const tv = it.points.map(p => Geom.apply(V, p[0], p[1]));
        const nseg = it.closed ? tv.length : tv.length - 1;
        for (let i = 0; i < nseg; i++) {
          const a = tv[i], b = tv[(i + 1) % tv.length];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const L2 = dx * dx + dy * dy;
          if (L2 < 1e-9) continue;
          const t = Math.max(0.05, Math.min(0.95, ((v[0] - a[0]) * dx + (v[1] - a[1]) * dy) / L2));
          const px = a[0] + dx * t, py = a[1] + dy * t;
          const d = Math.hypot(px - v[0], py - v[1]);
          if (d < bd) { bd = d; best = { idx, at: i + 1, V, px, py }; }
        }
      }
    });
    if (!best) return;
    const it = Store.items[best.idx];
    const [nx, ny] = Geom.apply(Geom.invert(best.V), best.px, best.py);
    const next = { ...it, points: [...it.points.slice(0, best.at), [nx, ny], ...it.points.slice(best.at)] };
    if (it.curve && it.corners) next.corners = it.corners.map(c => c >= best.at ? c + 1 : c);   // 新点はスムース
    Store.replaceAt(best.idx, next);
    editSel = { idx: best.idx, ring: -1, pt: best.at };
    alertHint("アンカーを追加（ドラッグで調整・⌘Zで戻る）");
  }

  editCv.addEventListener("dblclick", e => {
    if (viewMode !== "edit" || editToolOf(tool) !== "anchor") return;   // 追加・角切替はアンカーツールの仕事
    e.preventDefault();
    const v = editPos(e);
    const m = Render.buildMotif(Store.items, PAD_W);
    if (!m.bbox) return;
    const views = editViews(m.bbox);
    const pts = editablePoints(Store.items);
    let best = null, bd = 8;   // 1) アンカー上 → 角⇄スムース
    for (const V of views) for (const p of pts) {
      const [x, y] = Geom.apply(V, p.x, p.y);
      const d = Math.hypot(x - v[0], y - v[1]);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) { toggleSmooth(best); return; }
    addAnchorAt(v, views);   // 2) セグメント上 → 追加
  });

  /* ==== キーボード: v=選択ツール / ⌘Z=undo / ⌘A=全選択 / ⌘D=全削除 /
     ペン中は Enter=done, Esc=cancel / move中は矢印=移動・delete=削除 ==== */
  window.addEventListener("keydown", e => {
    // ヘルプが開いていれば Esc は最優先で閉じる（浮遊要素の作法）
    if (e.key === "Escape" && !$("cheat").hidden) { e.preventDefault(); $("cheat").hidden = true; return; }
    if (viewMode === "edit" && e.key === "Escape") {   // 展開ビュー: 選択（アンカー・形）の解除
      editSel = null; editDrag = null; editPreview = null;
      editXf = null; editMarquee = null;
      setEditSel([]);
      renderEdit();
      return;
    }
    // 選択ツールで選んだ形の削除（アンカー削除は下の editSel 側が受ける）
    if (viewMode === "edit" && editToolOf(tool) === "select" && editSelIdxs.length && !e.metaKey
        && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      const idxs = editSelIdxs;
      setEditSel([]);
      Store.removeMany(idxs);
      alertHint(`${idxs.length}個の形を削除しました（⌘Zで戻る）`);
      return;
    }
    // 矢印キーで移動（パッドと同じ刻み。掴んだコピーの向きに合わせて動かす＝鏡の中の手）
    if (viewMode === "edit" && editToolOf(tool) === "select" && editSelIdxs.length
        && e.key.startsWith("Arrow") && e.target.tagName !== "INPUT") {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key];
      const V = editSelView(Store.items);
      if (!V) return;
      const inv = Geom.invert(V);
      const o = Geom.apply(inv, 0, 0), p = Geom.apply(inv, d[0], d[1]);   // 向きだけを引き戻す（平行移動は打ち消す）
      const m = Geom.translate(p[0] - o[0], p[1] - o[1]);
      Store.replaceMany(editSelIdxs.map(i => [i, transformItem(Store.items[i], m)]));
      return;
    }
    if (viewMode === "edit" && (e.key === "Backspace" || e.key === "Delete") && editSel && !e.metaKey) {
      e.preventDefault();   // 選択アンカーの削除（S2）。形が保てる最小点数は守る
      const base = editBaseFor(editSel);
      if (!base) return;
      const it = base[editSel.idx];
      const ring = editSel.ring < 0 ? it.points : it.holes[editSel.ring];
      const min = (editSel.ring >= 0 || it.closed) ? 3 : 2;
      if (ring.length <= min) { alertHint("これ以上減らせません（形ごと消すには選択ツールで削除）"); return; }
      const nring = ring.filter((_, i) => i !== editSel.pt);
      let next;
      if (editSel.ring < 0) {
        next = { ...it, points: nring };
        if (it.curve && it.corners) {
          const corners = it.corners.filter(c => c !== editSel.pt).map(c => c > editSel.pt ? c - 1 : c);
          if (corners.length === nring.length) { delete next.curve; delete next.corners; }   // 全部角=素の直線パスへ
          else next.corners = corners;
        }
      } else next = { ...it, holes: it.holes.map((rg, ri) => ri === editSel.ring ? nring : rg) };
      Store.replaceAt(editSel.idx, next);   // 1undo（path化を含む）
      editSel = null;
      alertHint("アンカーを削除（⌘Zで戻る）");
      return;
    }
    // パッド直接編集: Escで抜ける / delete=アンカー削除 / 矢印=アンカー微動
    if (padEdit && e.target.tagName !== "INPUT") {
      if (e.key === "Escape") { e.preventDefault(); exitPadEdit(); return; }
      if (padSel && (e.key === "Backspace" || e.key === "Delete") && !e.metaKey) {
        e.preventDefault();
        const it = Store.items[padEdit.idx];
        const ring = padSel.ring < 0 ? it.points : it.holes[padSel.ring];
        const min = (padSel.ring >= 0 || it.closed) ? 3 : 2;
        if (ring.length <= min) { alertHint("これ以上減らせません（形ごと消すには選択ツールで削除）"); return; }
        const nring = ring.filter((_, i) => i !== padSel.pt);
        let next;
        if (padSel.ring < 0) {
          next = { ...it, points: nring };
          if (it.curve && it.corners) {
            const corners = it.corners.filter(c => c !== padSel.pt).map(c => c > padSel.pt ? c - 1 : c);
            if (corners.length === nring.length) { delete next.curve; delete next.corners; }
            else next.corners = corners;
          }
        } else next = { ...it, holes: it.holes.map((rg, ri) => ri === padSel.ring ? nring : rg) };
        Store.replaceAt(padEdit.idx, next);
        padSel = null;
        alertHint("アンカーを削除（⌘Zで戻る）");
        return;
      }
      if (padSel && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const s = e.shiftKey ? 10 : 1;
        const d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key];
        const it = Store.items[padEdit.idx];
        const cur = padSel.ring < 0 ? it.points[padSel.pt] : it.holes[padSel.ring][padSel.pt];
        padDrag = { ring: padSel.ring, pt: padSel.pt };
        Store.replaceAt(padEdit.idx, padMoved([cur[0] + d[0], cur[1] + d[1]]));
        padDrag = null;
        return;
      }
    }
    if (tool === "pen" && penPts.length) {
      if (e.key === "Enter") { e.preventDefault(); penCommit(false); return; }
      if (e.key === "Escape") { e.preventDefault(); penReset(); return; }
    }
    if (tool === "move" && selIdxs.length && e.target.tagName !== "INPUT") {   // スライダー操作中の矢印/deleteを奪わない
      const step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft")  { e.preventDefault(); nudgeSel(-step, 0); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); nudgeSel(step, 0); return; }
      if (e.key === "ArrowUp")    { e.preventDefault(); nudgeSel(0, -step); return; }
      if (e.key === "ArrowDown")  { e.preventDefault(); nudgeSel(0, step); return; }
      if (e.key === "Escape")     { e.preventDefault(); flushNudge(); setSel([]); return; }
      if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); flushNudge(); Store.removeMany(selIdxs); setSel([]); return; }
    }
    if (e.metaKey || e.ctrlKey) {
      const k = e.key.toLowerCase();
      if (k === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
      if (k === "a") {   // 全選択（画像以外）
        e.preventDefault();
        const all = Store.items.map((it, i) => it.kind === "image" ? -1 : i).filter(i => i >= 0);
        if (!all.length) return;
        if (viewMode === "edit") {   // 展開ビューでは展開側の選択に効く
          if (!editToolOf(tool)) setTool("move");
          setEditSel(all);
          renderEdit();
        } else { setTool("move"); setSel(all); }
        return;
      }
      if (k === "d") { e.preventDefault(); if (selIdxs.length) dupSel(); return; }   // 複製（Figma準拠）
      if (k === "j") { e.preventDefault(); joinSel(); return; }                      // 接続（Join）
      if (k === "k" && e.shiftKey) { e.preventDefault(); cutAtAnchor(); return; }   // アンカーでパスをカット
      if (k === "c") { e.preventDefault(); copySel(false); return; }                 // コピー
      if (k === "x") { e.preventDefault(); copySel(true); return; }                  // カット
      if (e.key === "Backspace" && e.shiftKey) {   // 全削除は ⌘⇧⌫（⌘Zで戻せる）
        e.preventDefault();
        if (Store.items.length || penPts.length) { clearAll(); alertHint("全て削除しました（⌘Zで戻せます）"); }
        return;
      }
      // 重ね順（Illustratorの筋肉記憶）。ブラウザの「戻る/進む」より先に奪う
      if (e.key === "[") { e.preventDefault(); reorderSel("back"); return; }
      if (e.key === "]") { e.preventDefault(); reorderSel("front"); return; }
      return;
    }
    // 単キーのツール/操作ショートカット（Illustrator流。入力欄・alt併用・日本語入力(IME)中は無効）
    if (!e.altKey && !e.isComposing && e.target.tagName !== "INPUT") {
      const k = e.key.toLowerCase();
      // シェイプ形成 ⇧M（イラレと同じ割り当て）。いま見ている側の形成ツールに入る
      if (k === "m" && e.shiftKey) {
        e.preventDefault();
        if (tool === "form") setTool(toolPrev);
        else { setTool("form"); alertHint("形成ツール: 領域をクリック＝1つの形にする／⌥＋クリック＝けずる（⌘Zで戻せます）"); }
        return;
      }
      if (viewMode === "edit") {   // 展開ビューでは V/A は展開側のツールに効く（イラレと同じ並び）
        if (k === "v") { setEditTool("select"); return; }
        if (k === "a") { setEditTool("anchor"); return; }
      }
      if (k === "v") { setTool("move"); return; }        // 選択
      if (k === "n") { setTool("freehand"); return; }    // 手描き（イラレの鉛筆N）
      if (k === "p") { setTool("pen"); return; }         // ペン
      if (k === "m") { setTool("rect"); return; }        // 矩形
      if (k === "l") { setTool("ellipse"); return; }     // 円
      if (k === "e") { setTool("erase"); return; }       // 消しゴム
      if (k === "a") { setTool("anchor"); return; }      // アンカー選択ツール（イラレのダイレクト選択A）
      if (k === "r") { if (selIdxs.length) editXform("rot", e.shiftKey ? -15 : 15); return; }        // 回転±15°
      if (k === "s") { if (selIdxs.length) editXform("scale", e.shiftKey ? 1 / 1.1 : 1.1); return; } // 拡大/縮小
      if (k === "x" && e.shiftKey) { swapFillStroke(); return; }   // 塗り／線の反転（イラレのX相当）
      if (k === "[") { reorderSel("back"); return; }     // 最背面へ
      if (k === "]") { reorderSel("front"); return; }    // 最前面へ
    }
  });

  /* ==== ヒント表示 ====
     4秒固定だと読み切る前に消えて読み返せない問題への対応:
     ①表示時間を文字数に応じて延ばす ②ホバー中は消さない ③消えた後もクリックで直前のヒントを読み返せる
     （常設のUI要素は増やさず、既存の#stateHint自体をクリック対象にする） */
  let hintTimer = null;
  let lastHint = "";        // 直前のヒント本文（読み返し用）
  let hintHovering = false; // ホバー中は自動非表示を止める
  const hintEl = $("stateHint");
  const hintMs = msg => Math.min(9000, Math.max(4000, msg.length * 130));   // 短文=従来どおり4秒／長文ほど延びる（上限9秒）
  function scheduleHintHide() {
    clearTimeout(hintTimer);
    if (hintHovering) return;   // mouseleaveで再スケジュールする
    hintTimer = setTimeout(() => {
      hintEl.textContent = persistNote();
      hintEl.classList.toggle("replay", !!lastHint);   // 消えた後はクリックで読み返せることを示す
    }, hintMs(lastHint));
  }
  function alertHint(msg) {
    lastHint = msg;
    hintEl.textContent = msg;
    hintEl.classList.remove("replay");   // 表示中はクリック対象ではない
    scheduleHintHide();
  }
  hintEl.addEventListener("mouseenter", () => { hintHovering = true; clearTimeout(hintTimer); });
  hintEl.addEventListener("mouseleave", () => { hintHovering = false; scheduleHintHide(); });
  hintEl.addEventListener("click", () => { if (hintEl.classList.contains("replay")) alertHint(lastHint); });
  const persistNote = () =>
    Store.persistState === "degraded" ? "自動保存: 画像は容量超過のため対象外" :
    Store.persistState === "memory" ? "自動保存が使えません（メモリのみ）" : "";
  function updateHints() { hintEl.textContent = persistNote(); hintEl.classList.remove("replay"); }
  Store.onPersist(updateHints);   // quota→degraded等を即座にヒント表示（次操作を待たない）

  /* ==== Prefs永続化（ドキュメントとは別キー） ==== */
  const PREFS_KEY = "symmetry-machine.prefs.v1";
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        view: viewMode, guide, png: pngScale, pngBg, tool, sides, sty: defSty,
        tidy: +$("tidyRange").value, cell: +$("cellRange").value, scale: +$("scaleRange").value,
        ink: $("inkColor").value, paper: $("paperColor").value,
        snap: snapOn, axis,
        sel: selected().map(s => specName(s.spec)),
        subs: Object.fromEntries(SUB_IDS.map(id => [id, $(id).open])),   // 選択パネルの開閉
        ofDir, anchorView, overlap: Render.getOverlap(), padLocked,
        snapKinds,
      }));
    } catch (_) { /* quota等は無視（UI設定なので致命的でない） */ }
  }
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; }
    catch (_) { return {}; }
  }

  /* ==== デバッグ: ?debug でF字モチーフ+テーブル詳細 ==== */
  const debug = new URLSearchParams(location.search).has("debug");
  function injectF() {
    const line = (a, b, n = 10) => {   // 非対称の「F」— 鏡映/映進/回転の判別用
      const pts = [];
      for (let i = 0; i <= n; i++)
        pts.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, i * 20]);
      return pts;
    };
    for (const [a, b] of [[[105, 60], [105, 220]], [[105, 60], [195, 60]], [[105, 140], [170, 140]]])
      Store.add({ kind: "stroke", raw: line(a, b), mode: "uniform" });
  }

  // 計測用（?debug のときだけ内部を露出。本番の挙動には影響しない）
  if (new URLSearchParams(location.search).has("debug"))
    window.__dbg = { expansionInput, expansionFaces, currentFaces, currentEdges, renderEdit,
                     formTargetAt, toForm, completeMats, orbitOfRec, faceIsCut, formedItems, setFormRec };

  /* ==== 起動 ==== */
  const problems = [...Groups.selfTest(), ...Groups.customSelfTest()];   // テーブル+カスタム閉包の自己検証
  if (problems.length) alertHint("群テーブル検証に失敗（consoleを確認）");

  const prefs = loadPrefs();
  // スタイル既定の復元（旧prefs.fill=booleanからの移行も吸収）。値はチップの刻みに収める
  if (prefs.sty && typeof prefs.sty === "object") {
    const s = prefs.sty;
    defSty = {
      fill: ["ink", "paper", "none"].includes(s.fill) ? s.fill : "none",
      stroke: ["ink", "none"].includes(s.stroke) ? s.stroke : "ink",
      sw: W_STEPS.includes(s.sw) ? s.sw : 3,
      alpha: A_STEPS.includes(s.alpha) ? s.alpha : 1,
      r: R_STEPS.includes(s.r) ? s.r : 0,
    };
  } else if (prefs.fill === true) defSty = { ...defSty, fill: "ink", stroke: "none" };
  updateStyleUI();
  setPngScale(prefs.png === 4 ? 4 : 2);
  setPngBg(prefs.pngBg === "clear" ? "clear" : "white");
  setSides(Number.isInteger(prefs.sides) ? prefs.sides : 6);
  setTool(TOOL_BTN[prefs.tool] ? prefs.tool : "freehand");
  setOfDir(prefs.ofDir === -1 ? -1 : 1, false);   // 復元時は保存し返さない
  setAnchorView(prefs.anchorView, false);
  setOverlapMode(prefs.overlap, false);
  setPadLock(prefs.padLocked === true, false);
  // 形成の記録（軌道・size正規化）。壊れた値が混じっても描画が落ちないよう形を検査して通す
  // 形成の記録は Store（ドキュメント）が復元する。prefs には置かない
  updateCutCount();
  syncBarActs();   // 起動直後もバーの活性を実状態に合わせる
  for (const k of SNAP_RANK) setSnapKind(k, prefs.snapKinds ? prefs.snapKinds[k] !== false : true, false);
  syncEditToolUI();   // 展開ビュー側のUIを tool に合わせる（状態は tool 1つ）
  // パネルの開閉。**記録に無いキーはHTMLの既定を尊重する**（新しく畳めるようにしたセクションが、
  // 古い prefs のせいで全部閉じた状態で起動してしまうのを防ぐ）
  if (prefs.subs && typeof prefs.subs === "object")
    for (const id of SUB_IDS) if (id in prefs.subs) $(id).open = !!prefs.subs[id];
  loadCustoms();                                     // 保存済みカスタム群（sel復元より先にスワッチ化）
  for (const def of customs) addCustomSwatch(def);
  if (Array.isArray(prefs.sel) && prefs.sel.length) {
    const sel = new Set(prefs.sel);
    for (const s of swatches) if (sel.has(specName(s.spec))) s.wrap.classList.add("sel");
  }
  const tidy = typeof prefs.tidy === "number" ? Geom.clamp(prefs.tidy, 0, 16) : 0;
  $("tidyRange").value = tidy;
  Render.setSimplify(tidy);   // 幾何に反映させてから motif を組む
  // 探索パラメータの復元（motif構築前にGroupsへ反映）
  const cell = typeof prefs.cell === "number" ? Geom.clamp(prefs.cell, 48, 120) : 72;
  const scale = typeof prefs.scale === "number" ? Geom.clamp(prefs.scale, 0.35, 1) : 0.65;
  $("cellRange").value = cell; $("scaleRange").value = scale;
  Groups.setParams({ cell, scale });
  applyColors(prefs.ink || "#0044cc", prefs.paper || "#ffffff", { persist: false });
  setSnap(!!prefs.snap);
  if (Array.isArray(prefs.axis) && prefs.axis.length === 2 && prefs.axis.every(Number.isFinite)) {
    axis = [prefs.axis[0], prefs.axis[1]];
    Groups.setParams({ center: axis });
  }
  Store.restore();
  if (debug && !Store.items.length) injectF();
  motif = Render.buildMotif(Store.items, PAD_W);   // setGuide/setViewModeが参照するので先に用意
  setGuide(["grid", "circle"].includes(prefs.guide) ? prefs.guide : "off");
  setViewMode(["live", "edit"].includes(prefs.view) ? prefs.view : "grid");
  updateUndoState();
  refresh();

  // PWA: secure context（https / localhost）でのみService Workerを登録。
  // file:// やLAN(http://192.168.x.x)では黙ってスキップ（通常動作に影響なし）
  if ("serviceWorker" in navigator &&
      (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* 失敗しても通常動作 */ });
  }
})();
