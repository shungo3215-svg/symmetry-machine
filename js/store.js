/* store.js — ドキュメント状態・undo/redo・永続化
   ドキュメント = 不変itemの配列。**配列の順序 = 描画順（後ろが前面）**。
   item: {kind:"stroke", raw:[[x,y,t],...]}（旧docのmode欄は読めるが無視=常に均一線）
       | {kind:"shape", shape:"line|rect|ellipse|polygon|path", ...}（path: points/closed/holes?）
       | {kind:"image", dataURL, w, h}
   スタイル（任意フィールド・省略可）: fill:"ink"|"paper"|"none"（旧形式 true/false も可）
       stroke:"ink"|"none" / sw:線幅px / alpha:0..1 / r:角R px
   読み手は item.fill 等を直接見ず、必ず styleOf(item) で正規化して解釈する。
   undo/redo はスナップショット式（配列の参照コピー）。 */
const Store = (() => {
  "use strict";

  // v2 = スタイル欄（fill文字列/stroke/sw/alpha/r/holes）導入後の保存先。
  // 旧キーは読み込み専用で残す（旧ビルド＝古いスマホ単一HTML等と相互破壊しないため消さない・書かない）
  const LS_KEY = "symmetry-machine.doc.v2";
  const LS_KEY_V1 = "symmetry-machine.doc.v1";
  const STACK_MAX = 100;

  let items = [];
  /* 形成の記録（展開ビューの非破壊編集）。**ドキュメントの一部**として items と一緒に版を持つ。
     ここに置かないと ⌘Z が形成に効かず、JSONにも入らず、prefs に残って別の絵へ持ち越される
     ——2026-07-25 の全面点検で「可逆性の窓口は1つなのに実体が2系統」が最上位の欠陥だった。
     cuts   = けずった面の軌道 / merges = つないだ面グループ / edges = 消した線の軌道 */
  const EMPTY_FORM = Object.freeze({ cuts: [], merges: [], edges: [] });
  let form = EMPTY_FORM;
  let undoStack = [], redoStack = [];
  const listeners = [];
  const persistListeners = [];
  let persistState = "ok";   // "ok" | "degraded"(画像なし保存) | "memory"(保存不可)

  const emit = () => { listeners.forEach(fn => fn(items)); scheduleSave(); };
  const snapshot = () => ({ items, form });

  /* items と form を1つの版として積む。既存の呼び出し（commit(nextItems)）はそのまま動き、
     form を触るときだけ第2引数を渡す＝1操作=1コミット=1undo が両方に効く */
  function commit(nextItems, nextForm) {
    undoStack.push(snapshot());
    if (undoStack.length > STACK_MAX) undoStack.shift();
    redoStack = [];
    if (nextItems !== undefined) items = nextItems;
    if (nextForm !== undefined) form = Object.freeze(nextForm);
    emit();
  }
  // 形成の記録の更新（1コミット=1undo）。差が無ければ履歴を汚さない
  function setForm(next) {
    const f = {
      cuts: Array.isArray(next && next.cuts) ? next.cuts : [],
      merges: Array.isArray(next && next.merges) ? next.merges : [],
      edges: Array.isArray(next && next.edges) ? next.edges : [],
    };
    if (JSON.stringify(f) === JSON.stringify(form)) return false;
    commit(undefined, f);
    return true;
  }
  const hasForm = () => !!(form.cuts.length || form.merges.length || form.edges.length);

  function add(item) { commit([...items, Object.freeze(item)]); }
  function addMany(arr) { if (arr && arr.length) commit([...items, ...arr.map(Object.freeze)]); }   // 1回のundoでまとめて追加
  function removeAt(i) { if (i >= 0 && i < items.length) commit(items.filter((_, k) => k !== i)); }
  function removeMany(idxs) {   // 複数選択の削除を1回のundoに
    const set = new Set(idxs.filter(i => i >= 0 && i < items.length));
    if (set.size) commit(items.filter((_, k) => !set.has(k)));
  }
  function replaceAt(i, item) {   // 1コミットでitemを置換（moveツールの変換確定用）
    if (i >= 0 && i < items.length && item) commit(items.map((it, k) => k === i ? Object.freeze(item) : it));
  }
  function replaceMany(entries) {   // [[index,item],...] を1コミットで置換（複数選択の変換確定用）
    const map = new Map(entries.filter(([i, it]) => i >= 0 && i < items.length && it));
    if (map.size) commit(items.map((it, k) => map.has(k) ? Object.freeze(map.get(k)) : it));
  }
  function replaceWith(idxs, newItems) {   // 選択群を新item群に置換（シェイプ演算の確定用・1コミット=1undo）
    const set = new Set(idxs.filter(i => i >= 0 && i < items.length));
    if (!set.size || !newItems || !newItems.length) return -1;
    const at = Math.min(...set);            // 挿入位置 = 置換対象の最背面の位置（重ね順を保つ）
    const rest = items.filter((_, k) => !set.has(k));
    commit([...rest.slice(0, at), ...newItems.map(Object.freeze), ...rest.slice(at)]);
    return at;                              // 新item群の開始index（選択の張り直し用）
  }
  function reorder(idxs, where) {   // 選択群を最前面("front")/最背面("back")へ（1コミット）。新index配列を返す
    const set = new Set(idxs.filter(i => i >= 0 && i < items.length));
    if (!set.size) return null;
    const picked = items.filter((_, k) => set.has(k));
    const rest = items.filter((_, k) => !set.has(k));
    const next = where === "back" ? [...picked, ...rest] : [...rest, ...picked];
    if (!next.every((it, k) => it === items[k])) commit(next);   // 既にその順なら何もしない
    return where === "back" ? picked.map((_, k) => k) : picked.map((_, k) => rest.length + k);
  }
  function clear() { if (items.length || hasForm()) commit([], EMPTY_FORM); }   // 全消去は形成の記録も消す
  const applySnap = s => { items = s.items; form = s.form; };
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); applySnap(undoStack.pop()); emit(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); applySnap(redoStack.pop()); emit(); }

  /* ==== スタイルの唯一の解釈器 ====
     旧形式（fill: true/false）も新形式（"ink"|"paper"|"none" + stroke/sw/alpha/r）もここで正規化。
     render / export / app は item のスタイル欄を直接見ず、必ずこれを通す。
     不変条件: 手描きstroke・line図形・開いたpen は塗らない（styleOfが強制する） */
  const isFiniteNum = v => typeof v === "number" && isFinite(v);
  function styleOf(item) {
    const sw = isFiniteNum(item.sw) && item.sw > 0 ? Math.min(item.sw, 24) : Geom.W_BASE;
    const alpha = isFiniteNum(item.alpha) ? Math.min(Math.max(item.alpha, 0.05), 1) : 1;
    if (item.kind !== "shape") return { fill: "none", stroke: "ink", sw, alpha, r: 0 };
    const r = isFiniteNum(item.r) && item.r > 0 ? item.r : 0;
    const fillable = item.shape !== "line" && !(item.shape === "path" && !item.closed);
    const fill = !fillable ? "none"
      : item.fill === "paper" ? "paper"
      : (item.fill === true || item.fill === "ink") ? "ink"
      : "none";
    // 旧形式の含意: solid(true)=輪郭なし / outline(false)=輪郭あり。明示指定があれば優先
    // ※ stroke に paper（白抜きの線）は持たせない: 隠し線の役目はガイドが担う（2026-07-25の判断）
    let stroke = item.stroke === "none" ? "none"
      : item.stroke === "ink" ? "ink"
      : (fill === "none" ? "ink" : "none");
    if (fill === "none" && stroke === "none") stroke = "ink";   // 不可視itemを作らない
    return { fill, stroke, sw, alpha, r };
  }

  /* ==== JSON入出力（localStorage・ファイル書き出し共用） ==== */
  const BOX_SHAPES = ["line", "rect", "ellipse", "polygon"];   // bbox指定の図形
  const sanFill = v => (v === true || v === false || v === "ink" || v === "paper" || v === "none") ? v : undefined;
  const sanStroke = v => (v === "ink" || v === "none") ? v : undefined;
  // スタイル欄は「あるものだけ」書く/読む（省略時はstyleOfの既定に落ちる=後方互換）
  function styleFields(it) {
    const o = {};
    if (sanFill(it.fill) !== undefined) o.fill = it.fill;
    if (sanStroke(it.stroke) !== undefined) o.stroke = it.stroke;
    if (isFiniteNum(it.sw) && it.sw > 0) o.sw = it.sw;
    if (isFiniteNum(it.alpha)) o.alpha = it.alpha;
    if (isFiniteNum(it.r) && it.r > 0) o.r = it.r;
    if (it.still === true) o.still = true;   // 静止（対称展開に参加しない＝地）
    return o;
  }
  const validRing = ring => Array.isArray(ring) && ring.length >= 3 &&
    ring.every(p => Array.isArray(p) && isFiniteNum(p[0]) && isFiniteNum(p[1]));
  function serializeItem(it) {
    if (it.kind === "stroke") return { kind: "stroke", raw: it.raw, mode: it.mode, ...styleFields(it) };
    if (it.kind === "shape") {
      const o = { kind: "shape", shape: it.shape, ...styleFields(it) };
      if (it.shape === "path") {
        o.points = it.points; o.closed = !!it.closed;
        if (Array.isArray(it.holes) && it.holes.length) o.holes = it.holes;
        if (it.curve) {   // 曲線（スムース点）: cornersは角のまま残す点のindex
          o.curve = true;
          if (Array.isArray(it.corners) && it.corners.length) o.corners = it.corners;
          // 曲線の解釈: 既定=centripetal Catmull-Rom（点が曲線に乗る）/ "bspline"=B-スプライン（乗らない）
          if (it.curveMode === "bspline") o.curveMode = "bspline";
        }
      }
      else { o.x0 = it.x0; o.y0 = it.y0; o.x1 = it.x1; o.y1 = it.y1; o.sides = it.sides; }
      return o;
    }
    return { kind: "image", dataURL: it.dataURL, w: it.w, h: it.h };
  }
  function toJSON(opt = {}) {
    const o = {
      v: 2,   // v1（boolean fill）も fromJSON で読める。書き出しは常に v2
      items: items
        .filter(it => !(opt.noImages && it.kind === "image"))
        .map(serializeItem),
    };
    if (hasForm()) o.form = form;   // 形成の記録もドキュメントの一部（無いときは書かない=旧形式と同じ見た目）
    return o;
  }
  // 形成の記録の検証: [[ [x,y], ... ], ...]（size正規化された0..1のビュー座標）
  const validOrbit = o => Array.isArray(o) && o.length &&
    o.every(p => Array.isArray(p) && p.length === 2 && p.every(isFiniteNum));
  function sanitizeForm(f) {
    if (!f || typeof f !== "object") return EMPTY_FORM;
    const pick = k => Array.isArray(f[k]) ? f[k].filter(validOrbit) : [];
    return Object.freeze({ cuts: pick("cuts"), merges: pick("merges"), edges: pick("edges") });
  }

  function validItem(it) {
    if (it.kind === "stroke") return Array.isArray(it.raw);
    if (it.kind === "shape") {
      if (it.shape === "path") return Array.isArray(it.points) && it.points.length >= 2 &&
        it.points.every(p => Array.isArray(p) && isFiniteNum(p[0]) && isFiniteNum(p[1]));
      return BOX_SHAPES.includes(it.shape) && [it.x0, it.y0, it.x1, it.y1].every(isFiniteNum);
    }
    if (it.kind === "image") return typeof it.dataURL === "string";
    return false;
  }
  function deserializeItem(it) {
    const sty = styleFields(it);
    if (it.kind === "stroke") return { kind: "stroke", raw: it.raw, ...sty };   // 旧mode欄は捨てる（強弱は廃止）
    if (it.kind === "shape") {
      if (it.shape === "path") {
        const o = { kind: "shape", shape: "path", points: it.points.map(p => [p[0], p[1]]), closed: !!it.closed, ...sty };
        const holes = Array.isArray(it.holes) ? it.holes.filter(validRing).map(ring => ring.map(p => [p[0], p[1]])) : [];
        if (holes.length) o.holes = holes;
        if (it.curve) {
          o.curve = true;
          const cs = Array.isArray(it.corners) ? it.corners.filter(c => Number.isInteger(c) && c >= 0 && c < o.points.length) : [];
          if (cs.length) o.corners = cs;
          if (it.curveMode === "bspline") o.curveMode = "bspline";
        }
        return o;
      }
      return { kind: "shape", shape: it.shape, x0: it.x0, y0: it.y0, x1: it.x1, y1: it.y1, sides: it.sides || 6, ...sty };
    }
    return { kind: "image", dataURL: it.dataURL, w: it.w, h: it.h };
  }
  function fromJSON(data, { asEdit = true } = {}) {
    if (!data || (data.v !== 1 && data.v !== 2) || !Array.isArray(data.items)) throw new Error("不明なJSON形式");
    const next = data.items.filter(validItem).map(it => Object.freeze(deserializeItem(it)));
    const nextForm = sanitizeForm(data.form);   // 別ドキュメントを読んだら形成の記録も入れ替わる
    if (asEdit) commit(next, nextForm);
    else { items = next; form = nextForm; emit(); }   // 起動時復元はundo履歴に積まない
  }

  /* ==== localStorage 自動保存（500msデバウンス + quota対策） ==== */
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }
  function saveNow() {
    clearTimeout(saveTimer);   // 保留中のデバウンスを消して二重保存を防ぐ
    const before = persistState;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(toJSON()));
      persistState = "ok";
    } catch (e) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(toJSON({ noImages: true })));
        persistState = "degraded";   // 画像はサイズ超過のため保存対象外
      } catch (e2) {
        persistState = "memory";
      }
    }
    if (persistState !== before) persistListeners.forEach(fn => fn());   // quota→degraded等を即通知
  }
  // タブを閉じる/隠す直前に確実に書き込む（500msデバウンスの取りこぼしを防ぐ）
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", saveNow);
    window.addEventListener("visibilitychange", () => { if (document.hidden) saveNow(); });
  }
  function restore() {
    try {
      // v2優先。無ければ旧キー（v1）から片道移行（旧キーは消さない=旧ビルドを壊さない）
      const raw = localStorage.getItem(LS_KEY) || localStorage.getItem(LS_KEY_V1);
      if (raw) fromJSON(JSON.parse(raw), { asEdit: false });
    } catch (e) {
      console.warn("復元に失敗:", e);
    }
  }

  return {
    get items() { return items; },
    get form() { return form; },          // 形成の記録（読み取り専用。更新は setForm）
    get persistState() { return persistState; },
    add, addMany, removeAt, removeMany, replaceAt, replaceMany, replaceWith, reorder, clear, undo, redo,
    setForm, hasForm,
    styleOf,   // itemスタイルの唯一の解釈器（render/export/appはこれを通す）
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    onChange: fn => listeners.push(fn),
    onPersist: fn => persistListeners.push(fn),   // 保存状態(ok/degraded/memory)が変わったとき
    toJSON, fromJSON, restore,
  };
})();
