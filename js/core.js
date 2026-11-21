'use strict';
// kyr-core.js（サンプル。仕様書 v0.3.7 の10章。この通りに実装すること）
const KYR_CORE_VERSION = '0.3.7';
const DAY_START_HOUR = 5;            // 1日の区切り（午前5時）。4-9
const MIN_SAMPLE_REFERENCE = 5;      // 「参考程度」と添える球数のしきい値
const NAME_SUGGEST_MAX = 30;         // 名前の候補の最大件数（投手・打者それぞれ。5.2）
const KEEP_AWAKE_IDLE_MIN = 30;      // 画面を点けたままにする、操作なしの限度（分。5.9）

// ---- 結果・コード（内部の名前。画面の表示名とは分ける。4-4）----
const RESULT = { TAKEN: 'TAKEN', MISS: 'MISS', FOUL: 'FOUL', HBP: 'HBP', INPLAY: 'INPLAY' };

// ---- ゾーン（5×5。行1が上、列1が投手から見て左）----
function isStrikeZone(row, col) {
  return row >= 2 && row <= 4 && col >= 2 && col <= 4;
}
function takenCallFromZone(row, col) {      // 見逃しのストライク(S)・ボール(B)の自動判定
  return isStrikeZone(row, col) ? 'S' : 'B';
}
// 打者から見た内外。右打者は投手から見て右側（列が大きい側）が内角
function hBand(col, side) {
  const d = (side === 'R') ? (col - 3) : (3 - col);
  if (d === 2) return 'IN2';
  if (d === 1) return 'IN1';
  if (d === 0) return 'MID';
  if (d === -1) return 'OUT1';
  return 'OUT2';
}
const H_LABEL = { IN2: '内（ゾーン外）', IN1: '内', MID: '真ん中', OUT1: '外', OUT2: '外（ゾーン外）' };
const V_LABEL = ['', '上（ゾーン外）', '高め', '真ん中', '低め', '下（ゾーン外）'];
function zoneLabel(row, col, side) {
  return H_LABEL[hBand(col, side)] + '・' + V_LABEL[row];
}

// ---- 打球方向と「引っ張り・流し」----
const DIR_SIDE = {                      // L=三塁側（左方向） M=中央 R=一塁側（右方向）
  '3B': 'L', 'SS': 'L', '3BSS': 'L', '3BL': 'L', 'LF': 'L', 'LFL': 'L', 'LCF': 'L',
  'P': 'M', 'C': 'M', '2BSS': 'M', 'CF': 'M',
  '1B': 'R', '2B': 'R', '1B2B': 'R', '1BL': 'R', 'RF': 'R', 'RFL': 'R', 'RCF': 'R'
};
function pullOppo(dir, side) {          // 戻り値: 'PULL' | 'CENTER' | 'OPPO'
  const s = DIR_SIDE[dir];
  if (s === 'M') return 'CENTER';
  if (side === 'R') return (s === 'L') ? 'PULL' : 'OPPO';
  return (s === 'R') ? 'PULL' : 'OPPO';
}
// ファウルの種類から、方向を自動で決める。決まらないときは null
function foulDirAuto(foulType, side) {
  const pull = (side === 'R') ? 'F3B' : 'F1B';
  const oppo = (side === 'R') ? 'F1B' : 'F3B';
  switch (foulType) {
    case 'PULL_CUT':   return pull;
    case 'LATE_OPPO':  return oppo;
    case 'BACK_GOOD':  return 'FBK';
    case 'UNDER_NICK': return 'FBK';
    default:           return null;     // CUT / OWN_BALL / OTHER
  }
}

// ---- カウントと打席の終わり ----
// pitch: { result, takenCall('S'|'B'), caught(true|false) }
// 戻り値: { balls, strikes, paEnd } paEnd は null | 'K' | 'BB' | 'HBP' | 'INPLAY' | 'CAUGHT_FOUL'
function applyPitchToCount(balls, strikes, pitch) {
  let b = balls, s = strikes, paEnd = null;
  switch (pitch.result) {
    case RESULT.TAKEN:
      if (pitch.takenCall === 'B') { b += 1; if (b >= 4) paEnd = 'BB'; }
      else { s += 1; if (s >= 3) paEnd = 'K'; }
      break;
    case RESULT.MISS:
      s += 1; if (s >= 3) paEnd = 'K';
      break;
    case RESULT.FOUL:
      if (pitch.caught) paEnd = 'CAUGHT_FOUL';
      else if (s < 2) s += 1;
      break;
    case RESULT.HBP:
      paEnd = 'HBP';
      break;
    case RESULT.INPLAY:
      paEnd = 'INPLAY';
      break;
  }
  return { balls: b, strikes: s, paEnd: paEnd };
}

// 打席が終わったときの、アウトの増え方
const OUTS_ADDED = { OUT: 1, DP: 2, SAC_BUNT: 1, SAC_FLY: 1 };   // 上にない結果（内安・単打…）は0（失策・野選・打撃妨害は下の outsAdded）
// 失策(ERR)・野選(FC)・打撃妨害(INTERF)は、利用者が押した数 outsAdded（0〜2の整数）だけ増える（5.5）。
// ほかの結果に outsAdded を渡しても使わない。整数でない・範囲外・なしのときは、0個
const OUTS_ASKED = { ERR: true, FC: true, INTERF: true };
function outsAddedByPaEnd(paEnd, outcome, outsAdded) {
  if (paEnd === 'K' || paEnd === 'CAUGHT_FOUL') return 1;
  if (paEnd === 'INPLAY') {
    if (OUTS_ASKED[outcome] === true && Number.isInteger(outsAdded) && outsAdded >= 0 && outsAdded <= 2) return outsAdded;
    return OUTS_ADDED[outcome] || 0;
  }
  return 0;
}

// 状況（回・表裏・アウト・走者）を、打席が終わったあとの値にする
// sit: { inning, half('T'|'B'), outs(0-2), runners(0-7 ビット: 1=一塁 2=二塁 4=三塁) }
// paEnd に 'SKIPPED'（終わりの球を記録しないまま閉じた打席。5.10）を渡したときは、アウト・走者は変わらない
function advanceSituation(sit, paEnd, outcome, outsAdded) {
  let outs = sit.outs + outsAddedByPaEnd(paEnd, outcome, outsAdded);
  let runners = sit.runners;
  if (paEnd === 'INPLAY' && outcome === 'HR') runners = 0;      // 本塁打は走者が全員かえる
  let inning = sit.inning, half = sit.half, halfChanged = false;
  if (outs >= 3) {                                              // 3アウトで攻守交代
    outs = 0; runners = 0; halfChanged = true;
    if (half === 'T') { half = 'B'; } else { half = 'T'; inning += 1; }
  }
  return { inning: inning, half: half, outs: outs, runners: runners, halfChanged: halfChanged };
}

// ---- ID（同じ時刻でも重ならない。4-10）----
let _idSeq = 0;
let _lastTime = 0;
function monoTime(nowMs) {               // 前より必ず大きい時刻
  _lastTime = Math.max(nowMs, _lastTime + 1);
  return _lastTime;
}
function newId(prefix, nowMs, rand01) {  // 例: p-lq2x9k8w-1-a3f
  _idSeq += 1;
  const t = monoTime(nowMs);
  const r = Math.floor(rand01 * 46656).toString(36).padStart(3, '0');
  return prefix + '-' + t.toString(36) + '-' + _idSeq.toString(36) + '-' + r;
}

// ---- 日付（1つの関数だけで決める。4-9）----
function dayStr(date) {
  const d = new Date(date.getTime() - DAY_START_HOUR * 3600 * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

// ---- 傾向の集計で「参考程度」と添えるか ----
function needsReferenceNote(n) { return n < MIN_SAMPLE_REFERENCE; }

// ---- 名前の候補（5.2）----
// games: 試合の配列（date・id・pitchers[{name,hand}]・batters[{name,side}] を持つ）
// 戻り値: { pitchers:[{name,hand}], batters:[{name,side}] }
// 日付の新しい試合が先。同じ名前は、いちばん新しい1つだけ（その左右を添える）。各 NAME_SUGGEST_MAX 件まで
function collectNameSuggestions(games) {
  const sorted = games.slice().sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;      // 日付の新しい順
    if (a.id !== b.id) return a.id < b.id ? 1 : -1;              // 同じ日は、IDの新しい順
    return 0;
  });
  const pit = new Map(), bat = new Map();
  for (const g of sorted) {
    const ps = (g.pitchers || []).slice().reverse();             // 1試合の中では、あとの投手が先
    for (const p of ps) {
      if (p && typeof p.name === 'string' && p.name !== '' && !pit.has(p.name)) pit.set(p.name, p.hand);
    }
    const bs = (g.batters || []).slice().reverse();
    for (const b of bs) {
      if (b && typeof b.name === 'string' && b.name !== '' && !bat.has(b.name)) bat.set(b.name, b.side);
    }
  }
  const out = { pitchers: [], batters: [] };
  pit.forEach(function (hand, name) { if (out.pitchers.length < NAME_SUGGEST_MAX) out.pitchers.push({ name: name, hand: hand }); });
  bat.forEach(function (side, name) { if (out.batters.length < NAME_SUGGEST_MAX) out.batters.push({ name: name, side: side }); });
  return out;
}

// ---- 画面を点けたままにする条件（5.9）----
// s: { enabled, tab('record' など), hasGame, visible, idleMs（最後の操作からの経過ミリ秒） }
function keepAwakeWanted(s) {
  return !!(s.enabled && s.tab === 'record' && s.hasGame && s.visible && s.idleMs < KEEP_AWAKE_IDLE_MIN * 60000);
}

if (typeof module !== 'undefined') {
  module.exports = { isStrikeZone, takenCallFromZone, hBand, zoneLabel, pullOppo, foulDirAuto,
    applyPitchToCount, outsAddedByPaEnd, advanceSituation, newId, dayStr, needsReferenceNote,
    collectNameSuggestions, keepAwakeWanted, RESULT };
}
