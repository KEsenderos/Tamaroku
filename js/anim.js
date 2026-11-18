'use strict';
// anim.js（球録 v0.1.6）シルエットの打者と、打撃のモーション（11.4）。SVGの図形だけで描く（画像・既存の絵は使わない。顔・背番号は描かない）
const SVGNS = 'http://www.w3.org/2000/svg';
const ZX0 = 85, ZY0 = 70, ZCELL = 30;            // ゾーンの図（5×5）の左上と1マスの大きさ（SVGの座標）
const BAT_LEN = 108;
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
// 投手から見た絵。右打者は、ゾーンの右側（三塁側）に立ち、体はホームベース（画面の左）へ向け、顔は投手（こちら）へ向ける。
// バットは、うしろの肩（画面の右）の上に構える。骨格（肩・ひじ・手・腰・ひざ・足）を計算して、1コマずつ描く。
const CX = 290, HIPY = 192, HEAD_R = 16, ARM1 = 48, ARM2 = 46, LEG1 = 56, LEG2 = 56;
const FOOT_F0 = [254, GROUND_Y], FOOT_B0 = [322, GROUND_Y];
const HAND_READY = [308, 96];                   // 構えたときの手の位置（うしろの耳のあたり）
const BAT_READY = [-0.08, -1];                  // 構えたときのバットの向き（ほぼ真上）
const LOAD_HAND = [HAND_READY[0] + 10, HAND_READY[1] - 6];   // テイクバック：手を後ろ（うしろの肩のほう）へ引く
const LOAD_BAT = [0.2, -1];                      // テイクバック：バットが少しうしろへ寝る
const LOAD_HW = 18, LOAD_LEAN = 4;               // テイクバック：肩を入れて（ひねって）、体をわずかに後ろへ引く
const T_SWING = 0.36;                            // スイングを始める時間（それまでが、足上げとテイクバック）

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
  const legB = mk('path', 'sil-limb', { 'stroke-width': 17 }), legF = mk('path', 'sil-limb', { 'stroke-width': 17 });
  const footB = mk('ellipse', 'sil-fill', { rx: 13, ry: 5 }), footF = mk('ellipse', 'sil-fill', { rx: 13, ry: 5 });
  const lean = svgNode('g', {});
  const torso = mk('polygon', 'sil-fill sil-round', { points: '', 'stroke-width': 12 });
  const neck = mk('path', 'sil-limb', { 'stroke-width': 12 });
  const head = mk('circle', 'sil-fill', { r: HEAD_R });
  const brim = mk('polygon', 'sil-fill', { points: '' });
  const armBh = mk('path', 'sil-halo', { 'stroke-width': 17 }), armB = mk('path', 'sil-limb', { 'stroke-width': 12 });
  const armFh = mk('path', 'sil-halo', { 'stroke-width': 17 }), armF = mk('path', 'sil-limb', { 'stroke-width': 12 });
  const batH = mk('polygon', 'sil-halo-fill', { points: '' }), bat = mk('polygon', 'sil-fill', { points: '' });
  [torso, neck, head, brim, armBh, armB, armFh, armF, batH, bat].forEach(function (e) { lean.appendChild(e); });
  [legB, legF, footB, footF, lean].forEach(function (e) { body.appendChild(e); });
  root.appendChild(body);
  const mitt = svgNode('ellipse', { rx: 17, ry: 13, 'class': 'sil-mitt', opacity: 0 });
  const impact = svgNode('polygon', { points: '', 'class': 'sil-impact', opacity: 0 });
  const ball = svgNode('circle', { r: 3, 'class': 'sil-ball', opacity: 0 });
  root.appendChild(mitt); root.appendChild(impact); root.appendChild(ball);
  svg.appendChild(root);
  const parts = { svg: svg, side: side, mirror: !!mirror, body: body, lean: lean, legB: legB, legF: legF, footB: footB, footF: footF, torso: torso, neck: neck, head: head, brim: brim,
    armB: armB, armBh: armBh, armF: armF, armFh: armFh, bat: bat, batH: batH, mitt: mitt, impact: impact, ball: ball, cellHit: cellHit };
  svg._parts = parts;
  renderFrame(parts, null, 0, false);
  return parts;
}

// 2つの骨（長さ L1, L2）で、始点 S から終点 P まで届くときの、関節（ひじ・ひざ）の位置。pick(n) が大きい向きに曲げる
function bend(S, P, L1, L2, pick) {
  let dx = P[0] - S[0], dy = P[1] - S[1];
  let d = Math.sqrt(dx * dx + dy * dy) || 1;
  const maxd = L1 + L2 - 1;
  if (d > maxd) { dx *= maxd / d; dy *= maxd / d; d = maxd; P = [S[0] + dx, S[1] + dy]; }
  const ux = dx / d, uy = dy / d;
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const nx = -uy, ny = ux;
  const sgn = pick(nx, ny) >= pick(-nx, -ny) ? 1 : -1;
  return { joint: [S[0] + ux * a + nx * h * sgn, S[1] + uy * a + ny * h * sgn], end: P };
}
const pts2 = function (list) { return list.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '); };
const path3 = function (a, b, c) { return 'M ' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + ' L ' + b[0].toFixed(1) + ' ' + b[1].toFixed(1) + ' L ' + c[0].toFixed(1) + ' ' + c[1].toFixed(1); };

// バット：手の位置 (px,py)、向きと長さのベクトル (vx,vy)（長さ1で全長）。手前（にぎり）を少し延ばして描く
function setBat(parts, px, py, vx, vy) {
  const len = Math.sqrt(vx * vx + vy * vy);
  const L = BAT_LEN * len;
  const dx = len > 0.001 ? vx / len : 1, dy = len > 0.001 ? vy / len : 0;
  const nx = -dy, ny = dx;
  const K = [px - dx * 12, py - dy * 12], H = [px + dx * (12 + (L - 12) * 0.38), py + dy * (12 + (L - 12) * 0.38)], T = [px + dx * L, py + dy * L];
  const mkPoly = function (grow) {
    return pts2([
      [K[0] + nx * (2.5 + grow), K[1] + ny * (2.5 + grow)], [H[0] + nx * (3.5 + grow), H[1] + ny * (3.5 + grow)], [T[0] + nx * (6 + grow), T[1] + ny * (6 + grow)],
      [T[0] - nx * (6 + grow), T[1] - ny * (6 + grow)], [H[0] - nx * (3.5 + grow), H[1] - ny * (3.5 + grow)], [K[0] - nx * (2.5 + grow), K[1] - ny * (2.5 + grow)]
    ]);
  };
  parts.bat.setAttribute('points', mkPoly(0));
  parts.batH.setAttribute('points', mkPoly(2.5));
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

// この球の、打者の姿勢（時間 t）。pitch が null のときは構え
function poseAt(pitch, t) {
  const P = { hw: 24, shF: 118, shB: 112, hand: HAND_READY.slice(), bat: BAT_READY.slice(), footF: FOOT_F0.slice(), footB: FOOT_B0.slice(), headDx: -2, lean: 0 };
  if (!pitch) return P;
  // ① 足を上げて、踏み出す（どの球でも、同じ。t 0.04〜0.36）
  const lift = easeOut(clamp01((t - 0.04) / 0.14)) * (1 - easeIn(clamp01((t - 0.20) / 0.16)));
  const stride = easeOut(clamp01((t - 0.10) / 0.26));
  P.footF = [lerp(FOOT_F0[0], FOOT_F0[0] - 14, stride), GROUND_Y - 26 * lift];
  const loadIn = easeOut(clamp01((t - 0.08) / 0.18));                                        // 引く（t 0.08〜0.26）
  const swing = isSwing(pitch);
  const loadK = swing ? loadIn : loadIn * 0.6 * (1 - easeIn(clamp01((t - 0.34) / 0.22)));    // 見逃しは、小さく引いて、戻る
  P.hand = [lerp(HAND_READY[0], LOAD_HAND[0], loadK), lerp(HAND_READY[1], LOAD_HAND[1], loadK)];
  P.bat = [lerp(BAT_READY[0], LOAD_BAT[0], loadK), lerp(BAT_READY[1], LOAD_BAT[1], loadK)];
  P.hw = lerp(24, LOAD_HW, loadK); P.lean = LOAD_LEAN * loadK;
  const c = cellCenter(pitch.row, pitch.col), cx = c[0], cy = c[1];
  const bunt = !!(pitch.inplay && pitch.inplay.kind === 'BUNT');
  if (isSwing(pitch)) {
    const off = pitch.result === 'MISS' ? (pitch.row <= 3 ? 22 : -22) : 0;                  // 空振りは、球の下（または上）を振る
    const tx = cx, ty = cy + off;
    const hx = Math.max(226, Math.min(262, tx + BAT_LEN * 0.78)), hy = Math.max(118, Math.min(172, ty));
    let ddx = tx - hx, ddy = ty - hy; const dl = Math.sqrt(ddx * ddx + ddy * ddy);
    if (dl < 8) { ddx = -1; ddy = 0; } else { ddx /= dl; ddy /= dl; }
    const tau = clamp01((t - T_SWING) / 0.35);
    const aR = Math.atan2(LOAD_BAT[1], LOAD_BAT[0]);                                       // 約 -95°
    let aC = Math.atan2(ddy, ddx); if (aC > 0) aC -= Math.PI * 2;                           // 上から左へ回って当たる向き
    if (bunt) {
      const k = easeOut(tau / 0.5);
      P.hand = [lerp(LOAD_HAND[0], hx + 6, k), lerp(LOAD_HAND[1], hy, k)]; P.lean = LOAD_LEAN * (1 - k);
      const a = lerp(aR, aC, k); P.bat = [Math.cos(a), Math.sin(a)];
      P.hw = lerp(LOAD_HW, 30, k); P.shF = lerp(118, 114, k); P.shB = lerp(112, 118, k);
    } else if (tau < 0.6) {
      const k = easeIn(tau / 0.6);
      P.hand = [lerp(LOAD_HAND[0], hx, k), lerp(LOAD_HAND[1], hy, k)]; P.lean = LOAD_LEAN * (1 - k);
      const a = lerp(aR, aC, k); P.bat = [Math.cos(a), Math.sin(a)];
      P.hw = lerp(LOAD_HW, 30, k); P.shF = lerp(118, 112, k); P.shB = lerp(112, 124, k);
      P.footB = [lerp(FOOT_B0[0], FOOT_B0[0] - 8, k), GROUND_Y - 5 * k];                    // うしろの足のかかとが上がる
      P.headDx = lerp(-2, -4, k);
    } else {
      const f = easeOut((tau - 0.6) / 0.4);
      const Vc = [Math.cos(aC), Math.sin(aC)], Vm = [0, -0.5], Vf = [0.82, -0.57];          // 当たったあと、バットは前を回って、うしろの肩へ巻く
      const q = function (i) { return (1 - f) * (1 - f) * Vc[i] + 2 * (1 - f) * f * Vm[i] + f * f * Vf[i]; };
      P.bat = [q(0), q(1)];
      P.hand = [lerp(hx, 256, f), lerp(hy, 104, f)];
      P.hw = lerp(30, 14, f); P.shF = lerp(112, 108, f); P.shB = lerp(124, 112, f);
      P.footB = [FOOT_B0[0] - 8 - 4 * f, GROUND_Y - 5 - 4 * f];
      P.footF = [FOOT_F0[0] - 14, GROUND_Y]; P.lean = 0;
      P.headDx = lerp(-4, -10, f);
    }
  }
  if (pitch.result === 'HBP') P.lean = lerp(0, 10, easeOut((t - T_HIT) / 0.12));
  return P;
}

// t（0〜1）の姿勢を描く。pitch が null のときは、構えだけ（球なし）
function renderFrame(parts, pitch, t, still) {
  const side = parts.side;
  const bxm = function (x) { return side === 'L' ? 320 - x : x; };   // 打者側の座標 → 画面の座標
  parts.mitt.setAttribute('opacity', 0); parts.impact.setAttribute('opacity', 0); parts.ball.setAttribute('opacity', 0); parts.cellHit.setAttribute('opacity', 0);
  if (pitch) {
    const c = cellCenter(pitch.row, pitch.col), cx = c[0], cy = c[1];
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
    if (pitch.result === 'TAKEN' || pitch.result === 'MISS') {
      parts.mitt.setAttribute('cx', cx); parts.mitt.setAttribute('cy', cy + 3);
      parts.mitt.setAttribute('opacity', (0.55 * clamp01((t - T_HIT) / 0.1)).toFixed(2));
    }
    if (t >= T_HIT && (pitch.result === 'FOUL' || pitch.result === 'INPLAY' || pitch.result === 'HBP')) {
      const w = clamp01((t - T_HIT) / 0.18);
      const R0 = 6 + 14 * w, pts = [];
      for (let i = 0; i < 16; i++) { const r = (i % 2 === 0) ? R0 : R0 * 0.45, an = Math.PI * 2 * i / 16; pts.push((cx + Math.cos(an) * r).toFixed(1) + ',' + (cy + Math.sin(an) * r).toFixed(1)); }
      parts.impact.setAttribute('points', pts.join(' '));
      parts.impact.setAttribute('opacity', (1 - w).toFixed(2));
    }
    if (t >= T_HIT) { parts.cellHit.setAttribute('x', ZX0 + ZCELL * (pitch.col - 1)); parts.cellHit.setAttribute('y', ZY0 + ZCELL * (pitch.row - 1)); parts.cellHit.setAttribute('opacity', 1); }
  }
  applyPose(parts, poseAt(pitch, pitch ? t : 0));
}

function applyPose(parts, P) {
  const FS = [CX - P.hw, P.shF], BS = [CX + P.hw, P.shB];                    // 前の肩（ホーム側）、うしろの肩
  const hipF = [CX - 14, HIPY], hipB = [CX + 14, HIPY];
  parts.torso.setAttribute('points', pts2([FS, BS, [CX + 16, HIPY], [CX - 16, HIPY]]));
  const mid = [(FS[0] + BS[0]) / 2, (FS[1] + BS[1]) / 2];
  const hd = [CX + P.headDx, mid[1] - 30];
  parts.neck.setAttribute('d', 'M ' + mid[0].toFixed(1) + ' ' + mid[1].toFixed(1) + ' L ' + hd[0].toFixed(1) + ' ' + (hd[1] + 6).toFixed(1));
  parts.head.setAttribute('cx', hd[0].toFixed(1)); parts.head.setAttribute('cy', hd[1].toFixed(1));
  parts.brim.setAttribute('points', pts2([[hd[0] - 13, hd[1] - 5], [hd[0] - 31, hd[1] + 2], [hd[0] - 13, hd[1] + 5]]));      // ヘルメットのつば（こちら＝ホーム側へ）
  // 腕（ひじは、前の腕は下へ、うしろの腕は外側（または下）へ曲がる）
  const hand = P.hand;
  const eF = bend(FS, hand, ARM1, ARM2, function (nx, ny) { return ny; });
  const eB = bend(BS, hand, ARM1, ARM2, function (nx, ny) { return Math.abs(nx) > 0.35 ? nx : ny; });
  const dF = path3(FS, eF.joint, eF.end), dB = path3(BS, eB.joint, eB.end);
  parts.armF.setAttribute('d', dF); parts.armFh.setAttribute('d', dF); parts.armB.setAttribute('d', dB); parts.armBh.setAttribute('d', dB);
  setBat(parts, hand[0], hand[1], P.bat[0], P.bat[1]);
  // 脚
  const kF = bend(hipF, P.footF, LEG1, LEG2, function (nx, ny) { return -nx; });
  const kB = bend(hipB, P.footB, LEG1, LEG2, function (nx, ny) { return -nx; });
  parts.legF.setAttribute('d', path3(hipF, kF.joint, kF.end)); parts.legB.setAttribute('d', path3(hipB, kB.joint, kB.end));
  parts.footF.setAttribute('cx', (P.footF[0] - 5).toFixed(1)); parts.footF.setAttribute('cy', (P.footF[1] + 3).toFixed(1));
  parts.footB.setAttribute('cx', (P.footB[0] - 5).toFixed(1)); parts.footB.setAttribute('cy', (P.footB[1] + 3).toFixed(1));
  parts.lean.setAttribute('transform', P.lean ? 'rotate(' + P.lean.toFixed(1) + ' ' + CX + ' ' + HIPY + ')' : '');
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
