'use strict';
// ui-review.js（球録 v0.1.4）振り返りタブ：試合・打者を選び、「再生」（次の球ボタン）・一覧・ゾーン図・傾向で見る（11章）。
// 表示するだけで、「次はこの球」「待っている球」のような予想は出さない

const RV = {
  gameId: null, games: [], game: null, pas: [], pitches: [],
  batterId: 'ALL', filter: { count: 'ALL', type: 'ALL', result: 'ALL', side: 'ALL', paId: 'ALL' },
  view: 'play', idx: -1, list: [], play: null, loadErr: null
};

function rvPaOf(p) { for (const a of RV.pas) if (a.id === p.paId) return a; return null; }
function rvTypeName(code) { return typeInfo(code).name; }
function sideLabel(s) { return s === 'R' ? '右' : '左'; }
function countKey(p) { return p.sit.balls + '-' + p.sit.strikes; }

// 選んだ範囲の球（時間順）。batterId・filter（カウント・球種・結果・打席の左右・打席）で絞る
function filterPitches(pitches, pas, batterId, f) {
  const paMap = new Map(pas.map(function (a) { return [a.id, a]; }));
  return pitches.filter(function (p) {
    const a = paMap.get(p.paId);
    if (!a) return false;
    if (batterId !== 'ALL' && a.batterId !== batterId) return false;
    if (f.side !== 'ALL' && a.side !== f.side) return false;
    if (f.paId !== 'ALL' && a.id !== f.paId) return false;
    if (f.type !== 'ALL' && p.pitchType !== f.type) return false;
    if (f.result !== 'ALL' && p.result !== f.result) return false;
    if (f.count !== 'ALL' && countKey(p) !== f.count) return false;
    return true;
  });
}

// 1球の説明（文字だけ）
function reactionText(p) {
  if (p.result === 'TAKEN') return '見送った（' + (p.takenCall === 'S' ? 'ストライク' : 'ボール') + '判定）';
  if (p.result === 'MISS') return 'スイングして空振り';
  if (p.result === 'HBP') return '体に当たった（死球）';
  if (p.result === 'FOUL') return 'ファウル（' + (p.foulType ? FOUL_LABEL[p.foulType] : '') + (p.foulDir ? '・' + FOULDIR_LABEL[p.foulDir] : '') + '）';
  if (p.result === 'INPLAY' && p.inplay) {
    return '打った（' + KIND_LABEL[p.inplay.kind] + '・' + DIR_LABEL[p.inplay.dir] + '・' + OUTCOME_LABEL[p.inplay.outcome] +
      (Number.isInteger(p.inplay.outsAdded) ? '・アウト+' + p.inplay.outsAdded : '') + '）';
  }
  return RESULT_LABEL[p.result];
}
function marksText(p) { return p.marks && p.marks.length ? '【' + p.marks.map(function (m) { return MARK_LABEL[m]; }).join('・') + '】' : ''; }
function afterText(p, pa) {                      // この球のあとの状態
  const lastInPa = RV.pitches.filter(function (x) { return x.paId === p.paId; }).reduce(function (m, x) { return Math.max(m, x.paSeq); }, 0) === p.paSeq;
  const cnt = applyPitchToCount(p.sit.balls, p.sit.strikes, { result: p.result, takenCall: p.takenCall, caught: p.marks.indexOf('CAUGHT_OUT') >= 0 });
  if (lastInPa && pa) {
    if (pa.endType === 'SKIPPED') return 'この打席は、終わりの球が記録されていません';
    if (pa.endType === 'INPLAY' && pa.outcome) return '打席の結果：' + OUTCOME_LABEL[pa.outcome];
    if (pa.endType) return '打席の結果：' + END_LABEL[pa.endType];
  }
  return 'この球のあとのカウント：B' + cnt.balls + ' S' + cnt.strikes;
}

// ---- 読み込みと全体 ----
async function renderReview() {
  const panel = document.getElementById('panel-review');
  if (!panel) return;
  try {
    const lg = await listGames();
    RV.games = lg.games;
    if (!RV.gameId || !RV.games.some(function (g) { return g.id === RV.gameId; })) {
      RV.gameId = (typeof R !== 'undefined' && R.game && RV.games.some(function (g) { return g.id === R.game.id; })) ? R.game.id : (RV.games[0] ? RV.games[0].id : null);
      RV.batterId = 'ALL'; resetFilter(); RV.idx = -1;
    }
    if (RV.gameId) {
      const data = await loadGame(RV.gameId);            // 選んだ試合だけを読む（8.6）
      RV.game = data ? data.game : null; RV.pas = data ? data.pas : []; RV.pitches = data ? data.pitches : [];
    } else { RV.game = null; RV.pas = []; RV.pitches = []; }
    RV.loadErr = null;
  } catch (e) { RV.loadErr = e; }
  drawReview();
}
function resetFilter() { RV.filter = { count: 'ALL', type: 'ALL', result: 'ALL', side: 'ALL', paId: 'ALL' }; }
function refilter() { RV.list = filterPitches(RV.pitches, RV.pas, RV.batterId, RV.filter); }

function selectEl(id, label, options, value, onchange) {
  const sel = el('select', { id: id, 'aria-label': label }, options.map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === value }); }));
  sel.value = value;
  sel.addEventListener('change', function () { onchange(sel.value); });
  return el('label', { class: 'field slim' }, [el('span', { text: label }), sel]);
}

function drawReview() {
  const panel = document.getElementById('panel-review');
  if (!panel) return;
  if (RV.play && RV.play.svg && RV.play.svg._raf) cancelAnimationFrame(RV.play.svg._raf);
  panel.textContent = '';
  const stack = el('div', { class: 'stack' });
  if (RV.loadErr) { stack.appendChild(el('p', { class: 'notice error', text: (RV.loadErr.code === 'NO_IDB') ? MSG.NO_DB : MSG.SAVE_FAIL(RV.loadErr.message || '不明') })); panel.appendChild(stack); return; }
  if (!RV.game) { stack.appendChild(el('p', { class: 'notice', text: 'まだ記録がありません。記録タブで試合を始めて、球を記録してください。' })); panel.appendChild(stack); return; }
  refilter();
  // 選ぶ：試合 → 打者 → 絞り込み
  const gameOpts = RV.games.map(function (g) { const p = g.pitchers[g.pitchers.length - 1]; return [g.id, g.date + '　投手：' + p.name]; });
  const batters = []; const seen = new Set();
  RV.pas.forEach(function (a) { if (!seen.has(a.batterId)) { seen.add(a.batterId); batters.push([a.batterId, a.batterName]); } });
  const paOpts = [['ALL', 'すべて']].concat(RV.pas.filter(function (a) { return RV.batterId === 'ALL' || a.batterId === RV.batterId; }).map(function (a) {
    return [a.id, '第' + a.paNo + '打席 ' + a.batterName + '（' + sideLabel(a.side) + '）' + (a.endType ? '：' + END_LABEL[a.endType] : '：途中')];
  }));
  const usedTypes = []; RV.pitches.forEach(function (p) { if (usedTypes.indexOf(p.pitchType) < 0) usedTypes.push(p.pitchType); });
  const sel = el('div', { class: 'card sel-card' }, [
    selectEl('rv-game', '試合', gameOpts, RV.gameId, function (v) { RV.gameId = v; RV.batterId = 'ALL'; resetFilter(); RV.idx = -1; renderReview(); }),
    selectEl('rv-batter', '打者', [['ALL', 'すべての打者']].concat(batters), RV.batterId, function (v) { RV.batterId = v; RV.filter.paId = 'ALL'; RV.idx = -1; drawReview(); }),
    el('details', { class: 'filters' }, [
      el('summary', { text: '絞り込み（なくてもよい）' + (filterActive() ? '：あり' : '') }),
      selectEl('rv-pa', '打席', paOpts, RV.filter.paId, function (v) { RV.filter.paId = v; RV.idx = -1; drawReview(); }),
      selectEl('rv-count', 'カウント（ボール-ストライク）', [['ALL', 'すべて']].concat(COUNT_LIST.map(function (c) { return [c, c]; })), RV.filter.count, function (v) { RV.filter.count = v; RV.idx = -1; drawReview(); }),
      selectEl('rv-type', '球種', [['ALL', 'すべて']].concat(usedTypes.map(function (c) { return [c, rvTypeName(c)]; })), RV.filter.type, function (v) { RV.filter.type = v; RV.idx = -1; drawReview(); }),
      selectEl('rv-result', '結果', [['ALL', 'すべて']].concat(RESULT_ORDER.map(function (r) { return [r, RESULT_LABEL[r]]; })), RV.filter.result, function (v) { RV.filter.result = v; RV.idx = -1; drawReview(); }),
      selectEl('rv-side', '打席の左右', [['ALL', 'すべて'], ['R', '右打席'], ['L', '左打席']], RV.filter.side, function (v) { RV.filter.side = v; RV.idx = -1; drawReview(); })
    ])
  ]);
  stack.appendChild(sel);
  stack.appendChild(el('div', { class: 'seg', role: 'tablist' }, REVIEW_VIEWS.map(function (v) {
    return el('button', { type: 'button', class: 'btn seg-btn' + (RV.view === v[0] ? ' on' : ''), 'data-view': v[0], role: 'tab', 'aria-selected': RV.view === v[0] ? 'true' : 'false', text: v[1], onclick: function () { RV.view = v[0]; drawReview(); } });
  })));
  stack.appendChild(el('p', { class: 'sub', id: 'rv-count-line', text: '選んだ範囲：' + RV.list.length + '球' }));
  if (RV.list.length === 0) stack.appendChild(el('p', { class: 'notice', text: '条件に合う球がありません。絞り込みを変えてください。' }));
  else if (RV.view === 'play') stack.appendChild(buildPlay());
  else if (RV.view === 'list') stack.appendChild(buildPitchList(RV.filter));
  else if (RV.view === 'zone') stack.appendChild(buildZoneView());
  else stack.appendChild(buildTendency(RV.list, RV.filter));
  panel.appendChild(stack);
}
function filterActive() { const f = RV.filter; return f.count !== 'ALL' || f.type !== 'ALL' || f.result !== 'ALL' || f.side !== 'ALL' || f.paId !== 'ALL'; }

// ---- 再生（次の球ボタン。シルエットの動き）----
function buildPlay() {
  const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('class', 'sil-svg');
  const field = document.createElementNS(SVGNS, 'svg'); field.setAttribute('class', 'fd-svg');
  const info = {
    head: el('p', { id: 'rv-head', class: 'rv-head' }), pos: el('p', { id: 'rv-pos', class: 'rv-pos' }),
    type: el('p', { id: 'rv-type-line' }), course: el('p', { id: 'rv-course' }), react: el('p', { id: 'rv-react', class: 'rv-react' }),
    after: el('p', { id: 'rv-after', class: 'sub' }), mini: el('div', { id: 'rv-mini' })
  };
  const btn = function (id, label, fn) { return el('button', { type: 'button', class: 'btn', id: id, text: label, onclick: fn }); };
  const next = el('button', { type: 'button', class: 'btn primary big-next', id: 'rv-next', text: '次の球', onclick: function () { rvStep(1); } });
  const prev = btn('rv-prev', '前の球', function () { rvStep(-1); });
  const again = btn('rv-again', 'もう一度', function () { rvStep(0); });
  const first = btn('rv-first', '最初から', function () { rvGo(-1); });
  RV.play = { svg: svg, field: field, info: info, next: next, prev: prev, again: again, first: first };
  const firstPa = RV.list.length ? rvPaOf(RV.list[0]) : null;
  drawSilhouette(svg, RV.idx >= 0 && RV.list[RV.idx] && rvPaOf(RV.list[RV.idx]) ? rvPaOf(RV.list[RV.idx]).side : (firstPa ? firstPa.side : 'R'));
  drawField(field);
  const box = el('div', { class: 'card play' }, [
    el('div', { class: 'play-figs' }, [el('div', { class: 'sil-wrap' }, svg), el('div', { class: 'fd-wrap' }, [field, el('p', { class: 'sub fd-cap', text: '打球の行き先（目安）' })])]),
    info.head, info.pos, info.type, info.course, info.react, info.after,
    el('div', { class: 'btn-row wrap play-btns' }, [first, prev, next, again]),
    el('h2', { text: 'この打席の、ここまでの球' }), info.mini
  ]);
  rvShow(false);
  return box;
}
function rvGo(i) { RV.idx = Math.max(-1, Math.min(RV.list.length - 1, i)); rvShow(true); }
function rvStep(d) { if (d === 0) { if (RV.idx < 0) RV.idx = 0; rvShow(true); return; } rvGo(RV.idx + d); }
// いまの球の説明を出し、動きを再生する
function rvShow(animate) {
  const pl = RV.play; if (!pl) return;
  const i = RV.idx, n = RV.list.length;
  pl.prev.disabled = i <= 0; pl.next.disabled = i >= n - 1; pl.again.disabled = i < 0; pl.first.disabled = i < 0;
  pl.next.textContent = i >= n - 1 ? '最後の球です' : '次の球';
  const inf = pl.info;
  if (i < 0) {
    inf.head.textContent = '「次の球」を押すと、1球ずつ再生します'; inf.pos.textContent = '全 ' + n + ' 球';
    inf.type.textContent = ''; inf.course.textContent = ''; inf.react.textContent = ''; inf.after.textContent = ''; inf.mini.textContent = '';
    drawSilhouette(pl.svg, (RV.list[0] && rvPaOf(RV.list[0])) ? rvPaOf(RV.list[0]).side : 'R'); drawField(pl.field);
    return;
  }
  const p = RV.list[i]; const pa = rvPaOf(p); const side = pa ? pa.side : 'R';
  inf.head.textContent = '第' + (pa ? pa.paNo : '?') + '打席　' + (pa ? pa.batterName : '') + '（' + sideLabel(side) + '打席）　投手：' + p.pitcher.name + '（' + sideLabel(p.pitcher.hand) + '）';
  inf.pos.textContent = '球 ' + (i + 1) + ' / ' + n + '　（この打席の ' + p.paSeq + ' 球目）　投げる前のカウント：B' + p.sit.balls + ' S' + p.sit.strikes + (p.sitEdited ? '　※状況を修正' : '');
  inf.type.textContent = '球種：' + rvTypeName(p.pitchType);
  inf.course.textContent = 'コース：' + zoneLabel(p.row, p.col, side) + (isStrikeZone(p.row, p.col) ? '（ストライクゾーン）' : '（ボールゾーン）');
  inf.react.textContent = '打者の反応：' + reactionText(p) + ' ' + marksText(p);
  inf.after.textContent = afterText(p, pa) + (p.memo ? '　メモ：' + p.memo : '');
  if (!pl.svg._parts || pl.svg._parts.side !== side) { drawSilhouette(pl.svg, side); }
  playMotion(pl.svg, p, { field: pl.field });
  inf.mini.textContent = '';
  const upto = RV.list.filter(function (x) { return x.paId === p.paId && x.seq <= p.seq; });
  inf.mini.appendChild(drawZoneChart(upto, side, true));
}

// ---- 一覧 ----
function buildPitchList(filter) {
  const rows = [];
  RV.list.forEach(function (p, i) {
    const pa = rvPaOf(p);
    let t = '#' + p.seq + '　第' + (pa ? pa.paNo : '?') + '打席 ' + p.paSeq + '球目　B' + p.sit.balls + ' S' + p.sit.strikes + '　' + rvTypeName(p.pitchType) + '　' + zoneLabel(p.row, p.col, pa ? pa.side : 'R') + '　' + RESULT_LABEL[p.result];
    if (p.result === 'TAKEN') t += '（' + (p.takenCall === 'S' ? 'ストライク' : 'ボール') + '）';
    if (p.result === 'FOUL' && p.foulType) t += '・' + FOUL_LABEL[p.foulType];
    if (p.inplay) t += '・' + KIND_LABEL[p.inplay.kind] + '・' + DIR_LABEL[p.inplay.dir] + '・' + OUTCOME_LABEL[p.inplay.outcome] + (Number.isInteger(p.inplay.outsAdded) ? '（アウト+' + p.inplay.outsAdded + '）' : '');
    t += ' ' + marksText(p);
    if (p.sitEdited) t += '　※状況を修正';
    if (p.memo) t += '　メモ：' + p.memo;
    const ti = typeInfo(p.pitchType);
    rows.push(el('button', { type: 'button', class: 'list-row', 'data-idx': i, onclick: function () { RV.view = 'play'; RV.idx = i; drawReview(); } }, [
      el('span', { class: 'dot', style: { background: ti.color }, text: ti.code }), el('span', { class: 'recent-text', text: t })
    ]));
    const maxSeq = RV.pitches.filter(function (x) { return x.paId === p.paId; }).reduce(function (m, x) { return Math.max(m, x.paSeq); }, 0);
    if (pa && pa.endType === 'SKIPPED' && p.paSeq === maxSeq) rows.push(el('p', { class: 'skipped-note', text: '終わりの球の記録なし（第' + pa.paNo + '打席）' }));
  });
  return el('div', { class: 'card', id: 'rv-list' }, [el('h2', { text: '一覧（押すと、その球から再生します）' }), el('div', { class: 'recent-list' }, rows)]);
}

// ---- ゾーン図 ----
const RESULT_RING = { TAKEN: 'ring-taken', MISS: 'ring-miss', FOUL: 'ring-foul', INPLAY: 'ring-inplay', HBP: 'ring-hbp' };
// 25マスに、球を点で重ねる。球種の色と2文字、結果は点の外枠（見逃し＝細い実線／空振り＝二重線／ファウル＝点線／インプレー＝太い実線／死球＝破線）
function drawZoneChart(pitches, side, compact) {
  const byCell = {};
  pitches.forEach(function (p) { const k = p.row + '-' + p.col; (byCell[k] = byCell[k] || []).push(p); });
  const cells = [];
  for (let r = 1; r <= 5; r++) for (let c = 1; c <= 5; c++) {
    const list = byCell[r + '-' + c] || [];
    const shown = list.slice(0, 6).map(function (p) {
      const ti = typeInfo(p.pitchType);
      return el('span', { class: 'zdot ' + RESULT_RING[p.result], style: { background: ti.color }, title: rvTypeName(p.pitchType) + '・' + RESULT_LABEL[p.result], text: ti.code });
    });
    if (list.length > 6) shown.push(el('span', { class: 'zmore', text: '×' + list.length }));
    cells.push(el('div', { class: 'zc ' + (isStrikeZone(r, c) ? 'in' : 'out') }, shown));
  }
  const cap = side ? el('p', { class: 'zone-cap ' + (side === 'R' ? 'right' : 'left'), text: side === 'R' ? '内角側 ▶' : '◀ 内角側' }) : null;
  return el('div', { class: 'zchart' + (compact ? ' compact' : '') }, [cap, el('div', { class: 'zgrid' }, cells)]);
}
function buildZoneView() {
  const sides = new Set(RV.list.map(function (p) { const a = rvPaOf(p); return a ? a.side : 'R'; }));
  const side = sides.size === 1 ? Array.from(sides)[0] : null;      // 左右が混ざるときは、内角側の表示を出さない
  return el('div', { class: 'card', id: 'rv-zone' }, [
    el('h2', { text: 'ゾーン図（投手から見て）' }),
    side ? null : el('p', { class: 'sub', text: '右打席と左打席が混ざっています。絞り込みの「打席の左右」で分けられます。' }),
    drawZoneChart(RV.list, side, false),
    el('p', { class: 'sub', text: '点の色と文字は球種。外枠：見逃し＝細い実線／空振り＝二重線／ファウル＝点線／インプレー＝太い実線／死球＝破線' })
  ]);
}

// ---- 傾向（集計だけ。予想は出さない）----
function pct(n, total) { return total ? Math.round(n * 1000 / total) / 10 + '%' : '－'; }
function tableOf(headers, rows) {
  return el('table', { class: 'tbl' }, [
    el('thead', null, el('tr', null, headers.map(function (h) { return el('th', { text: h }); }))),
    el('tbody', null, rows.map(function (r) { return el('tr', null, r.map(function (c, i) { return el(i === 0 ? 'th' : 'td', { text: String(c) }); })); }))
  ]);
}
function buildTendency(pitches, filter) {
  const n = pitches.length;
  const box = el('div', { class: 'card', id: 'rv-trend' }, [el('h2', { text: '傾向（選んだ範囲の集計）' })]);
  if (needsReferenceNote(n)) box.appendChild(el('p', { class: 'notice warn', text: '球数が少ないので参考程度です（' + n + '球）' }));
  box.appendChild(el('p', { class: 'sub', text: '数えただけの表です。次の球を予想するものではありません。割合は、選んだ範囲の球数（' + n + '球）に対する値です。' }));
  // ① 球種
  const tc = {}; pitches.forEach(function (p) { tc[p.pitchType] = (tc[p.pitchType] || 0) + 1; });
  box.appendChild(el('h3', { text: '① 球種の回数' }));
  box.appendChild(tableOf(['球種', '回数', '割合'], Object.keys(tc).sort(function (a, b) { return tc[b] - tc[a]; }).map(function (c) { return [rvTypeName(c), tc[c], pct(tc[c], n)]; })));
  // ② 25マス
  const zc = {}; pitches.forEach(function (p) { const k = p.row + '-' + p.col; zc[k] = (zc[k] || 0) + 1; });
  const zrows = [];
  for (let r = 1; r <= 5; r++) { const row = [V_LABEL[r]]; for (let c = 1; c <= 5; c++) row.push(zc[r + '-' + c] || 0); zrows.push(row); }
  box.appendChild(el('h3', { text: '② 25マスごとの回数（投手から見て・左が1列目）' }));
  box.appendChild(tableOf(['', '1列', '2列', '3列', '4列', '5列'], zrows));
  // ③ 結果
  const rc = {}; pitches.forEach(function (p) { rc[p.result] = (rc[p.result] || 0) + 1; });
  box.appendChild(el('h3', { text: '③ 結果の回数' }));
  box.appendChild(tableOf(['結果', '回数', '割合'], RESULT_ORDER.filter(function (r) { return rc[r]; }).map(function (r) { return [RESULT_LABEL[r], rc[r], pct(rc[r], n)]; })));
  const oc = {}; pitches.forEach(function (p) { if (p.inplay) oc[p.inplay.outcome] = (oc[p.inplay.outcome] || 0) + 1; });
  const orows = OUTCOME_ORDER.filter(function (o) { return oc[o]; }).map(function (o) { return [OUTCOME_LABEL[o], oc[o]]; });
  if (orows.length) { box.appendChild(el('h3', { text: 'インプレーの結果' })); box.appendChild(tableOf(['結果', '回数'], orows)); }
  // ④ カウントごと（絞り込みでカウントを選んでいないとき）
  if (filter.count === 'ALL') {
    const types = Object.keys(tc);
    const rows = COUNT_LIST.map(function (ck) {
      const sub = pitches.filter(function (p) { return countKey(p) === ck; });
      return [ck].concat(types.map(function (t) { return sub.filter(function (p) { return p.pitchType === t; }).length; }), [sub.length]);
    }).filter(function (r) { return r[r.length - 1] > 0; });
    box.appendChild(el('h3', { text: '④ カウントごとの球種の回数（ボール-ストライク）' }));
    box.appendChild(el('div', { class: 'scroll-x' }, tableOf(['カウント'].concat(types.map(rvTypeName), ['計']), rows)));
  }
  return box;
}
