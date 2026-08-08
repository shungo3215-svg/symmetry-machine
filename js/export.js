/* export.js — SVG / 高解像度PNG 書き出し
   SVG: canvasと同じ Groups.layout() と同じベジェ制御点を使う（見た目と幾何が一致）。
   線は centerline の strokeパス（Illustratorで線幅・色を後編集できる形）。
   モチーフスケールはパス座標に焼き込み、<g> の行列は等長変換のみ
   （stroke-width が transform でスケールされる罠の回避）。 */
const Exporter = (() => {
  "use strict";

  const f3 = v => (Math.round(v * 1000) / 1000).toString();
  const f6 = v => (Math.round(v * 1e6) / 1e6).toString();

  function stamp() {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  }

  // item のベジェ列 → mat を焼き込んだ SVG path d
  function pathD(beziers, mat) {
    if (!beziers.length) return "";
    const T = ([x, y]) => Geom.apply(mat, x, y);
    const [sx, sy] = T(beziers[0].p0);
    let d = `M${f3(sx)} ${f3(sy)}`;
    for (const b of beziers) {
      const [c1x, c1y] = T(b.c1), [c2x, c2y] = T(b.c2), [px, py] = T(b.p1);
      d += `C${f3(c1x)} ${f3(c1y)} ${f3(c2x)} ${f3(c2y)} ${f3(px)} ${f3(py)}`;
    }
    return d;
  }

  // スタイル → SVG属性。fill/strokeは要素ごとに明示（重ね順・per-itemスタイルを正確に運ぶ）。
  // 透明度は opacity（グループ不透明度）ではなく fill-opacity + stroke-opacity で出す:
  // canvasは fill→stroke を逐次合成する（輪郭が塗りに重なる帯は濃くなる）ので、それと同値にする
  function styleAttrs(st, s) {
    const c = Render.colors();
    const fa = ` fill="${st.fill === "ink" ? c.ink : st.fill === "paper" ? c.paper : "none"}"`;
    const sa = st.stroke === "ink" ? ` stroke="${c.ink}" stroke-width="${f3(st.sw * s)}"` : ` stroke="none"`;
    const oa = st.alpha < 1 ? ` fill-opacity="${f3(st.alpha)}" stroke-opacity="${f3(st.alpha)}"` : "";
    return fa + sa + oa;
  }

  // 手描き線 → 中心線のstrokeパス（SVGは構造・抑揚は高解像度PNGが担う。既存判断のまま）
  function strokeEl(item, place) {
    const st = Store.styleOf(item);
    const d = pathD(Render.strokeGeometry(item).beziers, place.mat);
    if (!d) return "";
    const oa = st.alpha < 1 ? ` stroke-opacity="${f3(st.alpha)}"` : "";
    return `<path d="${d}" fill="none" stroke="${Render.colors().ink}" stroke-width="${f3(st.sw * place.scale)}"${oa}/>`;
  }

  // roundedSegs（Geom）の消費: SVG側。canvas(render.js segsToPath)と同一の真円弧をAコマンドで出す契約
  function segsD(rs, T, s) {
    const [sx, sy] = T(rs.start[0], rs.start[1]);
    let d = `M${f3(sx)} ${f3(sy)}`;
    for (const seg of rs.segs) {
      const [tx, ty] = T(seg.to[0], seg.to[1]);
      if (seg.t === "L") d += `L${f3(tx)} ${f3(ty)}`;
      else d += `A${f3(seg.r * s)} ${f3(seg.r * s)} 0 0 ${seg.sweep} ${f3(tx)} ${f3(ty)}`;
    }
    if (rs.closed) d += "Z";
    return d;
  }

  // 図形 → native SVG要素（配置行列 mat を座標に焼き込む）。
  // mat は等方スケール(s)+並進なので circle/rect/ellipse が形を保ち、角Rの円弧も円のまま。
  // Illustratorでライブな図形オブジェクトとして開ける。角R/穴つきだけ <path>（真円弧のA）
  function shapeEl(item, mat) {
    const s = mat[0];   // placementの線形部は s·I（等方）
    const T = (x, y) => Geom.apply(mat, x, y);
    const st = Store.styleOf(item);
    const attrs = styleAttrs(st, s);
    const { shape, x0, y0, x1, y1 } = item;
    if (shape === "line") {
      if (Math.hypot(x1 - x0, y1 - y0) < 0.5) return "";
      const [ax, ay] = T(x0, y0), [bx, by] = T(x1, y1);
      return `<line x1="${f3(ax)}" y1="${f3(ay)}" x2="${f3(bx)}" y2="${f3(by)}"${attrs}/>`;
    }
    if (shape === "rect") {
      const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      if (w < 0.5 && h < 0.5) return "";
      const [px, py] = T(x, y);
      const rr = Math.min(st.r, w / 2, h / 2);
      const rx = rr > 0.05 ? ` rx="${f3(rr * s)}"` : "";   // 角R（canvasのarcToと同一の真円弧）
      return `<rect x="${f3(px)}" y="${f3(py)}" width="${f3(w * s)}" height="${f3(h * s)}"${rx}${attrs}/>`;
    }
    if (shape === "ellipse") {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
      if (rx < 0.5 || ry < 0.5) return "";
      const [px, py] = T(cx, cy);
      return Math.abs(rx - ry) < 1e-3
        ? `<circle cx="${f3(px)}" cy="${f3(py)}" r="${f3(rx * s)}"${attrs}/>`
        : `<ellipse cx="${f3(px)}" cy="${f3(py)}" rx="${f3(rx * s)}" ry="${f3(ry * s)}"${attrs}/>`;
    }
    if (shape === "polygon") {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const r = Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2;
      const n = Math.max(3, Math.min(12, item.sides || 6));
      if (r < 1) return "";
      const pts = [];
      for (let k = 0; k < n; k++) {
        const a = -Math.PI / 2 + 2 * Math.PI * k / n;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      const rs = st.r > 0 ? Geom.roundedSegs(pts, true, st.r) : null;
      if (rs) return `<path d="${segsD(rs, T, s)}"${attrs}/>`;
      return `<polygon points="${pts.map(([px, py]) => { const [tx, ty] = T(px, py); return `${f3(tx)},${f3(ty)}`; }).join(" ")}"${attrs}/>`;
    }
    if (shape === "path") {   // ペン/シェイプ演算の結果: 開=polyline / 閉=polygon / 角R・穴・曲線つき=<path>
      const p = item.points || [];
      if (p.length < 2) return "";
      const holes = (item.closed && Array.isArray(item.holes)) ? item.holes : [];
      if (item.curve) {   // スムース点: canvasと同一のベジェ列（Geom.pathBeziers）をCコマンドで
        let d = pathD(Geom.pathBeziers(p, !!item.closed, item.corners, item.curveMode), mat) + (item.closed ? "Z" : "");
        for (const ring of holes) d += ring.map(([px, py], i) => { const [tx, ty] = T(px, py); return `${i ? "L" : "M"}${f3(tx)} ${f3(ty)}`; }).join("") + "Z";
        return `<path d="${d}"${attrs}/>`;
      }
      const ringD = (pts, closed) => {
        const rs = st.r > 0 ? Geom.roundedSegs(pts, closed, st.r) : null;
        if (rs) return segsD(rs, T, s);
        return pts.map(([px, py], i) => { const [tx, ty] = T(px, py); return `${i ? "L" : "M"}${f3(tx)} ${f3(ty)}`; }).join("") + (closed ? "Z" : "");
      };
      if (!holes.length && st.r <= 0) {   // 従来通りnative要素（Illustratorでアンカー編集が楽）
        const pts = p.map(([px, py]) => { const [tx, ty] = T(px, py); return `${f3(tx)},${f3(ty)}`; });
        return item.closed
          ? `<polygon points="${pts.join(" ")}"${attrs}/>`
          : `<polyline points="${pts.join(" ")}"${attrs}/>`;
      }
      let d = ringD(p, !!item.closed);
      for (const ring of holes) d += ringD(ring, true);   // 穴=逆巻きサブパス（nonzeroで抜ける・巻きはpolyBoolが保証）
      return `<path d="${d}"${attrs}/>`;
    }
    return "";
  }

  /* item → **塗り用のパスd**（配置行列を焼き込む）。
     overlap（重なりの扱い）で全コピーを1つの<path>に連結するために使う。
     canvas側 Render.drawOverlapped が Path2D を集めるのと同じ幾何・同じ規則で文字列にする
     （＝画面とファイルの一致）。塗らないitem・開パス・線は対象外（面ではないので）。 */
  function fillD(item, mat) {
    const s = mat[0];
    const T = (x, y) => Geom.apply(mat, x, y);
    const st = Store.styleOf(item);
    if (st.fill === "none") return "";
    const { shape, x0, y0, x1, y1 } = item;
    const ringD = (pts, closed = true) => {
      const rs = st.r > 0 ? Geom.roundedSegs(pts, closed, st.r) : null;
      if (rs) return segsD(rs, T, s);
      return pts.map(([px, py], i) => { const [tx, ty] = T(px, py); return `${i ? "L" : "M"}${f3(tx)} ${f3(ty)}`; }).join("") + (closed ? "Z" : "");
    };
    if (shape === "rect") {
      const x = Math.min(x0, x1), y = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      if (w < 0.5 && h < 0.5) return "";
      const rr = Math.min(st.r, w / 2, h / 2);
      const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      if (rr > 0.05) { const rs = Geom.roundedSegs(pts, true, rr); if (rs) return segsD(rs, T, s); }
      return ringD(pts);
    }
    if (shape === "ellipse") {   // 真円弧2本で1周（canvasの弧と同じ幾何）
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
      if (rx < 0.5 || ry < 0.5) return "";
      const [ax, ay] = T(cx - rx, cy), [bx, by] = T(cx + rx, cy);
      const RX = f3(rx * s), RY = f3(ry * s);
      return `M${f3(ax)} ${f3(ay)}A${RX} ${RY} 0 0 1 ${f3(bx)} ${f3(by)}A${RX} ${RY} 0 0 1 ${f3(ax)} ${f3(ay)}Z`;
    }
    if (shape === "polygon") {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const r = Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2;
      const n = Math.max(3, Math.min(12, item.sides || 6));
      if (r < 1) return "";
      const pts = [];
      for (let k = 0; k < n; k++) {
        const a = -Math.PI / 2 + 2 * Math.PI * k / n;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      return ringD(pts);
    }
    if (shape === "path") {
      if (!item.closed || !item.points || item.points.length < 3) return "";
      let d = item.curve
        ? pathD(Geom.pathBeziers(item.points, true, item.corners, item.curveMode), mat) + "Z"
        : ringD(item.points);
      for (const h of (Array.isArray(item.holes) ? item.holes : [])) d += ringD(h);
      return d;
    }
    return "";   // line / stroke は面ではない
  }

  /* ==== SVG 生成 ====
     spec: {kind:"wallpaper", name} | {kind:"rosette", def}
     戻り値: SVG文字列。ベクターitem(stroke/shape)が無ければ null（画像はSVGに含めない） */
  function svg(spec, items, padW, size, formed) {
    /* formed = 形成を焼いた実体item列（padW座標・既に展開済み）。渡されたら展開せず
       size/padW の等方スケールで出す＝画面で見ている形がそのままファイルになる */
    if (formed && formed.length) {
      const k = size / padW;
      const mat = [k, 0, 0, k, 0, 0];
      const pl = { mat, scale: k };
      const es = formed
        .filter(it => it.kind === "stroke" || it.kind === "shape")
        .map(it => it.kind === "stroke" ? strokeEl(it, pl) : shapeEl(it, mat))
        .filter(Boolean);
      if (!es.length) return null;
      const nm = (spec.def ? spec.def.name : spec.name).replace(/\s+/g, "-");
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" data-symmetry="${nm}" data-formed="1">
<g stroke-linecap="round" stroke-linejoin="round">
${es.map(e => "  " + e).join("\n")}
</g>
</svg>
`;
    }
    const vis = items.filter(it => it.kind === "stroke" || it.kind === "shape");
    if (!vis.length) return null;
    const vecs = vis.filter(it => !it.still);     // 対称展開されるモチーフ
    const stills = vis.filter(it => it.still);    // 地（静止レイヤー）＝展開せず1回だけ
    const motif = Render.buildMotif(items, padW);
    if (!motif.bbox && !stills.length) return null;   // 可視の幾何がない
    // フリーズ名は空白を含む("spinning hop"等)のでid/ファイル名用にサニタイズ
    const name = (spec.def ? spec.def.name : spec.name).replace(/\s+/g, "-");
    const clipId = `clip-${name}-${Date.now().toString(36)}`;   // 複数ファイルをAIに集めた時のid衝突回避

    /* 静止レイヤー（地）: canvas側と**同一の行列** Render.stillMat（等方スケール+中央寄せ）で
       1回だけ出す。最背面＝展開より前に置く（figure/groundの対比） */
    let stillPart = "";
    if (stills.length) {
      const sm = Render.stillMat(padW, size, size);
      const pl = { mat: sm, scale: sm[0] };
      const es = stills.map(it => it.kind === "stroke" ? strokeEl(it, pl) : shapeEl(it, sm)).filter(Boolean);
      if (es.length) stillPart = es.map(e => `  ${e}`).join("\n") + "\n";
    }

    // 1モチーフ分の要素。**item順=重ね順**（canvasと同じ。paper塗りの白抜きを正しく運ぶ）。
    // 属性はper-item（fill/stroke/stroke-width/opacity）。
    // ※ 手描き線は常に均一線・SVGは中心線path（強弱=筆圧風は2026-07-22に廃止）。
    let gs = "";
    if (motif.bbox && vecs.length) {
      const { place, insts } = Groups.layout(spec, size, padW, motif.bbox);
      const ov = Render.getOverlap();
      if (ov !== "each") {
        /* 重なりの扱い: **塗りは全コピーを1つの<path>に連結して fill-rule** で解釈する
           （merge=nonzero で重なりが埋まる / punch=evenodd で重なりが穴になる）。
           canvas と同じ単位で処理できるのは、fillを持つitemがバッチされない＝
           1レイヤー=1item だから（render.jsのバッチ規則）。線は面ではないのでコピーごとに引く。 */
        const rule = ov === "punch" ? "evenodd" : "nonzero";
        const c = Render.colors();
        const parts = [];
        for (const it of vecs) {
          const st = Store.styleOf(it);
          if (st.fill === "none") continue;
          let d = "";
          for (const inst of insts) d += fillD(it, Geom.mul(inst, place.mat));
          if (!d) continue;
          const oa = st.alpha < 1 ? ` fill-opacity="${f3(st.alpha)}"` : "";
          parts.push(`  <path d="${d}" fill="${st.fill === "paper" ? c.paper : c.ink}" fill-rule="${rule}" stroke="none"${oa}/>`);
        }
        const lineEls = vecs
          .filter(it => Store.styleOf(it).stroke !== "none")
          .map(it => it.kind === "stroke" ? strokeEl(it, place) : shapeEl(it, place.mat))
          .filter(Boolean);
        if (lineEls.length) for (const m of insts)
          parts.push(`  <g transform="matrix(${m.map(f6).join(" ")})">\n` + lineEls.map(e => `    ${e}`).join("\n") + `\n  </g>`);
        gs = parts.join("\n");
      } else {
        const els = vecs.map(it => it.kind === "stroke" ? strokeEl(it, place) : shapeEl(it, place.mat)).filter(Boolean);
        if (els.length) gs = insts.map(m =>
          `  <g transform="matrix(${m.map(f6).join(" ")})">\n` +
          els.map(e => `    ${e}`).join("\n") +
          `\n  </g>`
        ).join("\n");
      }
    }
    if (!stillPart && !gs) return null;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${size}" height="${size}"/></clipPath></defs>
<g clip-path="url(#${clipId})" stroke-linecap="round" stroke-linejoin="round">
${stillPart}${gs}${gs ? "\n" : ""}</g>
</svg>
`;
  }

  /* ==== 高解像度PNG: ベクター再描画（canvas拡大コピーではない） ====
     bg: "#fff" 等の背景色。null/undefined なら透明背景 */
  function png(spec, items, padW, size, scale, cb, bg = "#fff", formed) {
    const cv = document.createElement("canvas");
    cv.width = size * scale; cv.height = size * scale;
    const ctx = cv.getContext("2d");
    const motif = Render.buildMotif(items, padW);
    Render.swatchInto(ctx, size, scale, spec, motif, padW, bg || null, size, formed);
    cv.toBlob(cb, "image/png");
  }

  /* ==== ダウンロード ==== */
  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const downloadText = (text, filename, type = "image/svg+xml") =>
    downloadBlob(new Blob([text], { type }), filename);

  return { svg, png, downloadBlob, downloadText, stamp };
})();
