'use strict';
// anim.js（球録 v0.3.7）シルエットの打者と、打撃のモーション（11.4）。SVGの図形だけで描く（画像・既存の絵は使わない。顔・背番号は描かない）
const SVGNS = 'http://www.w3.org/2000/svg';
const ZX0 = 85, ZY0 = 70, ZCELL = 30;            // ゾーンの図（5×5）の左上と1マスの大きさ（SVGの座標）
let BAT_CLIP_SEQ = 0;
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

// バットだけを球へ向ける（v0.3.7）。コマ42〜47は、動画のバット（体と同じ1つの輪郭）を、手もとで切り落とし、描き足したバットに置き換える
// 手もと（バットのつけ根）の位置・元のバットの向き（つけ根→先）・元の見かけの長さ（コマごと。バットが奥や手前を向くと、見かけは短い）。投手から見た絵の座標
const SP_BAT = { 42: { p: [191, 165], t: [158.5, 186.3] }, 43: { p: [191, 163], t: [119, 195.6] }, 44: { p: [190, 162], t: [118, 193.4] },
  45: { p: [191, 159], t: [135.8, 181.3] }, 46: { p: [191, 159], t: [135.8, 181.3] }, 47: { p: [194, 155], t: [158.3, 167.8] } };
const BAT_BARREL = 0.88;                    // 芯（球に当てる所）の位置：つけ根から先までの長さの何割か（元の動画のコマ43で 0.88）
const BAT_LEN_MIN = 38, BAT_LEN_MAX = 82;   // 見かけの長さの下限・上限（短くなる＝先が手前を向く。上限は、元の動画のバットの長さ約79に近い）
// 腕を伸ばす（v0.3.7）：球が遠いときは、手もとを球の方へ動かし、元の手から新しい手まで、腕（描き足し）でつなぐ
const ARM_REACH_MAX = 34;                   // 手もとを動かせる最大の距離（絵の単位）
const ARM_W0 = 5.2, ARM_W1 = 4.4;           // 描き足す腕の太さ（半分）：元の手の側・新しい手の側
const BAT_FADE = 6;                         // 当たったあと、向きのずれが消えていくコマ数
function batG(fi, fc) {                      // コマ fi で、球へ向ける度合い（0〜1）。fc＝当たるコマ
  if (fc < 42 || fi < 42 || fi > 47) return 0;
  if (fi <= fc) return (fi - 41) / (fc - 41);
  return Math.max(0, 1 - (fi - fc) / BAT_FADE);
}
function batGeom(fi) {                       // 元のバット：{ px, py, ang, len }
  const B = SP_BAT[fi]; if (!B) return null;
  const dx = B.t[0] - B.p[0], dy = B.t[1] - B.p[1];
  return { px: B.p[0], py: B.p[1], ang: Math.atan2(dy, dx), len: Math.sqrt(dx * dx + dy * dy) };
}
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
  fig.appendChild(sprite);
  const arm = svgNode('polygon', { points: '', 'class': 'sil-fill sil-arm', opacity: 0 });                  // 球へ伸ばす腕（コマ42〜47）
  fig.appendChild(arm);
  const bat = svgNode('polygon', { points: '', 'class': 'sil-fill sil-bat', opacity: 0 });                  // 球へ向けるバット（コマ42〜47）
  fig.appendChild(bat);
  const clipId = 'kyr-batclip-' + (++BAT_CLIP_SEQ);
  const clipPath = svgNode('clipPath', { id: clipId, clipPathUnits: 'userSpaceOnUse' });
  const clipRect = svgNode('rect', { x: 191, y: -100, width: 600, height: 600 });
  clipPath.appendChild(clipRect); svg.appendChild(clipPath);
  body.appendChild(fig);
  root.appendChild(body);
  const mitt = svgNode('ellipse', { rx: 17, ry: 13, 'class': 'sil-mitt', opacity: 0 });
  const impact = svgNode('polygon', { points: '', 'class': 'sil-impact', opacity: 0 });
  const impact2 = svgNode('polygon', { points: '', 'class': 'sil-impact2', opacity: 0 });                  // 本塁打：星の中の、小さなもう1つの星（色がちがう）
  const ring = svgNode('circle', { r: 1, 'class': 'sil-ring', fill: 'none', opacity: 0 });                 // 本塁打：外へ広がる光の輪
  const trail = svgNode('polyline', { points: '', 'class': 'sil-trail', fill: 'none', 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0 });
  const ball = svgNode('circle', { r: 3, 'class': 'sil-ball', opacity: 0 });
  root.appendChild(trail); root.appendChild(mitt); root.appendChild(ring); root.appendChild(impact); root.appendChild(impact2); root.appendChild(ball);
  svg.appendChild(root);
  const parts = { svg: svg, side: side, mirror: !!mirror, body: body, fig: fig, sprite: sprite, arm: arm, bat: bat, clipId: clipId, clipRect: clipRect, _f: 0, mitt: mitt, impact: impact, impact2: impact2, ring: ring, trail: trail, ball: ball, cellHit: cellHit };
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
  if (o === 'HR') return { scale: 8, span: 0.5, spikes: 16, cls: 'k-hr', inner: true, ring: true };
  if (o === 'H3') return { scale: 3.2, span: 0.3, spikes: 12, cls: 'k-h3', inner: false, ring: false };
  if (o === 'H2') return { scale: 2.4, span: 0.27, spikes: 10, cls: 'k-h2', inner: false, ring: false };
  return { scale: 0.85, span: 0.16, spikes: 8, cls: 'k-n', inner: false, ring: false };
}
// ---- 打った後の球の動き（球審の視点：遠ざかるほど小さく、こちらへ来るほど大きく）----
const BALL_R_PITCH = [2, 8];                      // 投球：手を離れたとき → ゾーンに着くときの半径
const OWN_BALL_POINT = [264, 250];                // 自打球が当たる打者のすね（打者側の座標。右打者基準）
const T_OWN = T_HIT + 0.30 * (1 - T_HIT);          // 自打球が打者に当たる時刻
function sideFoulPath(c, sgn, w, far, rEnd) {      // 一塁側・三塁側へのファウル：ゾーンの横へ大きく流れ、画面の外へ出ていく（ファウルゾーン）
  const e = Math.pow(w, 0.8);
  return { x: c[0] + sgn * far * e, y: c[1] - 62 * Math.sin(Math.PI * w * 0.8) + 46 * w * w, r: lerp(8, rEnd, w), o: w < 0.8 ? 1 : (1 - w) / 0.2 };
}
function backPopPath(c, w) {                       // 後方好打：真上へ高く上がる内野フライ。こちら（球審）の頭上を越えるように、だんだん大きくなる
  const e = easeOut(w);
  return { x: c[0], y: c[1] - 215 * e, r: 8 + 11 * Math.pow(w, 1.2), o: w < 0.85 ? 1 : (1 - w) / 0.15 };
}
function backCutPath(c, w, oppoSgn) {              // カット：やや流し方向（逆方向）へ、後ろへ低めに飛ぶ。大きくなりながら横へそれる
  const e = easeOut(w);
  return { x: c[0] + oppoSgn * 78 * e, y: c[1] - 105 * e, r: 8 + 9 * Math.pow(w, 1.1), o: w < 0.85 ? 1 : (1 - w) / 0.15 };
}
function backGroundPath(c, w) {                    // 下かすり：バットの下に当たるので、下へ落ちて地面ではね、後ろへ転がる（大きくなる）
  const wg = 0.5, gy = GROUND_Y - 4;
  const y = w < wg ? lerp(c[1], gy, easeIn(w / wg)) : gy - 34 * Math.sin(Math.PI * (w - wg) / (1 - wg));
  return { x: c[0], y: y, r: 8 + 7 * Math.pow(w, 1.1), o: w < 0.9 ? 1 : (1 - w) / 0.1 };
}
function ownBallPath(c, side, w) {                 // 自打球：打者のすねに当たり（星）、足もとへ落ちて転がる
  const tc = (T_OWN - T_HIT) / (1 - T_HIT);
  const P = [side === 'L' ? 320 - OWN_BALL_POINT[0] : OWN_BALL_POINT[0], OWN_BALL_POINT[1]];
  const away = side === 'L' ? 1 : -1;
  if (w < tc) { const k = easeIn(w / tc); return { x: lerp(c[0], P[0], k), y: lerp(c[1], P[1], k), r: 8, o: 1, hit: P }; }
  const v = (w - tc) / (1 - tc), gy = GROUND_Y - 5;
  const y = lerp(P[1], gy, easeIn(Math.min(1, v / 0.5))) - (v > 0.5 ? 16 * Math.sin(Math.PI * (v - 0.5) / 0.5) : 0);
  return { x: P[0] + away * 40 * easeOut(v), y: y, r: 8 - 2 * v, o: v < 0.85 ? 1 : (1 - v) / 0.15, hit: P };
}
function inplayPath(pitch, c, w) {                 // 打球：打った球は、遠ざかって小さくなる
  const sgn = (pitch.inplay && FIELD_POINTS[pitch.inplay.dir] && FIELD_POINTS[pitch.inplay.dir][0] > 50) ? -1 : 1;
  return { x: c[0] + sgn * 60 * easeOut(w), y: c[1] - 110 * easeOut(w), r: lerp(8, 1.8, easeOut(w)), o: 1 - w };
}
// ファウルの球の動き。種類（foulType）で決め、「その他」だけは方向（foulDir）で決める
function foulPath(pitch, c, w, side) {
  const oppoSgn = side === 'R' ? -1 : 1;           // 逆方向（流し）：右打者は一塁側（画面の左）、左打者は三塁側（画面の右）
  switch (pitch.foulType) {
    case 'OWN_BALL': return ownBallPath(c, side, w);
    case 'UNDER_NICK': return backGroundPath(c, w);
    case 'BACK_GOOD': return backPopPath(c, w);
    case 'CUT': return backCutPath(c, w, oppoSgn);
    default: break;
  }
  switch (pitch.foulDir) {
    case 'F1B': return sideFoulPath(c, -1, w, 250, 4);
    case 'F3B': return sideFoulPath(c, 1, w, 250, 4);
    case 'FBK': return backPopPath(c, w);
    case 'FLN': return sideFoulPath(c, -1, w, 290, 3);
    default: return sideFoulPath(c, -1, w, 250, 4);
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
    let score;
    if (+k >= 42) {                                                     // バットが見えるコマ：バットを球へ向けるので、つけ根から球までが、バットの届く長さに収まるか
      const G = SP_BAT[k], px = dx + SP_FEET_X + sx * (G.p[0] - SP_FEET_X), py = SP_GROUND + sy * (G.p[1] - SP_GROUND);
      const d = Math.sqrt((px - cxb) * (px - cxb) + (py - cyb) * (py - cyb));
      const far = Math.max(0, d - BAT_BARREL * BAT_LEN_MAX), err = Math.max(0, far - ARM_REACH_MAX, BAT_BARREL * BAT_LEN_MIN - d);
      score = err + 0.15 * far + 8 * (Math.abs(sx - 1) + Math.abs(sy - 1)) + 0.05 * Math.abs(dx) + ((+k === 42 || +k === 45) ? 2 : 0);
    } else {                                                            // コマ39・40：バットが体に重なって見えない。芯がマスに近いときだけ選ばれる
      const px = dx + SP_FEET_X + sx * (B[0] - SP_FEET_X), py = SP_GROUND + sy * (B[1] - SP_GROUND);
      score = 0.6 * Math.sqrt((px - cxb) * (px - cxb) + (py - cyb) * (py - cyb));
    }
    if (!best || score < best.d) best = { d: score, f: +k, sx: sx, sy: sy, dx: dx };
  });
  S.f = keyf(swingKeys(best.f), clamp01(t - tShift));
  const k = easeInOut(clamp01(t / 0.5));
  S.sx = lerp(1, best.sx, k); S.sy = lerp(1, best.sy, k); S.dx = lerp(0, best.dx, k);
  S.fc = best.f; S.aim = [cxb, cyb];                                              // バットを向ける先（打者側の座標）
  return S;
}

// t（0〜1）の姿勢を描く。pitch が null のときは、構えだけ（球なし）
function renderFrame(parts, pitch, t, still) {
  const side = parts.side;
  const bxm = function (x) { return side === 'L' ? 320 - x : x; };   // 打者側の座標 → 画面の座標
  parts.mitt.setAttribute('opacity', 0); parts.impact.setAttribute('opacity', 0); parts.impact2.setAttribute('opacity', 0); parts.ring.setAttribute('opacity', 0); parts.ball.setAttribute('opacity', 0); parts.cellHit.setAttribute('opacity', 0); parts.trail.setAttribute('opacity', 0);
  if (pitch) {
    const c = cellCenter(pitch.row, pitch.col), cx = c[0], cy = c[1];
    // 球（球審の視点：投げた球は遠くから近づいて大きくなり、打った球は遠ざかって小さくなる／ファウルは種類ごとに動く）
    let bx, by, br = BALL_R_PITCH[1], bo = 1, hit = [cx, cy];
    if (t < T_HIT) {
      const e = Math.pow(t / T_HIT, 1.6);
      bx = lerp(BALL_START[0], cx, e); by = lerp(BALL_START[1], cy, e); br = lerp(BALL_R_PITCH[0], BALL_R_PITCH[1], e);
      const bo2 = breakOffset(pitch, e); bx += bo2[0]; by += bo2[1];
    } else {
      const w = clamp01((t - T_HIT) / (1 - T_HIT));
      bx = cx; by = cy;
      let q = null;
      if (pitch.result === 'FOUL') q = foulPath(pitch, [cx, cy], w, side);
      else if (pitch.result === 'INPLAY') q = inplayPath(pitch, [cx, cy], w);
      if (q) { bx = q.x; by = q.y; br = q.r; bo = q.o; if (q.hit) hit = q.hit; }
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
      const pts = [], n = ik.spikes;
      let hx = cx, hy = cy, ww = w;
      if (pitch.result === 'FOUL' && pitch.foulType === 'OWN_BALL') {                // 自打球：まずバットに当たった星、つづいて打者の体に当たった星
        if (t >= T_OWN) { hx = hit[0]; hy = hit[1]; ww = clamp01((t - T_OWN) / ik.span); }
      }
      const R0 = 6 + 14 * ik.scale * ww;
      for (let i = 0; i < n * 2; i++) { const r = (i % 2 === 0) ? R0 : R0 * 0.45, an = Math.PI * 2 * i / (n * 2); pts.push((hx + Math.cos(an) * r).toFixed(1) + ',' + (hy + Math.sin(an) * r).toFixed(1)); }
      parts.impact.setAttribute('points', pts.join(' '));
      parts.impact.setAttribute('class', 'sil-impact ' + ik.cls);
      parts.impact.setAttribute('opacity', (1 - ww).toFixed(2));
      if (ik.inner) {                                                              // 本塁打：2つ目の星（半分の大きさ・とげは逆向き）と、光の輪
        const p2 = [], R2 = R0 * 0.55;
        for (let i = 0; i < n * 2; i++) { const r = (i % 2 === 0) ? R2 : R2 * 0.5, an = Math.PI * 2 * (i + 0.5) / (n * 2); p2.push((hx + Math.cos(an) * r).toFixed(1) + ',' + (hy + Math.sin(an) * r).toFixed(1)); }
        parts.impact2.setAttribute('points', p2.join(' '));
        parts.impact2.setAttribute('opacity', (1 - ww * 0.8).toFixed(2));
      }
      if (ik.ring) {
        parts.ring.setAttribute('cx', hx.toFixed(1)); parts.ring.setAttribute('cy', hy.toFixed(1));
        parts.ring.setAttribute('r', (8 + 14 * ik.scale * 1.25 * easeOut(ww)).toFixed(1));
        parts.ring.setAttribute('opacity', (0.9 * (1 - ww)).toFixed(2));
      }
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
  applyBat(parts, S, fi);
}
// バットを球へ向け、遠い球は腕を伸ばす：コマ42〜47で、元のバットを手もとで切り落とし、球の方へ向けたバットを描く。それ以外のコマは、動画のまま
function applyBat(parts, S, fi) {
  const g = S.aim ? batG(fi, S.fc) : 0;
  if (g < 0.02) { parts.sprite.removeAttribute('clip-path'); parts.bat.setAttribute('opacity', 0); parts.arm.setAttribute('opacity', 0); return; }
  const O = batGeom(fi), C = batGeom(S.fc);
  const tx = SP_FEET_X + (S.aim[0] - S.dx - SP_FEET_X) / S.sx, ty = SP_GROUND + (S.aim[1] - SP_GROUND) / S.sy;      // 球の位置を、体の絵の座標へ戻す
  const aimAng = Math.atan2(ty - C.py, tx - C.px), dist = Math.sqrt((tx - C.px) * (tx - C.px) + (ty - C.py) * (ty - C.py));
  const reachFull = clampR(dist - BAT_BARREL * BAT_LEN_MAX, 0, ARM_REACH_MAX);                                      // バットの長さだけで届かない分を、腕を伸ばして補う
  const lenNeed = clampR((dist - reachFull) / BAT_BARREL, BAT_LEN_MIN, BAT_LEN_MAX);
  let dAng = aimAng - C.ang; while (dAng > Math.PI) dAng -= 2 * Math.PI; while (dAng < -Math.PI) dAng += 2 * Math.PI;
  const ang = O.ang + dAng * g, len = O.len + (lenNeed - C.len) * g;
  const reach = reachFull * g, hx = O.px + Math.cos(aimAng) * reach, hy = O.py + Math.sin(aimAng) * reach;        // 新しい手もと
  parts.clipRect.setAttribute('x', O.px);                                                                           // つけ根より左（バット）を切り落とす
  parts.sprite.setAttribute('clip-path', 'url(#' + parts.clipId + ')');
  if (reach > 0.5) {                                                                                                // 腕：元の手（の少し手前）から、新しい手まで
    const ax = Math.cos(aimAng), ay = Math.sin(aimAng), anx = -ay, any = ax, sx0 = O.px - ax * 5, sy0 = O.py - ay * 5;
    parts.arm.setAttribute('points', [[sx0 + anx * ARM_W0, sy0 + any * ARM_W0], [hx + anx * ARM_W1, hy + any * ARM_W1], [hx + ax * 3 + anx * 2.5, hy + ay * 3 + any * 2.5], [hx + ax * 3 - anx * 2.5, hy + ay * 3 - any * 2.5], [hx - anx * ARM_W1, hy - any * ARM_W1], [sx0 - anx * ARM_W0, sy0 - any * ARM_W0]].map(function (q) { return q[0].toFixed(1) + ',' + q[1].toFixed(1); }).join(' '));
    parts.arm.setAttribute('opacity', 1);
  } else parts.arm.setAttribute('opacity', 0);
  const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
  const prof = [[-3, 1.8], [0, 1.6], [0.5, 2.4], [0.8, 3.8], [0.93, 4.3], [1, 3.6]], L = [], R = [];       // [つけ根からの割合（−3は、手の中へ3だけ入れる）, 半分の太さ]
  prof.forEach(function (q) {
    const along = q[0] < 0 ? q[0] : q[0] * len, x = hx + ux * along, y = hy + uy * along;
    L.push((x + nx * q[1]).toFixed(1) + ',' + (y + ny * q[1]).toFixed(1)); R.unshift((x - nx * q[1]).toFixed(1) + ',' + (y - ny * q[1]).toFixed(1));
  });
  const ex = hx + ux * (len + 1.5), ey = hy + uy * (len + 1.5);
  parts.bat.setAttribute('points', L.join(' ') + ' ' + ex.toFixed(1) + ',' + ey.toFixed(1) + ' ' + R.join(' '));
  parts.bat.setAttribute('opacity', 1);
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
