/* render.js — canvas描画（パッド＋スワッチ）
   item→幾何（ベジェ/アウトライン/図形）を WeakMap でメモ化し、
   ドキュメントを「順序つきスタイルレイヤー列」に組む（ベクターが唯一の真実）。
   レイヤー = {path, fill:"ink"|"paper"|null, stroke:"ink"|null, sw, alpha}。
   **配列の順序 = 描画順（後ろが前面）**。paper塗りは背後を隠す（白抜き/ノックアウト）。
   連続する同スタイルitemは1つのPath2Dにバッチして性能を保つ。
   スタイルの解釈は Store.styleOf() が唯一の真実（旧boolean fillもそこで吸収）。 */
const Render = (() => {
  "use strict";

  const NAVY = "#0044cc";
  const NAVY_25 = "rgba(0,68,204,.25)";
  const NAVY_50 = "rgba(0,68,204,.5)";

  /* ==== 出力の2色（線=ink / 地=paper）。UIクロームは常にネイビーのまま ==== */
  let INK = NAVY, PAPER = "#ffffff";
  function setColors(c = {}) {
    if (c.ink) INK = c.ink;
    if (c.paper) PAPER = c.paper;
  }
  const colors = () => ({ ink: INK, paper: PAPER });

  /* ==== item → 幾何のメモ化 ==== */
  let geomCache = new WeakMap();     // stroke item → {path: Path2D, kind: "fill"|"stroke", bbox}
  const bitmapCache = new WeakMap(); // image item → {img, ready}
  let onBitmapReady = null;          // 画像デコード完了時の再描画コールバック
  let simplifyEps = 0;               // 手描き線の「整える」量（Douglas-Peucker eps・px）。raw座標は不変で描画/出力時に適用

  // 幾何本体（メモ化なし）。ライブの進行中ストロークが毎フレーム呼ぶ
  // 手描きは常に均一線（強弱=筆圧風は2026-07-22に機能ごと廃止。旧docのmodeは無視される）
  function computeStrokeGeometry(raw, sw = Geom.W_BASE) {
    const pts = Geom.simplifyDP(Geom.resample(raw, 3), simplifyEps);
    const beziers = Geom.toBeziers(pts);
    const path = new Path2D();
    let bbox = null;
    const grow = (x, y, m) => {
      if (!bbox) bbox = { x0: x - m, y0: y - m, x1: x + m, y1: y + m };
      else {
        bbox.x0 = Math.min(bbox.x0, x - m); bbox.y0 = Math.min(bbox.y0, y - m);
        bbox.x1 = Math.max(bbox.x1, x + m); bbox.y1 = Math.max(bbox.y1, y + m);
      }
    };
    if (beziers.length) {
      path.moveTo(beziers[0].p0[0], beziers[0].p0[1]);
      for (const b of beziers) path.bezierCurveTo(b.c1[0], b.c1[1], b.c2[0], b.c2[1], b.p1[0], b.p1[1]);
    }
    pts.forEach(([x, y]) => grow(x, y, sw / 2 + 1));
    return { path, kind: "stroke", bbox, beziers };
  }

  function strokeGeometry(item) {
    let g = geomCache.get(item);
    if (g) return g;
    g = computeStrokeGeometry(item.raw, Store.styleOf(item).sw);
    geomCache.set(item, g);
    return g;
  }

  // roundedSegs（Geom）の消費: canvas側。SVG側(export.js)と同一の真円弧を描く契約
  function segsToPath(path, rs) {
    path.moveTo(rs.start[0], rs.start[1]);
    for (const s of rs.segs) {
      if (s.t === "L") path.lineTo(s.to[0], s.to[1]);
      else path.arcTo(s.corner[0], s.corner[1], s.to[0], s.to[1], s.r);
    }
    if (rs.closed) path.closePath();
  }

  // 「整える」量の変更。全ストロークの幾何が変わるのでメモ化を捨てる（図形は無関係だが再計算は無害）
  function setSimplify(eps) {
    if (eps === simplifyEps) return;
    simplifyEps = eps;
    geomCache = new WeakMap();
  }

  // 図形（正確な幾何・角R対応）。線の平滑化を通さず精密さを保つ
  function computeShapeGeometry(item) {
    const { shape, x0, y0, x1, y1 } = item;
    const st = Store.styleOf(item);
    const path = new Path2D();
    const margin = st.sw / 2 + 1;
    const xs = [], ys = [];
    // 折れ線/多角形を角R(真円弧)つきでpathへ。roundedSegsが使えない形はシャープにフォールバック
    const polyToPath = (pts, closed) => {
      const rs = st.r > 0 ? Geom.roundedSegs(pts, closed, st.r) : null;
      if (rs) segsToPath(path, rs);
      else {
        pts.forEach(([px, py], i) => { i ? path.lineTo(px, py) : path.moveTo(px, py); });
        if (closed) path.closePath();
      }
    };
    if (shape === "line") {
      if (Math.hypot(x1 - x0, y1 - y0) < 0.5) return null;
      path.moveTo(x0, y0); path.lineTo(x1, y1);
      xs.push(x0, x1); ys.push(y0, y1);
    } else if (shape === "rect") {
      const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      if (w < 0.5 && h < 0.5) return null;
      const rr = Math.min(st.r, w / 2, h / 2);
      if (rr > 0.05) {   // 角R: 真円弧（SVGの<rect rx>と同一の幾何）
        path.moveTo(x + rr, y);
        path.arcTo(x + w, y, x + w, y + h, rr);
        path.arcTo(x + w, y + h, x, y + h, rr);
        path.arcTo(x, y + h, x, y, rr);
        path.arcTo(x, y, x + w, y, rr);
        path.closePath();
      } else path.rect(x, y, w, h);
      xs.push(x, x + w); ys.push(y, y + h);
    } else if (shape === "ellipse") {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
      if (rx < 0.5 || ry < 0.5) return null;
      path.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
      xs.push(cx - rx, cx + rx); ys.push(cy - ry, cy + ry);
    } else if (shape === "polygon") {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const r = Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2;
      const n = Math.max(3, Math.min(12, item.sides || 6));
      if (r < 1) return null;
      const pts = [];
      for (let k = 0; k < n; k++) {
        const a = -Math.PI / 2 + 2 * Math.PI * k / n;   // 頂点を上向きから
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      polyToPath(pts, true);
      for (const [px, py] of pts) { xs.push(px); ys.push(py); }
    } else if (shape === "path") {   // ペン/シェイプ演算の結果。curve=スムース点（角R無効・S3）
      const p = item.points || [];
      if (p.length < 2) return null;
      if (item.curve) {
        const bz = Geom.pathBeziers(p, !!item.closed, item.corners, item.curveMode);
        if (!bz.length) return null;
        path.moveTo(bz[0].p0[0], bz[0].p0[1]);
        for (const b of bz) path.bezierCurveTo(b.c1[0], b.c1[1], b.c2[0], b.c2[1], b.p1[0], b.p1[1]);
        if (item.closed) path.closePath();
        for (const b of bz) { xs.push(b.p0[0], b.c1[0], b.c2[0], b.p1[0]); ys.push(b.p0[1], b.c1[1], b.c2[1], b.p1[1]); }
      } else {
        polyToPath(p, !!item.closed);
        for (const [px, py] of p) { xs.push(px); ys.push(py); }
      }
      // 穴（シェイプ演算の結果）: 逆巻きのサブパス。nonzeroで正しく抜ける（巻きはGeom.polyBoolが保証。穴は直線のまま=S2）
      for (const ring of item.holes || []) polyToPath(ring, true);
    } else return null;
    const bbox = { x0: Math.min(...xs) - margin, y0: Math.min(...ys) - margin, x1: Math.max(...xs) + margin, y1: Math.max(...ys) + margin };
    return { path, kind: "stroke", bbox };
  }

  function shapeGeometry(item) {
    let g = geomCache.get(item);
    if (g) return g;
    g = computeShapeGeometry(item);
    if (g) geomCache.set(item, g);
    return g;
  }

  // 進行中(未確定)itemの幾何（メモ化なし）: 描画中のライブ更新・pad preview用
  function liveItemGeometry(item) {
    if (!item) return null;
    if (item.kind === "shape") return computeShapeGeometry(item);
    if (item.raw && item.raw.length >= 2) return computeStrokeGeometry(item.raw, Store.styleOf(item).sw);
    return null;
  }
  // その item が実際に描画される幾何を持つか（幽霊アイテムの確定を防ぐ）
  function itemHasGeometry(item) { return !!liveItemGeometry(item); }

  // itemのbbox（パッド座標）。moveツールの選択枠・変換中心用。imageはnull（v1では変換対象外）
  function itemBBox(item) {
    if (!item || item.kind === "image") return null;
    const g = item.kind === "stroke" ? strokeGeometry(item) : shapeGeometry(item);
    return g ? g.bbox : null;
  }

  // itemの描画方法を解決（Store.styleOf に従う。手描きはstyleOfが塗りなし・線ありを強制）
  function paintOf(gKind, item) {
    const st = Store.styleOf(item);
    return {
      fill: st.fill === "none" ? null : st.fill,
      stroke: st.stroke === "none" ? null : "ink",
      sw: st.sw, alpha: st.alpha,
    };
  }

  // 単一itemをスタイル込みで描く（ドラッグ中プレビュー用）
  function drawItem(ctx, g, item) {
    const p = paintOf(g.kind, item);
    ctx.globalAlpha = p.alpha;
    if (p.fill) { ctx.fillStyle = p.fill === "paper" ? PAPER : INK; ctx.fill(g.path); }
    if (p.stroke) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = p.sw;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.stroke(g.path);
    }
    ctx.globalAlpha = 1;
  }

  function bitmap(item) {
    let b = bitmapCache.get(item);
    if (!b) {
      b = { img: new Image(), ready: false };
      b.img.onload = () => { b.ready = true; onBitmapReady && onBitmapReady(); };
      b.img.src = item.dataURL;
      bitmapCache.set(item, b);
    }
    return b.ready ? b.img : null;
  }

  // 画像のcontain-fit矩形（パッド座標）
  function imageFit(item, padW) {
    const sc = Math.min(padW / item.w, padW / item.h);
    const w = item.w * sc, h = item.h * sc;
    return { x: (padW - w) / 2, y: (padW - h) / 2, w, h };
  }

  /* ==== ドキュメント → モチーフ（順序つきスタイルレイヤー列 + 画像 + bbox） ====
     item配列の順序どおりにレイヤーを積む（後ろが前面・paper塗りは背後を隠す）。
     連続する同スタイルは1つのPath2Dへバッチ（同スタイル内の順序は見た目に影響しない）。
     liveItem: 描画中の未確定item。あればメモ化せず最前面に加える */
  function buildMotif(items, padW, liveItem) {
    const layers = [], images = [], stills = [];
    let bbox = null, last = null, stillLast = null;
    const merge = b => {
      if (!b) return;
      if (!bbox) bbox = { ...b };
      else {
        bbox.x0 = Math.min(bbox.x0, b.x0); bbox.y0 = Math.min(bbox.y0, b.y0);
        bbox.x1 = Math.max(bbox.x1, b.x1); bbox.y1 = Math.max(bbox.y1, b.y1);
      }
    };
    /* still=true のitemは**対称展開に参加しない**（地＝figure/groundの対比用）。
       別のレイヤー列に積み、bboxにも入れない（bboxは展開の配置基準なので、
       地を含めるとモチーフのスケールと位置が狂う）。 */
    const addGeom = (g, item, still) => {
      if (!g) return;
      const p = paintOf(g.kind, item);
      if (!p.fill && !p.stroke) return;   // 不可視item（styleOfが防ぐが念のため）
      if (still) {
        const key = (p.alpha === 1 && !p.fill) ? `${p.stroke}|${p.sw}` : null;
        if (key && stillLast && stillLast.key === key) stillLast.path.addPath(g.path);
        else {
          const path = new Path2D();
          path.addPath(g.path);
          stillLast = { key, path, fill: p.fill, stroke: p.stroke, sw: p.sw, alpha: p.alpha };
          stills.push(stillLast);
        }
        return;
      }
      // バッチ規則: **不透明かつストロークのみ**のitemだけ融合できる。
      // - alpha<1: item同士の重なりは「濃くなる」（SVGと同一）が正 → 融合すると濃くならず食い違う
      // - fillを持つitem: 融合Path2Dのnonzeroで逆巻き同士（図形/polyBool出力は正巻き・
      //   閉penやSVG取込は任意巻き）の重なりが相殺して白い穴が開く。
      //   さらにfill+stroke複合itemはper-itemの fill→stroke 描画順（=SVGの要素順）が壊れる
      const key = (p.alpha === 1 && !p.fill) ? `${p.stroke}|${p.sw}` : null;
      if (key && last && last.key === key) last.path.addPath(g.path);
      else {
        const path = new Path2D();
        path.addPath(g.path);   // キャッシュ済み幾何を汚さないようコピーに積む
        last = { key, path, fill: p.fill, stroke: p.stroke, sw: p.sw, alpha: p.alpha };
        layers.push(last);
      }
      merge(g.bbox);
    };
    for (const item of items) {
      const still = !!item.still;
      if (item.kind === "stroke") addGeom(strokeGeometry(item), item, still);
      else if (item.kind === "shape") addGeom(shapeGeometry(item), item, still);
      else if (item.kind === "image") { images.push(item); merge({ x0: 0, y0: 0, x1: padW, y1: padW }); }
    }
    addGeom(liveItemGeometry(liveItem), liveItem, false);
    return { layers, images, bbox, stills };
  }

  /* 静止レイヤー（地）をスワッチに1回だけ描く。パッド→スワッチは**等方**スケール＋中央寄せ
     （非等方だと円が楕円になり「幾何一致」の不変条件を壊す）。展開の背後＝最背面。 */
  function stillMat(padW, size, sizeH) {
    const s = Math.min(size, sizeH) / padW;
    return [s, 0, 0, s, (size - padW * s) / 2, (sizeH - padW * s) / 2];
  }
  function drawStills(ctx, motif, padW, base, size, sizeH, knockout) {
    if (!motif.stills || !motif.stills.length) return;
    const m = stillMat(padW, size, sizeH);
    ctx.setTransform(base * m[0], base * m[1], base * m[2], base * m[3], base * m[4], base * m[5]);
    drawLayers(ctx, motif.stills, knockout);
  }

  /* ==== 消しゴム用ヒットテスト: パッド座標(x,y)の直下にあるitemのindexを返す（上=最後を優先） ====
     ctx は identity transform に戻して pad 座標で判定する。tol はタップ許容幅(px) */
  function itemAt(ctx, items, x, y, padW, tol = 10) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let hit = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === "image") {
        const f = imageFit(it, padW);
        if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h) { hit = i; break; }
        continue;
      }
      const g = it.kind === "stroke" ? strokeGeometry(it) : shapeGeometry(it);
      if (!g) continue;
      const p = paintOf(g.kind, it);
      ctx.lineWidth = Math.max(p.sw, tol);   // 輪郭は太さ+許容幅で当てる（stroke:noneでも掴めるよう常に判定）
      if ((p.fill && ctx.isPointInPath(g.path, x, y)) || ctx.isPointInStroke(g.path, x, y)) { hit = i; break; }
    }
    ctx.restore();
    return hit;
  }

  /* ==== ガイド（パッド専用の重ね表示・書き出しには出さない） ====
     kind: "grid" | "circle" | それ以外は非表示。axis=回転中心（circleガイドの中心もここに従う） */
  function drawGuides(ctx, padW, kind, axis) {
    const acx = axis ? axis[0] : padW / 2, acy = axis ? axis[1] : padW / 2;
    ctx.save();
    ctx.lineWidth = 1;
    if (kind === "grid") {
      const step = padW / 16;   // 16分割（snapPointの grid step と一致させること）
      for (let i = 1; i < 16; i++) {
        const p = i * step, center = (i === 8);
        ctx.strokeStyle = center ? NAVY_50 : NAVY_25;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, padW); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(padW, p); ctx.stroke();
      }
    } else if (kind === "circle") {
      const c = padW / 2;
      ctx.strokeStyle = NAVY_25;
      for (const f of [0.25, 0.5, 0.75, 0.98]) {
        ctx.beginPath(); ctx.arc(acx, acy, c * f, 0, 2 * Math.PI); ctx.stroke();
      }
      for (let k = 0; k < 12; k++) {   // 30°ごとの放射（C8/D6まで割り切れる目安）
        const a = k * Math.PI / 6;
        ctx.beginPath(); ctx.moveTo(acx, acy); ctx.lineTo(acx + c * Math.cos(a), acy + c * Math.sin(a)); ctx.stroke();
      }
      ctx.strokeStyle = NAVY_50;   // 中心の十字を少し強く
      ctx.beginPath(); ctx.moveTo(acx, 0); ctx.lineTo(acx, padW); ctx.moveTo(0, acy); ctx.lineTo(padW, acy); ctx.stroke();
    }
    // 回転中心マーカー（axis設定時のみ・ガイドoffでも見える小さな×）
    if (axis) {
      ctx.strokeStyle = NAVY_50;
      ctx.beginPath();
      ctx.moveTo(acx - 5, acy - 5); ctx.lineTo(acx + 5, acy + 5);
      ctx.moveTo(acx + 5, acy - 5); ctx.lineTo(acx - 5, acy + 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  // モチーフを現在の変換の下に描く（パッド座標系で）。レイヤー順=描画順
  // knockout=true（透明PNG用）: paper塗りを白でなく「真の穴」にする（destination-out）。
  // ネイビー地のポスター等に置いたとき白い形が浮かないための実戦仕様。画面/白背景は白塗り=見た目同一
  function drawMotif(ctx, motif, padW, knockout = false) {
    for (const item of motif.images) {
      const img = bitmap(item);
      if (!img) continue;
      const f = imageFit(item, padW);
      ctx.drawImage(img, f.x, f.y, f.w, f.h);
    }
    drawLayers(ctx, motif.layers, knockout);
  }

  function drawLayers(ctx, layers, knockout = false) {
    for (const L of layers) {
      ctx.globalAlpha = L.alpha;
      if (L.fill) {
        if (knockout && L.fill === "paper") {
          ctx.save();
          ctx.globalCompositeOperation = "destination-out";
          ctx.fillStyle = "#000";
          ctx.fill(L.path);
          ctx.restore();
        } else {
          ctx.fillStyle = L.fill === "paper" ? PAPER : INK;
          ctx.fill(L.path);
        }
      }
      if (L.stroke) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = L.sw;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke(L.path);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ==== パッド ==== */
  function pad(ctx, padW, motif, dpr, guide, axis) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, padW, padW);
    drawGuides(ctx, padW, guide, axis);   // モチーフの背後にガイド
    drawLayers(ctx, motif.stills || []);  // 地（静止）はスワッチと同じく背面（padW座標系なので変換不要）
    drawMotif(ctx, motif, padW);
  }

  // 図形ドラッグ中のパッドプレビュー: 確定モチーフ+ガイドを描き直し、進行中図形をスタイル込みで重ねる
  function previewShape(ctx, padW, motif, dpr, guide, item, axis) {
    pad(ctx, padW, motif, dpr, guide, axis);
    const g = liveItemGeometry(item);
    if (g) drawItem(ctx, g, item);   // 結果と同じ塗り/線/濃度で見せる
  }

  /* ==== スワッチ（ロゼット/フリーズ/壁紙 共通） ====
     spec: {kind:"rosette", def} | {kind:"frieze"|"wallpaper", name}
     base: 出力スケール（dpr または PNG倍率）。sizeH: 縦寸（省略=正方。フリーズの横長ライブ表示用） */
  /* formed = 形成（展開ビューでの非破壊編集）を焼いた実体item列。padW座標で**既に展開済み**なので、
     渡されたら spec による展開はせず size/padW の等方スケールで描くだけ。
     これで「画面で見ているもの」と「スワッチ/PNG/SVGに出るもの」が構造的に一致する */
  function swatchInto(ctx, size, base, spec, motif, padW, bg, sizeH = size, formed) {
    ctx.setTransform(base, 0, 0, base, 0, 0);
    ctx.clearRect(0, 0, size, sizeH);
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, size, sizeH); }
    if (formed && formed.length) {
      const fm = buildMotif(formed, padW);
      if (!fm.layers.length && !(fm.stills && fm.stills.length)) return;
      const k = size / padW;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, size, sizeH); ctx.clip();
      ctx.setTransform(base * k, 0, 0, base * k, 0, 0);
      if (fm.stills && fm.stills.length) drawLayers(ctx, fm.stills, bg === null);
      drawLayers(ctx, fm.layers, bg === null);
      ctx.restore();
      return;
    }
    const hasStill = !!(motif.stills && motif.stills.length);
    if (!motif.bbox && !hasStill) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, size, sizeH); ctx.clip();

    const knockout = bg === null;   // 透明背景（PNG clear）のときだけpaperを真の穴にする
    drawStills(ctx, motif, padW, base, size, sizeH, knockout);   // 地は展開の背後に1回だけ
    if (motif.bbox) {
      const { place, insts } = Groups.layout(spec, size, padW, motif.bbox, sizeH);
      if (overlap === "each") {
        for (const inst of insts) {
          const m = Geom.mul(inst, place.mat);
          ctx.setTransform(base * m[0], base * m[1], base * m[2], base * m[3], base * m[4], base * m[5]);
          drawMotif(ctx, motif, padW, knockout);
        }
      } else {
        drawOverlapped(ctx, motif, insts, place, base, knockout, padW);
      }
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* ==== 重なりの扱い（overlap）====
     展開は純関数のまま、**描くときだけ**コピー同士の重なりを解釈し直す後処理。
     モチーフには一切触れないので、対称の連動・アンカー編集・undo はそのまま生き、
     トグルで即座に行き来できる（＝不可逆な「実体化」をしなくても試せる）。

     実装の要: polyBool を回さず **fill-rule** で決める。
       merge = 全コピーを1つのPath2Dに集めて nonzero  → 重なりが埋まって1つの輪郭に見える
       punch = 同じパスを evenodd                      → 重なった領域が穴になる
     どちらも O(コピー数) の描画だけで済むのでリアルタイム。SVGも同じ fill-rule で一致する。
     ※ 線(stroke)は「面」ではないので重なりを解釈できない。線のまま重なりを消したいときは
       editbarの「輪郭」で面に変えてから使う（チートシートに明記）。 */
  let overlap = "each";   // "each"（既定）| "merge" | "punch"
  const setOverlap = v => { overlap = (v === "merge" || v === "punch") ? v : "each"; };
  const getOverlap = () => overlap;

  function drawOverlapped(ctx, motif, insts, place, base, knockout, padW) {
    const rule = overlap === "punch" ? "evenodd" : "nonzero";
    const mats = insts.map(inst => {
      const m = Geom.mul(inst, place.mat);
      return new DOMMatrix([m[0], m[1], m[2], m[3], m[4], m[5]]);
    });
    ctx.setTransform(base, 0, 0, base, 0, 0);   // パスに行列を焼くので、ここは基準スケールのまま
    for (const L of motif.layers) {
      ctx.globalAlpha = L.alpha;
      if (L.fill) {
        const merged = new Path2D();
        for (const M of mats) merged.addPath(L.path, M);
        if (knockout && L.fill === "paper") {
          ctx.save();
          ctx.globalCompositeOperation = "destination-out";
          ctx.fillStyle = "#000";
          ctx.fill(merged, rule);
          ctx.restore();
        } else {
          ctx.fillStyle = L.fill === "paper" ? PAPER : INK;
          ctx.fill(merged, rule);
        }
      }
      // 線は面ではないので融合できない。コピーごとに引く（線幅を行列で歪めないため個別変換）
      if (L.stroke) {
        ctx.strokeStyle = INK;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        for (const inst of insts) {
          const m = Geom.mul(inst, place.mat);
          ctx.setTransform(base * m[0], base * m[1], base * m[2], base * m[3], base * m[4], base * m[5]);
          ctx.lineWidth = L.sw;
          ctx.stroke(L.path);
        }
        ctx.setTransform(base, 0, 0, base, 0, 0);
      }
    }
    ctx.globalAlpha = 1;
    // 画像は重なり解釈の対象外（ビットマップなので）。コピーごとにそのまま置く
    if (motif.images.length) {
      for (const inst of insts) {
        const m = Geom.mul(inst, place.mat);
        ctx.setTransform(base * m[0], base * m[1], base * m[2], base * m[3], base * m[4], base * m[5]);
        for (const item of motif.images) {
          const img = bitmap(item);
          if (!img) continue;
          const f = imageFit(item, padW);
          ctx.drawImage(img, f.x, f.y, f.w, f.h);
        }
      }
    }
  }

  /* ==== rAFキュー: 1フレームに数枚ずつスワッチを更新 ====
     タブが非表示のときはrAFが止まるのでsetTimeoutにフォールバック */
  let queueToken = 0;
  const nextFrame = fn => document.hidden ? setTimeout(fn, 16) : requestAnimationFrame(fn);
  function queueSwatches(jobs, perFrame = 3) {
    const token = ++queueToken;
    let i = 0;
    const step = () => {
      if (token !== queueToken) return;   // 新しい更新が来たら中断
      const until = Math.min(i + perFrame, jobs.length);
      for (; i < until; i++) jobs[i]();
      if (i < jobs.length) nextFrame(step);
    };
    nextFrame(step);
  }

  return {
    NAVY, setColors, colors,
    buildMotif, drawMotif, drawLayers, drawGuides, imageFit, pad, previewShape, swatchInto, queueSwatches, itemAt, itemHasGeometry, itemBBox, setSimplify,
    stillMat,         // 静止レイヤー（地）のパッド→スワッチ変換。SVG書き出しが同じ行列を使う
    setOverlap, getOverlap,   // 重なりの扱い（each/merge/punch）。SVG書き出しも同じ値を読む
    strokeGeometry,   // SVG書き出しが同じベジェを使うため公開
    setBitmapReadyHandler: fn => { onBitmapReady = fn; },
  };
})();
