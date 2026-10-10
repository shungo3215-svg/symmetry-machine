/* svgimport.js — SVG（Illustratorの書き出し/コピペ）を item に取り込む
   .ai は直接読めないので入力はSVG。各図形要素をブラウザの getPointAtLength で
   サンプルし（transformは getCTM で吸収）、パッドにフィットして shape:path item にする。
   ※ 取り込み後はネイビー単色。曲線は密サンプルの折れ線として近似（tidyで整えられる）。 */
const SvgImport = (() => {
  "use strict";

  const GEOM_SEL = "path,rect,circle,ellipse,line,polygon,polyline";
  const CLOSED_TAGS = new Set(["rect", "circle", "ellipse", "polygon"]);

  // svgText → [{kind:"shape", shape:"path", points, closed, fill}]。取り込めなければ []
  function parse(svgText, padW, opt = {}) {
    const maxEls = opt.maxEls || 400;
    let text = (svgText || "").trim();
    if (!text) return [];
    if (!/<svg[\s>]/i.test(text)) text = `<svg xmlns="http://www.w3.org/2000/svg">${text}</svg>`;

    let doc;
    try { doc = new DOMParser().parseFromString(text, "image/svg+xml"); }
    catch (_) { return []; }
    if (doc.querySelector("parsererror") || !doc.documentElement) return [];

    // getCTM / getPointAtLength はレンダリング文脈が要るので一時的にDOMへ（画面外）
    const holder = document.createElement("div");
    holder.setAttribute("style", "position:fixed;left:-10000px;top:0;width:1200px;height:1200px;opacity:0;pointer-events:none;");
    const svg = document.importNode(doc.documentElement, true);
    holder.appendChild(svg);
    document.body.appendChild(holder);

    const raw = [];
    try {
      const els = svg.querySelectorAll(GEOM_SEL);
      for (let e = 0; e < els.length && raw.length < maxEls; e++) {
        const el = els[e];
        let len;
        try { len = el.getTotalLength(); } catch (_) { continue; }   // 未対応要素はスキップ
        if (!len || !isFinite(len)) continue;
        const n = Math.max(8, Math.min(600, Math.ceil(len / 2)));
        let ctm = null;
        try { ctm = el.getCTM(); } catch (_) { /* null可 */ }
        const pts = [];
        for (let i = 0; i <= n; i++) {
          let p;
          try { p = el.getPointAtLength(len * i / n); } catch (_) { break; }
          let x = p.x, y = p.y;
          if (ctm) { const X = ctm.a * x + ctm.c * y + ctm.e, Y = ctm.b * x + ctm.d * y + ctm.f; x = X; y = Y; }
          if (isFinite(x) && isFinite(y)) pts.push([x, y]);
        }
        if (pts.length < 2) continue;
        const tag = el.tagName.toLowerCase();
        const closed = CLOSED_TAGS.has(tag) || /[zZ]/.test(el.getAttribute("d") || "");
        let fc = "";
        try { fc = getComputedStyle(el).fill; } catch (_) {}
        const filled = closed && fc && fc !== "none" && fc !== "rgba(0, 0, 0, 0)" && fc !== "transparent";
        raw.push({ points: pts, closed, fill: !!filled });
      }
    } finally {
      document.body.removeChild(holder);
    }
    if (!raw.length) return [];

    // 全体bboxをパッドの8割にフィット（中央寄せ）
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of raw) for (const [x, y] of r.points) {
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
    const w = x1 - x0, h = y1 - y0;
    const target = padW * 0.8;
    const s = (w > 0 || h > 0) ? Math.min(target / (w || 1), target / (h || 1)) : 1;
    const ox = (padW - w * s) / 2 - x0 * s, oy = (padW - h * s) / 2 - y0 * s;

    return raw.map(r => ({
      kind: "shape", shape: "path",
      points: r.points.map(([x, y]) => [x * s + ox, y * s + oy]),
      closed: r.closed, fill: r.fill,
    }));
  }

  return { parse };
})();
