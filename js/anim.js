'use strict';
// anim.js（球録 v0.1.4）シルエットの打者と、打撃のモーション（11.4）。SVGの図形だけで描く（画像・既存の絵は使わない。顔・背番号は描かない）
const SVGNS = 'http://www.w3.org/2000/svg';
const ZX0 = 85, ZY0 = 70, ZCELL = 30;            // ゾーンの図（5×5）の左上と1マスの大きさ（SVGの座標）
const BAT_LEN = 118;
const SHOULDER = [288, 128];
const HIP = [290, 190];
const READY_HAND = [266, 112];
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
function easeOut(x) { x = clamp01(x); return 1 - (1 - x) * (1 - x); }
function cellCenter(row, col) { return [ZX0 + ZCELL * (col - 0.5), ZY0 + ZCELL * (row - 0.5)]; }

// ---- 打者の絵（右打者を基準。左打者は左右反転）----
function drawSilhouette(svg, side) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', '-30 -40 380 340');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '打者のシルエットとコース');
  const zone = svgNode('g', { 'class': 'sil-zone' });
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 5; c++) {
    zone.appendChild(svgNode('rect', { x: ZX0 + ZCELL * (c - 1), y: ZY0 + ZCELL * (r - 1), width: ZCELL, height: ZCELL, 'class': isStrikeZone(r, c) ? 'sz-in' : 'sz-out' }));
  }
  zone.appendChild(svgNode('rect', { x: ZX0 + ZCELL, y: ZY0 + ZCELL, width: ZCELL * 3, height: ZCELL * 3, 'class': 'sz-strike' }));
  svg.appendChild(zone);
  const cellHit = svgNode('rect', { width: ZCELL, height: ZCELL, 'class': 'sz-hit', opacity: 0 });
  svg.appendChild(cellHit);
  svg.appendChild(svgNode('line', { x1: 20, y1: GROUND_Y + 6, x2: 300, y2: GROUND_Y + 6, 'class': 'sil-ground' }));
  // 打者（右打者の座標で描き、左打者は左右反転）
  const body = svgNode('g', { transform: side === 'L' ? 'translate(320,0) scale(-1,1)' : '' });
  body.appendChild(svgNode('path', { d: 'M ' + HIP[0] + ' ' + HIP[1] + ' L 258 ' + GROUND_Y, 'class': 'sil-limb', 'stroke-width': 15 }));        // 前の脚（ゾーン側）
  body.appendChild(svgNode('path', { d: 'M ' + HIP[0] + ' ' + HIP[1] + ' L 308 ' + GROUND_Y, 'class': 'sil-limb', 'stroke-width': 15 }));        // うしろの脚
  const lean = svgNode('g', {});
  lean.appendChild(svgNode('path', { d: 'M ' + HIP[0] + ' ' + HIP[1] + ' L 288 118', 'class': 'sil-limb', 'stroke-width': 30 }));                  // 胴
  lean.appendChild(svgNode('circle', { cx: 286, cy: 92, r: 17, 'class': 'sil-fill' }));                                                         // 頭
  lean.appendChild(svgNode('path', { d: 'M 269 90 L 262 94 L 270 98 Z', 'class': 'sil-fill' }));                                               // ヘルメットのつば
  const arms = svgNode('path', { d: '', 'class': 'sil-limb', 'stroke-width': 11, fill: 'none' });
  const bat = svgNode('polygon', { points: '', 'class': 'sil-fill' });
  lean.appendChild(arms); lean.appendChild(bat);
  body.appendChild(lean);
  svg.appendChild(body);
  // 球・ミット・当たった印
  const mitt = svgNode('ellipse', { rx: 17, ry: 13, 'class': 'sil-mitt', opacity: 0 });
  const impact = svgNode('polygon', { points: '', 'class': 'sil-impact', opacity: 0 });
  const ball = svgNode('circle', { r: 3, 'class': 'sil-ball', opacity: 0 });
  svg.appendChild(mitt); svg.appendChild(impact); svg.appendChild(ball);
  const parts = { svg: svg, side: side, body: body, lean: lean, arms: arms, bat: bat, mitt: mitt, impact: impact, ball: ball, cellHit: cellHit };
  svg._parts = parts;
  renderFrame(parts, null, 0, false);
  return parts;
}

function setBat(parts, px, py, aDeg) {
  const a = aDeg * Math.PI / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const nx = -dy, ny = dx;
  const K = [px - dx * 12, py - dy * 12], H = [px + dx * 40, py + dy * 40], T = [px + dx * BAT_LEN, py + dy * BAT_LEN];
  const pts = [
    [K[0] + nx * 3, K[1] + ny * 3], [H[0] + nx * 3.5, H[1] + ny * 3.5], [T[0] + nx * 6.5, T[1] + ny * 6.5],
    [T[0] - nx * 6.5, T[1] - ny * 6.5], [H[0] - nx * 3.5, H[1] - ny * 3.5], [K[0] - nx * 3, K[1] - ny * 3]
  ];
  parts.bat.setAttribute('points', pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '));
  // 腕：肩 → ひじ → 手（ひじは、下側へ少し出す）
  const vx = px - SHOULDER[0], vy = py - SHOULDER[1];
  const len = Math.sqrt(vx * vx + vy * vy) || 1;
  let ex = -vy / len, ey = vx / len;
  if (ey < 0) { ex = -ex; ey = -ey; }
  const E = [(SHOULDER[0] + px) / 2 + ex * 14, (SHOULDER[1] + py) / 2 + ey * 14];
  parts.arms.setAttribute('d', 'M ' + SHOULDER[0] + ' ' + SHOULDER[1] + ' L ' + E[0].toFixed(1) + ' ' + E[1].toFixed(1) + ' L ' + px.toFixed(1) + ' ' + py.toFixed(1));
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

// t（0〜1）の姿勢を描く。pitch が null のときは、構えだけ（球なし）
function renderFrame(parts, pitch, t, still) {
  const side = parts.side;
  const bxm = function (x) { return side === 'L' ? 320 - x : x; };   // 打者側の座標 → 画面の座標
  let px = READY_HAND[0], py = READY_HAND[1], a = -72, leanDeg = 0;
  parts.mitt.setAttribute('opacity', 0); parts.impact.setAttribute('opacity', 0); parts.ball.setAttribute('opacity', 0); parts.cellHit.setAttribute('opacity', 0);
  if (pitch) {
    const c = cellCenter(pitch.row, pitch.col), cx = c[0], cy = c[1];
    const bunt = !!(pitch.inplay && pitch.inplay.kind === 'BUNT');
    if (isSwing(pitch)) {
      const off = pitch.result === 'MISS' ? (pitch.row <= 3 ? 22 : -22) : 0;      // 空振りは、球の下（または上）を振る
      const cpx = Math.max(232, Math.min(266, cx + BAT_LEN * 0.75)), cpy = cy + off;
      const tau = clamp01((t - 0.30) / 0.45);
      if (bunt) {
        const k = easeOut(tau / 0.5);
        a = lerp(-72, -180, k); px = lerp(READY_HAND[0], cpx + 8, k); py = lerp(READY_HAND[1], cpy, k);
      } else if (tau < 0.6) {
        const k = easeIn(tau / 0.6);
        a = lerp(-72, -180, k); px = lerp(READY_HAND[0], cpx, k); py = lerp(READY_HAND[1], cpy, k);
      } else {
        const k = easeOut((tau - 0.6) / 0.4);
        a = lerp(-180, -222, k); px = lerp(cpx, cpx - 12, k); py = lerp(cpy, cpy - 16, k);
      }
    }
    if (pitch.result === 'HBP') leanDeg = lerp(0, 10, easeOut((t - T_HIT) / 0.12));
    // 球
    let bx, by, br = 7, bo = 1;
    if (t < T_HIT) {
      const e = Math.pow(t / T_HIT, 1.6);
      bx = lerp(BALL_START[0], cx, e); by = lerp(BALL_START[1], cy, e); br = lerp(3, 7, e);
    } else {
      const w = clamp01((t - T_HIT) / (1 - T_HIT));
      bx = cx; by = cy;
      if (pitch.result === 'FOUL' && pitch.foulType === 'OWN_BALL') {
        bx = lerp(cx, bxm(262), easeIn(w)); by = lerp(cy, GROUND_Y - 4, easeIn(w)); br = 6;
      } else if (pitch.result === 'FOUL') {
        const d = foulScreenDir(pitch);
        bx = cx + d[0] * 140 * easeOut(w); by = cy + d[1] * 140 * easeOut(w); br = lerp(7, 3, w); bo = 1 - 0.7 * w;
      } else if (pitch.result === 'INPLAY') {
        const sgn = (pitch.inplay && FIELD_POINTS[pitch.inplay.dir] && FIELD_POINTS[pitch.inplay.dir][0] > 50) ? -1 : 1;
        bx = cx + sgn * 60 * easeOut(w); by = cy - 110 * easeOut(w); br = lerp(7, 3, w); bo = 1 - w;
      }
    }
    parts.ball.setAttribute('cx', bx.toFixed(1)); parts.ball.setAttribute('cy', by.toFixed(1)); parts.ball.setAttribute('r', br.toFixed(1));
    parts.ball.setAttribute('opacity', (t < 0.01 ? 0 : bo).toFixed(2));
    parts.ball.style.fill = (typeof typeInfo === 'function') ? typeInfo(pitch.pitchType).color : '#E5E7EB';
    // ミット（見逃し・空振りのとき、球が収まる）
    if (pitch.result === 'TAKEN' || pitch.result === 'MISS') {
      parts.mitt.setAttribute('cx', cx); parts.mitt.setAttribute('cy', cy + 3);
      parts.mitt.setAttribute('opacity', (0.55 * clamp01((t - T_HIT) / 0.1)).toFixed(2));
    }
    // 当たった印（打った・死球）
    if (t >= T_HIT && (pitch.result === 'FOUL' || pitch.result === 'INPLAY' || pitch.result === 'HBP')) {
      const w = clamp01((t - T_HIT) / 0.18);
      const R0 = 6 + 14 * w, pts = [];
      for (let i = 0; i < 16; i++) { const r = (i % 2 === 0) ? R0 : R0 * 0.45, an = Math.PI * 2 * i / 16; pts.push((cx + Math.cos(an) * r).toFixed(1) + ',' + (cy + Math.sin(an) * r).toFixed(1)); }
      parts.impact.setAttribute('points', pts.join(' '));
      parts.impact.setAttribute('opacity', (1 - w).toFixed(2));
    }
    // 球が着いたマスの強調
    if (t >= T_HIT) { parts.cellHit.setAttribute('x', ZX0 + ZCELL * (pitch.col - 1)); parts.cellHit.setAttribute('y', ZY0 + ZCELL * (pitch.row - 1)); parts.cellHit.setAttribute('opacity', 1); }
  }
  setBat(parts, px, py, a);
  parts.lean.setAttribute('transform', leanDeg ? 'rotate(' + leanDeg.toFixed(1) + ' ' + HIP[0] + ' ' + HIP[1] + ')' : '');
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
