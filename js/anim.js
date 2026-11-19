'use strict';
// anim.js（球録 v0.1.14）シルエットの打者と、打撃のモーション（11.4）。SVGの図形だけで描く（画像・既存の絵は使わない。顔・背番号は描かない）
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
function easeInOut(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
function easeOut(x) { x = clamp01(x); return 1 - (1 - x) * (1 - x); }
function cellCenter(row, col) { return [ZX0 + ZCELL * (col - 0.5), ZY0 + ZCELL * (row - 0.5)]; }

// ---- 打者の絵（右打者を基準。左打者は左右反転）----
// 投手から見た絵。右打者は、ゾーンの右側（三塁側）に立ち、体はホームベース（画面の左）へ向け、顔は投手（こちら）へ向ける。
// バットは、うしろの肩（画面の右）の上に構える。骨格（肩・ひじ・手・腰・ひざ・足）を計算して、1コマずつ描く。
const CX = 290, HIPY = 192, HEAD_R = 16, ARM1 = 48, ARM2 = 46, LEG1 = 56, LEG2 = 56;
const FOOT_F0 = [262, GROUND_Y], FOOT_B0 = [318, GROUND_Y];   // 立ち幅（両足の間）を、少しせまく
const HAND_READY = [308, 96];                   // 構えたときの手の位置（うしろの耳のあたり）
const BAT_READY = [-0.08, -1];                  // 構えたときのバットの向き（ほぼ真上）
const LOAD_HAND = [HAND_READY[0] + 5, HAND_READY[1] - 3];   // テイクバック：手を後ろ（うしろの肩のほう）へ引く
const LOAD_BAT = [0.1, -1];                      // テイクバック：バットが少しうしろへ寝る
const LOAD_HW = 21, LOAD_LEAN = 2;               // テイクバック：肩を入れて（ひねって）、体をわずかに後ろへ引く
const COIL_HAND = [LOAD_HAND[0] + 4, LOAD_HAND[1] - 2], COIL_BAT = [0.18, -1], COIL_HW = 18, COIL_LEAN = 4;   // 打ちにいく直前の、もうひと引き（反動をためる）
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
  const gripA = mk('circle', 'sil-grip', { r: 7.5 }), gripB = mk('circle', 'sil-grip', { r: 7 });        // バットを握る両手（こぶし）
  [torso, neck, head, brim, armBh, armB, armFh, armF, batH, bat, gripA, gripB].forEach(function (e) { lean.appendChild(e); });
  [legB, legF, footB, footF, lean].forEach(function (e) { body.appendChild(e); });
  root.appendChild(body);
  const mitt = svgNode('ellipse', { rx: 17, ry: 13, 'class': 'sil-mitt', opacity: 0 });
  const impact = svgNode('polygon', { points: '', 'class': 'sil-impact', opacity: 0 });
  const ball = svgNode('circle', { r: 3, 'class': 'sil-ball', opacity: 0 });
  root.appendChild(mitt); root.appendChild(impact); root.appendChild(ball);
  svg.appendChild(root);
  const parts = { svg: svg, side: side, mirror: !!mirror, body: body, lean: lean, legB: legB, legF: legF, footB: footB, footF: footF, torso: torso, neck: neck, head: head, brim: brim,
    armB: armB, armBh: armBh, armF: armF, armFh: armFh, bat: bat, batH: batH, gripA: gripA, gripB: gripB, mitt: mitt, impact: impact, ball: ball, cellHit: cellHit };
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
  parts.gripA.setAttribute('cx', (px + dx * 2).toFixed(1)); parts.gripA.setAttribute('cy', (py + dy * 2).toFixed(1));
  parts.gripB.setAttribute('cx', (px + dx * 10).toFixed(1)); parts.gripB.setAttribute('cy', (py + dy * 10).toFixed(1));
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

// 打った方向（引っ張り・センター・流し）。踏み込む足の位置を決める
function swingDirOf(pitch, side) {
  if (pitch.result === 'INPLAY' && pitch.inplay && DIR_SIDE[pitch.inplay.dir]) return pullOppo(pitch.inplay.dir, side);
  if (pitch.result === 'FOUL') {
    const pull = side === 'R' ? 'F3B' : 'F1B', oppo = side === 'R' ? 'F1B' : 'F3B';
    return pitch.foulDir === pull ? 'PULL' : (pitch.foulDir === oppo ? 'OPPO' : 'CENTER');
  }
  const hb = hBand(pitch.col, side);                                                         // 空振り：球の内外から
  return (hb === 'IN1' || hb === 'IN2') ? 'PULL' : (hb === 'MID' ? 'CENTER' : 'OPPO');
}
// 前足が着く位置（画面のx）：流し＝うしろの足の外側まで／センター＝その中ほど／引っ張り＝いちばん前（ゾーン側）
const STRIDE_X = { PULL: FOOT_F0[0] - 20, CENTER: FOOT_B0[0] - 34, OPPO: FOOT_B0[0] + 8 };
const T_CONTACT = T_HIT;                                                                    // 当たる瞬間
function nzv(v) { const l = Math.sqrt(v[0] * v[0] + v[1] * v[1]) || 1; return [v[0] / l, v[1] / l]; }
// 肩・腰の幅（最大）と、横から見たときの厚みの割合。角度0＝正面向きで最も広く、90＝真横向きで最も細い
const SH_W = 27, HIP_W = 18, BODY_DEPTH = 0.38;
function projW(W, deg) { const a = deg * Math.PI / 180, c = W * Math.cos(a), d = W * BODY_DEPTH * Math.sin(a); return Math.sqrt(c * c + d * d); }
function lerpPose(A, B, k) {
  const R = {};
  Object.keys(A).forEach(function (key) {
    const a = A[key], b = B[key];
    if (Array.isArray(a)) R[key] = [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
    else if (typeof a === 'number') R[key] = lerp(a, b, k);
    else R[key] = a;
  });
  R.bat = nzv(R.bat);
  return R;
}
function readyPose() {
  return { ps: 40, ph: 40, hipDx: 0, shF: 118, shB: 112, hand: HAND_READY.slice(), bat: BAT_READY.slice(), footF: FOOT_F0.slice(), footB: FOOT_B0.slice(), headDx: -2, lean: 0 };
}

// この球の、打者の姿勢（時間 t）。pitch が null のときは構え。
// 見逃し（無反応）は動かない／見逃し（バットが出かかった・止めた）は途中まで振って戻る／空振り・ファウル・インプレーは振り抜く
// 動きだす順番：足 → 腰 → 肩 → 腕 → バット
function poseAt(pitch, t, side) {
  const P = readyPose();
  if (!pitch) return P;
  const swingKind = (pitch.result === 'MISS' || pitch.result === 'FOUL' || pitch.result === 'INPLAY');
  const react = pitch.reaction || (pitch.result === 'MISS' ? 'TIMED' : (pitch.result === 'TAKEN' ? 'NONE' : null));
  if (!swingKind && react !== 'BAT_OUT' && react !== 'CHECK') {
    if (pitch.result === 'HBP') P.lean = lerp(0, 10, easeOut((t - T_HIT) / 0.12));
    return P;                                                                                // ピクリとも動かない
  }
  const partial = !swingKind;                                                                // 途中まで振って止める
  const tCap = react === 'CHECK' ? 0.53 : 0.49;                                             // 止めるまでの時間（当たる前）
  const tShift = (pitch.result === 'MISS' && react === 'NO_TIMING') ? 0.13 : 0;              // 全くタイミングが合わない空振りは、振るのが遅れる
  const isBunt = !!(pitch.inplay && pitch.inplay.kind === 'BUNT');
  const dir = swingKind && !isBunt ? swingDirOf(pitch, side) : null;
  const strideX = dir ? STRIDE_X[dir] : FOOT_F0[0] - 14;

  // ① 足を上げて、踏み出す（t 0.04〜0.36）
  const lift = easeOut(clamp01((t - 0.04) / 0.14)) * (1 - easeIn(clamp01((t - 0.20) / 0.16)));
  const stride = easeOut(clamp01((t - 0.10) / 0.26));
  P.footF = [lerp(FOOT_F0[0], strideX, stride), GROUND_Y - 26 * lift];
  // ② テイクバック（t 0.08〜0.26）と、打ちにいく直前の反動（t 0.26〜0.36）
  const loadK = easeOut(clamp01((t - 0.08) / 0.18));
  P.hand = [lerp(HAND_READY[0], LOAD_HAND[0], loadK), lerp(HAND_READY[1], LOAD_HAND[1], loadK)];
  P.bat = [lerp(BAT_READY[0], LOAD_BAT[0], loadK), lerp(BAT_READY[1], LOAD_BAT[1], loadK)];
  P.ps = lerp(40, 48, loadK); P.ph = lerp(40, 44, loadK); P.lean = LOAD_LEAN * loadK;
  const coilK = easeOut(clamp01((t - 0.26) / 0.10));
  if (coilK > 0) {
    P.hand = [lerp(LOAD_HAND[0], COIL_HAND[0], coilK), lerp(LOAD_HAND[1], COIL_HAND[1], coilK)];
    P.bat = [lerp(LOAD_BAT[0], COIL_BAT[0], coilK), lerp(LOAD_BAT[1], COIL_BAT[1], coilK)];
    P.ps = lerp(48, 58, coilK); P.ph = lerp(44, 50, coilK); P.lean = lerp(LOAD_LEAN, COIL_LEAN, coilK);
  }
  const planted = Object.assign({}, P, { footF: [strideX, GROUND_Y] });                      // 戻るときの、足が着いたままの構え
  // ③ 振る
  const c = cellCenter(pitch.row, pitch.col), cx = c[0], cy = c[1];
  const ts = (partial ? Math.min(t, tCap) : t) - tShift;                                       // スイングの時計
  const off = pitch.result === 'MISS' ? ((react === 'NO_TIMING' ? 38 : 22) * (pitch.row <= 3 ? 1 : -1)) : 0;   // 空振りは球の下（または上）を振る
  const tx = cx, ty = cy + off;
  const hx = Math.max(226, Math.min(262, tx + BAT_LEN * 0.78)), hy = Math.max(118, Math.min(172, ty));
  let ddx = tx - hx, ddy = ty - hy; const dl = Math.sqrt(ddx * ddx + ddy * ddy);
  if (dl < 8) { ddx = -1; ddy = 0; } else { ddx /= dl; ddy /= dl; }
  const aR = Math.atan2(COIL_BAT[1], COIL_BAT[0]);
  let aC = Math.atan2(ddy, ddx); if (aC > 0) aC -= Math.PI * 2;
  const hipP = easeInOut(clamp01((ts - 0.30) / 0.30));                                         // 腰（0.30〜0.60）
  const shP = easeInOut(clamp01((ts - 0.35) / 0.30));                                          // 肩（0.35〜0.65）
  const kArm = easeIn(clamp01((ts - 0.40) / 0.168));                                           // 腕（0.40〜0.568）
  const kBat = easeIn(clamp01((ts - 0.43) / 0.138));                                           // バット（0.43〜0.568）
  const tc = T_CONTACT + tShift;
  if (isBunt) {
    const k = easeOut(clamp01((ts - 0.40) / 0.15));
    P.hand = [lerp(COIL_HAND[0], hx + 6, k), lerp(COIL_HAND[1], hy, k)]; P.lean = lerp(COIL_LEAN, -3, k);
    const a = lerp(aR, aC, k); P.bat = [Math.cos(a), Math.sin(a)];
    P.ps = lerp(58, 72, k); P.ph = lerp(50, 72, k); P.shF = lerp(118, 114, k); P.shB = lerp(112, 118, k);
    return P;
  }
  const aSwing = lerp(aR, aC, kBat);
  const swingP = Object.assign({}, P);
  if (ts < tc) {
    swingP.hand = [lerp(COIL_HAND[0], hx, kArm), lerp(COIL_HAND[1], hy, kArm)];
    swingP.bat = [Math.cos(aSwing), Math.sin(aSwing)];
    swingP.ph = lerp(50, 85, hipP); swingP.hipDx = lerp(0, -4, hipP);                       // 腰がまず開く
    swingP.ps = lerp(58, 76, shP);                                                         // つぎに肩が開く
    swingP.shF = lerp(118, 112, shP); swingP.shB = lerp(112, 124, shP);
    swingP.lean = lerp(COIL_LEAN, -3, shP);
    swingP.footB = [lerp(FOOT_B0[0], FOOT_B0[0] - 8, hipP), GROUND_Y - 5 * hipP];              // うしろの足のかかとが上がる
    swingP.headDx = lerp(-2, -4, shP);
    swingP.footF = [strideX, GROUND_Y - 26 * lift];
    if (!partial) return swingP;
    // 途中で止めた：止めたまま少し間をおいて、構えに戻る
    const rec = easeInOut(clamp01((t - (tCap + 0.08)) / 0.22));
    return lerpPose(swingP, planted, rec);
  }
  const f = clamp01((ts - tc) / 0.26);                                                          // 当たったあと
  const Vc = [Math.cos(aC), Math.sin(aC)], Vk = [-0.78, -0.62], Vm = [0, -1], Vf = [0.82, -0.57];
  if (f < 0.4) {                                                                                 // ①打ったあとも、バットは前（ゾーン側）へ振り抜く
    const u = easeOut(f / 0.4);
    P.bat = nzv([lerp(Vc[0], Vk[0], u), lerp(Vc[1], Vk[1], u)]);
    P.hand = [lerp(hx, hx - 8, u), lerp(hy, hy - 6, u)];
  } else {                                                                                       // ②そのあと、頭の上を回って、うしろの肩へ巻く（投手側の腕・肩・バットは、胴と頭のうしろへ）
    const w = easeOut((f - 0.4) / 0.6);
    P.batBehind = f > 0.46;
    const q = function (i) { return (1 - w) * (1 - w) * Vk[i] + 2 * (1 - w) * w * Vm[i] + w * w * Vf[i]; };
    P.bat = nzv([q(0), q(1)]);
    P.hand = [lerp(hx - 8, 250, w), lerp(hy - 6, 104, w)];
  }
  P.ph = lerp(85, 104, easeOut(f)); P.hipDx = -4;
  P.ps = lerp(76, 100, easeOut(f)); P.shF = lerp(112, 108, f); P.shB = lerp(124, 112, f);
  P.footB = [FOOT_B0[0] - 8 - 4 * f, GROUND_Y - 5 - 4 * f];
  P.footF = [strideX, GROUND_Y]; P.lean = lerp(-3, 0, f);
  P.headDx = lerp(-4, -10, f);
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
        const d = foulScreenDir(pitch), far = pitch.foulDir === 'FBK' ? 260 : 140;       // 後方（バックネット）へのファウルは、真上へ高く上がる
        const ww = pitch.foulDir === 'FBK' ? w : easeOut(w);
        bx = cx + d[0] * far * ww; by = cy + d[1] * far * ww; br = lerp(7, 3, w); bo = pitch.foulDir === 'FBK' ? 1 - 0.3 * w : 1 - 0.7 * w;
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
  applyPose(parts, poseAt(pitch, pitch ? t : 0, parts.side));
}

function applyPose(parts, P) {
  const behind = !!P.batBehind;                                              // バットを、体（胴・首・頭）より奥に描くか
  if (parts._behind !== behind) {
    parts._behind = behind;
    const order = behind                                                      // 巻いたあとは、投手側の腕とバットが、胴・首・頭のうしろに入る
      ? [parts.armFh, parts.armF, parts.batH, parts.bat, parts.torso, parts.neck, parts.head, parts.brim, parts.armBh, parts.armB, parts.gripA, parts.gripB]
      : [parts.torso, parts.neck, parts.head, parts.brim, parts.armBh, parts.armB, parts.armFh, parts.armF, parts.batH, parts.bat, parts.gripA, parts.gripB];
    order.forEach(function (e) { parts.lean.appendChild(e); });
  }
  const hw = projW(SH_W, P.ps), hipHW = projW(HIP_W, P.ph);                  // 体の回転角（度）から、見える横幅を出す（回って縦向きになるほど細くなる）
  const FS = [CX - hw, P.shF], BS = [CX + hw, P.shB];                    // 前の肩（ホーム側）、うしろの肩
  const hipF = [CX - hipHW + P.hipDx, HIPY], hipB = [CX + hipHW + P.hipDx, HIPY];
  parts.torso.setAttribute('points', pts2([FS, BS, [hipB[0] + 2, HIPY], [hipF[0] - 2, HIPY]]));
  const mid = [(FS[0] + BS[0]) / 2, (FS[1] + BS[1]) / 2];
  const hd = [CX + P.headDx, mid[1] - 30];
  parts.neck.setAttribute('d', 'M ' + mid[0].toFixed(1) + ' ' + mid[1].toFixed(1) + ' L ' + hd[0].toFixed(1) + ' ' + (hd[1] + 6).toFixed(1));
  parts.head.setAttribute('cx', hd[0].toFixed(1)); parts.head.setAttribute('cy', hd[1].toFixed(1));
  parts.brim.setAttribute('points', pts2([[hd[0] - 13, hd[1] - 4], [hd[0] - 22, hd[1] + 1], [hd[0] - 13, hd[1] + 4]]));      // ヘルメットのつば（こちら＝ホーム側へ）
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
