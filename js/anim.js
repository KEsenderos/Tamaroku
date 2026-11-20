'use strict';
// anim.js（球録 v0.3）シルエットの打者と、打撃のモーション（11.4）。SVGの図形だけで描く（画像・既存の絵は使わない。顔・背番号は描かない）
const SVGNS = 'http://www.w3.org/2000/svg';
const ZX0 = 85, ZY0 = 70, ZCELL = 30;            // ゾーンの図（5×5）の左上と1マスの大きさ（SVGの座標）
const BALL_START = [160, 34];
const T_HIT = 0.57;                               // 球がゾーンに着く（打つ）瞬間（0〜1）
const GROUND_Y = 286;

function svgNode(tag, attrs, kids) {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, String(attrs[k])); });
  if (kids) (Array.isArray(kids) ? kids : [kids]).forEach(function (c) { if (c) e.appendChild(c); });
  return e;
}
function lerp(a, b, k) { return a + (b - a) * k; }
function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function easeIn(x) { x = clamp01(x); return x * x; }
function easeInOut(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
function easeOut(x) { x = clamp01(x); return 1 - (1 - x) * (1 - x); }
function cellCenter(row, col) { return [ZX0 + ZCELL * (col - 0.5), ZY0 + ZCELL * (row - 0.5)]; }

// ---- 打者の絵（動画から作った輪郭を、コマ送りで見せる）----
// 動画（右打者の素振り）を1コマずつ輪郭にして js/sprite.js に入れてある（作り方は tools/make_sprite.py）。
// 投手から見た絵。右打者を基準に描き、左打者は左右反転する。打つ瞬間のバットの高さ・位置は、球のマスにあわせて少しだけ体を伸び縮み・ずらして近づける（精密には合わせない）。
const SP_N = SPRITE_FRAMES.length;      // コマ数（動画の30コマ/秒のまま）
const SP_CONTACT = 45;                  // バットが球をとらえるコマ
const SP_PLANT = 33;                    // 足を踏み出し終えた（バットを振り出す前の）コマ
// 当たる瞬間のバットの芯の位置（絵の座標）。コマごと（振りの途中ほど体の近く、振り切るほど遠く）。球のマスにいちばん近いコマを「当たるコマ」に選ぶ
const SP_BARRELS = { 39: [206, 150], 40: [202, 154], 42: [168, 185], 43: [128, 193], 44: [127, 192], 45: [145, 181] };
const SP_FEET_X = 275, SP_GROUND = 290; // 体の軸（足もとの中心）と、靴底の高さ
const SP_STRIDED = 36;                  // 踏み出して、バットが動きだすコマ
const SP_FPT = 45;                      // スイング中の速さ（t が 1 進むあいだに進むコマ数。動画の速さ 36 の約1.25倍）
// 動き：時間 t（0〜1）→ コマ番号。足上げ・踏み出し → 振る（T_HIT で当たる）→ 振り抜いて肩に巻く（〜1）
function swingKeys(fc) { return [[0, 0], [0.03, 3], [T_HIT - (fc - SP_STRIDED) / SP_FPT, SP_STRIDED], [T_HIT, fc], [1, SP_N - 1]]; }
const SP_SWING_KEYS = swingKeys(SP_CONTACT);

function drawSilhouette(svg, side, mirror) {   // mirror=true：捕手から見た絵（図ぜんたいを左右反転。振り返り用）
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', '-30 -22 380 322');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '打者のシルエットとコース');
  const root = svgNode('g', { transform: mirror ? 'translate(320,0) scale(-1,1)' : '' });
  const zone = svgNode('g', { 'class': 'sil-zone' });
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 5; c++) {
    zone.appendChild(svgNode('rect', { x: ZX0 + ZCELL * (c - 1), y: ZY0 + ZCELL * (r - 1), width: ZCELL, height: ZCELL, 'class': isStrikeZone(r, c) ? 'sz-in' : 'sz-out' }));
  }
  zone.appendChild(svgNode('rect', { x: ZX0 + ZCELL, y: ZY0 + ZCELL, width: ZCELL * 3, height: ZCELL * 3, 'class': 'sz-strike' }));
  root.appendChild(zone);
  const cellHit = svgNode('rect', { width: ZCELL, height: ZCELL, 'class': 'sz-hit', opacity: 0 });
  root.appendChild(cellHit);
  root.appendChild(svgNode('line', { x1: 20, y1: GROUND_Y + 6, x2: 300, y2: GROUND_Y + 6, 'class': 'sil-ground' }));
  const body = svgNode('g', { transform: side === 'L' ? 'translate(320,0) scale(-1,1)' : '' });
  const mk = function (tag, cls, extra) { const e = svgNode(tag, Object.assign({ 'class': cls }, extra || {})); return e; };
  const fig = svgNode('g', {});                                                    // 体を伸び縮み・ずらす入れ物
  const sprite = mk('path', 'sil-fill sil-sprite', { 'fill-rule': 'evenodd', d: SPRITE_FRAMES[0] });
  fig.appendChild(sprite); body.appendChild(fig);
  root.appendChild(body);
  const mitt = svgNode('ellipse', { rx: 17, ry: 13, 'class': 'sil-mitt', opacity: 0 });
  const impact = svgNode('polygon', { points: '', 'class': 'sil-impact', opacity: 0 });
  const trail = svgNode('polyline', { points: '', 'class': 'sil-trail', fill: 'none', 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0 });
  const ball = svgNode('circle', { r: 3, 'class': 'sil-ball', opacity: 0 });
  root.appendChild(trail); root.appendChild(mitt); root.appendChild(impact); root.appendChild(ball);
  svg.appendChild(root);
  const parts = { svg: svg, side: side, mirror: !!mirror, body: body, fig: fig, sprite: sprite, _f: 0, mitt: mitt, impact: impact, trail: trail, ball: ball, cellHit: cellHit };
  svg._parts = parts;
  renderFrame(parts, null, 0, false);
  return parts;
}

// 打者だけ（ゾーンなし）の、動かない絵。記録タブのゾーンのとなりに出す
function drawBatterOnly(svg, side) {
  const parts = drawSilhouette(svg, side, false);
  const z = svg.querySelector('.sil-zone'); if (z) z.parentNode.removeChild(z);
  svg.setAttribute('viewBox', (side === 'L' ? '-30' : '215') + ' -22 135 316');
  svg.setAttribute('aria-label', (side === 'L' ? '左' : '右') + '打者');
  return parts;
}

// 当たった瞬間の星の大きさ・長さ・とげの数。ふつう（ファウル・単打など）＜長打（二塁打・三塁打）＜本塁打
// 球種ごとの変化（ゾーン図の座標の px）。g = 投手の「グラブ側」への横の曲がり、d = 下への落ち。マイナスのgは、利き腕側（打者のほうへ）
const BREAK = { ST: { g: 0, d: 0 }, TW: { g: -10, d: 4 }, CT: { g: 10, d: 3 }, SL: { g: 34, d: 12 }, CV: { g: 16, d: 52 },
  FK: { g: 0, d: 40 }, CH: { g: -10, d: 22 }, SK: { g: -26, d: 16 }, SP: { g: 0, d: 30 } };
// 飛んでいる球の、まっすぐな道すじからのずれ。u = 0（手を離れた）〜1（ゾーン）。両はしは0で、後半にはっきり曲がって見えるよう、前半は反対側へふくらむ
function breakOffset(pitch, u) {
  const b = BREAK[pitch.pitchType] || { g: 0, d: 0 };
  const sx = (pitch.pitcher && pitch.pitcher.hand === 'L') ? 1 : -1;      // グラブ側が画面のどちらか（右投手は、画面の左）
  const k = -2.6 * u * (1 - u);                                           // 曲がる量の割合（マイナス＝曲がる向きと反対へ、いったんふくらむ）
  return [sx * b.g * k, b.d * k];
}
function impactKind(pitch) {
  const o = pitch && pitch.result === 'INPLAY' && pitch.inplay ? pitch.inplay.outcome : null;
  if (o === 'HR') return { scale: 3.6, span: 0.34, spikes: 12 };
  if (o === 'H2' || o === 'H3') return { scale: 2.2, span: 0.26, spikes: 10 };
  return { scale: 1, span: 0.18, spikes: 8 };
}
function foulScreenDir(pitch) {                    // 画面での飛ぶ向き（投手から見た絵。一塁側は画面の左）
  switch (pitch.foulDir) {
    case 'F1B': return [-1, 0];
    case 'F3B': return [1, 0];
    case 'FBK': return [0, -1];
    default: return [-0.6, -0.8];
  }
}
function isSwing(pitch) { return pitch.result === 'MISS' || pitch.result === 'FOUL' || pitch.result === 'INPLAY'; }

function keyf(keys, t) {                          // 折れ線（区切りごとの [時間, 値]）で、時間 t の値を出す
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) { const p = keys[i - 1], q = keys[i]; return lerp(p[1], q[1], (t - p[0]) / (q[0] - p[0])); }
  }
  return keys[keys.length - 1][1];
}
function clampR(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

// この球の、打者の姿勢（時間 t）。コマ番号 f（小数）と、体の伸び縮み・ずれ・かたむきを返す。pitch が null のときは構え。
// 見逃し（無反応）は動かない／見逃し（バットが出かかった・止めた）は途中まで振って戻る／空振り・ファウル・インプレーは振り抜く
function stateAt(pitch, t, side) {
  const S = { f: 0, sx: 1, sy: 1, dx: 0, lean: 0 };
  if (!pitch) return S;
  const swingKind = (pitch.result === 'MISS' || pitch.result === 'FOUL' || pitch.result === 'INPLAY');
  const react = pitch.reaction || (pitch.result === 'MISS' ? 'TIMED' : (pitch.result === 'TAKEN' ? 'NONE' : null));
  if (!swingKind && react !== 'BAT_OUT' && react !== 'CHECK') {
    if (pitch.result === 'HBP') S.lean = lerp(0, 8, easeOut((t - T_HIT) / 0.12));        // よける（体が打者の外側へかたむく）
    return S;                                                                            // ピクリとも動かない
  }
  const isBunt = !!(pitch.inplay && pitch.inplay.kind === 'BUNT');
  if (isBunt) { S.f = keyf([[0, 0], [0.03, 3], [0.37, 36], [0.5, 40], [1, 40]], t); return S; }   // バント：バットを前へ出して構えたまま
  if (!swingKind) {                                                                      // 途中まで振って止める → 少し間をおいて、構えに戻る
    const tCap = react === 'CHECK' ? 0.53 : 0.49;
    const fCap = keyf(SP_SWING_KEYS, tCap);
    const rec = easeInOut(clamp01((t - (tCap + 0.08)) / 0.22));
    S.f = t <= tCap ? keyf(SP_SWING_KEYS, t) : lerp(fCap, SP_PLANT, rec);
    return S;
  }
  const tShift = (pitch.result === 'MISS' && react === 'NO_TIMING') ? 0.13 : 0;          // 全くタイミングが合わない空振りは、振るのが遅れる
  // 球のマスにあわせて、「当たるコマ」を選び、体を少し伸び縮み・ずらす（当たる瞬間のバットの芯を、マスへ近づける）。空振りは、球の下（または上）を振る
  const c = cellCenter(pitch.row, pitch.col);
  const off = pitch.result === 'MISS' ? ((react === 'NO_TIMING' ? 38 : 22) * (pitch.row <= 3 ? 1 : -1)) : 0;
  const cxb = side === 'L' ? 320 - c[0] : c[0], cyb = c[1] + off;
  let best = null;
  Object.keys(SP_BARRELS).forEach(function (k) {
    const B = SP_BARRELS[k];
    const sy = clampR(1 + 0.35 * ((SP_GROUND - cyb) / (SP_GROUND - B[1]) - 1), 0.92, 1.10);
    const sx = clampR(1 + 0.3 * ((SP_FEET_X - cxb) / (SP_FEET_X - B[0]) - 1), 0.9, 1.1);
    const dx = clampR((cxb - B[0]) * 0.3, -16, 16);
    const px = dx + SP_FEET_X + sx * (B[0] - SP_FEET_X), py = SP_GROUND + sy * (B[1] - SP_GROUND);
    const d = Math.sqrt((px - cxb) * (px - cxb) + (py - cyb) * (py - cyb));
    if (!best || d < best.d) best = { d: d, f: +k, sx: sx, sy: sy, dx: dx };
  });
  S.f = keyf(swingKeys(best.f), clamp01(t - tShift));
  const k = easeInOut(clamp01(t / 0.5));
  S.sx = lerp(1, best.sx, k); S.sy = lerp(1, best.sy, k); S.dx = lerp(0, best.dx, k);
  return S;
}

// t（0〜1）の姿勢を描く。pitch が null のときは、構えだけ（球なし）
function renderFrame(parts, pitch, t, still) {
  const side = parts.side;
  const bxm = function (x) { return side === 'L' ? 320 - x : x; };   // 打者側の座標 → 画面の座標
  parts.mitt.setAttribute('opacity', 0); parts.impact.setAttribute('opacity', 0); parts.ball.setAttribute('opacity', 0); parts.cellHit.setAttribute('opacity', 0); parts.trail.setAttribute('opacity', 0);
  if (pitch) {
    const c = cellCenter(pitch.row, pitch.col), cx = c[0], cy = c[1];
    // 球
    let bx, by, br = 7, bo = 1;
    if (t < T_HIT) {
      const e = Math.pow(t / T_HIT, 1.6);
      bx = lerp(BALL_START[0], cx, e); by = lerp(BALL_START[1], cy, e); br = lerp(3, 7, e);
      const bo2 = breakOffset(pitch, e); bx += bo2[0]; by += bo2[1];
    } else {
      const w = clamp01((t - T_HIT) / (1 - T_HIT));
      bx = cx; by = cy;
      if (pitch.result === 'FOUL' && pitch.foulType === 'OWN_BALL') {
        bx = lerp(cx, bxm(262), easeIn(w)); by = lerp(cy, GROUND_Y - 4, easeIn(w)); br = 6;
      } else if (pitch.result === 'FOUL') {
        const d = foulScreenDir(pitch), far = pitch.foulDir === 'FBK' ? 260 : 140;       // 後方（バックネット）へのファウルは、真上へ高く上がる
        const ww = pitch.foulDir === 'FBK' ? w : easeOut(w);
        bx = cx + d[0] * far * ww; by = cy + d[1] * far * ww; br = lerp(7, 3, w); bo = pitch.foulDir === 'FBK' ? 1 - 0.3 * w : 1 - 0.7 * w;
      } else if (pitch.result === 'INPLAY') {
        const sgn = (pitch.inplay && FIELD_POINTS[pitch.inplay.dir] && FIELD_POINTS[pitch.inplay.dir][0] > 50) ? -1 : 1;
        bx = cx + sgn * 60 * easeOut(w); by = cy - 110 * easeOut(w); br = lerp(7, 3, w); bo = 1 - w;
      }
    }
    if (t >= 0.01 && pitch.result !== undefined) {                       // 球の通ってきた道すじ（うすい線）
      const tt = Math.min(t, T_HIT), pts = [];
      for (let i = 0; i <= 12; i++) {
        const u = Math.pow((tt / T_HIT) * i / 12, 1.6), o = breakOffset(pitch, u);
        pts.push((lerp(BALL_START[0], cx, u) + o[0]).toFixed(1) + ',' + (lerp(BALL_START[1], cy, u) + o[1]).toFixed(1));
      }
      parts.trail.setAttribute('points', pts.join(' ')); parts.trail.setAttribute('opacity', 0.55);
      parts.trail.style.stroke = (typeof typeInfo === 'function') ? typeInfo(pitch.pitchType).color : '#E5E7EB';
    }
    parts.ball.setAttribute('cx', bx.toFixed(1)); parts.ball.setAttribute('cy', by.toFixed(1)); parts.ball.setAttribute('r', br.toFixed(1));
    parts.ball.setAttribute('opacity', (t < 0.01 ? 0 : bo).toFixed(2));
    parts.ball.style.fill = (typeof typeInfo === 'function') ? typeInfo(pitch.pitchType).color : '#E5E7EB';
    if (pitch.result === 'TAKEN' || pitch.result === 'MISS') {
      parts.mitt.setAttribute('cx', cx); parts.mitt.setAttribute('cy', cy + 3);
      parts.mitt.setAttribute('opacity', (0.55 * clamp01((t - T_HIT) / 0.1)).toFixed(2));
    }
    if (t >= T_HIT && (pitch.result === 'FOUL' || pitch.result === 'INPLAY' || pitch.result === 'HBP')) {
      const ik = impactKind(pitch);                                                // 当たりの大きさ：ふつう／長打（二塁打・三塁打）／本塁打
      const w = clamp01((t - T_HIT) / ik.span);
      const R0 = 6 + 14 * ik.scale * w, pts = [], n = ik.spikes;
      for (let i = 0; i < n * 2; i++) { const r = (i % 2 === 0) ? R0 : R0 * 0.45, an = Math.PI * 2 * i / (n * 2); pts.push((cx + Math.cos(an) * r).toFixed(1) + ',' + (cy + Math.sin(an) * r).toFixed(1)); }
      parts.impact.setAttribute('points', pts.join(' '));
      parts.impact.setAttribute('opacity', (1 - w).toFixed(2));
    }
    if (t >= T_HIT) { parts.cellHit.setAttribute('x', ZX0 + ZCELL * (pitch.col - 1)); parts.cellHit.setAttribute('y', ZY0 + ZCELL * (pitch.row - 1)); parts.cellHit.setAttribute('opacity', 1); }
  }
  applySprite(parts, stateAt(pitch, pitch ? t : 0, parts.side));
}

function applySprite(parts, S) {
  const fi = Math.max(0, Math.min(SP_N - 1, Math.round(S.f)));
  if (parts._f !== fi) { parts._f = fi; parts.sprite.setAttribute('d', SPRITE_FRAMES[fi]); }
  const tf = 'translate(' + S.dx.toFixed(1) + ' 0)' + (S.lean ? ' rotate(' + S.lean.toFixed(1) + ' ' + SP_FEET_X + ' ' + SP_GROUND + ')' : '') +
    ' translate(' + SP_FEET_X + ' ' + SP_GROUND + ') scale(' + S.sx.toFixed(3) + ' ' + S.sy.toFixed(3) + ') translate(' + (-SP_FEET_X) + ' ' + (-SP_GROUND) + ')';
  parts.fig.setAttribute('transform', tf);
}

// ---- 打球の行き先（野球場の小さな図）----
function drawField(svg) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', '0 0 100 104');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '打球の行き先');
  svg.appendChild(svgNode('path', { d: 'M 50 90 L 2 42 Q 50 -26 98 42 Z', 'class': 'fd-grass' }));
  svg.appendChild(svgNode('path', { d: 'M 50 90 L 72 68 L 50 46 L 28 68 Z', 'class': 'fd-dirt' }));
  svg.appendChild(svgNode('path', { d: 'M 2 42 Q 50 -26 98 42', 'class': 'fd-wall' }));
  [[72, 68], [50, 46], [28, 68], [50, 90]].forEach(function (b) { svg.appendChild(svgNode('rect', { x: b[0] - 2.5, y: b[1] - 2.5, width: 5, height: 5, 'class': 'fd-base', transform: 'rotate(45 ' + b[0] + ' ' + b[1] + ')' })); });
  const trail = svgNode('path', { d: '', 'class': 'fd-trail' });
  const arrow = svgNode('polygon', { points: '', 'class': 'fd-arrow', opacity: 0 });
  const ball = svgNode('circle', { r: 2.6, 'class': 'fd-ball', opacity: 0 });
  const label = svgNode('text', { x: 50, y: 103, 'text-anchor': 'middle', 'class': 'fd-label' });
  svg.appendChild(trail); svg.appendChild(arrow); svg.appendChild(ball); svg.appendChild(label);
  svg._fparts = { trail: trail, arrow: arrow, ball: ball, label: label };
  return svg._fparts;
}
// 行き先（SVG座標）。決まらないときは null（見逃し・空振り・カット・自打球など）
function fieldDest(pitch) {
  if (!pitch) return null;
  const h = FIELD_HOME;
  if (pitch.result === 'INPLAY' && pitch.inplay && FIELD_POINTS[pitch.inplay.dir]) {
    const pt = FIELD_POINTS[pitch.inplay.dir];
    let f = 1;
    if (pitch.inplay.kind === 'BUNT') f = BUNT_FACTOR;
    else if (FLY_FACTOR[pitch.inplay.kind]) f = FLY_FACTOR[pitch.inplay.kind];
    if (pitch.inplay.outcome === 'HR') f = HR_FACTOR;
    return { x: h[0] + (pt[0] - h[0]) * f, y: h[1] + (pt[1] - h[1]) * f, fly: !!FLY_FACTOR[pitch.inplay.kind] || pitch.inplay.outcome === 'HR', foul: false };
  }
  if (pitch.result === 'FOUL' && pitch.foulDir && FOUL_POINTS[pitch.foulDir]) {
    const pt = FOUL_POINTS[pitch.foulDir];
    return { x: pt[0], y: pt[1], fly: false, foul: true };
  }
  return null;
}
function renderField(fparts, pitch, t, still) {
  const d = fieldDest(pitch);
  fparts.ball.setAttribute('opacity', 0); fparts.arrow.setAttribute('opacity', 0);
  fparts.trail.setAttribute('d', '');
  fparts.label.textContent = '';
  if (!d) return;
  const h = FIELD_HOME;
  const w = still ? 1 : clamp01((t - T_HIT) / (0.95 - T_HIT));
  if (!still && t < T_HIT) return;
  const e = easeOut(w);
  const x = lerp(h[0], d.x, e), y = lerp(h[1], d.y, e);
  fparts.trail.setAttribute('d', 'M ' + h[0] + ' ' + h[1] + ' L ' + x.toFixed(1) + ' ' + y.toFixed(1));
  fparts.trail.setAttribute('class', 'fd-trail' + (d.fly ? ' fly' : '') + (d.foul ? ' foul' : ''));
  const bump = d.fly ? 2.8 * Math.sin(Math.PI * w) : 0;
  fparts.ball.setAttribute('cx', x.toFixed(1)); fparts.ball.setAttribute('cy', y.toFixed(1));
  fparts.ball.setAttribute('r', (2.6 + bump).toFixed(1)); fparts.ball.setAttribute('opacity', 1);
  if (still) {                                   // 動きを減らす設定：1枚絵と、行き先の矢印
    const ang = Math.atan2(d.y - h[1], d.x - h[0]);
    const tip = [d.x, d.y], L = 6;
    const p1 = [tip[0] - Math.cos(ang - 0.45) * L, tip[1] - Math.sin(ang - 0.45) * L], p2 = [tip[0] - Math.cos(ang + 0.45) * L, tip[1] - Math.sin(ang + 0.45) * L];
    fparts.arrow.setAttribute('points', tip.join(',') + ' ' + p1.map(function (v) { return v.toFixed(1); }).join(',') + ' ' + p2.map(function (v) { return v.toFixed(1); }).join(','));
    fparts.arrow.setAttribute('opacity', 1);
  }
}

function reducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
}
// 1球の動きを再生する（長さ MOTION_MS）。opts: { field: 行き先の図のsvg }。戻り値：{ stop() }
function playMotion(svg, pitch, opts) {
  const parts = svg._parts;
  if (!parts) return null;
  const fsvg = opts && opts.field;
  const fparts = fsvg ? (fsvg._fparts || drawField(fsvg)) : null;
  if (svg._raf) { cancelAnimationFrame(svg._raf); svg._raf = 0; }
  const draw = function (t, still) { renderFrame(parts, pitch, t, still); if (fparts) renderField(fparts, pitch, t, still); };
  if (!pitch) { draw(0, false); return { stop: function () {} }; }
  if (reducedMotion()) { draw(1, true); return { stop: function () {} }; }
  const start = performance.now();
  const tick = function (now) {
    const t = clamp01((now - start) / MOTION_MS);
    draw(t, false);
    if (t < 1) svg._raf = requestAnimationFrame(tick); else svg._raf = 0;
  };
  svg._raf = requestAnimationFrame(tick);
  return { stop: function () { if (svg._raf) { cancelAnimationFrame(svg._raf); svg._raf = 0; } } };
}
