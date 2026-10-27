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
  let formErase = false;
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
  // 文字を打つ欄か（range/checkbox等は含めない）。キーボードショートカットの入力ガードに使う
  const isTextInput = el => !!el && (el.isContentEditable || el.tagName === "SELECT" || el.tagName === "TEXTAREA" ||
    (el.tagName === "INPUT" && !["range", "checkbox", "radio", "button", "file", "color", "submit"].includes(el.type)));

  /* ==== スワッチDOM（GRID） ==== */
  const swatches = [];
  /* 一覧で選んだ群の履歴（直近順・重複なし・最大 RECENT_MAX 件）。先頭が「いま大きく展開している群」。
     2番目以降は展開の右に小さく並べる（持ち主の依頼 2026-10-24）。名前だけ持ち、spec は swatches から引く
     ＝カスタム群が消えていても落ちない。prefs に保存して再起動後も残す */
  const RECENT_MAX = 5;   // 先頭=いまの群＋右の小さい展開4枚分（足りない分は recentFilled が一覧の並び順で埋める）
  let recentNames = [];
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
      wrap.addEventListener("click", () => { chooseWorkbenchSpec(spec); });
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
      Render.swatchInto(cv.getContext("2d"), cv.width / dpr, dpr, spec, m, PAD_W, Render.colors().paper, cv.height / dpr, formedItems(spec));
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
  let downView = null;             // 展開面で押した位置（ビュー座標・吸着し直すために持つ）
  let activePointer = null;        // 1本目のポインタのみ処理（2本目/手のひらの誤爆を防ぐ）
  /* 展開面に直接描く（段2）。操作の間だけ持つ: {k, inv, bbox}
     inv=触れた複製の逆写像（ビュー→パッド座標・操作中は固定）／bbox=配置の凍結（描きながら複製が飛ばない）。
     penLock はペンの点を打ち終えるまで持ち越す（点ごとに別の複製を選ぶと座標系が混ざるため） */
  let drawLock = null, penLock = null;
  // 空の作品で複製を出すための仮の外接枠（配置用の一時値・保存/書き出しには入れない）
  const DEFAULT_BBOX = { x0: PAD_W * 0.3, y0: PAD_W * 0.3, x1: PAD_W * 0.7, y1: PAD_W * 0.7 };

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
  const SNAP_RANK = ["anchor", "cross", "lattice", "center", "mid", "axis", "edge"];   // lattice＝壁紙・帯のセル格子（格子点・辺の中点・セル中心）
  /* 種類ごとのオンオフ。「アンカーには吸わせたいが輪郭には吸わせたくない」のような
     使い分けを作れる（吸着そのもののオン／オフは snapOn＝造形パネルの「吸着」） */
  let snapKinds = { anchor: true, cross: true, lattice: true, center: true, mid: true, axis: true, edge: true };
  const pickSnap = c => { for (const k of SNAP_RANK) if (c[k] && snapKinds[k]) return c[k]; return null; };
  const SNAP_BTN = { anchor: "snAnchor", cross: "snCross", lattice: "snLattice", center: "snCenter", mid: "snMid", axis: "snAxis", edge: "snEdge" };
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
      const r = Math.abs(item.x1 - item.x0) / 2 * s;   // 回転しても半径は拡縮に従う（s=1の等長変換以外で円が元の大きさのままになっていた）
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
    const T = targetCtx(), idxs = T.idxs;
    if (!idxs.length) { alertHint("選んでいる図形がありません（選択ツール V で図形を選んでから）"); return; }
    const b = unionBBox(idxs.map(i => Render.itemBBox(Store.items[i])).filter(Boolean)); if (!b) return;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const apply = m => Store.replaceMany(idxs.map(i => [i, transformItem(Store.items[i], m)]));   // 1コミット=1undo
    /* 展開側では「掴んだコピーの見た目」で回す・拡げる（V⁻¹·M·V＝矢印キーと同じ鏡の中の手）。
       鏡映したコピーなら、モチーフ側は逆向きに回る */
    const Vsel = (T.edit && editSelView(Store.items)) || [1, 0, 0, 1, 0, 0];   // パッド側は恒等＝bbox 中心まわりの変換
    const viaView = m => {
      const c = Geom.apply(Vsel, cx, cy);
      return Geom.mul(Geom.invert(Vsel), Geom.mul(Geom.translate(c[0], c[1]), Geom.mul(m, Geom.mul(Geom.translate(-c[0], -c[1]), Vsel))));
    };
    if (kind === "rot") {
      const th = val * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
      apply(viaView([c, sn, -sn, c, 0, 0]));
    } else if (kind === "scale") {
      apply(viaView(Geom.scaleMat(val)));
    } else if (kind === "align") {
      // 基準枠: 1個ならパッド、複数なら選択全体のbbox（オブジェクト同士を揃える）
      const F = idxs.length > 1 ? b : { x0: 0, y0: 0, x1: PAD_W, y1: PAD_W };
      const fcx = (F.x0 + F.x1) / 2, fcy = (F.y0 + F.y1) / 2;
      const entries = [];
      for (const i of idxs) {
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
    const boxes = targetCtx().idxs.map(i => ({ i, b: Render.itemBBox(Store.items[i]) })).filter(e => e.b);
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
  /* 図形のドラッグ中/確定の item。展開面では shapeDrag が**ビュー座標**（view:true）なので、画面でドラッグした枠のまま
     作ってから、描いたコピーの逆写像（lock.inv）でモチーフ座標へ引き戻す。
     以前は始点・終点をそれぞれ逆写像して軸平行の箱にしていたので、回転・鏡映したコピーの上では
     箱が傾いた対角2点の軸平行包みになり、矩形も円も画面の枠と違う大きさ・縦横比になっていた */
  function shapeLive(lock) {
    const { view, ox, oy, ...box } = shapeDrag;
    const it = { kind: "shape", shape: tool, ...box, sides, ...newSty() };
    if (!view || !lock) return it;
    const t = transformItem(it, lock.inv);
    return t.r !== it.r ? { ...t, r: it.r } : t;   // 角R は図形の単位のまま（引き戻しの拡縮で変えない）
  }
  function liveItem() {
    if (shapeDrag) return shapeLive(drawLock);
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

  // 移動量 (dx,dy) を 45° 刻みの向きに拘束（水平・垂直・斜め）。⇧ドラッグの移動と直線で共有する
  function constrain45(dx, dy) {
    const L = Math.hypot(dx, dy), a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    return [L * Math.cos(a), L * Math.sin(a)];
  }
  /* 指（pointerType=touch）で線・図形を当てる許容。画面 TOUCH_HIT_PX px（★仮 14）まで広げる。マウスは従来の tol のまま。
     Render.itemAt の tol は線幅として使われる（半径は tol/2）ので、画面 px → 座標系の長さ（÷scale）に直して 2 倍する。
     scale=その座標系の1単位が画面で何pxか。点（アンカー）の判定は別（従来どおり 18px） */
  const TOUCH_HIT_PX = 14;
  const hitTol = (base, touch, scale) => touch ? Math.max(base, 2 * TOUCH_HIT_PX / Math.max(scale, 0.05)) : base;
  const viewScale = V => Math.sqrt(Math.abs(Geom.det2(V)));
  // 図形ドラッグの origin（押した点）。⌥ならこの点が中心になる
  const shapeOrigin = () => [shapeDrag.ox !== undefined ? shapeDrag.ox : shapeDrag.x0, shapeDrag.oy !== undefined ? shapeDrag.oy : shapeDrag.y0];
  // shift の拘束（正方/正円/45°）。座標系は shapeDrag と同じ（パッド側=パッド座標・展開面=ビュー座標）。拘束の基準は押した点
  function shapeConstrain(x1, y1, shiftKey) {
    if (shiftKey) {
      const [ox, oy] = shapeOrigin();
      const dx = x1 - ox, dy = y1 - oy;
      if (tool === "line") {   // 45°スナップ
        const [ex, ey] = constrain45(dx, dy);
        x1 = ox + ex; y1 = oy + ey;
      } else {                 // 正方形/正円/正多角形の外接正方
        const s = Math.max(Math.abs(dx), Math.abs(dy));
        x1 = ox + Math.sign(dx || 1) * s; y1 = oy + Math.sign(dy || 1) * s;
      }
    }
    return [x1, y1];
  }
  /* 図形ドラッグの終点を決める（パッド・展開面共通）。⇧=正方/正円/45°、⌥=押した点を中心にして反対側へ同じだけ広げる（併用可）。
     プレビューも確定も shapeDrag の x0..y1 から作るので、ここで決めた枠がそのまま出る */
  function shapeSetEnd(p, shiftKey, altKey) {
    const [ex, ey] = shapeConstrain(p[0], p[1], shiftKey);
    const [ox, oy] = shapeOrigin();
    shapeDrag.x1 = ex; shapeDrag.y1 = ey;
    if (altKey) { shapeDrag.x0 = 2 * ox - ex; shapeDrag.y0 = 2 * oy - ey; }
    else { shapeDrag.x0 = ox; shapeDrag.y0 = oy; }
  }

  /* ---- ペン ---- */
  function penReset() { penPts = []; penSmooth = []; hoverPt = null; penLock = null; document.body.classList.remove("penning"); renderPad(); scheduleLive(); if (viewMode === "edit") renderEdit(); }
  function penCommit(closed) {
    const penVi = viewMode === "edit" && penLock ? penLock.k : -1;   // 展開面で描いたコピー（描いた直後の選択に使う）
    if (penPts.length >= (closed ? 3 : 2)) {
      const item = { kind: "shape", shape: "path", points: penPts, closed, ...newSty() };   // 開いた線はstyleOfが塗りを外す
      if (penSmooth.some(Boolean)) {   // 全点が角のままなら従来どおりcurveを付けない（後方互換）
        item.curve = true;
        item.corners = penSmooth.reduce((a, s, i) => { if (!s) a.push(i); return a; }, []);
      }
      Store.add(item);
      if (penVi >= 0) setEditSel([Store.items.length - 1], penVi);   // 描いた形が選択された状態にする（イラレと同じ）
    }
    penReset();
  }
  // アンカーを1点確定する。smooth=false=角（クリック） / true=スムース（ドラッグ。イラレ準拠でアンカーはダウン位置に固定）
  const PEN_DUP_TOL = 1.5;   // 直前の点とこの距離（パッド座標）以内なら同じ位置＝点を足さない（ダブルクリックで重複しない）
  function penPlace(p, smooth) {
    if (penPts.length && Math.hypot(p[0] - penPts[0][0], p[1] - penPts[0][1]) < CLOSE_TOL) { penCommit(true); return; }
    const last = penPts[penPts.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < PEN_DUP_TOL) { hoverPt = null; return; }
    penPts.push([p[0], p[1]]);
    penSmooth.push(smooth);
    hoverPt = null;   // 確定直後は下書き/ドラッグの仮点を残さない（次のpointermoveで張り直す）
    document.body.classList.add("penning");
    Render.previewShape(pctx, PAD_W, motif, padScale, guide, liveItem(), axis);
    scheduleLive();
    if (viewMode === "edit") renderEdit();   // 展開面で打ったときも途中の線を見せる
  }
  function penTap(p) { penPlace(p, false); }   // クリック＝角の点(従来どおり)
  // ペンの途中の最後の点を1つ戻す（⌘Z・Backspace）。Store の undo には触れない。全部戻したらペンを終える
  function penUndoPoint() {
    if (!penPts.length) return false;
    penPts.pop(); penSmooth.pop();
    hoverPt = null;
    if (!penPts.length) { penReset(); return true; }
    renderPad();
    Render.previewShape(pctx, PAD_W, motif, padScale, guide, liveItem(), axis);
    scheduleLive();
    if (viewMode === "edit") renderEdit();
    return true;
  }

  pad.addEventListener("pointerdown", e => {
    if (padLocked) { alertHint("造形はロック中です（「描画 > 造形 > ロック」で解除）"); return; }
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
      padForm = { alt: e.altKey || formErase, seen: new Set() };
      const f = padFaces().find(x => faceHas(x, p));
      if (f) padForm.seen.add(f);
      padHoverFaces = [...padForm.seen];
      renderPad();
      return;
    }
    /* アンカー選択ツール（A・イラレのダイレクト選択）: クリックした形にそのまま入る。
       moveのダブルクリックと違い、1クリックでアンカーが出る */
    const padTouch = e.pointerType === "touch", padPx = pad.getBoundingClientRect().width / PAD_W;   // パッド座標1単位が画面で何px
    if (tool === "anchor") {
      const hit = Render.itemAt(pctx, Store.items, p[0], p[1], PAD_W, hitTol(10, padTouch, padPx));
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
      const hit = Render.itemAt(pctx, Store.items, p[0], p[1], PAD_W, hitTol(10, padTouch, padPx));
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
      shapeDrag = { x0: sp[0], y0: sp[1], x1: sp[0], y1: sp[1], ox: sp[0], oy: sp[1] };
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
    if (padForm && e.pointerId !== activePointer) return;   // なぞりは開始した指だけが進める
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
      shapeSetEnd(snapPoint(pos(e)), e.shiftKey, e.altKey);
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
      const [mdx, mdy] = e.shiftKey ? constrain45(q[0] - dragSel[0], q[1] - dragSel[1])   // ⇧=45°（水平・垂直・斜め）に拘束。スマートガイドは使わない
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
  // 指を離す以外の中断（pointercancel / lostpointercapture）: 確定せず、描画中の途中状態を捨てて作品は変えない
  function abortDraw() {
    padForm = null; padHoverFaces = [];
    padDrag = null; padPreview = null; padSnapHit = null;
    raw = null; lastPt = null; shapeDrag = null;
    handleDrag = null; marquee = null; dragSel = null; dupDrag = false;
    previewMat = null; previewItems = null; smartLines = [];
    hoverPt = null;   // ペンのドラッグ中の仮点だけ捨てる（置いた点 penPts は残す）
    downPt = null; activePointer = null;
    motif = Render.buildMotif(Store.items, PAD_W);
    renderPad();
    if (viewMode === "live") renderLive(motif);
  }
  function finishDraw(e) {
    if (e && e.pointerId !== activePointer) return;   // アクティブなポインタのup/cancelのみ処理
    if (e && (e.type === "pointercancel" || e.type === "lostpointercapture")) { abortDraw(); return; }
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
        if (item && Render.itemHasGeometry(item)) { Store.add(item); oneShotDone(); }
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
        else { const i = Render.itemAt(pctx, Store.items, p[0], p[1], PAD_W); if (i >= 0) { Store.removeAt(i); oneShotDone(); } }
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
    const T = targetCtx();
    if (!T.idxs.length) { alertHint("選んでいる図形がありません（選択ツール V で図形を選んでから）"); return; }
    // 展開側では「掴んだコピーから見て右下へ」ずらす（鏡のコピーでも画面上は同じ向きに離れる）
    const V = T.edit ? editSelView(Store.items) : null;
    const m = V ? editDirMat(V, 8, 8) : Geom.translate(8, 8);
    const copies = T.idxs.map(i => transformItem(Store.items[i], m));
    const base = Store.items.length;
    Store.addMany(copies);
    T.set(copies.map((_, k) => base + k));
  }
  $("objDup").onclick = dupSel;
  // 削除・選択解除（左右どちらの選択でも効く）。消した後は index がずれるので選択は持ち越さない
  function deleteSel() {
    flushNudge();
    const T = targetCtx();
    if (!T.idxs.length) return 0;
    const idxs = T.idxs.slice();
    T.set([]);
    Store.removeMany(idxs);
    return idxs.length;
  }
  function clearSelection() {
    flushNudge();
    setSel([]);
    if (editSelIdxs.length || editSel) { editSel = null; editDrag = null; editPreview = null; setEditSel([]); scheduleEdit(); }
  }
  $("objDel").onclick = deleteSel;
  $("objDone").onclick = clearSelection;

  /* ==== オブジェクトのコピー/カット/ペースト（⌘C/⌘X/⌘V・イラレ流） ====
     システムclipboardへ自前JSON（marker付き）を書く。書けない環境用にアプリ内クリップボードも持つ。
     pasteイベントは marker付きJSON → SVGテキスト → 画像 → アプリ内 の優先順で解釈 */
  const CLIP_MARK = "symmetry-machine/clip";
  let clipItems = null;
  function copySel(cut) {
    flushNudge();
    const T = targetCtx();
    if (!T.idxs.length) {   // 選択が無ければ図版全体をSVGでコピー（§8）。カットは対象が無いので言うだけ
      if (cut) alertHint("カットする対象を選択してください"); else copyFigureSvg();
      return;
    }
    clipItems = T.idxs.map(i => Store.items[i]);   // 展開側でも「選んだ元の図形だけ」（展開した全体ではない）
    const payload = JSON.stringify({ app: CLIP_MARK, v: 2, items: clipItems });
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(payload).catch(() => { /* アプリ内クリップボードが受け皿 */ });
    alertHint(`${cut ? "カット" : "コピー"} ${clipItems.length}個（⌘Vでペースト）`);
    if (cut) { const idxs = T.idxs.slice(); T.set([]); Store.removeMany(idxs); }
  }
  function pasteClip(items) {
    const ok = (items || []).filter(it => it && (it.kind === "stroke" || it.kind === "shape" || it.kind === "image"));
    if (!ok.length) return false;
    const copies = ok.map(it => transformItem(it, Geom.translate(8, 8)));   // 少しずらして置く
    const base = Store.items.length;
    Store.addMany(copies);   // 1コミット=1undo
    setTool("move");
    const ids = copies.map((_, k) => base + k);
    if (viewMode === "edit") { editSel = null; setEditSel(ids); scheduleEdit(); } else setSel(ids);   // 貼ったものを選ぶ（見ている側の選択へ）
    clipItems = copies;      // 連続ペーストは階段状にずれていく
    alertHint(`ペースト ${copies.length}個`);
    return true;
  }

  // 重ね順（1コミット=1undo）。後ろのitemほど前面に描かれる
  //   "forward"/"backward" = 1段階（⌘] / ⌘[・イラレの「前面へ」「背面へ」）
  //   "front"/"back"       = 最前面/最背面（⇧⌘] / ⇧⌘[・パネルのボタンもこちら）
  //   端で動かないときは Store.reorder がコミットしない＝undo履歴は増えない
  function reorderSel(where) {
    flushNudge();
    const T = targetCtx();
    if (!T.idxs.length) { alertHint("選んでいる図形がありません（選択ツール V で図形を選んでから）"); return; }
    const ni = Store.reorder(T.idxs, where);
    if (ni) T.set(ni);   // 動いた先の index へ選択を追従（展開側は掴んだコピーも保つ）
  }
  $("objFront").onclick = () => reorderSel("front");
  $("objBack").onclick = () => reorderSel("back");
  // [ / ] のキー判定。⇧を押すとUS/JIS配列とも e.key が { / } になるので両方を受ける
  const isBracketL = e => e.key === "[" || e.key === "{";
  const isBracketR = e => e.key === "]" || e.key === "}";

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
    const T = targetCtx(), selIdxs = T.idxs;
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
      T.set(skippedNew);
      alertHint(op === "cross" ? "交差 → 共通部分がありません（⌘Zで戻せます）" : "形が全て消えました（⌘Zで戻せます）");
      return;
    }
    const at = Store.replaceWith(eligIdx, newItems);   // 1コミット=1undo・最背面の位置に挿入
    const k = newItems.length;
    const skippedNew = skippedIdx.map(j => {   // 置換後のindexへ写像（スキップ品も選択に残す）
      const pos = j - eligIdx.filter(i => i < j).length;
      return pos >= at ? pos + k : pos;
    });
    T.set([...Array.from({ length: k }, (_, x) => at + x), ...skippedNew]);
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
    const selIdxs = targetCtx().idxs;
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
        ? "単純化 → 手描き線の細かさは「整え」スライダーで調整します（パスにしてから単純化するなら「なめらかに」）"
        : "単純化 → これ以上減らせません（すでに最小のアンカー数です）");
      return;
    }
    Store.replaceMany(entries);   // 1コミット=1undo
    alertHint(`単純化 → アンカー ${before} → ${after}（もう一度押すとさらに減る・⌘Zで戻る）`);
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
      /* it.formed＝形成の「つなぐ」で作った塗りの実体。**面の材料には入れない**——境界が元の線と
         重なっているので入れると同一直線の辺が二重になり、塗りのたびに面が細分化する。
         塗りは材料の上に載る「色」であって、面を割る線ではない */
      if (it.still || it.kind === "image" || it.formed) continue;
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
    const donor = Store.items.find(it => isBoolable(it) && !it.formed) || Store.items.find(it => !it.formed) || {};
    const sty = {};
    for (const k of ["fill", "stroke", "sw", "alpha"]) if (donor[k] !== undefined) sty[k] = donor[k];
    /* 形成の対象外だった item は面になっていないので、**通常どおり展開して実体化**する
       （ここで落とすと「選択して形成したら他の形が消えた」になる） */
    const rest = subset.length
      ? Store.items.filter(it => !subset.includes(it) && it.kind !== "image" && !it.still) : [];
    const restOut = [];
    for (const M of mats) for (const it of rest) restOut.push(transformItem(it, M));
    /* 形成の「つなぐ」で作った塗り（it.formed）は面の材料から外してあるので、ここで全コピー分を運ぶ。
       画面では「けずった面」が最後に紙色で上から塗られる＝塗りから穴が抜けるので、出力でも同じにする。
       塗りは面の和として作ってあるので、そのコピーの内側にある「消えていない面」を unite し直せば
       穴の抜けた塗りになる（polyBool(subtract) は輪郭が面の辺と完全に重なるため縫合に失敗した）。
       面で埋め尽くされていない塗り（あとから選択ツールで動かした等）は面積が合わないので、そのまま運ぶ */
    const formedOut = [];
    const formedSrc = Store.items.filter(it => it.formed && it.kind === "shape" && !it.still);
    if (formedSrc.length) {
      const inner = f => {   // 面の内側の1点（重心が外れる凹形は代表点）
        const n = f.outer.length;
        const c = [f.outer.reduce((t, q) => t + q[0], 0) / n, f.outer.reduce((t, q) => t + q[1], 0) / n];
        return faceHas(f, c) ? c : faceRep(f);
      };
      const ringsArea = rs => Math.abs(Geom.ringArea(rs[0])) - rs.slice(1).reduce((t, h) => t + Math.abs(Geom.ringArea(h)), 0);
      const faceArea = f => ringsArea([f.outer, ...(f.holes || [])]);
      const cutSet = cutFaceSet(fcx);
      const probe = new Map(faces.map(f => [f, inner(f)]));
      for (const M of mats) for (const it of formedSrc) {
        const copy = transformItem(it, M);
        if (!cutSet.size) { formedOut.push(copy); continue; }
        const rings = itemRings(copy);
        const inside = faces.filter(f => Geom.inRings(rings, probe.get(f)[0], probe.get(f)[1]));
        const cutIn = inside.filter(f => cutSet.has(f));
        if (!cutIn.length) { formedOut.push(copy); continue; }
        const tiled = inside.reduce((t, f) => t + faceArea(f), 0);
        const whole = ringsArea(rings);
        if (!(whole > 0) || Math.abs(tiled - whole) > 0.03 * whole) { formedOut.push(copy); continue; }   // 面で埋まっていない
        const alive2 = inside.filter(f => !cutSet.has(f));
        if (!alive2.length) continue;
        /* 消えていない面を unite。面が1点だけで接する形（asterisk など）や極小の面が混じると
           polyBool が縫合に失敗して空を返す／面積が合わなくなる。そのときは unite を諦めて
           面を1枚ずつ塗る（塗りと輪郭が同じインクなので、中の境界線は見えない） */
        const groupRings = alive2.map(f => [f.outer, ...(f.holes || [])]);
        let merged = Geom.polyBool(groupRings, [], "unite");
        const mArea = merged.reduce((t, q) => t + ringsArea([q.outer, ...(q.holes || [])]), 0);
        const aArea = alive2.reduce((t, f) => t + faceArea(f), 0);
        if (!merged.length || Math.abs(mArea - aArea) > 0.01 * aArea) merged = alive2;
        for (const poly of merged) {
          if (!poly.outer || poly.outer.length < 3) continue;
          const o = { ...copy, points: poly.outer, closed: true };
          delete o.curve; delete o.corners; delete o.holes;
          if (poly.holes && poly.holes.length) o.holes = poly.holes;
          formedOut.push(o);
        }
      }
    }
    return Store.items.filter(it => it.kind === "image" || it.still).concat(
      polys.map(({ poly: f, filled }) => ({
        kind: "shape", shape: "path", points: f.outer, closed: true,
        ...(f.holes && f.holes.length ? { holes: f.holes } : {}), ...sty,
        ...(filled ? { fill: "ink", stroke: "ink", sw: mergeSW() } : {}),
      })), restOut, formedOut);
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
  /* 形成の対象になる item の添字を求める。触った面の範囲(bbox)と重なる item を芋づる式に集め、
     範囲に関係しない開いた線・図形はここに入れない（＝形成しても消えず、そのまま残る）。
     bbox が取れない item は安全側（対象）に入れる。 */
  function padFormTargets(picked) {
    const parts = [];
    Store.items.forEach((it, i) => {
      if (it.still || it.kind === "image") return;
      if (isBoolable(it) || knifePolyline(it)) parts.push(i);
    });
    const R = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const grow = b => { R.x0 = Math.min(R.x0, b.x0); R.y0 = Math.min(R.y0, b.y0); R.x1 = Math.max(R.x1, b.x1); R.y1 = Math.max(R.y1, b.y1); };
    const ringBox = rg => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of rg) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
      return { x0, y0, x1, y1 }; };
    for (const f of picked) if (f.outer && f.outer.length) grow(ringBox(f.outer));
    const M = 1;   // 線幅ぶんの余白
    const hits = b => !b || (b.x0 - M <= R.x1 && b.x1 + M >= R.x0 && b.y0 - M <= R.y1 && b.y1 + M >= R.y0);
    const rel = new Set();
    for (let again = true; again;) {
      again = false;
      for (const i of parts) {
        if (rel.has(i)) continue;
        const b = Render.itemBBox(Store.items[i]);
        if (!hits(b)) continue;
        rel.add(i); again = true;
        if (b) grow(b);
      }
    }
    return { idxs: [...rel].sort((a, b) => a - b), R, hits };
  }
  function padFormUp() {
    const d = padForm;
    padForm = null;
    padHoverFaces = [];
    if (!d || !d.seen.size) { renderPad(); return; }
    const all = padFaces(), picked = [...d.seen];
    const tg = padFormTargets(picked);
    const faceBox = f => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of f.outer || []) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
      return { x0, y0, x1, y1 }; };
    const inScope = f => d.seen.has(f) || tg.hits(faceBox(f));   // 形成の対象にならなかった item の面は触らない
    const donor = tg.idxs.map(i => Store.items[i]).find(isBoolable) || Store.items[tg.idxs[0]] || {};
    const sty = {};
    for (const k of ["fill", "stroke", "sw", "alpha"]) if (donor[k] !== undefined) sty[k] = donor[k];
    const toItem = f => ({
      kind: "shape", shape: "path", points: f.outer, closed: true,
      ...(f.holes && f.holes.length ? { holes: f.holes } : {}), ...sty,
    });
    const rest = all.filter(f => !d.seen.has(f) && inScope(f)).map(toItem);
    let out;
    if (d.alt) out = rest;   // けずる: 触った面を捨てる
    // 面にする: 1面なら「その領域を独立した形に」／複数なら「つなぐ」（イラレのクリックとドラッグ）
    else out = [...rest, ...Geom.polyBool(picked.map(f => [f.outer, ...(f.holes || [])]), [], "unite")
      .filter(p => p.outer && p.outer.length >= 3).map(toItem)];
    if (!out.length && !d.alt) { alertHint("形成 → 面ができませんでした"); renderPad(); return; }
    if (!tg.idxs.length) { renderPad(); return; }
    // 対象の item だけを置き換える（地・画像・関係しない線や図形はそのまま）。1コミット=1undo。
    // けずって何も残らないときは、対象の形を消して空にする
    if (out.length) Store.replaceWith(tg.idxs, out); else Store.removeMany(tg.idxs);
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
    const T = targetCtx();
    const elig = T.idxs.filter(i => Store.items[i].kind !== "image");   // 画像は常に展開側
    if (!elig.length) { alertHint("静止 → 線か図形を選んでください（画像は対象外）"); return; }
    const on = !elig.every(i => Store.items[i].still);   // 全部が静止なら解除・混在なら全部を静止に
    Store.replaceMany(elig.map(i => {
      const o = { ...Store.items[i] };
      if (on) o.still = true; else delete o.still;
      return [i, o];
    }));
    T.set(T.idxs);
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
    for (const i of targetCtx().idxs) {
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
    const T = targetCtx();
    const openIdx = T.idxs.filter(i => isOpenPath(Store.items[i]));
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
    T.set([at]);
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
    const T = targetCtx(), selIdxs = T.idxs;
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
    T.set(newItems.map((_, k) => at + k));
    alertHint(`分割 → ${newItems.length}面（不要な面は選んで削除・組むには合体）`);
  }
  $("opDivide").onclick = divideSel;

  /* オフセット（イラレの「パスのオフセット」相当）:
     閉じた図形 → 内側/外側に平行線（角はマイター・凹角の自己交差はGeom側で掃除）。
     開いた線 → 輪郭化して面にする（線が「太さを持ったかたち」になる＝線と面の往復ができる）。
     距離は離散チップ（外/内 × 2/4/8/16px）＝量子化された入力の美学。 */
  function offsetSel(d) {
    flushNudge();
    const T = targetCtx(), selIdxs = T.idxs;
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
    T.set([...Array.from({ length: k }, (_, x) => at + x), ...skippedNew]);
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

  /* ==== 書き出したSVGを窓に落とすと、その設定で開き直す（006_ツールの規格 §1） ====
     戻るのは**設定**（群の選択・セル・断片・整え・インクと紙・重なりの扱い・メモ）。
     **絵そのもの（線と図形）は戻らない** — 絵は封筒に入らないので、絵ごと戻すのは「開く」（JSON）の仕事。
     取り違えないよう、戻した中身と「絵は戻らない」ことをその場で言う。
     他のツールのSVG・封筒の無いSVGは受けない（図形として取り込むなら「配置」）。 */
  function readEnvelope(text) {
    const m = String(text).match(/<metadata id="studio">([\s\S]*?)<\/metadata>/);
    if (!m) return null;
    const json = m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    try { const env = JSON.parse(json); return env && env.studio ? env : null; } catch (_) { return null; }
  }
  function restoreEnvelope(env) {
    const p = env.params || {};
    const pick = (v, lo, hi, def) => (typeof v === "number" && isFinite(v) ? Geom.clamp(v, lo, hi) : def);
    const cell = pick(p.cell, 48, 300, 72), scale = pick(p.scale, 0.1, 2, 0.65), tidy = pick(p.tidy, 0, 16, 0);
    $("tidyRange").value = tidy;
    setSymRanges(cell, scale);
    Render.setSimplify(tidy);
    Groups.setParams({ cell, scale });
    if (typeof p.rows === "boolean") Groups.setParams({ rows: p.rows });   // 帯の「段を重ねる」
    applyColors(p.ink || $("inkColor").value, p.paper || $("paperColor").value, { persist: false });
    setOverlapMode(p.overlap, false);
    $("memo").value = env.memo || "";
    let hit = null;                          // 群の選択を戻す（一覧の同じ名前のスワッチ）
    for (const sw of swatches) {
      const on = specName(sw.spec) === p.group;
      sw.wrap.classList.toggle("sel", on);
      if (on) hit = sw;
    }
    motif = Render.buildMotif(Store.items, PAD_W);
    renderPad();
    if (viewMode === "live") renderLive(motif); else scheduleSwatches(0);
    savePrefs();
    if (hit) hit.wrap.scrollIntoView({ block: "nearest" });
    alertHint(`設定を戻しました（群 ${p.group || "?"} · セル ${cell}px · 断片 ${scale}× · 整え ${tidy}px`
      + `${hit ? "" : "／この群は一覧に見当たりません"}）。`
      + `絵そのものは戻りません — 絵ごと戻すなら「開く」でJSONを読んでください（書き出し ${env.date || "日時不明"}）`);
  }
  /* ファイルのドロップは必ずこちらで受け止める（ブラウザに開かせない＝描きかけを失わない）。
     SVG以外と、封筒の無いSVGは、どこから読むかを言うだけで何も変えない */
  const hasFiles = dt => !!dt && Array.prototype.some.call(dt.types || [], t => t === "Files");
  addEventListener("dragover", e => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  addEventListener("drop", e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    if (!isSvgFile(f)) { alertHint("SVGだけ受け取ります。画像を図として置くなら「配置」を使ってください"); return; }
    f.text().then(t => {
      const env = readEnvelope(t);
      if (!env) { alertHint("このSVGには出自が入っていません。図形として取り込むなら「配置」を使ってください"); return; }
      if (env.tool !== Exporter.TOOL) { alertHint(`${env.tool} のSVGです（このツールでは開けません）`); return; }
      restoreEnvelope(env);
    }).catch(() => alertHint("SVGを読めませんでした"));
  });

  $("file").addEventListener("change", e => {
    const f = e.target.files?.[0]; if (!f) return;
    if (isSvgFile(f)) f.text().then(t => { if (!importSvgText(t)) alertHint("SVGを取り込めませんでした"); });
    else importImageFile(f);
    e.target.value = "";
  });

  // ペースト取り込み（⌘V）: アプリ内オブジェクト → SVGテキスト → 画像 → アプリ内クリップボード
  window.addEventListener("paste", e => {
    const cd = e.clipboardData; if (!cd) return;
    const plain = cd.getData("text/plain") || "";
    if (plain.includes(CLIP_MARK)) {   // ⌘Cした自前オブジェクト（マーカー付きJSONは text/plain に載る）
      try {
        const data = JSON.parse(plain);
        if (data && data.app === CLIP_MARK && pasteClip(data.items)) { e.preventDefault(); return; }
      } catch (_) { /* 通常テキストとして続行 */ }
    }
    /* SVGの読み順は image/svg+xml → text/plain → text/html（006_ツールの規格 §8）。
       書く側は両MIMEに載せているのに読む側が text しか見ていなかった非対称を解消（spec §12 の残件・2026-08-24） */
    const svgText = cd.getData("image/svg+xml") || plain || cd.getData("text/html") || "";
    const text = plain || cd.getData("text/html") || "";
    if (/<svg[\s>]/i.test(svgText) || /<path[\s>]/i.test(svgText)) {
      if (importSvgText(svgText)) { e.preventDefault(); return; }
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
  /* 戻す・やり直すの後も、まだ存在する図形の選択は保つ（B4）。版が変わると index の指す先がずれるので、
     選んでいた item を**参照で**新しい配列から探して index を張り直す（reorder・追加・削除でも別の形を指さない）。
     参照が見つからないのは「そのコミットで置き換わった形」＝配列の長さが同じなら同じ index の新しい版とみなして残す */
  function remapIdxs(A, B, idxs) {
    if (A === B) return idxs.filter(i => i < B.length);
    const pos = new Map();
    B.forEach((it, i) => pos.set(it, i));
    const out = [];
    for (const i of idxs) {
      const o = A[i];
      if (!o) continue;
      if (pos.has(o)) out.push(pos.get(o));
      else if (A.length === B.length && B[i]) out.push(i);
    }
    return out;
  }
  function stepHistory(fn) {
    const A = Store.items, sp = selIdxs.slice(), se = editSelIdxs.slice(), vi = editSelVi;
    fn();
    const B = Store.items;
    if (sp.length) setSel(remapIdxs(A, B, sp));
    if (se.length) { setEditSel(remapIdxs(A, B, se), vi); scheduleEdit(); }
  }
  function doUndo() { flushNudge(); stepHistory(() => Store.undo()); }
  function doRedo() { flushNudge(); stepHistory(() => Store.redo()); }
  // アプリバー（画面上部に貼り付いて追従する）。狭い画面ではここが唯一の窓口になる
  function syncBarActs() {
    $("barUndo").disabled = !Store.canUndo();
    $("barRedo").disabled = !Store.canRedo();
    $("barClear").disabled = !Store.items.length && !Store.hasForm();
  }
  $("barUndo").onclick = doUndo;
  $("barRedo").onclick = doRedo;
  $("barClear").onclick = () => { if (penPts.length) penReset(); flushNudge(); setSel([]); setEditSel([]); Store.clear(); alertHint("ぜんぶ消しました（⌘Zで戻せます）"); };
  $("barSvg").onclick = () => $("saveSvg").click();
  // アプリバーの「対象: …」表示。saveSvg 側の対象決定ロジック（一覧の選択／編集中の展開）は変えず、いま何が出力対象かを言葉にするだけ
  function syncBarExportTarget() {
    const el = $("barExportTgt"); if (!el) return;
    const m = document.body.classList.contains("mode-edit") ? "編集中の展開" :
              document.body.classList.contains("mode-grid") ? "一覧の作品" : "";
    el.textContent = m ? "対象: " + m : "";
  }
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
    syncBarExportTarget();
  }
  $("modeLive").onclick = () => setViewMode("live");
  $("modeGrid").onclick = () => setViewMode("grid");
  $("modeEdit").onclick = () => setViewMode("edit");

  // 探索パラメータ: セルサイズ / 断片スケール（壁紙・フリーズに効く。Phase 2）
  /* 断片スケールの真の値。「間隔」（setGap）は形の実寸（セル×断片）を保つので、断片が #scaleRange の刻み（0.05）に
     載らない値になる。レンジは刻みへ丸めて見せるだけで、真の値はここに持つ（レンジを人が動かしたら捨てる＝shown と食い違う） */
  let scaleExact = null;   // {v, shown}
  const symScale = () => {
    const s = +$("scaleRange").value;
    return scaleExact && Math.abs(s - scaleExact.shown) < 1e-9 ? scaleExact.v : s;
  };
  // セル・断片を反映する（レンジの表示・真の値・数値欄）。Groups.setParams は呼ばない（呼び出し側）
  function setSymRanges(cell, scale) {
    $("cellRange").value = cell; $("scaleRange").value = scale;
    scaleExact = { v: scale, shown: +$("scaleRange").value };
    syncNumRows();
  }
  function applySymParams() {
    const changed = Groups.setParams({ cell: +$("cellRange").value, scale: symScale() });
    if (!changed || !motif) return;
    if (viewMode === "live") renderLive(motif);
    else if (viewMode === "edit") { scheduleSwatches(60); renderEdit(); }   // 展開面も即再描画
    else scheduleSwatches(60);
    savePrefs();
  }
  $("cellRange").addEventListener("input", applySymParams);
  $("scaleRange").addEventListener("input", applySymParams);
  /* 間隔（壁紙・帯）＝セル辺 CELL。**形の大きさ（セル×断片＝モチーフの実寸）は変えず**、間隔だけ変える:
     CELL を替えた分だけ MOTIF_SCALE を合わせる（範囲外は端に寄せる）。Groups.setParams 経由・#cellRange/#scaleRange も同期 */
  const GAP_MIN = 48, GAP_MAX = 300, SCALE_MIN = 0.1, SCALE_MAX = 2;   // 断片は最大2（大きさスライダー。重なってよい）
  function setGap(v) {
    const p = Groups.getParams();
    const real = p.cell * p.scale;
    const cell = Geom.clamp(Math.round(+v / 4) * 4, GAP_MIN, GAP_MAX);
    if (!isFinite(cell) || cell === p.cell) return;
    const scale = Geom.clamp(real / cell, SCALE_MIN, SCALE_MAX);
    setSymRanges(cell, scale);
    applySymParams();
  }
  // 大きさ（壁紙・帯）＝モチーフの実寸（CELL×MOTIF_SCALE）。CELL（間隔）は変えない。値は断片スケールそのもの
  function setSize(v) {
    const scale = Geom.clamp(+v, SCALE_MIN, SCALE_MAX);
    if (!isFinite(scale) || scale === Groups.getParams().scale) return;
    setSymRanges(Groups.getParams().cell, scale);
    applySymParams();
  }
  const isTileSpec = () => { const k = editSpecNow().kind; return k === "wallpaper" || k === "frieze"; };
  const isFriezeSpec = () => editSpecNow().kind === "frieze";
  /* 帯の「段を重ねる」: 帯を縦に CELL（間隔）ごと展開面いっぱいに並べる。Groups.layout（instancesFrieze）の経路なので
     画面・SVG・PNG・スワッチが同じになる。オフで従来の1列。prefs `rows`（既定オン）・封筒にも載せる */
  function setRows(on) {
    if (!Groups.setParams({ rows: !!on }) || !motif) return;
    if (viewMode === "live") renderLive(motif);
    else if (viewMode === "edit") { scheduleSwatches(60); renderEdit(); }
    else scheduleSwatches(60);
    savePrefs();
  }

  // tidy: 手描き線の「整える」量（Douglas-Peucker eps）。raw座標は不変で描画/出力時に適用
  function setTidy(eps, { persist = true } = {}) {
    Render.setSimplify(eps);
    if ($("tidyRange").value !== String(eps)) $("tidyRange").value = eps;
    motif = Render.buildMotif(Store.items, PAD_W);   // 幾何を組み直して即反映
    renderPad();
    if (viewMode === "live") renderLive(motif);
    else if (viewMode === "edit") { scheduleSwatches(60); renderEdit(); }   // 展開面も即再描画
    else scheduleSwatches(60);
    if (persist) savePrefs();
  }
  $("tidyRange").addEventListener("input", e => setTidy(+e.target.value));

  /* ==== 数値行（006_ツールの規格 §5・正典は135の bindNumberRow） ====
     スライダーの隣に数値入力を置き、双方向に同期する。
       ↑ ↓（数値欄・スライダーとも）  … ±1×step
       ⇧↑ ⇧↓                        … 10×stepの倍数へ乗せてから ±10×step（イラレの粗い刻みと同じ着地）
       ラベルを左右にドラッグ          … 連続変更（⇧で1/10）
       ラベルをダブルクリック          … 既定値へ戻す
       数値欄に直接入力                … Enter か フォーカスが外れたときに確定
     吸着(stops)が効くのは**ドラッグだけ**。矢印キーと直接入力は通さない（狙った値に正確に置く経路）。 */
  const numRows = [];
  function bindNumberRow(rangeId, numId, opts) {
    const range = $(rangeId), num = $(numId);
    if (!range || !num) return null;
    const step = +range.step || 1, lo = +range.min, hi = +range.max;
    const dec = (String(step).split(".")[1] || "").length;
    const stops = opts.stops || [], tol = opts.tol != null ? opts.tol : step * 1.5;
    const def = opts.def != null ? opts.def : +range.value;
    const fmt = v => (+v).toFixed(dec);
    const clamp = v => Math.min(hi, Math.max(lo, v));
    const grid = v => +fmt(clamp(Math.round(v / step) * step));   // stepの格子に載せる（浮動小数の端数を残さない）
    const snap = (v, off) => {
      if (off || !stops.length) return v;
      let best = v, d = tol;
      for (const t of stops) { const dd = Math.abs(t - v); if (dd <= d) { d = dd; best = t; } }
      return best;
    };
    const show = v => { range.value = v; num.value = fmt(v); };
    const apply = (v, fire = true) => { const nv = grid(v); show(nv); if (fire) opts.onInput(nv); };
    // ⇧↑↓ は「10×step の倍数へ乗せてから ±10×step」
    const coarse = (v, dir) => {
      const u = step * 10, base = dir > 0 ? Math.floor(v / u) * u : Math.ceil(v / u) * u;
      return base + dir * u;
    };
    function onArrow(e) {
      const dir = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1
                : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
      if (!dir) return false;
      e.preventDefault();
      const cur = +range.value;
      apply(e.shiftKey ? coarse(cur, dir) : cur + dir * step);
      return true;
    }
    let dragging = false;
    range.addEventListener("pointerdown", () => { dragging = true; });
    addEventListener("pointerup", () => { if (dragging) { dragging = false; range.step = step; } });
    range.addEventListener("input", () => {
      // ドラッグ中だけ吸着する（⇧で解除＋1/10刻み）。キーボードは下の onArrow が受ける
      apply(dragging ? snap(+range.value, range.step !== String(step)) : +range.value);
    });
    range.addEventListener("keydown", onArrow);
    addEventListener("keydown", e => { if (dragging && e.key === "Shift") range.step = step / 10; });
    addEventListener("keyup", e => { if (dragging && e.key === "Shift") range.step = step; });

    num.addEventListener("focus", () => num.select());
    num.addEventListener("keydown", e => {
      if (onArrow(e)) return;
      if (e.key === "Enter") { e.preventDefault(); commitNum(); num.blur(); }
      if (e.key === "Escape") { show(+range.value); num.blur(); }
    });
    num.addEventListener("blur", commitNum);
    function commitNum() {
      const v = parseFloat(num.value);
      if (!isFinite(v)) { show(+range.value); return; }   // 数字でなければ元に戻す（無反応にしない）
      apply(v);
    }
    // ラベル: 左右ドラッグで増減・ダブルクリックで既定値（135と同じ作法）
    const row = range.closest(".prow"), label = row && row.querySelector(".plbl");
    if (label) {
      label.classList.add("drag");
      label.title = `左右にドラッグで増減 / ダブルクリックで既定値（${fmt(def)}）に戻す`;
      let from = null;
      label.addEventListener("pointerdown", e => {
        from = { x: e.clientX, v: +range.value };
        label.setPointerCapture(e.pointerId);
      });
      label.addEventListener("pointermove", e => {
        if (!from) return;
        const k = e.shiftKey ? step / 10 : step;
        apply(snap(from.v + (e.clientX - from.x) * k, e.shiftKey));
      });
      label.addEventListener("pointerup", () => { from = null; });
      label.addEventListener("dblclick", () => { apply(def); });
    }
    const row2 = { sync: () => show(grid(+range.value)) };
    numRows.push(row2);
    show(grid(+range.value));
    return row2;
  }
  /* 吸着の基準値は spec §5 の標準（長さ=50の倍数 / 太さ=5の倍数 / 倍率=0.5と1）に合わせる */
  bindNumberRow("cellRange", "cellNum", { stops: [50, 100], tol: 4, def: 72, onInput: applySymParams });
  bindNumberRow("scaleRange", "scaleNum", { stops: [0.5, 1], tol: 0.03, def: 0.65, onInput: applySymParams });
  bindNumberRow("tidyRange", "tidyNum", { stops: [0, 5, 10, 15], tol: 0.4, def: 0, onInput: v => setTidy(v) });
  const syncNumRows = () => numRows.forEach(r => r.sync());


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
    ? (editSelIdxs.length ? editSelIdxs : editSel ? [editSel.idx] : selIdxs)   // 展開側に何も無ければ左のパッドの選択（どちらで選んでも効く）
    : selIdxs;
  /* 選択に効く操作の窓口（2026-10-25）。対象の読み取りは targetIdxs()、書き込み（選び直し）は ctx.set()。
     どちらの選択を見ているか（edit=展開側）は操作の最初に固定する——Store が変わると選択の持ち主が変わり得るため。
     展開側なら setEditSel（掴んだコピー vi は保つ）、そうでなければ setSel */
  function targetCtx() {
    const edit = viewMode === "edit" && (editSelIdxs.length > 0 || !!editSel || !selIdxs.length);
    return {
      edit,
      idxs: targetIdxs().filter(i => Store.items[i]),
      set(ids, vi) {
        if (edit) { editSel = null; setEditSel(ids, vi); scheduleEdit(); }
        else setSel(ids);
      },
    };
  }

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
    const swapIdxs = targetCtx().idxs;
    if (swapIdxs.length) {
      flushNudge();
      const entries = swapIdxs.map(i => {
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
    $("disH").classList.toggle("dis", tgt.length < 3);   // 等間隔は3個以上で意味を持つ
    $("disV").classList.toggle("dis", tgt.length < 3);
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
  /* 一度だけ使う道具（フリックの 円・矩形・多角形・触って削除）。1個描く／1個消したら back の道具へ戻る。
     ほかの道具へ替えたら解除。画面（workbench.js）の入口は api.oneShotTool が呼ぶ */
  let oneShot = null;   // {tool, back}
  function oneShotDone() {
    if (!oneShot || oneShot.tool !== tool) return;
    const back = oneShot.back;
    oneShot = null;
    if (back === "form") formErase = false;   // 形成へ戻るときは「つなぐ」
    setTool(back);
  }
  function setTool(t) {
    if (oneShot && t !== oneShot.tool) oneShot = null;
    if (t !== tool) document.dispatchEvent(new Event("symmetry:tool"));   // 前の道具の通知を消す（workbench.js）
    if (t === "form" && tool !== "form") toolPrev = tool;
    /* ペン途中の点は、別の道具へ替えた瞬間に確定する（持ち主の依頼 2026-10-24: 確定のために
       マウスへ手を伸ばさず、V・N などで次の道具へ移るだけで済ませる）。
       2点以上＝開いたパスとして確定／1点だけ＝パスにならないので捨てる。Enter・Esc・始点クリックで閉じる動作は従来どおり */
    if (tool === "pen" && t !== "pen" && penPts.length) {
      if (penPts.length >= 2) { penCommit(false); alertHint("描きかけの線を確定しました"); } else penReset();
    }
    if (padEdit && !isAnchorTool(t)) exitPadEdit();
    if (tool === "move" && t !== "move") { flushNudge(); marquee = null; dupDrag = false; handleDrag = null; setSel([]); }
    if (tool === "form" && t !== "form") { padForm = null; padHoverFaces = []; }
    /* ツールを跨ぐ途中状態は必ず捨てる（前のツールの選択が残って誤操作になるのを防ぐ）。
       展開ビュー側も同じ tool を見ているので、ここ1箇所で両方の面倒をみる */
    // 描いた直後の選択は、描画系→選択（V）・描画系→描画系で持ち越す（形成へはそのまま持ち込まない＝材料が選択だけに絞られるため）
    const keepSel = isEditDrawTool(tool) && (t === "move" || isEditDrawTool(t));
    if (t === "form" && motifOnly) { setMotifOnly(false, true); alertHint("展開に戻しました"); }   // 形成は展開が前提（黙って切り替えない）
    if (t !== tool) {
      if (drawLock) { drawLock = null; raw = null; lastPt = null; shapeDrag = null; hoverPt = null; downPt = null; }   // 展開面で描いている途中のツール替え
      hoverFaces = []; hoverEdges = []; formDrag = null;
      editSel = null; editDrag = null; editPreview = null; editSnapHit = null;
      editXf = null; editMarquee = null; editClickPend = null;
      if (t === "form" ? isEditDrawTool(tool) : !keepSel) { editSelIdxs = []; updateEditSelInfo(); }   // 形成は選択で対象を絞れるので持ち越す（描画直後の選択は除く）
    }
    tool = t;
    for (const [k, id] of Object.entries(TOOL_BTN)) $(id).classList.toggle("on", k === t);
    document.body.classList.toggle("tool-poly", t === "polygon");
    document.body.classList.toggle("tool-anchor", t === "anchor");
    pad.style.cursor = t === "freehand" || t === "pen" ? "crosshair"
      : t === "erase" || t === "move" || t === "anchor" || t === "form" ? "pointer" : "cell";
    if (t === "pen" && penPts.length) { renderPad(); Render.previewShape(pctx, PAD_W, motif, padScale, guide, liveItem(), axis); scheduleLive(); }   // 残してあるペンの途中を描き直す
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

  /* ==== 出自（006_ツールの規格 §1 封筒・§2 キャプション） ====
     書き出すSVGには必ず封筒が入る。キャプション（☑）は同じ内容を目に見える帯にする。
     メモは封筒の memo とキャプションの「メモ:」の両方へ入る。 */
  const OVERLAP_JA = { each: "そのまま", merge: "結合", punch: "重なりを穴に" };
  function studioParams(spec) {
    const c = Render.colors();
    return {
      group: specName(spec),                 // 群の名前（表示どおり。C6 / p3m1 / spinning hop / カスタム名）
      kind: spec.kind,                       // wallpaper / frieze / rosette / custom
      cell: +$("cellRange").value,
      scale: +symScale().toFixed(4),
      rows: spec.kind === "frieze" ? Groups.getParams().rows : null,   // 帯の「段を重ねる」の有無（帯以外は null）
      tidy: +$("tidyRange").value,
      ink: c.ink, paper: c.paper,
      overlap: Render.getOverlap(),
      formed: Store.hasForm(),               // 形成（けずる・つなぐ）の記録があるか
      shapes: Store.items.filter(it => it.kind === "stroke" || it.kind === "shape").length,
      size: SW,
    };
  }
  function studioMeta(spec) {
    const memo = $("memo").value.trim();
    const params = studioParams(spec);
    const meta = { tool: Exporter.TOOL, pj: Exporter.PJ, law: Exporter.LAW, params, seed: null, memo };
    if ($("cap").checked) {
      // 設定値はUIのラベルのまま（§2）
      meta.caption = [
        `群 ${params.group} · セル ${params.cell}px · 断片 ${params.scale}× · 整え ${params.tidy}px`
        + ` · 重なり ${OVERLAP_JA[params.overlap] || params.overlap}${params.formed ? " · 形成あり" : ""}`
        + ` · 図形 ${params.shapes}個 · インク ${params.ink} · 紙 ${params.paper}`
        + ` · ${Exporter.studioStamp().date}`,
      ];
    }
    return meta;
  }
  // §3 ファイル名: <tool>_<主要値>_<YYYYMMDD-HHMM>
  const svgName = spec => Exporter.studioFname(Exporter.TOOL, Exporter.slug(specName(spec)));
  const pngName = spec => Exporter.studioFname(Exporter.TOOL, `${Exporter.slug(specName(spec))}-${pngScale}x`);

  /* ==== 書き出し（GRID） ==== */
  $("saveSvg").onclick = () => {
    const list = selected();
    if (!list.length) { alertHint("一覧で群をひとつ選んでください（枠をクリック）"); return; }
    const names = [];
    for (const s of list) {
      const text = Exporter.svg(s.spec, Store.items, PAD_W, SW, formedItems(s.spec), studioMeta(s.spec));
      if (!text) continue;
      const n = `${svgName(s.spec)}.svg`;
      Exporter.downloadText(text, n);
      names.push(n);
    }
    // どのファイル名で落ちたかをその場で知らせる（§9・失敗も無反応にしない）
    alertHint(names.length ? `SVGを書き出しました: ${names.join(" / ")}` : "ベクターがありません");
  };
  const savePngFor = list => {
    for (const s of list) {
      Exporter.png(s.spec, Store.items, PAD_W, SW, pngScale, blob =>
        Exporter.downloadBlob(blob, `${pngName(s.spec)}.png`),
        pngBg === "clear" ? null : Render.colors().paper, formedItems(s.spec));
    }
    if (list.length) alertHint(`PNG（${pngScale}x）を${list.length}枚書き出しました`);
  };
  /* 図版全体のSVGコピー（「SVGをコピー」ボタン／選択が無いときの ⌘C・006_ツールの規格 §8）。
     対象は一覧で選んだ群、無ければ展開に使っている群（editSpecNow）。地色は含まない */
  async function copyFigureSvg() {
    const spec = editSpecNow();
    const text = Exporter.svg(spec, Store.items, PAD_W, SW, formedItems(spec), studioMeta(spec));
    if (!text) { alertHint("ベクターがありません（線や図形を描いてからコピーしてください）"); return; }
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
      alertHint(`${specName(spec)} のSVGをコピーしました（Illustrator/Figmaに⌘V）`);
    } catch (_) {
      try { await navigator.clipboard.writeText(text); alertHint("SVGコードをコピーしました"); }
      catch (e2) { alertHint("コピーできませんでした（保存を使ってください）"); }
    }
  }
  $("copySvg").onclick = copyFigureSvg;
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
    Exporter.downloadText(JSON.stringify({ ...Store.toJSON(), customs, workbench:workbenchSnapshot() }),
      `sym-doc-${Exporter.stamp()}.json`, "application/json");
  $("jsonIn").addEventListener("change", e => {
    const f = e.target.files?.[0]; if (!f) return;
    f.text().then(text => {
      let data;
      try { data = JSON.parse(text); if (data.workbench) applyWorkbenchSnapshot(data.workbench); else Store.fromJSON(data); }
      catch (err) { alertHint("JSONを読めませんでした"); return; }
      const added = mergeCustoms(data.customs);
      document.dispatchEvent(new Event("symmetry:change"));
      alertHint("作品を読み込みました");
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
  /* 展開なしで表示（Tab）: 同じ展開面のまま、基準コピー（editViews の先頭）1つだけを見せる画面のみのモード。
     editViews がここで1枚に絞るので、描く・選ぶ・点を動かす・消す・吸着の全部が「見えている1コピー」だけを相手にする。
     書き出し・スワッチ・形成（展開が前提）には関係しない */
  let motifOnly = false;
  let editSel = null;       // {idx, ring(-1=外周 | 穴index), pt}
  let editDrag = null;      // {inv} 掴んだコピーの逆行列（ドラッグ中固定=リスト順の揺れに依存しない）
  let editPreview = null;   // ドラッグ中のpatched items
  let editSnapHit = null;   // {x,y,kind,dir?} 吸着先（ビュー座標・画面表示のみ／書き出しには出さない）
  const EDIT_LOGICAL_MAX = 600;   // 展開面の論理サイズの上限（renderEditMain）
  let editSize = 280;
  let editZoom = 1;         // 展開面の表示倍率（workbench.js の camera から。解像度だけに使う＝拡大は CSS transform）
  let previewSpec = null;   // 一覧ポップアップで矢印移動中の仮の群（画面のみ・状態は変えない）
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
    const all = insts.map(inst => Geom.mul(inst, place.mat));
    return motifOnly ? all.slice(0, 1) : all;   // 展開なし＝先頭の1コピー（位置は展開時のそのコピーと同じ）
  };
  const editPos = e => {
    const r = editCv.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * editSize, (e.clientY - r.top) / r.height * editSize];
  };

  /* ==== セル格子（壁紙・帯）: 展開面の論理座標での格子。吸着先（snapKinds.lattice）と薄い線（画面のみ） ====
     壁紙: o=(0,0)＝展開の並進の原点（instancesWallpaper の ox,oy と同じ格子）・a=(B0,B2)・b=(B1,B3)（基底 Groups.basis の列）。
     帯: a=(CELL,0)・b=null・o=帯の軸上の点（instancesFrieze が軸をビュー高さの中央に置く）。回転対称・カスタムは null */
  function editLattice(spec) {
    spec = spec || editSpecNow();
    if (spec.kind === "wallpaper" && Groups.TABLE[spec.name]) {
      const B = Groups.basis(Groups.TABLE[spec.name].lattice);
      return { o: [0, 0], a: [B[0], B[2]], b: [B[1], B[3]] };
    }
    if (spec.kind === "frieze") {
      const B = Groups.basis();
      // 段を重ねるとき（既定）は縦にも CELL ごとに並ぶので b=(0,CELL)。1列のときは b=null
      return { o: [0, editSize / 2], a: [B[0], 0], b: Groups.getParams().rows ? [0, B[3]] : null };
    }
    return null;
  }
  let latticeOn = true;   // 展開面にセル格子の線を出す（画面のみ。prefs.lattice）
  // 格子の吸着先: 格子点・辺の中点・セル中心＝格子の半分の刻みの点 o+(i/2)a+(j/2)b
  function latticeSnap(v, tol, spec) {
    const L = editLattice(spec);
    if (!L) return {};
    const { o, a, b } = L;
    let best = null;
    const test = (i, j) => {
      const x = o[0] + i / 2 * a[0] + (b ? j / 2 * b[0] : 0), y = o[1] + i / 2 * a[1] + (b ? j / 2 * b[1] : 0);
      const d = Math.hypot(x - v[0], y - v[1]);
      if (d < tol && (!best || d < best.d)) best = { d, x, y, kind: "lattice" };
    };
    if (!b) {   // 帯: 軸上の点だけ（o+(i/2)a）
      const i0 = Math.round((v[0] - o[0]) / a[0] * 2);
      for (let i = i0 - 1; i <= i0 + 1; i++) test(i, 0);
    } else {
      const det = a[0] * b[1] - a[1] * b[0];
      const dx = v[0] - o[0], dy = v[1] - o[1];
      const u = (dx * b[1] - dy * b[0]) / det * 2, w = (-dx * a[1] + dy * a[0]) / det * 2;   // 半刻み単位の分数座標
      for (let i = Math.floor(u) - 1; i <= Math.ceil(u) + 1; i++) for (let j = Math.floor(w) - 1; j <= Math.ceil(w) + 1; j++) test(i, j);
    }
    return { lattice: best };
  }
  /* 格子の線（画面のみ・UI のグレー。作品の色は使わない）。ctx は論理座標（setTransform 済み）。px=1画面pxに当たる論理長。
     セルの境界（濃いめ）＋吸着先の半分の刻み（辺の中点・セル中心を通る線＝薄め）。吸着する点（線の交点）が見えるようにする */
  function drawLatticeLines(ctx, size, L, px) {
    ctx.save();
    ctx.lineWidth = px;
    const far = size * 4, strong = new Path2D(), light = new Path2D();
    const line = (path, p, d) => {
      const n = Math.hypot(d[0], d[1]) || 1, k = far / n;
      path.moveTo(p[0] - d[0] * k, p[1] - d[1] * k);
      path.lineTo(p[0] + d[0] * k, p[1] + d[1] * k);
    };
    const { o, a, b } = L;
    if (!b) {   // 帯: 半周期ごとの縦線＋軸
      line(strong, o, a);
      const i0 = Math.floor((0 - o[0]) / a[0] * 2) - 1, i1 = Math.ceil((size - o[0]) / a[0] * 2) + 1;
      for (let i = i0; i <= i1; i++) line(i % 2 ? light : strong, [o[0] + i / 2 * a[0], o[1]], [0, 1]);
    } else {
      const det = a[0] * b[1] - a[1] * b[0];
      let u0 = 1e9, u1 = -1e9, w0 = 1e9, w1 = -1e9;
      for (const [x, y] of [[0, 0], [size, 0], [0, size], [size, size]]) {
        const dx = x - o[0], dy = y - o[1];
        const u = (dx * b[1] - dy * b[0]) / det, w = (-dx * a[1] + dy * a[0]) / det;
        u0 = Math.min(u0, u); u1 = Math.max(u1, u); w0 = Math.min(w0, w); w1 = Math.max(w1, w);
      }
      for (let j = Math.floor(w0 * 2) - 1; j <= Math.ceil(w1 * 2) + 1; j++) line(j % 2 ? light : strong, [o[0] + j / 2 * b[0], o[1] + j / 2 * b[1]], a);   // a 方向の線
      for (let i = Math.floor(u0 * 2) - 1; i <= Math.ceil(u1 * 2) + 1; i++) line(i % 2 ? light : strong, [o[0] + i / 2 * a[0], o[1] + i / 2 * a[1]], b);   // b 方向の線
    }
    ctx.strokeStyle = "rgba(98,103,98,.16)"; ctx.stroke(light);   // --color-text-muted（#626762）の薄がけ
    ctx.strokeStyle = "rgba(98,103,98,.30)"; ctx.stroke(strong);
    ctx.restore();
  }
  /* 回転対称（C/D/独自）の補助線: 中心の小さな十字＋ Cn は回転の区切り n 本の放射線・Dn は鏡映の軸 n 本（中心を通る線）。
     向きは群の行列から導く（回転は atan2(b,a)・鏡映の軸は atan2(b,a)/2）。独自は十字だけ。同じ薄い灰色・画面のみ */
  function drawRosetteAux(ctx, size, spec, px) {
    const c = size / 2, far = size * 2;
    ctx.save();
    ctx.lineWidth = px;
    /* 回転対称の補助線（中心・回転の区切り・鏡映の軸）。壁紙・帯のセル格子（drawLatticeLines）の濃い線と同じ灰色・同じ太さ。
       画面のみ（書き出し・スワッチには出さない＝regress_261027v V3）。検査は灰色を作品の線と数えない（regress_stage2 FIND_INK_JS は青みだけ） */
    ctx.strokeStyle = "rgba(98,103,98,.30)";
    ctx.beginPath();
    const r = 6 * px;
    ctx.moveTo(c - r, c); ctx.lineTo(c + r, c); ctx.moveTo(c, c - r); ctx.lineTo(c, c + r);
    if (spec.kind === "rosette") {
      const insts = Groups.layout(spec, size, PAD_W, null).insts;
      const rays = [], axes = [];
      const same = (list, a, mod) => list.some(b => { const d = Math.abs(((a - b) % mod + mod) % mod); return d < 1e-3 || mod - d < 1e-3; });
      for (const m of insts) {
        if (m[0] * m[3] - m[1] * m[2] > 0) { const a = Math.atan2(m[1], m[0]); if (!same(rays, a, 2 * Math.PI)) rays.push(a); }
        else { const a = Math.atan2(m[1], m[0]) / 2; if (!same(axes, a, Math.PI)) axes.push(a); }
      }
      if (axes.length) for (const a of axes) { ctx.moveTo(c - Math.cos(a) * far, c - Math.sin(a) * far); ctx.lineTo(c + Math.cos(a) * far, c + Math.sin(a) * far); }
      else if (rays.length > 1) for (const a of rays) { ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(a) * far, c + Math.sin(a) * far); }
    }
    ctx.stroke();
    ctx.restore();
  }
  /* 展開面の吸着（描画系ツールの点）: ビュー座標 v を、全コピー横断のエンジン（ドラッグ移動と同じ
     snapSearch＋symSnap＋crossSnap＋格子）で吸わせる。探索はビュー座標。許容は PC 8・タッチ 12（ビュー px）。
     描きかけの自分（ペンの置いた点・図形の始点）は Store.items に無いので吸着先にならない。戻り {x,y,kind,dir?}（ビュー座標）か null */
  function editSnapView(v, lock, touch) {
    if (!snapOn || !lock) return null;
    const tol = touch ? 12 : 8;
    const bb = lock.bbox, all = editViews(bb);
    const near = all.filter(V => {   // 輪郭・交点の探索はカーソル近傍のコピーだけ（壁紙は数十枚あるため）
      const xs = [], ys = [];
      for (const c of [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]]) {
        const q = Geom.apply(V, c[0], c[1]); xs.push(q[0]); ys.push(q[1]);
      }
      return v[0] >= Math.min(...xs) - tol && v[0] <= Math.max(...xs) + tol
          && v[1] >= Math.min(...ys) - tol && v[1] <= Math.max(...ys) + tol;
    });
    const rings = ringsOf(Store.items);
    return pickSnap({ ...snapSearch(v, rings, near, null, tol), ...symSnap(v, all, tol),
      ...crossSnap(v, rings, near, tol), ...latticeSnap(v, tol) });
  }
  /* 吸着した点をパッド座標で返す（描いているコピー lock.inv で戻す）。何にも吸かなければガイド（格子16分割／同心円）へ。
     吸着マーカー（editSnapHit）もここで更新する */
  function editSnapPad(v, lock, touch) {
    const q = Geom.apply(lock.inv, v[0], v[1]);
    if (!snapOn) { editSnapHit = null; return [q[0], q[1]]; }
    const hit = editSnapView(v, lock, touch);
    editSnapHit = hit;
    if (hit) { const r = Geom.apply(lock.inv, hit.x, hit.y); return [r[0], r[1]]; }
    return guideSnap([q[0], q[1]]);
  }

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

  // 展開面を描き直したら知らせる（workbench.js が展開の右の小さい図を、間引きながら描き直す）
  function renderEdit() {
    renderEditMain();
    document.dispatchEvent(new Event("symmetry:edit-rendered"));
  }
  function renderEditMain() {
    if (viewMode !== "edit") return;
    /* 展開は正方形なので、**幅と高さの小さいほう**に収める。スマホで幅いっぱいに広げると
       画面より縦に長くなり、編集しているものがスクロールしないと見えなくなる */
    const host = document.getElementById("wbArt");
    const narrow = window.innerWidth < 900;
    const availW = host ? host.clientWidth - 32 : $("edit").clientWidth || 560;
    const availH = host ? host.clientHeight - 32 : window.innerHeight - 240;
    const display = Math.max(80, Math.min(880, availW, availH));   // 画面での大きさ（px）
    /* 展開面の論理サイズは EDIT_LOGICAL_MAX（600）まで。群のセルは絶対 px で並ぶので、窓が大きいときは
       論理サイズを増やさず**拡大して描く**（模様の密度が窓の大きさで変わらない・座標系も 600 基準のまま）。
       それより小さい画面（スマホ）は論理サイズ＝表示サイズ */
    const size = Math.min(display, EDIT_LOGICAL_MAX);
    const fit = display / size;
    /* 表示を拡大しても線がぼやけないよう、canvas の実ピクセルを 表示倍率×dpr に合わせて描き直す
       （CSS transform の拡大だけだと元のビットマップを引き伸ばすだけ）。巨大化しないよう一辺 4096px で頭打ち */
    const res = dpr * fit * Math.min(Math.max(editZoom, 1), Math.max(1, 4096 / (display * dpr)));
    if (editCv.width !== Math.round(size * res)) {
      editCv.width = Math.round(size * res);
      editCv.height = Math.round(size * res);
      editCv.style.width = display + "px";
    }
    editSize = size;
    const items = editPreview || Store.items;
    /* 直接描画（段2）: 描いている最中の item も含めて展開し、配置は操作の始めに凍結した外接枠で固定する。
       空の作品は仮の枠で複製を出す（描ける状態にするだけ・items と保存は変えない） */
    const lock = drawLock || (penPts.length ? penLock : null);
    const m = Render.buildMotif(items, PAD_W, liveItem());
    const noMotif = !m.bbox;
    if (lock) m.bbox = lock.bbox;
    else if (noMotif) m.bbox = DEFAULT_BBOX;
    Render.swatchInto(ectx, size, res, previewSpec || editSpecNow(), m, PAD_W, Render.colors().paper, size, undefined, motifOnly);
    /* ガイド（格子／同心円）。パッドでは作品の背後だが、ここは swatchInto が地を塗り直すので上に置く。
       位置合わせの目安なので上でも機能する。画面のみ＝書き出しには出ない */
    if (guide !== "off") {
      ectx.setTransform(res, 0, 0, res, 0, 0);
      ectx.save();
      ectx.globalAlpha = 0.55;
      Render.drawGuides(ectx, size, guide, null);
      ectx.restore();
    }
    {   // 補助線（画面のみ。スワッチ・SVG・PNG・右の小さい展開には出さない）: 壁紙・帯＝セル格子／回転対称＝中心の十字と回転の区切り・鏡映の軸。何も描いていなくても出す
      const sp = previewSpec || editSpecNow();
      if (latticeOn) {
        ectx.setTransform(res, 0, 0, res, 0, 0);
        const L = editLattice(sp);
        if (L) drawLatticeLines(ectx, size, L, 1 / fit);
        else drawRosetteAux(ectx, size, sp, 1 / fit);
      }
    }
    if (previewSpec) return;   // 仮の群を見せている間は、選択の枠やアンカーは出さない（位置が合わない）
    const views = editViews(m.bbox);
    const pts = editablePoints(items);
    if (editSel && !pts.some(q => q.idx === editSel.idx && q.ring === editSel.ring && q.pt === editSel.pt))
      editSel = null;   // undo等で消えた選択は捨てる
    ectx.setTransform(res, 0, 0, res, 0, 0);
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
    if (!motifOnly && (cutOrbits().length || mergeGroups().length || cutEdges().length || editToolOf(tool) === "shape")) {
      /* 面・線は FORM_SIZE(=PAD_W) 座標で計算されている。表示サイズへはここでスケールするだけ
         ＝計算はサイズに依らず1つの座標系、表示はcanvasの都合、という分離 */
      const fk = size / FORM_SIZE;
      ectx.setTransform(res * fk, 0, 0, res * fk, 0, 0);
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
      ectx.setTransform(res, 0, 0, res, 0, 0);   // 以降（枠・吸着マーカー）はビュー座標に戻す
    }
    if (editToolOf(tool) === "select") drawEditBox();
    else if (isEditDrawTool(tool) && editSelIdxs.length && !drawLock) drawEditBox(true);   // 描いた直後の形（どれを描いたか分かる枠）
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
    if (document.body.classList.contains("workbench") || window.innerWidth >= 900 || viewMode !== "edit") {
      document.documentElement.style.removeProperty("--sp-edit-h");
      return;
    }
    const h = $("edit").getBoundingClientRect().height;
    if (h > 0) document.documentElement.style.setProperty("--sp-edit-h", Math.round(h + 8) + "px");
  }

  // 展開ビューのヒント（いま選んでいるツールの操作だけを書く＝読む量を増やさない）
  /* 展開ビューでアンカーを出す（＝掴める）コピー。描画と当たり判定で同じ関数を使い、見えないアンカーを掴めないようにする。
     基準コピー=モチーフ中心がビュー中心に最も近い1枚。 */
  function anchorShownViews(views, pts, bbox, size) {
    if (anchorView === "off" || !views.length) return [];
    const cx0 = (bbox.x0 + bbox.x1) / 2, cy0 = (bbox.y0 + bbox.y1) / 2;
    let base = views[0], bd = Infinity;
    for (const V of views) {
      const [x, y] = Geom.apply(V, cx0, cy0);
      const d = Math.hypot(x - size / 2, y - size / 2);
      if (d < bd) { bd = d; base = V; }
    }
    const overflow = views.length * pts.length > 2400;
    return (anchorView === "one" || overflow) ? [base] : views;
  }
  function editHintText(overflow) {
    const g = specName(editSpecNow());
    if (isEditDrawTool(tool))
      return `${g} — 展開した絵の上に直接描けます（どの複製の上で描いても、全部の複製に同じ形が出ます）`
        + (tool === "pen" ? "。クリックで角の点・ドラッグでスムース点・「確定」で終わり" : "")
        + (tool === "erase" ? "。消したい形の上をクリック" : "")
        + (Store.items.length ? "" : "。いまは何も描かれていないので、中央の枠のあたりに複製を出しています");
    if (!editToolOf(tool))
      return `${g} — いまのツール（${TOOL_LABEL[tool] || tool}）は展開の上では使えません。`
        + `描くには 手描き・ペン・図形・消しゴム、さわるには 選択 V / アンカー A / 形成 ⇧M のどれかに持ち替えてください`;
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
  /* ビュー上の向き (dx,dy) の移動を、コピー行列Vの逆写像でパッド座標の平行移動へ（向きだけ引き戻す＝平行移動は打ち消す）。
     矢印キー・複製のずらしなど「掴んだコピーから見た方向」で動かす操作の共通部品 */
  /* 矢印キーの連打を1段にまとめる（B4）。同じ対象への矢印が 400ms 以内に続き、間に他のコミットが無ければ
     直前のコミットに合流する（Store の履歴は積まない）＝1段 = 1回の ⌘Z */
  let nudgeCommit = null;
  function commitNudge(entries, key) {
    const now = Date.now();
    const amend = !!nudgeCommit && nudgeCommit.items === Store.items && nudgeCommit.key === key && now - nudgeCommit.t < 400;
    Store.replaceMany(entries, { amend });
    nudgeCommit = { items: Store.items, key, t: now };
  }
  function editDirMat(V, dx, dy) {
    const inv = Geom.invert(V);
    const o = Geom.apply(inv, 0, 0), p = Geom.apply(inv, dx, dy);
    return Geom.translate(p[0] - o[0], p[1] - o[1]);
  }
  // 枠が囲む item の添字。複製ドラッグ中は動いている複製（プレビューの末尾）を囲む
  function editBoxIdxs() {
    if (editXf && editXf.dup && editPreview && editPreview.length > Store.items.length)
      return editSelIdxs.map((_, k) => Store.items.length + k);
    return editSelIdxs;
  }
  function editBoxGeom() {
    if (!editSelIdxs.length) return null;
    const items = editPreview || Store.items;
    const b = unionBBox(editBoxIdxs().map(i => Render.itemBBox(items[i])).filter(Boolean));
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
  const EDIT_BOX_COPIES_MAX = 24;   // コピー数がこれ以下なら他のコピーにも薄い枠（C6 など）・超えたら掴んだコピーだけ
  function drawEditBox(thin) {   // thin=描画系ツール中の細い枠（ハンドルなし。V で選択ツールにすればそのまま変形できる）
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
    {   // 他のコピーにも薄く出す（どれを選んでいるか・動かすとどこが連動するかが見える）。掴んだコピーは下で濃く描く
      const mm = Render.buildMotif(items, PAD_W);
      if (mm.bbox) {
        const vs = editViews(mm.bbox), cur = Math.min(editSelVi, vs.length - 1);
        // コピーが多い群（壁紙・帯）では他のコピーの薄い枠を出さない（p6m で展開面の3割を覆った）。掴んだコピーの枠は下で描く
        if (vs.length <= EDIT_BOX_COPIES_MAX) vs.forEach((V, k) => { if (k !== cur) strokeBoxVia(g.b, V, "rgba(0,68,204,.22)"); });
      }
    }
    if (editSelIdxs.length > 1)   // 個々の形の枠（何が選ばれているかを示す）
      for (const i of editBoxIdxs()) {
        const bb = Render.itemBBox(items[i]);
        if (bb) strokeBoxVia(bb, g.V, "rgba(0,68,204,.3)");
      }
    strokeBoxVia(g.b, g.V, thin ? "rgba(0,68,204,.35)" : "rgba(0,68,204,.6)");
    if (thin) return;
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
  const editToolOf = t => ET_OF_TOOL[t] || null;   // 描画系ツールのときは null（描画は isEditDrawTool 側で扱う）
  // 展開面の上に直接描けるツール（段2）。パッドの描画系分岐と同じ状態機械を、触れた複製の逆写像で動かす
  const isEditDrawTool = t => t === "freehand" || t === "pen" || t === "erase" || BOX_TOOLS.includes(t);
  let hoverFaces = [];      // 形成ツールでホバー／なぞり中の面（画面のみ）
  let hoverEdges = [];      // 同・線（⌥のときだけ出る）
  let formDrag = null;      // {alt, seen:Set(face), edges:Set(seg)} なぞり中
  let editSelIdxs = [];     // 選択ツールで選んでいるitem index列（複数可・パッドの selIdxs と同じ役割）
  let editSelVi = 0;        // 掴んだコピー（editViews の添字）。行列でなく添字で覚える＝形が変わっても追従する
  let editXf = null;        // {mode, inv, from, center, a0, anchor, h0, h, v0, dup, shiftClick} 枠のドラッグ
  let editClickPend = null; // ⇧を押して形を押した（動かさずに離したら追加／除外）{hit, v0}
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
      : (et === "anchor" || isEditDrawTool(tool)) ? "crosshair" : "not-allowed";
    $("editHint").textContent = editHintText(false);
  }
  // 展開ビューのセグメントは tool そのものを切り替える（左のツール行と同じ状態を指す）
  for (const [t, id] of Object.entries(ET_BTN)) $(id).onclick = () => setTool(TOOL_OF_ET[t]);

  const formedIdxs = () => Store.items.map((it, i) => it.formed ? i : -1).filter(i => i >= 0);   // 形成で塗った実体
  $("shapeReset").onclick = () => {
    const fi = formedIdxs();
    const n = cutOrbits().length + mergeGroups().length + cutEdges().length + fi.length;
    if (!n) { alertHint("形成しているところはありません"); return; }
    if (fi.length) {   // 塗った実体も同じ1コミットで消す（1操作=1undo）
      setEditSel([]);
      Store.removeMany(fi, { cuts: [], merges: [], edges: [] });
    } else clearFormRec();
    updateCutCount();
    renderEdit(); scheduleSwatches(0);
    alertHint(`形成をリセットしました（${n}か所・⌘Zで戻せます）`);
  };
  function updateCutCount() {
    const p = [];
    const nMerged = mergeGroups().length + formedIdxs().length;   // 古い記録のつなぎ＋形成で塗った実体
    if (nMerged) p.push(`${nMerged}か所つないでいます`);
    if (cutOrbits().length) p.push(`${cutOrbits().length}か所けずっています`);
    if (cutEdges().length) p.push(`線を${cutEdges().length}本消しています`);
    $("cutCount").textContent = p.join(" / ");
  }

  Store.onChange(() => updateCutCount());   // ⌘Z・塗りの追加/削除でも件数表示を合わせる

  /* ---- 展開なしで表示（Tab / #wbMotifOnly）---- */
  function setMotifOnly(v, persist = true) {
    v = !!v;
    if (v === motifOnly) return "";
    let note = "";
    if (tool === "pen" && penPts.length) {   // 描きかけのコピー番号が変わるので先に確定
      if (penPts.length >= 2) { penCommit(false); note = "描きかけの線を確定しました"; } else { penReset(); note = "点が1つだけだったので描きかけを取り消しました"; }
    }
    motifOnly = v;
    editSel = null; editDrag = null; editPreview = null; editSnapHit = null; editXf = null; editMarquee = null;
    hoverFaces = []; hoverEdges = []; formDrag = null;
    if (v) editSelVi = 0;   // 見えているのは先頭の1コピーだけ
    if (persist) savePrefs();
    renderEdit();
    document.dispatchEvent(new Event("symmetry:change"));   // ボタンの表示・状態文を合わせる
    return note;
  }
  const toggleMotifOnly = () => {
    const note = setMotifOnly(!motifOnly);
    alertHint((note ? note + "。" : "") + (motifOnly ? "展開なしで表示しています（Tab で戻る）" : "展開して表示しています"));
  };
  Store.onChange(() => {   // 削除などで添字が範囲外になった選択を落とす
    const n = Store.items.length;
    if (editSelIdxs.some(i => i >= n)) setEditSel(editSelIdxs.filter(i => i < n));
  });

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
  function editMovePoint(base, sel, padPt) {
    const it = base[sel.idx];
    if (!it || it.kind !== "shape" || it.shape !== "path") return null;
    let next;
    if (sel.ring < 0) {
      next = { ...it, points: it.points.map((p, i) => i === sel.pt ? [padPt[0], padPt[1]] : p) };
    } else {
      next = { ...it, holes: it.holes.map((ring, ri) => ri !== sel.ring ? ring
        : ring.map((p, i) => i === sel.pt ? [padPt[0], padPt[1]] : p)) };
    }
    return base.map((x, k) => k === sel.idx ? next : x);
  }
  function editPatched(padPt) {
    return editMovePoint((editDrag && editDrag.base) || Store.items, editSel, padPt);
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
  /* ---- 形成の「つなぐ」を実体にする ----
     面（ビュー座標・FORM_SIZE）の和を、基準コピー mats[0] の逆行列でモチーフ座標へ引き戻す。
     引き戻した形を展開すると全コピーに同じ形が出る（どのコピーを触っても同じ結果＝対称が保たれる）。
     鏡映を含む行列で引き戻すと環の向きが反転するので、外周>0・穴<0 の巻き（polyBool と同じ規約）に直す。
     印 formed:true は JSON 往復で残し（store.js styleFields）、「もう一度触って戻す」と
     面の材料から外す（expansionInput）ために使う */
  function bakeFormedItems(list, fc) {
    const M0 = fc.mats && fc.mats[0];
    if (!M0 || !list.length) return [];
    const inv = Geom.invert(M0);
    const flip = Geom.det2(inv) < 0;
    const polys = list.length < 2 ? list
      : Geom.polyBool(list.map(f => [f.outer, ...(f.holes || [])]), [], "unite");
    const back = rg => { const r = rg.map(q => Geom.apply(inv, q[0], q[1])); return flip ? r.reverse() : r; };
    const out = [];
    for (const poly of polys) {
      if (!poly.outer || poly.outer.length < 3) continue;
      const holes = (poly.holes || []).filter(h => h && h.length >= 3).map(back);
      out.push({
        kind: "shape", shape: "path", points: back(poly.outer), closed: true,
        ...(holes.length ? { holes } : {}),
        fill: "ink", stroke: "ink", sw: mergeSW(), formed: true,
      });
    }
    return out;
  }
  /* いま触った場所（なぞった軌跡と触った面の代表点）が、形成で塗った item のどれかの
     どのコピーの内側にあるか。あれば その item の添字列を返す */
  function formedItemsAt(d, list, fc) {
    const probes = [...(d.trail || []).map(toForm), ...list.map(faceRep)];
    const idxs = [];
    Store.items.forEach((it, i) => {
      if (!it.formed || it.kind !== "shape") return;
      const rings = itemRings(it);
      for (const M of fc.mats) {
        const rg = rings.map(r => r.map(q => Geom.apply(M, q[0], q[1])));
        if (probes.some(p => Geom.inRings(rg, p[0], p[1]))) { idxs.push(i); return; }
      }
    });
    return idxs;
  }
  function formUp() {
    const d = formDrag;
    formDrag = null;
    hoverFaces = []; hoverEdges = [];
    if (!d || (!d.seen.size && !d.edges.size)) {
      if (d) alertHint("閉じた領域ではありません");   // 前の「1つの形にしました」を残さない
      scheduleEdit();
      return;
    }
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
      /* ①古い保存データの merges 記録: 従来どおり、触った面が属するグループを解除する（後方互換）。
         記録点を軌道に展開してから照合するので、兄弟コピーからでも戻せる */
      const hit = mergeGroups().findIndex(g =>
        g.some(c => orbitOfRec(c, fc).some(p => list.some(f => faceHas(f, p)))));
      const formedHit = hit >= 0 ? [] : formedItemsAt(d, list, fc);
      if (hit >= 0) {
        setFormRec({ merges: mergeGroups().filter((_, i) => i !== hit) });
        alertHint("元に戻しました");
      } else if (formedHit.length) {
        /* ②形成で塗った実体の上をもう一度触る＝その塗りを消す（元の線や図形は残る） */
        if (editSelIdxs.length) setEditSel([]);   // 削除で添字がずれるので選択は持ち越さない
        Store.removeMany(formedHit);
        alertHint("元に戻しました");
      } else {
        /* ③新しくつなぐ/塗る: 触った面の和を、モチーフ座標へ引き戻した閉じたパスとして item に足す。
           記録（merges）ではなく実体にするので、あとから線や図形を描き足して面が細分化されても
           塗りは変わらない（イラレのシェイプ形成と同じ）。1操作=1コミット=1undo */
        const baked = bakeFormedItems(list, fc);
        if (!baked.length) { scheduleEdit(); return; }
        Store.addMany(baked);
        alertHint(list.length < 2 ? "この領域を1つの形にしました（もう一度クリックで戻る）"
          : `${list.length}つの領域をつなぎました（もう一度なぞると戻る）`);
      }
    }
    savePrefs(); updateCutCount(); renderEdit(); scheduleSwatches(0);
  }

  /* ---- 選択ツール: 枠のハンドルを掴む／枠の中で移動／形をクリックで選ぶ（shift=追加）／空所ドラッグ=範囲選択 ---- */
  // ビュー座標 v の位置にある item を全コピー横断で探す。戻り: {idx, vi} or null
  /* 当たり判定の許容は**画面 px**で決める（EDIT_HIT_PX=6・タッチ TOUCH_HIT_PX=14）。タイルは線が画面で1px未満になるので、
     パッド座標の許容のままだと画面上で極小になる。まず狭い許容（EDIT_HIT_EXACT_PX）で「ちょうど押したコピー」を探し、
     無ければ広い許容＝重なったコピーのうち押した線の真上にある方を掴む。座標範囲では絞らない
     （展開面の点をコピーの逆写像でパッド座標へ戻すと、パッドの枠 0〜PAD_W の外になるのが普通＝枠で絞ると当たらない）。 */
  const EDIT_HIT_PX = 6;
  const editHitTol = (px, V, base = 0) => Math.max(base, 2 * px / Math.max(viewScale(V), 0.05));   // Render.itemAt の tol は線幅（半径は tol/2）
  // item の輪郭までの距離（パッド座標）。ビューが重なって複数当たったとき、押した線に一番近いコピーを選ぶのに使う
  function itemEdgeDist(idx, x, y) {
    let best = Infinity;
    for (const rg of ringsOf(Store.items)) {
      if (rg.idx !== idx) continue;
      const pts = rg.pts, n = pts.length, nseg = rg.closed ? n : n - 1;
      for (let i = 0; i < nseg; i++) {
        const A = pts[i], B = pts[(i + 1) % n];
        const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy;
        const t = L2 < 1e-9 ? 0 : Geom.clamp(((x - A[0]) * dx + (y - A[1]) * dy) / L2, 0, 1);
        best = Math.min(best, Math.hypot(A[0] + dx * t - x, A[1] + dy * t - y));
      }
    }
    return best;
  }
  function editItemAt(v, touch) {
    const m = Render.buildMotif(Store.items, PAD_W);
    if (!m.bbox) return null;
    const bb = m.bbox, views = editViews(bb);
    let best = null;
    for (let vi = 0; vi < views.length; vi++) {
      const V = views[vi], tol = editHitTol(touch ? TOUCH_HIT_PX : EDIT_HIT_PX, V);
      const [x, y] = Geom.apply(Geom.invert(V), v[0], v[1]);
      const mg = tol + 20;   // 形の外接枠（線幅ぶん広げた）の外は調べない
      if (x < bb.x0 - mg || x > bb.x1 + mg || y < bb.y0 - mg || y > bb.y1 + mg) continue;
      const hit = Render.itemAt(pctx, Store.items, x, y, PAD_W, tol);
      if (hit < 0 || Store.items[hit].kind === "image") continue;
      const d = itemEdgeDist(hit, x, y) * viewScale(V);   // 画面での距離
      if (!best || d < best.d - 1e-6) best = { idx: hit, vi, d };
    }
    return best && { idx: best.idx, vi: best.vi };
  }
  function setEditSel(idxs, vi) {
    editSelIdxs = [...new Set(idxs)].sort((a, b) => a - b);
    if (vi !== undefined) editSelVi = vi;
    updateEditSelInfo();
    syncSelUI();   // 左の「選択」パネル・「見た目」も同じ選択を見る
  }
  /* 選択ツールの pointerdown。⇧を押していても枠のハンドル・枠の中は掴める（⇧ドラッグ＝拘束つきの移動・拡大縮小・回転）。
     ⇧クリックの追加／除外は「動かさずに離したとき」だけ（editClickPend / editXf.shiftClick・pointerup で判定） */
  function selectDown(v, e) {
    const g = editBoxGeom();
    const hd = g && editHandleAt(v, e.pointerType === "touch");
    if (hd) {
      const V = g.V, inv = Geom.invert(V), b = hd.b;
      const from = Geom.apply(inv, v[0], v[1]);   // 逆写像でパッド座標へ＝以降の計算はすべてパッド座標
      const base = { inv, v0: v, dup: e.altKey };   // ⌥ドラッグ＝複製（移動・拡大縮小・回転のどれでも。原本は残し、変形した複製を足す＝イラレと同じ）
      if (hd.mode === "scale")
        editXf = { ...base, mode: "scale", h: hd.h, anchor: hPos(b, { u: 1 - hd.h.u, v: 1 - hd.h.v }), h0: hPos(b, hd.h) };
      else if (hd.mode === "rotate") {
        const c = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
        editXf = { ...base, mode: "rotate", center: c, a0: Math.atan2(from[1] - c[1], from[0] - c[0]) };
      } else editXf = { ...base, mode: "move", from, shiftClick: e.shiftKey ? editItemAt(v) : null };
      return;
    }
    const hit = editItemAt(v, e.pointerType === "touch");
    if (hit) {
      if (e.shiftKey) {   // 追加／除外は動かさずに離したとき（editUp）。掴んで動かすことはしない
        editClickPend = { hit, v0: v };
        return;
      }
      /* 押した瞬間に選んで、同じドラッグのまま移動へ入る（イラレと同じ・1回のドラッグで動く）。
         選択済みの形でも、枠の外にある別のコピーの線を掴んだときはそのコピーを掴んだことにする */
      if (!editSelIdxs.includes(hit.idx)) setEditSel([hit.idx], hit.vi);
      else if (hit.vi !== editSelVi) setEditSel(editSelIdxs, hit.vi);
      const V = editSelView(Store.items);
      if (V) editXf = { mode: "move", inv: Geom.invert(V), from: Geom.apply(Geom.invert(V), v[0], v[1]), v0: v, dup: e.altKey };
      renderEdit();
      return;
    }
    editMarquee = { x0: v[0], y0: v[1], x1: v[0], y1: v[1], add: e.shiftKey };   // 空所＝範囲選択の開始
    renderEdit();
  }
  // ⇧クリック: 選択に加える／外す（hit={idx,vi}）
  function editToggleSel(hit) {
    setEditSel(editSelIdxs.includes(hit.idx) ? editSelIdxs.filter(i => i !== hit.idx) : [...editSelIdxs, hit.idx], hit.vi);
    renderEdit();
  }
  /* 範囲選択の確定: ビュー座標の矩形に、いずれかのコピーの item bbox が全部入れば選ぶ。
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
        if (Math.min(...xs) >= R.x0 && Math.max(...xs) <= R.x1
         && Math.min(...ys) >= R.y0 && Math.max(...ys) <= R.y1) {   // 枠に全体が入ったコピーだけ（イラレの既定に近い）
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

  /* ---- 展開面に直接描く（段2）----
     パッド（pad）の描画系の状態機械（raw / shapeDrag / penPts / erase）をそのまま使い、座標だけを
     「触れた複製の逆写像」でパッド座標へ引き戻して流す。どの複製の上で描いても、モチーフ側には
     その複製から見た形が入り、全複製へ展開される（鏡の中の手と同じ原則）。 */
  // 触れたビュー座標 v から、操作の間固定する {k, inv, bbox} を決める
  function editDrawLockAt(v) {
    if (tool === "pen" && penPts.length && penLock) {   // ペンの続き: 前の点と同じ複製・同じ配置で打つ
      const vs = editViews(penLock.bbox);
      if (vs[penLock.k]) return { k: penLock.k, inv: Geom.invert(vs[penLock.k]), V: vs[penLock.k], bbox: penLock.bbox };
    }
    const bbox = Render.buildMotif(Store.items, PAD_W).bbox || DEFAULT_BBOX;
    const views = editViews(bbox);
    if (!views.length) return null;
    const M = PAD_W / 2, LIM = 20;
    let best = -1, bd = Infinity, inside = false, onHit = false, plain = false, invs = [];
    views.forEach((V, k) => {
      const inv = Geom.invert(V);
      invs.push(inv);
      const q = Geom.apply(inv, v[0], v[1]);
      const d = Math.hypot(q[0] - M, q[1] - M);
      const ins = q[0] >= -LIM && q[0] <= PAD_W + LIM && q[1] >= -LIM && q[1] <= PAD_W + LIM;
      // 消しゴムは「実際に形に触れている複製」を最優先（どの複製を触ったかで消す形が決まる）
      const hit = tool === "erase" && Render.itemAt(pctx, Store.items, q[0], q[1], PAD_W, editHitTol(EDIT_HIT_PX, V, 10)) >= 0;
      /* 図形（矩形・円・多角形・直線）は、回転も鏡映もしないコピー（平行移動＋拡縮だけ）の上に描ければ、
         矩形は矩形・円は円のまま（native）で持てる。回転したコピーの上だと path 化が要る。
         どのコピーの上で描いても展開の結果は同じなので、パッドの近くに収まるならそちらを選ぶ（遠すぎる所へは出さない） */
      const pl = BOX_TOOLS.includes(tool) && isAxisAligned(V)
        && q[0] >= -PAD_W / 2 && q[0] <= PAD_W * 1.5 && q[1] >= -PAD_W / 2 && q[1] <= PAD_W * 1.5;
      // 次に、パッド範囲に入る複製を優先し、その中でパッド中心に近いもの。どれも入らなければ全体で最も近いもの
      if (hit !== onHit ? hit : pl !== plain ? pl : ins !== inside ? ins : d < bd) { best = k; bd = d; inside = ins; onHit = hit; plain = pl; }
    });
    return { k: best, inv: invs[best], V: views[best], bbox };
  }
  // ビュー座標の点 → 吸着（パッド座標で）→ ビュー座標。図形の枠はビュー座標で持つので、吸着だけパッド側のエンジンを通す
  const editShapePt = (v, lock, touch) => {
    const sp = editSnapPad(v, lock, touch);
    return Geom.apply(lock.V, sp[0], sp[1]);
  };
  // イベント位置（ビュー座標）をロックの逆写像でパッド座標へ（第3要素は時刻）
  const editDrawPt = (ev, lock) => {
    const q = editPos(ev), r = Geom.apply(lock.inv, q[0], q[1]);
    return [r[0], r[1], ev.timeStamp];
  };
  function editDrawDown(e, v) {
    if (padLocked) { alertHint("造形はロック中です（「描画 > 造形 > ロック」で解除）"); editPointer = null; return; }
    const lock = editDrawLockAt(v);
    if (!lock) { editPointer = null; return; }
    drawLock = lock;
    if (tool === "pen") penLock = lock;
    const p = editDrawPt(e, lock);
    downPt = p; downView = v;
    const touch = e.pointerType === "touch";
    if (tool === "freehand") { raw = [p]; lastPt = p; }
    else if (BOX_TOOLS.includes(tool)) {
      const sp = editShapePt(v, lock, touch);   // ビュー座標（画面でドラッグした枠のまま持つ・全コピー横断で吸着）
      shapeDrag = { x0: sp[0], y0: sp[1], x1: sp[0], y1: sp[1], ox: sp[0], oy: sp[1], view: true };
    }
    // pen/erase は pointerup（タップ）で確定
    scheduleEdit();
  }
  function editDrawMove(e) {
    if (!drawLock) return;
    if (tool === "freehand") {
      if (!raw) return;
      const co = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      for (const ev of (co.length ? co : [e])) { const q = editDrawPt(ev, drawLock); raw.push(q); lastPt = q; }
    } else if (BOX_TOOLS.includes(tool)) {
      if (!shapeDrag) return;
      const sp = editShapePt(editPos(e), drawLock, e.pointerType === "touch");
      shapeSetEnd(sp, e.shiftKey, e.altKey);
    } else if (tool === "pen") {
      hoverPt = editSnapPad(editPos(e), drawLock, e.pointerType === "touch");
    } else return;
    scheduleEdit();   // 増分描画はせず、毎フレーム展開全体を描き直す（半透明でも継ぎ目が濃くならない）
  }
  function editDrawUp(e) {
    const lock = drawLock;
    const p = e ? editDrawPt(e, lock) : downPt;
    drawLock = null;   // 確定（Store.add → 再描画）の前に外す＝凍結していた配置を解いて通常の配置に戻す
    if (tool === "freehand") {
      const r = raw;
      raw = null; lastPt = null;
      if (r) {
        if (r.length === 1) r.push([r[0][0] + 0.1, r[0][1], r[0][2] + 8]);   // タップ=点
        Store.add({ kind: "stroke", raw: r, sw: defSty.sw, alpha: defSty.alpha });
        setEditSel([Store.items.length - 1], lock.k);   // 描いた直後の形を選択状態にする（イラレと同じ）
      }
    } else if (BOX_TOOLS.includes(tool)) {
      if (shapeDrag) {
        const item = shapeLive(lock);
        shapeDrag = null;
        if (item && Render.itemHasGeometry(item)) { Store.add(item); setEditSel([Store.items.length - 1], lock.k); oneShotDone(); }
      }
    } else if (tool === "pen" || tool === "erase") {
      if (downPt && p && Math.hypot(p[0] - downPt[0], p[1] - downPt[1]) <= TAP_TOL) {
        if (tool === "pen") { hoverPt = null; penTap(editSnapPad(e ? editPos(e) : downView, lock, !!e && e.pointerType === "touch")); }
        else {
          const i = Render.itemAt(pctx, Store.items, p[0], p[1], PAD_W, editHitTol(e && e.pointerType === "touch" ? TOUCH_HIT_PX : EDIT_HIT_PX, lock ? lock.V : [1, 0, 0, 1, 0, 0], 10));
          if (i >= 0) { if (editSelIdxs.length) setEditSel([]); Store.removeAt(i); oneShotDone(); }   // 添字がずれるので選択は持ち越さない
        }
      } else if (tool === "pen" && downPt) {
        hoverPt = null;
        penPlace(editSnapPad(downView, lock, !!e && e.pointerType === "touch"), true);   // ドラッグ＝スムース点（アンカーはダウン位置に固定）
      }
    }
    hoverPt = null; downPt = null; downView = null; editSnapHit = null;
    renderEdit();
  }

  let editPointer = null;   // 進行中の操作を開始した pointerId（別の指の move/up は無視する）
  editCv.addEventListener("pointerdown", e => {
    if (viewMode !== "edit") return;
    if (editPointer !== null) return;   // 既に操作中なら2本目/手のひらは無視
    editPointer = e.pointerId;
    e.preventDefault();
    try { editCv.setPointerCapture(e.pointerId); } catch (_) { /* 合成イベント等 */ }
    const v = editPos(e);
    if (editToolOf(tool) === "shape") {
      formDrag = { alt: e.altKey || formErase, seen: new Set(), edges: new Set(), trail: [v] };
      formAdd(formTargetAt(v, e.altKey || formErase, e.pointerType === "touch"));
      scheduleEdit();
      return;
    }
    if (editToolOf(tool) === "select") { selectDown(v, e); return; }
    if (isEditDrawTool(tool)) { editDrawDown(e, v); return; }   // 描画系ツールは展開面の上に直接描く（段2）
    if (editToolOf(tool) !== "anchor") {
      alertHint("このツールは展開の上では使えません。描くには 手描き・ペン・図形・消しゴム、さわるには 選択 V / アンカー A / 形成 ⇧M");
      editPointer = null;
      return;
    }
    if (anchorView === "off") return;   // 隠しているときは掴めない（表示と当たり判定を一致させる）
    const m = Render.buildMotif(Store.items, PAD_W);
    if (!m.bbox) return;
    const views = editViews(m.bbox);
    const pts = editablePoints(Store.items);
    const tol = e.pointerType === "touch" ? 18 : 11;
    let best = null, bd = tol;
    for (const V of anchorShownViews(views, pts, m.bbox, editSize)) for (const p of pts) {   // 最近傍アンカー（表示中のコピーだけ）
      const [x, y] = Geom.apply(V, p.x, p.y);
      const d = Math.hypot(x - v[0], y - v[1]);
      if (d < bd) { bd = d; best = { p, V }; }
    }
    if (!best) {
      /* 点が近くに無いときは、押した線の最寄りの点を選ぶ（B7・線の途中をクリックしてもその線の点が出る）。形ごと動かしたいときは選択ツール（V）へ */
      const hit = editItemAt(v);
      editSel = null;
      if (hit) {
        const Vh = views[hit.vi];
        let nb = null, nd = Infinity;
        for (const p of pts) {
          if (p.idx !== hit.idx) continue;
          const [x, y] = Geom.apply(Vh, p.x, p.y);
          const d = Math.hypot(x - v[0], y - v[1]);
          if (d < nd) { nd = d; nb = p; }
        }
        if (nb) editSel = { idx: nb.idx, ring: nb.ring, pt: nb.pt, V: Vh };
      }
      renderEdit();
      return;
    }
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
    if (editClickPend) {   // ⇧クリック待ち: 動かしたらクリックではない（選択は変えず、掴んで動かすこともしない）
      const v = editPos(e);
      if (Math.hypot(v[0] - editClickPend.v0[0], v[1] - editClickPend.v0[1]) >= 4) editClickPend = null;
      return;
    }
    if (!editXf || !editSelIdxs.length) return;
    const v = editPos(e);
    if (editXf.shiftClick && !editXf.moved) {   // ⇧で選択済みの形の上を押した: 4px 動くまでは「クリックかもしれない」
      if (Math.hypot(v[0] - editXf.v0[0], v[1] - editXf.v0[1]) < 4) return;
      editXf.moved = true;
    }
    const p = Geom.apply(editXf.inv, v[0], v[1]);
    let m;
    if (editXf.mode === "move") {
      let dvx = v[0] - editXf.v0[0], dvy = v[1] - editXf.v0[1];
      if (e.shiftKey) [dvx, dvy] = constrain45(dvx, dvy);   // ⇧=画面上で水平・垂直・斜め45°に拘束（掴んだコピーの見た目どおり）
      const q = Geom.apply(editXf.inv, editXf.v0[0] + dvx, editXf.v0[1] + dvy);
      m = Geom.translate(q[0] - editXf.from[0], q[1] - editXf.from[1]);
    }
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
    editPreview = editXf.dup   // 複製ドラッグ: 原本は動かさず、動かした複製を末尾へ足して見せる
      ? [...Store.items, ...editSelIdxs.map(i => transformItem(Store.items[i], m))]
      : Store.items.map((it, i) => editSelIdxs.includes(i) ? transformItem(it, m) : it);
    scheduleEdit();
    Render.pad(pctx, PAD_W, Render.buildMotif(editPreview, PAD_W), padScale, guide, axis);   // パッドも追従
  }

  editCv.addEventListener("pointermove", e => {
    if (viewMode !== "edit") return;
    if ((formDrag || editMarquee || editXf || editDrag || drawLock) && e.pointerId !== editPointer) return;   // 開始した指だけが進める
    if (drawLock) { editDrawMove(e); return; }
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
      const t = formTargetAt(v, e.altKey || formErase, touch);
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
          ...crossSnap(v, rings, near, tol), ...latticeSnap(v, tol) });   // 複製どうしが交わる点＝展開ビューで一番欲しい足場（壁紙・帯はセル格子も）
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
  // 指を離す以外の中断（pointercancel / lostpointercapture）: 確定せず途中状態を捨てて作品は変えない
  function editAbort() {
    formDrag = null; hoverFaces = []; hoverEdges = [];
    editMarquee = null; editXf = null; editClickPend = null; editDrag = null; editPreview = null; editSnapHit = null;
    drawLock = null; raw = null; lastPt = null; shapeDrag = null; hoverPt = null; downPt = null;   // 描きかけは確定せず捨てる（ペンの置いた点は残す）
    motif = Render.buildMotif(Store.items, PAD_W);
    renderPad();   // パッドの追従プレビューも元へ戻す
    renderEdit();
  }
  const editUp = e => {
    if (e && e.pointerId !== editPointer) return;   // 操作を開始した指の up/cancel のみ処理
    editPointer = null;
    if (viewMode !== "edit") return;
    if (e && (e.type === "pointercancel" || e.type === "lostpointercapture")) { editAbort(); return; }
    if (drawLock) { editDrawUp(e); return; }
    if (editToolOf(tool) === "shape") { formUp(); return; }
    if (editMarquee) {
      const r = editMarquee;
      editMarquee = null;
      if (Math.hypot(r.x1 - r.x0, r.y1 - r.y0) < 4) { if (!r.add) setEditSel([]); }   // ほぼ動いていない＝空所クリック
      else editMarqueeCommit(r);
      renderEdit();
      return;
    }
    if (editClickPend) {   // ⇧クリック（動かさずに離した）＝追加／除外
      const c = editClickPend;
      editClickPend = null;
      editToggleSel(c.hit);
      return;
    }
    if (editXf) {   // 移動・拡大縮小・回転を確定（1コミット=1undo）
      const prev = editPreview;
      const dup = editXf.dup;
      const click = editXf.shiftClick && !editXf.moved ? editXf.shiftClick : null;
      editXf = null; editPreview = null;
      if (click) { editToggleSel(click); return; }
      if (prev && dup) {   // 複製を確定: 複製側を選択（1コミット=1undo・旧パッドの dupDrag と同じ結果）
        const base = Store.items.length, copies = prev.slice(base);
        Store.addMany(copies);
        setEditSel(copies.map((_, k) => base + k));
        renderEdit();
      } else if (prev) Store.replaceMany(editSelIdxs.map(i => [i, prev[i]]));
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
  editCv.addEventListener("lostpointercapture", editUp);

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
      hoverCache = { items: Store.items, size: editSize, val: m.bbox ? anchorShownViews(editViews(m.bbox), editablePoints(Store.items), m.bbox, editSize) : [] };
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
    let best = null, bd = 8;   // 1) アンカー上 → 角⇄スムース（表示中のコピーだけ）
    for (const V of anchorShownViews(views, pts, m.bbox, editSize)) for (const p of pts) {
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
    // 作業面（workbench.js）は #cheat の id を外して操作ガイドの中へ移すので null になる。その時は何もしない（Esc の他の処理を止めない）
    const cheatEl = $("cheat");
    if (e.key === "Escape" && cheatEl && !cheatEl.hidden) { e.preventDefault(); cheatEl.hidden = true; return; }
    if (viewMode === "edit" && e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing && !isTextInput(e.target)) {
      // Tab=展開なしで表示 ⇄ 展開（画面上の #wbMotifOnly と同じ操作）。作業面ではフォーカス移動に使わない
      e.preventDefault();
      if (!e.repeat) toggleMotifOnly();
      return;
    }
    /* ペンの途中（点を置いてある間）は ⌘Z・Backspace＝最後の点を1つ戻す（B5）。前に描いた別の図形は消えない */
    if (tool === "pen" && penPts.length && !isTextInput(e.target) && !e.altKey
        && ((e.key === "Backspace" && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z"))) {
      e.preventDefault();
      penUndoPoint();
      return;
    }
    // ⌘S＝SVG で保存（書き出しボタンと同じ経路）。ブラウザのページ保存は使わないので、文字入力欄でも奪う（B8）
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (!e.repeat) $("saveSvg").click();
      return;
    }
    if (viewMode === "edit" && e.key === "Escape") {   // 展開ビュー: 選択（アンカー・形）の解除
      if (tool === "pen" && penPts.length) penReset();   // ペンの途中は取消（この早期 return の前に処理しないと届かない）
      editSel = null; editDrag = null; editPreview = null;
      editXf = null; editMarquee = null;
      setEditSel([]);
      renderEdit();
      return;
    }
    /* 展開側で選んでいる形への 削除・矢印。選択ツールのときだけでなく、描いた直後の描画系ツール（手描き・図形・ペン先頭・消しゴム）でも効く。
       ペンの途中（penPts あり）と描いている最中（drawLock）は描く側が優先。文字入力欄・数値欄では奪わない */
    const editSelKeys = viewMode === "edit" && editSelIdxs.length && !isTextInput(e.target)
      && !drawLock && (editToolOf(tool) === "select" || (isEditDrawTool(tool) && !(tool === "pen" && penPts.length)));
    // 点（アンカー）を選んでいるとき: 矢印で動かす（1／⇧10・掴んだコピーの見た目の向き・連打は1段）（B7）
    if (viewMode === "edit" && editSel && !editSelKeys && e.key.startsWith("Arrow") && !isTextInput(e.target)
        && e.target.tagName !== "INPUT" && !editDrag && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const st = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
      const base = editBaseFor(editSel);
      const it = base && base[editSel.idx];
      if (!it || it.kind !== "shape" || it.shape !== "path") return;
      const cur = editSel.ring < 0 ? it.points[editSel.pt] : (it.holes[editSel.ring] || [])[editSel.pt];
      if (!cur) return;
      const dm = editDirMat(editSel.V || [1, 0, 0, 1, 0, 0], d[0], d[1]);
      const np = Geom.apply(dm, cur[0], cur[1]);
      const patched = editMovePoint(base, editSel, np);
      if (patched) commitNudge([[editSel.idx, patched[editSel.idx]]], "a" + editSel.idx + "," + editSel.ring + "," + editSel.pt);
      return;
    }
    // 選んだ形の削除（アンカー削除は下の editSel 側が受ける）
    if (editSelKeys && !e.metaKey && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      const n = deleteSel();
      if (n) alertHint(`${n}個の形を削除しました（⌘Zで戻る）`);
      return;
    }
    // 矢印キーで移動（パッドと同じ刻み。掴んだコピーの向きに合わせて動かす＝鏡の中の手）
    if (editSelKeys && e.key.startsWith("Arrow") && e.target.tagName !== "INPUT") {   // スライダー操作中の矢印は奪わない
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key];
      const V = editSelView(Store.items);
      if (!V) return;
      const m = editDirMat(V, d[0], d[1]);
      commitNudge(editSelIdxs.map(i => [i, transformItem(Store.items[i], m)]), "s" + editSelIdxs.join(",") + "@" + editSelVi);
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
      /* テキストを打つ欄（メモ・数値入力）では ⌘C/⌘X/⌘V/⌘A/⌘Z を素通しする（006_ツールの規格 §7 ルール3）。
         スライダーやボタンの上では従来どおり効かせる（イラレと同じ感覚） */
      if (isTextInput(e.target)) return;
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
      if (k === "d") { e.preventDefault(); dupSel(); return; }   // 複製（Figma準拠。左右どちらの選択にも効く）
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
      //   ⌘[ / ⌘] = 1段階 背面へ/前面へ、⇧⌘[ / ⇧⌘] = 最背面へ/最前面へ（006_ツールの規格 §7）
      if (isBracketL(e)) { e.preventDefault(); reorderSel(e.shiftKey ? "back" : "backward"); return; }
      if (isBracketR(e)) { e.preventDefault(); reorderSel(e.shiftKey ? "front" : "forward"); return; }
      return;
    }
    // 単キーのツール/操作ショートカット（Illustrator流。入力欄・alt併用・日本語入力(IME)中は無効）
    if (!e.altKey && !e.isComposing && e.target.tagName !== "INPUT") {
      const k = e.key.toLowerCase();
      // シェイプ形成 ⇧M（イラレと同じ割り当て）。いま見ている側の形成ツールに入る
      if (k === "m" && e.shiftKey) {
        e.preventDefault();
        if (tool === "form") setTool(toolPrev);
        else { const back = motifOnly; setTool("form"); alertHint((back ? "展開に戻しました。" : "") + "領域をクリックで1つの形に／⌥でけずる"); }
        return;
      }
      /* 展開ビューの V/A も下の setTool("move"/"anchor") で足りる（ツールは1組・editToolOf が select/anchor に読み替える）。
         以前ここにあった setEditTool は存在しない関数で、展開面で V・A を押すと例外になっていた */
      if (k === "v") { setTool("move"); return; }        // 選択
      if (k === "n") { setTool("freehand"); return; }    // 手描き（イラレの鉛筆N）
      if (k === "p") { setTool("pen"); return; }         // ペン
      if (k === "m") { setTool("rect"); return; }        // 矩形
      if (k === "l") { setTool("ellipse"); return; }     // 円
      if (k === "e") { setTool("erase"); return; }       // 消しゴム
      if (e.key === "\\" || e.key === "¥") { setTool("line"); return; }   // 直線（イラレと同じ \。JIS配列の ¥ キーも）
      if (k === "a") { setTool("anchor"); return; }      // アンカー選択ツール（イラレのダイレクト選択A）
      if ((k === "," || k === ".") && !isTextInput(e.target)) { stepGroup(k === "." ? 1 : -1); return; }   // 前後の群へ（一覧の並び順）
      if (k === "r") { editXform("rot", e.shiftKey ? -15 : 15); return; }        // 回転±15°（選択が無ければ何もしない）
      if (k === "s") { editXform("scale", e.shiftKey ? 1 / 1.1 : 1.1); return; } // 拡大/縮小
      if (k === "x" && e.shiftKey) { swapFillStroke(); return; }   // 塗り／線の反転（イラレのX相当）
      if (isBracketL(e)) { reorderSel(e.shiftKey ? "back" : "backward"); return; }   // [ =1段階背面へ / ⇧[ =最背面へ（⌘版のエイリアス）
      if (isBracketR(e)) { reorderSel(e.shiftKey ? "front" : "forward"); return; }   // ] =1段階前面へ / ⇧] =最前面へ
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
        tidy: +$("tidyRange").value, cell: +$("cellRange").value, scale: +symScale().toFixed(4), lattice: latticeOn, rows: Groups.getParams().rows,
        ink: $("inkColor").value, paper: $("paperColor").value,
        snap: snapOn, axis,
        sel: selected().map(s => specName(s.spec)),
        subs: Object.fromEntries(SUB_IDS.map(id => [id, $(id).open])),   // 選択パネルの開閉
        ofDir, anchorView, overlap: Render.getOverlap(), padLocked,
        snapKinds, recent: recentNames, motifOnly,
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
  if (Array.isArray(prefs.recent))   // 壊れた値は捨てる（文字列だけ・重複なし・最大 RECENT_MAX）
    recentNames = [...new Set(prefs.recent.filter(n => typeof n === "string" && n))].slice(0, RECENT_MAX);
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
  motifOnly = prefs.motifOnly === true;
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
  const cell = typeof prefs.cell === "number" ? Geom.clamp(prefs.cell, GAP_MIN, GAP_MAX) : 72;
  const scale = typeof prefs.scale === "number" ? Geom.clamp(prefs.scale, SCALE_MIN, SCALE_MAX) : 0.65;
  setSymRanges(cell, scale);   // スライダーを直接書き換えたので数値欄も合わせる（006 §5）
  Groups.setParams({ cell, scale });
  latticeOn = prefs.lattice !== false;
  Groups.setParams({ rows: prefs.rows !== false });   // 帯の「段を重ねる」（既定オン）
  applyColors(prefs.ink || "#0044cc", prefs.paper || "#ffffff", { persist: false });
  setSnap(!!prefs.snap);
  if (Array.isArray(prefs.axis) && prefs.axis.length === 2 && prefs.axis.every(Number.isFinite)) {
    axis = [prefs.axis[0], prefs.axis[1]];
    Groups.setParams({ center: axis });
  }
  const firstRun = !Store.hasSaved();
  Store.restore();
  if (debug && !Store.items.length) injectF();
  /* INIT-01（006_ツールの規格 §0）: 保存データが無い初回だけ、強みが出る短い線を1本描いた状態で始める。
     中心から少し外れた位置の青い曲線が、選んだ群（既定 C6）の回転で6回展開されて模様になる。
     全消去で空にでき、⌘Zで戻せる。全消去後は空の保存が残るので、次回以降は復元が優先され再び置かれない */
  if (firstRun && !debug && !Store.items.length)
    Store.fromJSON({ v: 2, items: [{ kind: "shape", shape: "path", closed: false, curve: true, corners: [],
      points: [[176, 40], [218, 82], [214, 138], [184, 186]], sw: 4 }] }, { asEdit: false });
  motif = Render.buildMotif(Store.items, PAD_W);   // setGuide/setViewModeが参照するので先に用意
  setGuide(["grid", "circle"].includes(prefs.guide) ? prefs.guide : "off");
  setViewMode(["live", "edit"].includes(prefs.view) ? prefs.view : "grid");
  Store.setMeta(specName(editSpecNow()), false);   // 版に同梱する群名の初期値（履歴には積まない）
  updateUndoState();
  refresh();

  // 2026-09-14: 画面構成と既存編集エンジンをつなぐ小さな窓口。
  /* 群の変更は版（Store のスナップショット）に同梱して ⌘Z で戻せる（B6）。
     record=false は ⌘Z/⇧⌘Z で戻した結果・案の読み込み＝履歴に積まず今の版へ名前だけ合わせる */
  function chooseWorkbenchSpec(spec, opt) {
    flushNudge(); setSel([]); setEditSel([]); exitPadEdit();
    editSel = null; editPreview = null; editDrag = null;
    const name = specName(spec);
    const record = !opt || opt.record !== false;
    recentNames = [name, ...recentNames.filter(n => n !== name)].slice(0, RECENT_MAX);   // 選んだ群を履歴の先頭へ
    for (const s of swatches) {
      const on = specName(s.spec) === name;
      s.wrap.classList.toggle("sel", on);
      s.wrap.setAttribute("aria-selected", String(on));
      s.wrap.tabIndex = on ? 0 : -1;
    }
    savePrefs(); buildLivePanel(); refresh();
    document.dispatchEvent(new Event("symmetry:change"));
    applyingGroup = true;
    try { Store.setMeta(name, record); } finally { applyingGroup = false; }   // 選び終えてから版に載せる（同期リスナーが戻さないように）
  }
  let applyingGroup = false;
  // ⌘Z/⇧⌘Z で版の群名が変わったら、画面の群もそれに合わせる（履歴には積まない）
  Store.onChange(() => {
    const m = Store.meta;
    if (!m || applyingGroup) return;
    if (specName(editSpecNow()) === m) return;
    const sw = swatches.find(x => specName(x.spec) === m);
    if (!sw) return;   // 消した独自の群などは戻せない（群はそのまま）
    applyingGroup = true;
    try { chooseWorkbenchSpec(sw.spec, { record: false }); } finally { applyingGroup = false; }
  });
  // , . で前後の群へ（swatches＝一覧の並び順・端は反対側へ回る）
  function stepGroup(dir) {
    if (!swatches.length) return;
    const cur = specName(editSpecNow());
    const i = swatches.findIndex(x => specName(x.spec) === cur);
    const next = swatches[((i < 0 ? 0 : i + dir) + swatches.length) % swatches.length];
    chooseWorkbenchSpec(next.spec);
    alertHint(`群: ${specName(next.spec)}（, . で前後の群・⌘Zで戻せます）`);
  }
  function workbenchSnapshot() {
    return JSON.parse(JSON.stringify({version:1, doc:Store.toJSON(), spec:editSpecNow(),
      params:Groups.getParams(), axis, tidy:+$("tidyRange").value,
      colors:Render.colors(), overlap:Render.getOverlap(), memo:$("memo").value,
      caption:$("cap").checked, pngScale, pngBg}));
  }
  function applyWorkbenchSnapshot(s) {
    // 自分が保存した案だけを受ける。構造を検査してから現在の作品へ適用する。
    if (!s || s.version !== 1 || !s.doc || !Array.isArray(s.doc.items) || !s.spec ||
        !s.params || !Number.isFinite(s.params.cell) || !Number.isFinite(s.params.scale) ||
        s.params.cell < 48 || s.params.cell > 300 || s.params.scale < .1 || s.params.scale > 2 ||
        !Number.isFinite(s.tidy) || s.tidy < 0 || s.tidy > 16 ||
        !s.colors || !/^#[0-9a-f]{6}$/i.test(s.colors.ink) || !/^#[0-9a-f]{6}$/i.test(s.colors.paper))
      throw new Error("保存した案の形式が読み取れません");
    const point = p => Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite);
    const ring = a => Array.isArray(a) && a.length >= 2 && a.every(point);
    if (![1,2].includes(s.doc.v) || !s.doc.items.every(it => {
      if (!it || !["stroke","shape","image"].includes(it.kind)) return false;
      if (["sw","alpha","r"].some(k=>it[k]!==undefined&&!Number.isFinite(it[k]))) return false;
      if (it.kind === "stroke") return ring(it.raw);
      if (it.kind === "image") return typeof it.dataURL === "string" && it.dataURL.startsWith("data:image/") && Number.isFinite(it.w) && Number.isFinite(it.h);
      if (it.shape === "path") return ring(it.points) && (!it.holes || (Array.isArray(it.holes) && it.holes.every(ring)));
      return ["line","rect","ellipse","polygon"].includes(it.shape) && [it.x0,it.y0,it.x1,it.y1].every(Number.isFinite);
    }) || (s.axis !== null && !point(s.axis)) ||
      (s.doc.form && !["cuts","merges","edges"].every(k=>Array.isArray(s.doc.form[k])&&s.doc.form[k].every(a=>Array.isArray(a)&&a.every(point)))) ||
      (s.spec.kind === "custom" && (!s.spec.def || !Array.isArray(s.spec.def.gens) || !s.spec.def.gens.every(validGen))))
      throw new Error("保存した案に不正な座標やルールがあります");
    if (!swatches.some(w => specName(w.spec) === specName(s.spec))) {
      if (s.spec.kind !== "custom" || !s.spec.def || !Array.isArray(s.spec.def.gens))
        throw new Error("この対称ルールは見つかりません");
      customs.push(s.spec.def); addCustomSwatch(s.spec.def); saveCustoms();
    }
    flushNudge(); setSel([]); setEditSel([]); exitPadEdit();
    editSel = null; editPreview = null;
    setSymRanges(s.params.cell, s.params.scale);
    Groups.setParams(s.params);
    setAxis(s.axis); setTidy(s.tidy); applyColors(s.colors.ink, s.colors.paper);
    setOverlapMode(s.overlap, false);
    $("memo").value = s.memo || ""; $("cap").checked = !!s.caption;
    setPngScale(s.pngScale === 4 ? 4 : 2); setPngBg(s.pngBg === "clear" ? "clear" : "white");
    Store.fromJSON(s.doc); chooseWorkbenchSpec(s.spec, { record: false }); savePrefs(); refresh();
  }
  window.SymmetryWorkbench = {
    firstRun,   // 保存データが無い初回起動か（狭い画面の初期表示を展開にする判定に使う）
    toggleMotifOnly,
    state: () => ({view:viewMode, tool, motifOnly, formErase, spec:editSpecNow(), name:specName(editSpecNow()),
      selected:targetIdxs().length, anchor:!!currentAnchorSel(), pen:penPts.length,
      style: (()=>{const a=targetIdxs().map(i=>Store.items[i]).filter(Boolean).map(Store.styleOf);return a.length?{sw:a.every(x=>x.sw===a[0].sw)?a[0].sw:undefined}:defSty;})(), empty:!Store.items.length, locked:padLocked}),
    specs: () => swatches.map(s => ({spec:s.spec, wrap:s.wrap})),
    choose: chooseWorkbenchSpec,
    // 2本指が触れたとき、1本目の描きかけ・ドラッグを確定せず捨てる（workbench.js のピンチが呼ぶ）。ペンの置いた点は残す
    abortGesture() { if (viewMode === "edit") { editAbort(); editPointer = null; } else abortDraw(); },
    // フリック入口（workbench.js）から呼ぶ操作。どれも既存の関数を呼ぶだけ（選択は左右どちらの選択にも効く）
    undo() { doUndo(); },
    redo() { doRedo(); },
    dupSelection() { if (!targetIdxs().length) { alertHint("複製する図形を選んでください"); return; } dupSel(); alertHint("複製しました（「戻す」で戻せます）"); },
    deleteSelection() { const n = deleteSel(); alertHint(n ? `${n}個を削除しました（「戻す」で戻せます）` : "削除する図形を選んでください"); },
    bringForward() { reorderSel("forward"); },
    // 選択中の先頭の図形の線色（線が無ければ塗り色）。選択が無ければ null（#wbSelRow の色の見本用）
    selectionColor() {
      const it = Store.items[targetIdxs()[0]];
      if (!it) return null;
      const st = Store.styleOf(it), c = Render.colors();
      const pick = v => v === "ink" ? c.ink : v === "paper" ? c.paper : null;
      return pick(st.stroke) || pick(st.fill) || c.ink;
    },
    // 円・矩形・多角形などを1個だけ描いて back へ戻る／触って削除は1個消したら back へ戻る
    oneShotTool(t, back) { setTool(t); oneShot = { tool: t, back }; },
    eraseOnce() { const back = tool === "erase" ? "move" : tool; setTool("erase"); oneShot = { tool: "erase", back }; },
    // 描きかけのペンを確定して先へ進む（2点以上=確定 / 1点=取消）。戻り: "committed" | "dropped" | null
    settlePen() { if (!penPts.length) return null; if (penPts.length >= 2) { penCommit(false); return "committed"; } penReset(); return "dropped"; },
    // 色・線幅などを選択（無ければ次に描くものの既定）へ適用する（線幅の数値入力用）
    setStyle(field, value) { applyStyleChange(field, value, field === "sw" ? `太さ ${value}` : field); },
    // 一覧ポップアップの矢印移動中、後ろの展開を仮の群で見せる（null で元へ・状態は変えない・展開面のみ）
    previewSpec(spec) { previewSpec = spec || null; if (viewMode === "edit") scheduleEdit(); },
    // 表示倍率（workbench.js の camera）。canvas の実ピクセルを倍率に合わせて描き直す
    setEditZoom(z) { z = Math.max(1, +z || 1); if (z !== editZoom) { editZoom = z; if (viewMode === "edit") scheduleEdit(); } },
    // 一覧で選んだ群の履歴（直近順・先頭=いま大きく展開している群）。存在しなくなった群は除く
    // 先頭=いまの群＋右の小さい展開4枚分。履歴で足りない分は、一覧（swatches）の並び順でいまの群の次から埋める（重複なし）
    recent: () => {
      const cur = specName(editSpecNow());
      const names = [cur];
      for (const n of recentNames) if (!names.includes(n) && swatches.some(s => specName(s.spec) === n)) names.push(n);
      const i0 = Math.max(0, swatches.findIndex(s => specName(s.spec) === cur));
      for (let k = 1; k < swatches.length && names.length < RECENT_MAX; k++) {
        const n = specName(swatches[(i0 + k) % swatches.length].spec);
        if (!names.includes(n)) names.push(n);
      }
      return names.slice(0, RECENT_MAX).map(n => swatches.find(s => specName(s.spec) === n).spec);
    },
    // 観測用（検査・読み取り専用）: 展開面の論理サイズ・いま描いている全コピーの行列・セル格子（壁紙・帯のみ）
    editGeom() {
      const bbox = Render.buildMotif(Store.items, PAD_W).bbox || DEFAULT_BBOX;
      const L = editLattice(), k = editSpecNow().kind;
      // center: 回転対称（C/D/独自）の回転中心（論理座標・何も描いていなくても返す）。壁紙・帯は null
      const center = (k === "rosette" || k === "custom") ? [editSize / 2, editSize / 2] : null;
      return { size: editSize, views: editViews(bbox), lattice: L, center, latticeShown: !!(latticeOn && viewMode === "edit") };
    },
    // 間隔（壁紙・帯）＝セル辺。形の実寸（セル×断片）は保つ。範囲 48〜300
    gap: () => ({ on: isTileSpec(), value: Groups.getParams().cell, min: GAP_MIN, max: GAP_MAX }),
    setGap(v) { if (isTileSpec()) setGap(v); },
    // 大きさ（壁紙・帯）＝モチーフの実寸（断片スケール）。間隔は変えない。範囲 0.1〜2
    size: () => ({ on: isTileSpec(), value: Groups.getParams().scale, min: SCALE_MIN, max: SCALE_MAX }),
    setSize(v) { if (isTileSpec()) setSize(v); },
    // 帯の「段を重ねる」（帯のときだけ意味がある）
    rows: () => ({ on: isFriezeSpec(), value: !!Groups.getParams().rows }),
    setRows(on) { if (isFriezeSpec()) setRows(on); },
    // 展開面のセル格子の線（画面のみ）を出す／消す
    lattice: () => latticeOn,
    setLattice(on) { latticeOn = !!on; savePrefs(); if (viewMode === "edit") scheduleEdit(); },
    // 同じ絵を spec の群で展開して canvas に描く（展開の右に並べる小さい図用）。形成の記録は
    // 「いま大きく展開している群」の座標で取ったもので、群を替えると捨てられる（currentFaces）ので、ここでは当てない
    drawSpec(cv, spec) {
      Render.swatchInto(cv.getContext("2d"), cv.width / dpr, dpr, spec, Render.buildMotif(Store.items, PAD_W),
        PAD_W, Render.colors().paper, cv.height / dpr);
    },
    view(v) { setViewMode(v); if (v === "edit" && !editToolOf(tool) && !isEditDrawTool(tool)) setTool("move"); },
    tool(t) { setTool(t); },   // 描画系ツールでも展開面に留まる（展開の上に直接描く・段2）
    formErase(v) { formErase=!!v; },
    resize() { sizePad(); if (motif) { buildLivePanel(); refresh(); } },
    snapshot:workbenchSnapshot, restore:applyWorkbenchSnapshot,
    preview(s) {
      const cv=document.createElement("canvas"); cv.width=cv.height=240;
      Render.swatchInto(cv.getContext("2d"),240,1,editSpecNow(),Render.buildMotif(Store.items,PAD_W),PAD_W,
        Render.colors().paper,240,formedItems(editSpecNow()));
      return cv.toDataURL("image/png");
    },
    deleteAnchor() { document.dispatchEvent(new KeyboardEvent("keydown",{key:"Delete",bubbles:true})); },
    smoothAnchor() { const a=currentAnchorSel(); if (!a) return; if(a.src === "pad") padToggleSmooth(a); else toggleSmooth({...a, conv:editablePoints(Store.items).find(p=>p.idx===a.idx)?.conv}); },
    axis: setAxis,
    notify: alertHint
  };
  // PWA: secure context（https / localhost）でのみService Workerを登録。
  // file:// やLAN(http://192.168.x.x)では黙ってスキップ（通常動作に影響なし）
  if ("serviceWorker" in navigator &&
      (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* 失敗しても通常動作 */ });
  }
})();
