'use strict';
// ui-record.js（球録 v0.3.1）記録タブ。利用者が入れた文字は、すべて textContent で出す

// 画面の部品を作る小さな関数（ほかのファイルからも使う）
function el(tag, attrs, kids) {
  const e = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k === 'value') e.value = v;
      else if (k === 'checked') e.checked = true;
      else if (k === 'disabled') e.disabled = true;
      else if (k === 'hidden') e.hidden = true;
      else if (k === 'style') Object.assign(e.style, v);
      else if (k.indexOf('on') === 0 && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : String(v));
    });
  }
  if (kids !== undefined && kids !== null) {
    (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
  }
  return e;
}

// ---- 記録タブの状態 ----
const R = {
  ready: false, dbError: null,
  state: 'NO_GAME',          // 9.1の状態
  game: null, pas: [], pitches: [],
  types: [],                 // 球種の一覧（meta）
  draft: null,               // 入力の途中の内容（保存前）
  isSaving: false,
  selectedPitchId: null,
  editing: null,             // 帯の修正：null | 'inning' | 'count' | 'outs'
  form: null,                // null | 'pitcher' | 'batter'（IDLEのときの入力欄）
  emphasize: false,          // 打席を閉じた直後：アウトと走者を強調
  lastPitchType: null,
  suggestions: { pitchers: [], batters: [] },
  banners: [],               // 記録タブの上に出す文
  notice: { text: '', error: false }
};
let _flashTimer = null;

function typeInfo(code) {
  for (const t of R.types) if (t.code === code) return t;
  return { code: code, name: code, color: '#E5E7EB' };
}
function curPa() {
  if (!R.game || !R.game.liveSit.openPaId) return null;
  const id = R.game.liveSit.openPaId;
  for (const a of R.pas) if (a.id === id) return a;
  return null;
}
function curPitcher() { return R.game.pitchers[R.game.pitchers.length - 1]; }
function paPitchCount(paId) { return R.pitches.filter(function (p) { return p.paId === paId; }).length; }
// ボール（黄）・ストライク（緑）・アウト（赤）を、丸で出す。ついている数だけ塗りつぶす
function bsoGroup(letter, kind, n, max) {
  const kids = [el('span', { class: 'bso-l', text: letter })];
  for (let i = 0; i < max; i++) kids.push(el('span', { class: 'bso-dot bso-' + kind + (i < n ? ' on' : '') }));
  return el('span', { class: 'bso-g' }, kids);
}
function sitText(s) {
  return { inning: s.inning + '回' + (s.half === 'T' ? '表' : '裏'), count: 'B' + s.balls + ' S' + s.strikes, outs: s.outs + 'アウト' };
}

// ---- 通知（入力欄を作り直さずに、1か所だけ書き換える）----
function showNotice(text, isError) {
  R.notice = { text: text || '', error: !!isError };
  const n = document.getElementById('record-notice');
  if (n) { n.textContent = R.notice.text; n.hidden = !R.notice.text; n.className = 'notice' + (isError ? ' error' : ''); }
}

// ---- 起動・読み込み ----
async function recordInit() {
  try {
    R.types = await getPitchTypes();
    const lg = await listGames();
    R.suggestions = collectNameSuggestions(lg.games);
    R.suggestions.lastTypes = lg.games.length ? lg.games[0].pitchers[lg.games[0].pitchers.length - 1].pitchTypes : null;
    R.banners = [];
    if (lg.unreadable > 0) R.banners.push(MSG.UNREADABLE(lg.unreadable));
    let lastId = null;
    try { lastId = localStorage.getItem(LS_LAST_GAME); } catch (e) { lastId = null; }
    if (lastId) { await openGameById(lastId); }
    await refreshReminders();
    R.ready = true;
  } catch (e) {
    R.dbError = e;
  }
  renderRecord();
}
async function openGameById(gameId) {
  const data = await loadGame(gameId);
  if (!data || !isReadableGame(data.game)) { R.game = null; R.pas = []; R.pitches = []; R.state = 'NO_GAME'; return false; }
  R.game = data.game; R.pas = data.pas; R.pitches = data.pitches;
  R.draft = null; R.editing = null; R.form = null; R.selectedPitchId = null; R.emphasize = false;
  if (R.game.liveSit.openPaId && !curPa()) { R.game.liveSit.openPaId = null; }
  R.state = R.game.liveSit.openPaId ? 'AWAIT_RESULT' : 'IDLE';
  const last = R.pitches[R.pitches.length - 1];
  R.lastPitchType = last ? last.pitchType : null;
  try { localStorage.setItem(LS_LAST_GAME, gameId); } catch (e) { /* 何もしない */ }
  return true;
}
async function reloadGame() {
  const data = await loadGame(R.game.id);
  R.game = data.game; R.pas = data.pas; R.pitches = data.pitches;
  R.state = R.game.liveSit.openPaId ? 'AWAIT_RESULT' : 'IDLE';
  R.draft = null; R.editing = null;
}
async function refreshReminders() {
  const msgs = [];
  try {
    const lastAt = await getMeta('lastExportAt');
    const lastCount = await getMeta('lastExportPitchCount');
    const total = await countPitches();
    if (typeof lastAt !== 'number') {
      if (total >= 1) msgs.push(MSG.EXPORT_REMIND_NEVER);
    } else {
      const days = Math.floor((Date.now() - lastAt) / 86400000);
      if (days >= EXPORT_REMIND_DAYS) msgs.push(MSG.EXPORT_REMIND(days));
      else if (typeof lastCount === 'number' && total - lastCount >= EXPORT_REMIND_PITCHES) msgs.push(MSG.EXPORT_REMIND_PITCHES(total - lastCount));
    }
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      if (est && est.quota && est.usage / est.quota > STORAGE_WARN_RATIO) msgs.push(MSG.STORAGE_WARN);
    }
  } catch (e) { /* 催促が出せなくても、記録は続ける */ }
  const keep = R.banners.filter(function (b) { return b.indexOf('読めない記録') === 0; });
  R.banners = keep.concat(msgs);
}

// ---- 保存中の二度押し防止（8.4）----
function setBusy(on) {
  R.isSaving = on;
  const p = document.getElementById('panel-record');
  if (!p) return;
  p.classList.toggle('busy', on);
  p.querySelectorAll('button, input, select').forEach(function (b) {
    if (on) { if (b.disabled && !b.hasAttribute('data-busy')) b.setAttribute('data-keep-disabled', '1'); b.setAttribute('data-busy', '1'); b.disabled = true; }
    else if (b.hasAttribute('data-busy')) { b.disabled = b.hasAttribute('data-keep-disabled'); b.removeAttribute('data-busy'); b.removeAttribute('data-keep-disabled'); }
  });
}
// 保存などの処理を、二重に走らせずに行う。失敗したら理由を出す
async function runSaving(fn) {
  if (R.isSaving) return false;
  setBusy(true);
  try {
    await fn();
    setBusy(false);
    return true;
  } catch (e) {
    setBusy(false);
    showNotice(MSG.SAVE_FAIL(e && e.message ? e.message : String(e)), true);
    return false;
  }
}

// ---- 描画 ----
// 記録タブの画面：① 状況・投手・打者 → ② 結果 → ③ コース・球種 → ④ ファウル・インプレーのくわしい結果
function recordScreen() {
  if (R.state === 'IDLE' || (R.showSit && R.state === 'AWAIT_RESULT')) return 1;
  if (R.state === 'AWAIT_RESULT') return 2;
  if (R.state === 'AWAIT_ZONE' || R.state === 'AWAIT_TYPE') return 3;
  return 4;
}
const STEP_NAMES = ['① 状況・打者', '② 結果', '③ コース・球種', '④ くわしく'];
function buildStepNav(scr) {
  return el('div', { id: 'step-nav', class: 'step-nav', role: 'list' }, STEP_NAMES.map(function (n, i) {
    return el('span', { class: 'step-chip' + (scr === i + 1 ? ' on' : ''), role: 'listitem', 'aria-current': scr === i + 1 ? 'step' : null, text: n });
  }));
}
// ②〜④の画面の上に出す、いまの状況の要約（押すと①へ）
function buildSitSummary() {
  const s = R.game.liveSit, t = sitText(s), pa = curPa(), p = curPitcher();
  const runners = [[1, '一'], [2, '二'], [4, '三']].filter(function (d) { return (s.runners & d[0]) !== 0; }).map(function (d) { return d[1]; }).join('・');
  return el('div', { id: 'sit-summary', class: 'card sum-card' }, [
    el('p', { class: 'sum-line' }, [
      el('strong', { text: t.inning + '　' }), bsoGroup('B', 'b', s.balls, 3), bsoGroup('S', 's', s.strikes, 2), bsoGroup('O', 'o', s.outs, 2),
      el('span', { text: '　走者：' + (runners || 'なし') })
    ]),
    el('p', { class: 'sum-line sub' }, [el('span', { text: '投手：' + p.name + '（' + (p.hand === 'R' ? '右' : '左') + '）　打者：' + (pa ? pa.batterName + '（' + (pa.side === 'R' ? '右' : '左') + '）' : '') + '　' + (pa ? pa.paNo + '打席目' : '') })]),
    R.state === 'AWAIT_RESULT' ? el('button', { type: 'button', class: 'btn small', id: 'to-sit-btn', text: '① 状況・打者を直す', onclick: function () { R.showSit = true; renderRecord(); } }) : null
  ]);
}
function backToResult() {
  if (R.isSaving) return;
  R.draft = null; R.state = R.game.liveSit.openPaId ? 'AWAIT_RESULT' : 'IDLE'; renderRecord();
}
function backToZone() {
  if (R.isSaving) return;
  if (R.draft) { R.draft.foulType = null; R.draft.foulDir = undefined; R.draft.kind = null; R.draft.dir = null; R.draft.outcome = null; R.draft.outsAdded = null; }
  R.state = 'AWAIT_TYPE'; renderRecord();
}
function renderRecord() {
  const panel = document.getElementById('panel-record');
  if (!panel) return;
  panel.textContent = '';
  const kids = [];
  if (R.dbError) {
    const noDb = R.dbError.code === 'NO_IDB';
    const newer = R.dbError.code === 'VERSION';
    kids.push(el('p', { class: 'notice error', text: noDb ? MSG.NO_DB : (newer ? MSG.NEWER_DB : MSG.SAVE_FAIL(R.dbError.message || '不明')) }));
    panel.appendChild(el('div', { class: 'stack' }, kids));
    return;
  }
  R.banners.forEach(function (b) { kids.push(el('p', { class: 'banner', text: b })); });
  kids.push(el('p', { id: 'awake-status', class: 'awake', hidden: true }));
  kids.push(el('p', { id: 'record-notice', class: 'notice' + (R.notice.error ? ' error' : ''), text: R.notice.text, hidden: !R.notice.text, role: 'status' }));
  if (!R.game) {
    kids.push(buildStartForm());
  } else {
    if (R.state !== 'AWAIT_RESULT') R.showSit = false;
    const scr = recordScreen();
    kids.push(buildStepNav(scr));
    if (scr === 1) {                                                   // ① 状況・投手・打者
      kids.push(buildSituationBar());
      kids.push(buildGameLine());
      if (R.form === 'pitcher') kids.push(buildPitcherChangeForm());
      if (R.form === 'batter') kids.push(buildBatterSwapForm());
      kids.push(buildBatterBar());
      if (R.state === 'AWAIT_RESULT') kids.push(el('button', { type: 'button', class: 'btn primary wide', id: 'to-result-btn', text: '② 結果の入力へ', onclick: function () { R.showSit = false; R.editing = null; renderRecord(); } }));
    } else {
      kids.push(buildSitSummary());
      if (scr === 2) kids.push(buildResultBar());                      // ② 結果
      else if (scr === 3) {                                            // ③ コース・球種
        kids.push(el('button', { type: 'button', class: 'btn back-btn', id: 'back-result-btn', text: '← ② 結果を選び直す', onclick: backToResult }));
        kids.push(buildZone());
        kids.push(buildStepArea());
      } else {                                                         // ④ ファウル・インプレーのくわしい結果
        kids.push(el('button', { type: 'button', class: 'btn back-btn', id: 'back-zone-btn', text: '← ③ コース・球種に戻る', onclick: backToZone }));
        kids.push(buildStepArea());
      }
    }
    kids.push(buildUndoRow());
    if (scr <= 2) kids.push(buildRecentList());
  }
  panel.appendChild(el('div', { class: 'stack' }, kids));
  fillNameSuggestions();
  if (typeof awakeShow === 'function') awakeShow();
  if (R.isSaving) setBusy(true);
}

// ---- 試合の開始（5.2）----
function typeCheckboxes(prefix, selected) {
  return R.types.map(function (t) {
    return el('label', { class: 'chk' }, [
      el('input', { type: 'checkbox', 'data-code': t.code, checked: selected.indexOf(t.code) >= 0 }),
      el('span', { class: 'dot', style: { background: t.color }, text: t.code }),
      el('span', { text: t.name })
    ]);
  });
}
function handRadios(name, value, label) {
  return el('span', { class: 'radios' }, [
    el('label', { class: 'rad' }, [el('input', { type: 'radio', name: name, value: 'R', checked: value === 'R' }), el('span', { text: label[0] })]),
    el('label', { class: 'rad' }, [el('input', { type: 'radio', name: name, value: 'L', checked: value === 'L' }), el('span', { text: label[1] })])
  ]);
}
function previousStartTypes() {
  const last = R.suggestions && R.suggestions.lastTypes;
  return (last && last.length) ? last : DEFAULT_START_TYPES;
}
function buildStartForm() {
  const today = dayStr(new Date());
  const rows = [];
  for (let i = 1; i <= BATTER_MAX; i++) {
    rows.push(el('div', { class: 'row-form' }, [
      el('input', { type: 'text', id: 'in-batter-' + i, list: 'dl-batter-names', maxlength: NAME_MAX, placeholder: '打者' + i + (i === 1 ? '（必須）' : '（なくてもよい）'), autocomplete: 'off', 'aria-label': '打者' + i + 'の名前' }),
      handRadios('batterSide' + i, 'R', ['右打席', '左打席'])
    ]));
  }
  const form = el('div', { class: 'card', id: 'start-form' }, [
    el('h2', { text: '試合を始める' }),
    el('label', { class: 'field' }, [el('span', { text: '日付' }), el('input', { type: 'date', id: 'in-date', value: today })]),
    el('label', { class: 'field' }, [el('span', { text: '投手の名前' }), el('input', { type: 'text', id: 'in-pitcher', list: 'dl-pitcher-names', maxlength: NAME_MAX, placeholder: '1〜' + NAME_MAX + '字', autocomplete: 'off' })]),
    el('div', { class: 'field' }, [el('span', { text: '投手の右投・左投' }), handRadios('pitcherHand', 'R', ['右投', '左投'])]),
    el('div', { class: 'field' }, [el('span', { text: '使う球種（1つ以上）' }), el('div', { class: 'chips', id: 'in-types' }, typeCheckboxes('st', previousStartTypes()))]),
    el('div', { class: 'field' }, [el('span', { text: '追う打者（1〜' + BATTER_MAX + '人）' }), el('div', null, rows)]),
    el('datalist', { id: 'dl-pitcher-names' }),
    el('datalist', { id: 'dl-batter-names' }),
    el('button', { class: 'btn primary', id: 'start-btn', type: 'button', text: '試合を始める', onclick: startGame })
  ]);
  // 候補から選んだとき、前の左右を最初から選ぶ
  form.addEventListener('change', function (ev) {
    const t = ev.target;
    if (!t || !t.id) return;
    if (t.id === 'in-pitcher') {
      const f = R.suggestions.pitchers.find(function (p) { return p.name === t.value; });
      if (f) { const r = document.querySelector('input[name="pitcherHand"][value="' + f.hand + '"]'); if (r) r.checked = true; }
    } else if (t.id.indexOf('in-batter-') === 0) {
      const n = t.id.slice('in-batter-'.length);
      const f = R.suggestions.batters.find(function (b) { return b.name === t.value; });
      if (f) { const r = document.querySelector('input[name="batterSide' + n + '"][value="' + f.side + '"]'); if (r) r.checked = true; }
    }
  });
  return form;
}
// 過去の試合から名前の候補を作り、入力欄に付ける（5.2）。option は createElement と .value で作る
function fillNameSuggestions() {
  [['dl-pitcher-names', R.suggestions.pitchers], ['dl-batter-names', R.suggestions.batters]].forEach(function (pair) {
    const dl = document.getElementById(pair[0]);
    if (!dl) return;
    dl.textContent = '';
    pair[1].forEach(function (s) { const o = document.createElement('option'); o.value = s.name; dl.appendChild(o); });
  });
}
function readChecked(container) {
  const out = [];
  container.querySelectorAll('input[type="checkbox"]').forEach(function (c) { if (c.checked) out.push(c.getAttribute('data-code')); });
  return out;
}
function radioValue(name) {
  const r = document.querySelector('input[name="' + name + '"]:checked');
  return r ? r.value : 'R';
}
async function startGame() {
  const date = document.getElementById('in-date').value || dayStr(new Date());
  const pName = document.getElementById('in-pitcher').value.trim();
  if (pName.length < 1 || pName.length > NAME_MAX) { showNotice('投手の名前を1〜' + NAME_MAX + '字で入れてください', true); return; }
  const types = readChecked(document.getElementById('in-types'));
  if (types.length < 1) { showNotice('使う球種を1つ以上選んでください', true); return; }
  const batters = [];
  for (let i = 1; i <= BATTER_MAX; i++) {
    const nm = document.getElementById('in-batter-' + i).value.trim();
    if (nm === '') continue;
    if (nm.length > NAME_MAX) { showNotice('打者の名前は' + NAME_MAX + '字までです', true); return; }
    batters.push({ id: 'b' + (batters.length + 1), name: nm, side: radioValue('batterSide' + i) });
  }
  if (batters.length < 1) { showNotice('追う打者を1人以上入れてください', true); return; }
  if (new Set(batters.map(function (b) { return b.name; })).size !== batters.length) { showNotice('同じ名前の打者がいます。名前を分けてください', true); return; }
  const game = {
    id: newId('g', Date.now(), Math.random()), date: date,
    pitchers: [{ name: pName, hand: radioValue('pitcherHand'), pitchTypes: types }],
    batters: batters,
    liveSit: { inning: 1, half: 'T', outs: 0, runners: 0, balls: 0, strikes: 0, openPaId: null, edited: false },
    batterSeq: batters.length, createdAt: Date.now(), note: ''
  };
  const ok = await runSaving(function () { return saveGameTx(game); });
  if (!ok) return;
  R.game = game; R.pas = []; R.pitches = []; R.state = 'IDLE'; R.draft = null; R.lastPitchType = types[0];
  try { localStorage.setItem(LS_LAST_GAME, game.id); } catch (e) { /* 何もしない */ }
  showNotice('', false);
  renderRecord();
  if (typeof awakeRefresh === 'function') awakeRefresh();
}
// 試合を閉じて、別の試合を始める画面に戻る（記録は残る）
function leaveGame() {
  if (R.isSaving) return;
  R.game = null; R.pas = []; R.pitches = []; R.state = 'NO_GAME'; R.draft = null; R.form = null;
  try { localStorage.removeItem(LS_LAST_GAME); } catch (e) { /* 何もしない */ }
  recordRefreshSuggestions().then(function () { renderRecord(); if (typeof awakeRefresh === 'function') awakeRefresh(); });
}
async function recordRefreshSuggestions() {
  try {
    const lg = await listGames();
    R.suggestions = collectNameSuggestions(lg.games);
    R.suggestions.lastTypes = lg.games.length ? lg.games[0].pitchers[lg.games[0].pitchers.length - 1].pitchTypes : null;
  } catch (e) { /* 候補が作れなくても続ける */ }
}

// ---- 状況の帯（5.6）----
function canEditSit() { return R.state === 'IDLE' || R.state === 'AWAIT_RESULT'; }
function buildSituationBar() {
  const s = R.game.liveSit;
  const t = sitText(s);
  const can = canEditSit();
  const emph = R.emphasize ? ' emph' : '';
  const toggle = function (field) { return function () { R.editing = (R.editing === field) ? null : field; renderRecord(); }; };
  const diamond = el('div', { class: 'diamond' + emph, role: 'group', 'aria-label': '走者' }, [
    [2, '二', 'r2'], [4, '三', 'r3'], [1, '一', 'r1']
  ].map(function (d) {
    const on = (s.runners & d[0]) !== 0;
    return el('button', { type: 'button', class: 'base ' + d[2] + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', 'aria-label': d[1] + '塁の走者', disabled: !can, text: d[1], onclick: function () { editSituation('runnerToggle', d[0]); } });
  }));
  const items = el('div', { class: 'sit-items' }, [
    el('button', { type: 'button', class: 'sit-item', id: 'sit-inning', disabled: !can, text: t.inning, onclick: toggle('inning') }),
    el('button', { type: 'button', class: 'sit-item', id: 'sit-count', 'aria-label': 'ボール' + s.balls + '　ストライク' + s.strikes, disabled: !(can && R.state === 'AWAIT_RESULT'), onclick: toggle('count') }, [bsoGroup('B', 'b', s.balls, 3), bsoGroup('S', 's', s.strikes, 2)]),
    el('button', { type: 'button', class: 'sit-item' + emph, id: 'sit-outs', 'aria-label': s.outs + 'アウト', disabled: !can, onclick: toggle('outs') }, [bsoGroup('O', 'o', s.outs, 2)])
  ]);
  const bar = el('div', { id: 'situation-bar', class: 'card sit' }, [items, diamond]);
  const wrap = [bar];
  if (R.emphasize) wrap.push(el('p', { class: 'notice warn', text: MSG.CHECK_SITUATION }));
  if (R.editing && can) {
    const opt = function (label, active, fn) { return el('button', { type: 'button', class: 'btn small' + (active ? ' on' : ''), text: label, onclick: fn }); };
    let box = null;
    if (R.editing === 'inning') {
      box = el('div', { class: 'edit-box' }, [
        opt('回 －', false, function () { editSituation('inning', s.inning - 1); }),
        opt('回 ＋', false, function () { editSituation('inning', s.inning + 1); }),
        opt('表', s.half === 'T', function () { editSituation('half', 'T'); }),
        opt('裏', s.half === 'B', function () { editSituation('half', 'B'); })
      ]);
    } else if (R.editing === 'count') {
      box = el('div', { class: 'edit-box' }, [
        el('span', { text: 'ボール' })].concat([0, 1, 2, 3].map(function (n) { return opt(String(n), s.balls === n, function () { editSituation('balls', n); }); }),
        [el('span', { text: 'ストライク' })], [0, 1, 2].map(function (n) { return opt(String(n), s.strikes === n, function () { editSituation('strikes', n); }); })));
    } else if (R.editing === 'outs') {
      box = el('div', { class: 'edit-box' }, [0, 1, 2].map(function (n) { return opt(n + 'アウト', s.outs === n, function () { editSituation('outs', n); }); }));
    }
    if (box) wrap.push(box);
  }
  return el('div', { class: 'sit-wrap' }, wrap);
}
function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
// 帯を直したら、すぐ保存する（保存に失敗したら、表示は直す前に戻す）
async function editSituation(field, value) {
  if (R.isSaving || !R.game || !canEditSit()) return;
  if (typeof awakeTouch === 'function') awakeTouch();
  const live = R.game.liveSit;
  const nl = Object.assign({}, live);
  if (field === 'inning') nl.inning = clampInt(value, 1, 30);
  else if (field === 'half') nl.half = (value === 'B') ? 'B' : 'T';
  else if (field === 'outs') nl.outs = clampInt(value, 0, 2);
  else if (field === 'balls') nl.balls = clampInt(value, 0, 3);
  else if (field === 'strikes') nl.strikes = clampInt(value, 0, 2);
  else if (field === 'runnerToggle') nl.runners = live.runners ^ value;
  else return;
  if (JSON.stringify(nl) === JSON.stringify(live)) return;
  nl.edited = true;
  const ok = await runSaving(function () { return saveLiveSitTx(R.game.id, nl); });
  if (!ok) { renderRecord(); return; }
  R.game.liveSit = nl;
  R.emphasize = false;
  renderRecord();
}

// ---- 試合の1行・投手交代・打者の入れ替え（5.2）----
function buildGameLine() {
  const p = curPitcher();
  const idle = R.state === 'IDLE';
  return el('div', { class: 'card gameline' }, [
    el('p', { class: 'gl-main' }, [
      el('span', { text: R.game.date + '　投手：' + p.name + '（' + (p.hand === 'R' ? '右' : '左') + '）' }),
      el('strong', { id: 'pitch-total', text: '　この試合：' + R.pitches.length + '球' })
    ]),
    el('div', { class: 'btn-row' }, [
      el('button', { type: 'button', class: 'btn small', text: '投手交代', disabled: !idle, onclick: function () { R.form = (R.form === 'pitcher') ? null : 'pitcher'; renderRecord(); } }),
      el('button', { type: 'button', class: 'btn small', text: '打者の入れ替え', disabled: !idle, onclick: function () { R.form = (R.form === 'batter') ? null : 'batter'; renderRecord(); } }),
      el('button', { type: 'button', class: 'btn small', id: 'leave-game-btn', text: '別の試合を始める', disabled: R.state !== 'IDLE' && R.state !== 'AWAIT_RESULT', onclick: leaveGame })
    ])
  ]);
}
function buildPitcherChangeForm() {
  const cur = curPitcher();
  return el('div', { class: 'card', id: 'pitcher-form' }, [
    el('h2', { text: '投手交代' }),
    el('label', { class: 'field' }, [el('span', { text: '新しい投手の名前' }), el('input', { type: 'text', id: 'pc-name', list: 'dl-pitcher-names', maxlength: NAME_MAX, autocomplete: 'off' })]),
    el('div', { class: 'field' }, [el('span', { text: '右投・左投' }), handRadios('pcHand', 'R', ['右投', '左投'])]),
    el('div', { class: 'field' }, [el('span', { text: '使う球種' }), el('div', { class: 'chips', id: 'pc-types' }, typeCheckboxes('pc', cur.pitchTypes))]),
    el('datalist', { id: 'dl-pitcher-names' }),
    el('div', { class: 'btn-row' }, [
      el('button', { type: 'button', class: 'btn primary', text: '交代する', onclick: applyPitcherChange }),
      el('button', { type: 'button', class: 'btn', text: 'やめる', onclick: function () { R.form = null; renderRecord(); } })
    ])
  ]);
}
async function applyPitcherChange() {
  const name = document.getElementById('pc-name').value.trim();
  const types = readChecked(document.getElementById('pc-types'));
  if (name.length < 1 || name.length > NAME_MAX) { showNotice('投手の名前を1〜' + NAME_MAX + '字で入れてください', true); return; }
  if (types.length < 1) { showNotice('使う球種を1つ以上選んでください', true); return; }
  const g = JSON.parse(JSON.stringify(R.game));
  g.pitchers.push({ name: name, hand: radioValue('pcHand'), pitchTypes: types });
  const ok = await runSaving(function () { return saveGameTx(g); });
  if (!ok) return;
  R.game = g; R.form = null; showNotice('', false); renderRecord();
}
function buildBatterSwapForm() {
  const sel = el('select', { id: 'bs-which', 'aria-label': '入れ替える打者' }, R.game.batters.map(function (b) { return el('option', { value: b.id, text: b.name }); }));
  return el('div', { class: 'card', id: 'batter-form' }, [
    el('h2', { text: '打者の入れ替え' }),
    el('label', { class: 'field' }, [el('span', { text: '入れ替える打者' }), sel]),
    el('label', { class: 'field' }, [el('span', { text: '新しい打者の名前' }), el('input', { type: 'text', id: 'bs-name', list: 'dl-batter-names', maxlength: NAME_MAX, autocomplete: 'off' })]),
    el('div', { class: 'field' }, [el('span', { text: '右打席・左打席' }), handRadios('bsSide', 'R', ['右打席', '左打席'])]),
    el('datalist', { id: 'dl-batter-names' }),
    el('div', { class: 'btn-row' }, [
      el('button', { type: 'button', class: 'btn primary', text: '入れ替える', onclick: applyBatterSwap }),
      el('button', { type: 'button', class: 'btn', text: 'やめる', onclick: function () { R.form = null; renderRecord(); } })
    ])
  ]);
}
async function applyBatterSwap() {
  const which = document.getElementById('bs-which').value;
  const name = document.getElementById('bs-name').value.trim();
  if (name.length < 1 || name.length > NAME_MAX) { showNotice('新しい打者の名前を1〜' + NAME_MAX + '字で入れてください', true); return; }
  if (R.game.batters.some(function (b) { return b.id !== which && b.name === name; })) { showNotice('同じ名前の打者がいます', true); return; }
  const g = JSON.parse(JSON.stringify(R.game));
  g.batterSeq += 1;                                              // 前のIDは使い回さない
  const idx = g.batters.findIndex(function (b) { return b.id === which; });
  if (idx < 0) return;
  g.batters[idx] = { id: 'b' + g.batterSeq, name: name, side: radioValue('bsSide') };
  const ok = await runSaving(function () { return saveGameTx(g); });
  if (!ok) return;
  R.game = g; R.form = null; showNotice('', false); renderRecord();
}

// ---- 打者・結果・ゾーン ----
function buildBatterBar() {
  const idle = R.state === 'IDLE';
  const pa = curPa();
  const kids = R.game.batters.map(function (b) {
    const active = pa && pa.batterId === b.id;
    const n = R.pas.filter(function (a) { return a.batterId === b.id; }).length;                  // この打者の、これまでの打席数
    return el('button', { type: 'button', class: 'btn batter' + (active ? ' on' : ''), 'data-batter': b.id, disabled: !idle, 'aria-pressed': active ? 'true' : 'false',
      onclick: function () { startPa(b.id); } }, [b.name + '（' + (b.side === 'R' ? '右' : '左') + '）', idle ? el('span', { class: 'batter-next', text: '押すと ' + (n + 1) + '打席目' }) : null]);
  });
  return el('div', { id: 'batter-bar', class: 'card' }, [el('h2', { text: '打者' }),
    el('p', { class: 'sub tiny', text: idle ? '打席が終わったら、次の打者を押します。同じ打者をもう一度押すと、その打者の次の打席になります' : '打席の途中です。終わると、打者のボタンがまた押せます' }),
    el('div', { class: 'btn-row wrap' }, kids)]);
}
async function startPa(batterId) {
  if (R.isSaving || R.state !== 'IDLE') return;
  if (typeof awakeTouch === 'function') awakeTouch();
  const b = R.game.batters.find(function (x) { return x.id === batterId; });
  if (!b) return;
  const paNo = R.pas.reduce(function (m, a) { return Math.max(m, a.paNo); }, 0) + 1;
  const pa = { id: newId('a', Date.now(), Math.random()), gameId: R.game.id, paNo: paNo, batterId: b.id, batterName: b.name, side: b.side, endType: null, outcome: null, startedAt: Date.now() };
  const nl = Object.assign({}, R.game.liveSit, { balls: 0, strikes: 0, openPaId: pa.id });
  const ok = await runSaving(function () { return startPaTx(pa, nl); });
  if (!ok) return;
  R.pas.push(pa); R.game.liveSit = nl; R.state = 'AWAIT_RESULT'; R.draft = null; R.emphasize = false; R.selectedPitchId = null;
  renderRecord();
}
function resultRows() {
  const live = R.game ? R.game.liveSit : null;
  const b = live ? live.balls : 0;
  return [
    { cap: null, items: [
      { result: 'TAKEN', call: 'B', reaction: 'NONE', label: b >= 3 ? '四球' : 'ボール', cls: 'res-TAKEN' },
      { result: 'FOUL', call: null, reaction: null, label: 'ファウル', cls: 'res-FOUL' },
      { result: 'HBP', call: null, reaction: null, label: '死球', cls: 'res-HBP' },
      { result: 'INPLAY', call: null, reaction: null, label: 'インプレー', cls: 'res-INPLAY' }] },
    { cap: null, items: [
      { result: 'TAKEN', call: 'S', reaction: 'NONE', label: '見逃(無反)', cls: 'res-TAKEN' },
      { result: 'TAKEN', call: 'S', reaction: 'BAT_OUT', label: '見逃(反有)', cls: 'res-TAKEN' },
      { result: 'TAKEN', call: 'B', reaction: 'CHECK', label: '見逃(バ止)', cls: 'res-TAKEN' }] },
    { cap: null, items: [
      { result: 'MISS', call: null, reaction: 'TIMED', label: '空振', cls: 'res-MISS' },
      { result: 'MISS', call: null, reaction: 'NO_TIMING', label: '空振(全無)', cls: 'res-MISS' }] }
  ];
}
function buildResultBar() {
  const on = R.state === 'AWAIT_RESULT' || R.state === 'AWAIT_ZONE';
  const sel = R.draft ? R.draft.result : null, selCall = R.draft ? R.draft.takenCall : null, selReact = R.draft ? R.draft.reaction : null;
  const rows = [];
  resultRows().forEach(function (row) {
    if (row.cap) rows.push(el('p', { class: 'res-cap', text: row.cap }));
    rows.push(el('div', { class: 'btn-row wrap' }, row.items.map(function (c) {
      const isOn = sel === c.result && (c.result !== 'TAKEN' || (selCall === c.call && selReact === c.reaction)) && (c.result !== 'MISS' || selReact === c.reaction);
      return el('button', { type: 'button', class: 'btn res ' + c.cls + (isOn ? ' on' : ''), 'data-result': c.result, 'data-call': c.call || '', 'data-react': c.reaction || '', disabled: !on, 'aria-pressed': isOn ? 'true' : 'false', text: c.label, onclick: function () { onResultTap(c.result, c.call, c.reaction); } });
    })));
  });
  return el('div', { id: 'result-bar', class: 'card' }, rows);
}
function onResultTap(r, call, reaction) {
  if (R.isSaving) return;
  if (R.state !== 'AWAIT_RESULT' && R.state !== 'AWAIT_ZONE') return;
  if (typeof awakeTouch === 'function') awakeTouch();
  if (!R.draft) R.draft = { pitchId: newId('p', Date.now(), Math.random()) };       // 球のIDは、入力を始めた時点で1つ作る
  R.draft.result = r;
  R.draft.takenCall = (r === 'TAKEN') ? call : undefined;                            // 見逃しのボール・ストライクは、押したボタンで決まる
  R.draft.reaction = reaction || undefined;                                          // 見逃し・空振りの反応
  R.state = 'AWAIT_ZONE';
  renderRecord();
}
// ゾーンのとなりに出す、対戦打者の絵（動かない。左右どちらの打席かが分かる）
function batterFigure(side) {
  if (!side) return null;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'zone-batter ' + (side === 'L' ? 'l' : 'r'));
  drawBatterOnly(svg, side);
  return svg;
}
function buildZone() {
  const pa = curPa();
  const side = pa ? pa.side : null;
  const on = R.state === 'AWAIT_ZONE' || R.state === 'AWAIT_TYPE';
  const d = R.draft;
  const rows = [];
  for (let r = 1; r <= 5; r++) {
    for (let c = 1; c <= 5; c++) {
      const sel = d && d.row === r && d.col === c;
      rows.push(el('button', { type: 'button', class: 'cell ' + (isStrikeZone(r, c) ? 'in' : 'out') + (sel ? ' sel' : ''), 'data-row': r, 'data-col': c, disabled: !on,
        'aria-label': (side ? zoneLabel(r, c, side) : '行' + r + '列' + c), 'aria-pressed': sel ? 'true' : 'false', text: sel ? '●' : '', onclick: function () { onZoneTap(r, c); } }));
    }
  }
  const cap = side ? el('p', { class: 'zone-cap ' + (side === 'R' ? 'right' : 'left'), text: side === 'R' ? '内角側 ▶' : '◀ 内角側' }) : null;
  return el('div', { class: 'card' }, [
    el('h2', { text: 'コース（投手から見て）' }),
    el('div', { class: 'zone-row' + (side === 'L' ? ' left' : '') }, [el('div', { class: 'zone-col' }, [cap, el('div', { id: 'zone-grid', class: 'zone' }, rows)]), batterFigure(side)]),
    (d && d.result === 'TAKEN' && d.row) ? el('div', { class: 'btn-row' }, [
      el('span', { id: 'taken-call', text: '判定：' + (d.takenCall === 'S' ? 'ストライク' : 'ボール') }),
      el('button', { type: 'button', class: 'btn small', id: 'taken-flip', text: '判定を逆にする', onclick: function () { if (R.isSaving) return; d.takenCall = (d.takenCall === 'S') ? 'B' : 'S'; renderRecord(); } })
    ]) : null
  ]);
}
function onZoneTap(row, col) {
  if (R.isSaving) return;
  if (R.state !== 'AWAIT_ZONE' && R.state !== 'AWAIT_TYPE') return;
  if (typeof awakeTouch === 'function') awakeTouch();
  R.draft.row = row; R.draft.col = col;
  R.state = 'AWAIT_TYPE';
  renderRecord();
}

// ---- 球種・ファウル・インプレー ----
function buildStepArea() {
  const st = R.state;
  const box = el('div', { id: 'step-area', class: 'card' });
  const d = R.draft;
  if (st === 'AWAIT_TYPE') {
    box.appendChild(el('h2', { text: '球種' }));
    box.appendChild(el('div', { class: 'btn-row wrap' }, curPitcher().pitchTypes.map(function (code) {
      const t = typeInfo(code);
      const prev = R.lastPitchType === code;
      return el('button', { type: 'button', class: 'btn ptype' + (prev ? ' prev' : ''), 'data-type': code, onclick: function () { onPitchTypeTap(code); } }, [
        el('span', { class: 'dot', style: { background: t.color }, text: t.code }), el('span', { text: t.name })
      ]);
    })));
  } else if (st === 'AWAIT_FOUL') {
    box.appendChild(el('h2', { text: 'ファウルの種類' }));
    box.appendChild(el('div', { class: 'btn-row wrap' }, FOUL_ORDER.map(function (f) {
      return el('button', { type: 'button', class: 'btn', 'data-foul': f, text: FOUL_LABEL[f], onclick: function () { onFoulTypeTap(f); } });
    })));
  } else if (st === 'AWAIT_FOUL_DIR') {
    box.appendChild(el('h2', { text: 'ファウルの方向' }));
    box.appendChild(el('div', { class: 'btn-row wrap' }, FOULDIR_ORDER.map(function (f) {
      return el('button', { type: 'button', class: 'btn', 'data-fouldir': f, text: FOULDIR_LABEL[f], onclick: function () { onFoulDirTap(f); } });
    })));
  } else if (st === 'AWAIT_INPLAY') {
    box.appendChild(buildInplayPanel());
  } else if (st === 'AWAIT_OUTS') {
    box.appendChild(el('h2', { text: MSG.ASK_OUTS }));
    box.appendChild(el('div', { class: 'btn-row' }, [0, 1, 2].map(function (n) {
      return el('button', { type: 'button', class: 'btn big', 'data-outs': n, text: String(n), onclick: function () { onOutsAddedTap(n); } });
    })));
    box.appendChild(el('p', { class: 'sub', text: '結果：' + OUTCOME_LABEL[d.outcome] }));
    box.appendChild(el('div', { class: 'btn-row' }, [el('button', { type: 'button', class: 'btn small', text: '結果を選び直す', onclick: function () { R.draft.outcome = null; R.state = 'AWAIT_INPLAY'; renderRecord(); } })]));
  } else if (st === 'IDLE') {
    box.appendChild(el('p', { class: 'sub', text: '打者のボタンを押してください' }));
  } else if (st === 'AWAIT_RESULT') {
    box.appendChild(el('p', { class: 'sub', text: '結果を選んでください' }));
  } else if (st === 'AWAIT_ZONE') {
    box.appendChild(el('p', { class: 'sub', text: 'コースを押してください' }));
  }
  return box;
}
function onPitchTypeTap(code) {
  if (R.isSaving || R.state !== 'AWAIT_TYPE') return;
  if (typeof awakeTouch === 'function') awakeTouch();
  const d = R.draft;
  d.pitchType = code;
  if (d.result === 'TAKEN' || d.result === 'MISS' || d.result === 'HBP') { commitPitch(); return; }
  if (d.result === 'FOUL') { R.state = 'AWAIT_FOUL'; renderRecord(); return; }
  d.kind = null; d.dir = null; d.outcome = null; d.outsAdded = null;
  R.state = 'AWAIT_INPLAY'; renderRecord();
}
function onFoulTypeTap(t) {
  if (R.isSaving || R.state !== 'AWAIT_FOUL') return;
  if (typeof awakeTouch === 'function') awakeTouch();
  const pa = curPa();
  R.draft.foulType = t;
  if (t === 'OTHER') { R.state = 'AWAIT_FOUL_DIR'; renderRecord(); return; }
  R.draft.foulDir = foulDirAuto(t, pa.side);
  commitPitch();
}
function onFoulDirTap(dir) {
  if (R.isSaving || R.state !== 'AWAIT_FOUL_DIR') return;
  if (typeof awakeTouch === 'function') awakeTouch();
  R.draft.foulDir = dir;
  commitPitch();
}
function buildInplayPanel() {
  const d = R.draft;
  const pa = curPa();
  const hints = d.kind ? (OUTCOME_HINT[d.kind] || []) : [];
  const field = el('div', { id: 'field-diagram', class: 'field-grid', role: 'group', 'aria-label': '打球の方向' });
  FIELD_ROWS.forEach(function (row) {
    row.forEach(function (dir) {
      if (!dir) { field.appendChild(el('span', { class: 'field-gap' })); return; }
      field.appendChild(el('button', { type: 'button', class: 'fd' + (d.dir === dir ? ' on' : ''), 'data-dir': dir, 'aria-pressed': d.dir === dir ? 'true' : 'false', text: DIR_LABEL[dir], onclick: function () { onInplayTap('dir', dir); } }));
    });
  });
  const po = (d.dir && pa) ? pullOppo(d.dir, pa.side) : null;
  return el('div', { class: 'inplay' }, [
    el('h2', { text: 'A．打球の種類' }),
    el('div', { class: 'btn-row wrap' }, KIND_ORDER.map(function (k) { return el('button', { type: 'button', class: 'btn' + (d.kind === k ? ' on' : ''), 'data-kind': k, 'aria-pressed': d.kind === k ? 'true' : 'false', text: KIND_LABEL[k], onclick: function () { onInplayTap('kind', k); } }); })),
    el('h2', { text: 'B．方向（下が本塁・上が中堅）' }),
    field,
    po ? el('p', { class: 'sub', text: '→ ' + (po === 'PULL' ? '引っ張り' : (po === 'OPPO' ? '流し' : '中央')) }) : null,
    el('h2', { text: 'C．結果（押すと記録して終わり）' }),
    el('div', { class: 'btn-row wrap' }, OUTCOME_ORDER.map(function (o) {
      return el('button', { type: 'button', class: 'btn' + (d.outcome === o ? ' on' : '') + (hints.indexOf(o) >= 0 ? ' hint' : ''), 'data-outcome': o, 'aria-pressed': d.outcome === o ? 'true' : 'false', text: OUTCOME_LABEL[o], onclick: function () { onInplayTap('outcome', o); } });
    }))
  ]);
}
// 打球のA（種類）・B（方向）は先に押す。C（結果）を押した時点で、Cが失策・野選・打撃妨害なら「アウトの数」へ、ほかは保存
function onInplayTap(part, value) {
  if (R.isSaving || R.state !== 'AWAIT_INPLAY') return;
  if (typeof awakeTouch === 'function') awakeTouch();
  R.draft[part] = value;
  if (part === 'outcome') { onInplayCommit(); return; }          // C（結果）を押したら、その打席の記録を終える。A・Bを押していなければ「不明」で残す
  renderRecord();
}
function onInplayCommit() {
  const d = R.draft;
  if (d.outcome === 'ERR' || d.outcome === 'FC' || d.outcome === 'INTERF') { R.state = 'AWAIT_OUTS'; renderRecord(); return; }
  d.outsAdded = null;
  commitPitch();
}
function onOutsAddedTap(n) {
  if (R.isSaving || R.state !== 'AWAIT_OUTS') return;
  if (typeof awakeTouch === 'function') awakeTouch();
  R.draft.outsAdded = n;
  commitPitch();
}

// ---- 1球の保存 ----
async function commitPitch() {
  if (R.isSaving) return;
  const d = R.draft; const pa = curPa(); const live = R.game.liveSit;
  if (!d || !pa) return;
  const seq = R.pitches.reduce(function (m, p) { return Math.max(m, p.seq); }, 0) + 1;
  const isInplay = d.result === 'INPLAY';
  const pitch = {
    id: d.pitchId, gameId: R.game.id, paId: pa.id, seq: seq, paSeq: paPitchCount(pa.id) + 1,
    pitcher: { name: curPitcher().name, hand: curPitcher().hand },
    row: d.row, col: d.col, pitchType: d.pitchType, result: d.result,
    takenCall: d.result === 'TAKEN' ? d.takenCall : null,
    reaction: (d.result === 'TAKEN' || d.result === 'MISS') ? (d.reaction || (d.result === 'TAKEN' ? 'NONE' : 'TIMED')) : null,
    foulType: d.result === 'FOUL' ? d.foulType : null,
    foulDir: d.result === 'FOUL' ? (d.foulDir === undefined ? null : d.foulDir) : null,
    inplay: isInplay ? { kind: d.kind, dir: d.dir, outcome: d.outcome, outsAdded: (d.outcome === 'ERR' || d.outcome === 'FC' || d.outcome === 'INTERF') ? d.outsAdded : null } : null,
    marks: [],
    sit: { inning: live.inning, half: live.half, outs: live.outs, runners: live.runners, balls: live.balls, strikes: live.strikes },
    sitEdited: !!live.edited, memo: '', createdAt: Date.now()
  };
  const cnt = applyPitchToCount(live.balls, live.strikes, { result: d.result, takenCall: pitch.takenCall, caught: false });
  const newPa = Object.assign({}, pa, { endType: cnt.paEnd, outcome: isInplay ? d.outcome : null });
  let nl;
  if (cnt.paEnd) {
    const adv = advanceSituation({ inning: live.inning, half: live.half, outs: live.outs, runners: live.runners }, cnt.paEnd, newPa.outcome, pitch.inplay ? pitch.inplay.outsAdded : null);
    nl = { inning: adv.inning, half: adv.half, outs: adv.outs, runners: adv.runners, balls: 0, strikes: 0, openPaId: null, edited: false };
  } else {
    nl = Object.assign({}, live, { balls: cnt.balls, strikes: cnt.strikes, edited: false });
  }
  const ok = await runSaving(function () { return savePitchTx(pitch, newPa, nl); });
  if (!ok) return;                                  // 失敗：入力（R.draft）と帯は、そのまま残す
  R.pitches.push(pitch);
  R.pas = R.pas.map(function (a) { return a.id === newPa.id ? newPa : a; });
  R.game.liveSit = nl;
  R.lastPitchType = d.pitchType;
  R.draft = null; R.editing = null; R.emphasize = false;
  R.state = cnt.paEnd ? 'IDLE' : 'AWAIT_RESULT';
  R.selectedPitchId = pitch.id;
  showNotice('', false);
  renderRecord();
  const bar = document.getElementById('situation-bar');
  if (bar) { bar.classList.add('flash'); if (_flashTimer) clearTimeout(_flashTimer); _flashTimer = setTimeout(function () { const b = document.getElementById('situation-bar'); if (b) b.classList.remove('flash'); }, 700); }
}

// ---- 取り消し・打席を閉じる（5.10）----
function buildUndoRow() {
  const hasPitch = R.pitches.length > 0;
  const pa = curPa();
  const emptyOpen = pa && paPitchCount(pa.id) === 0;
  const lastPa = R.pas[R.pas.length - 1];
  const canReopen = !pa && lastPa && lastPa.endType === 'SKIPPED';
  const canUndo = !!R.draft || emptyOpen || canReopen || hasPitch;
  const canClose = R.state === 'AWAIT_RESULT' && pa && paPitchCount(pa.id) >= 1;
  return el('div', { class: 'btn-row undo-row' }, [
    el('button', { type: 'button', class: 'btn undo', id: 'undo-btn', text: '直前の1球を取り消す', disabled: !canUndo, onclick: undoLastPitch }),
    canClose ? el('button', { type: 'button', class: 'btn', id: 'close-pa-btn', text: '打席を閉じる', onclick: closePa }) : null
  ]);
}
// 上から見て、当てはまる最初の1つだけ行う
async function undoLastPitch() {
  if (R.isSaving || !R.game) return;
  if (typeof awakeTouch === 'function') awakeTouch();
  if (R.draft) {                                                      // ① 入力の途中を捨てる
    R.draft = null; R.state = R.game.liveSit.openPaId ? 'AWAIT_RESULT' : 'IDLE'; renderRecord(); return;
  }
  const pa = curPa();
  const lastPa = R.pas[R.pas.length - 1];
  let op = null;
  if (pa && paPitchCount(pa.id) === 0) op = function () { return deleteEmptyPaTx(R.game.id); };           // ② 球のない打席を消す
  else if (!pa && lastPa && lastPa.endType === 'SKIPPED') op = function () { return reopenPaTx(R.game.id); };   // ③ 閉じた打席を開き直す
  else if (R.pitches.length > 0) op = function () { return deleteLastPitchTx(R.game.id); };               // ④ 最後の1球を消す
  if (!op) return;
  const ok = await runSaving(op);
  if (!ok) return;
  try { await reloadGame(); } catch (e) { showNotice(MSG.SAVE_FAIL(e.message), true); return; }
  R.selectedPitchId = null; R.emphasize = false;
  showNotice('', false);
  renderRecord();
}
async function closePa() {
  if (R.isSaving || R.state !== 'AWAIT_RESULT') return;
  if (typeof awakeTouch === 'function') awakeTouch();
  const pa = curPa();
  if (!pa || paPitchCount(pa.id) < 1) return;
  let res = null;
  const ok = await runSaving(async function () { res = await closePaTx(R.game.id); });
  if (!ok) return;
  R.pas = R.pas.map(function (a) { return a.id === pa.id ? Object.assign({}, a, { endType: 'SKIPPED' }) : a; });
  R.game.liveSit = res.liveSit; R.state = 'IDLE'; R.draft = null; R.emphasize = true;
  renderRecord();
}

// ---- 直近の球と印（5.5のD）----
function pitchSummary(p) {
  const pa = R.pas.find(function (a) { return a.id === p.paId; });
  const side = pa ? pa.side : 'R';
  let s = '#' + p.seq + ' ' + (pa ? pa.batterName : '') + ' ' + RESULT_LABEL[p.result] + reactSuffix(p) + '・' + zoneLabel(p.row, p.col, side);
  if (p.result === 'TAKEN') s += '（' + (p.takenCall === 'S' ? 'ストライク' : 'ボール') + '）';
  if (p.result === 'FOUL' && p.foulType) s += '・' + FOUL_LABEL[p.foulType];
  if (p.inplay) {
    s += '・' + kindText(p.inplay) + '・' + dirText(p.inplay) + '・' + OUTCOME_LABEL[p.inplay.outcome];
    if (Number.isInteger(p.inplay.outsAdded)) s += '（アウト+' + p.inplay.outsAdded + '）';
  }
  if (p.sitEdited) s += '　※帯を直した';
  return s;
}
function buildRecentList() {
  const rows = R.pitches.slice(-RECENT_PITCH_ROWS).reverse();
  const box = el('div', { class: 'card', id: 'recent' }, [el('h2', { text: '直近の球（押すと印を付けられます）' })]);
  if (rows.length === 0) { box.appendChild(el('p', { class: 'sub', text: 'まだ球がありません' })); return box; }
  const list = el('div', { class: 'recent-list' });
  rows.forEach(function (p) {
    const t = typeInfo(p.pitchType);
    const sel = R.selectedPitchId === p.id;
    const item = el('div', { class: 'recent-item' + (sel ? ' sel' : '') }, [
      el('button', { type: 'button', class: 'recent-row', 'data-pitch': p.id, onclick: function () { R.selectedPitchId = sel ? null : p.id; renderRecord(); } }, [
        el('span', { class: 'dot', style: { background: t.color }, text: t.code }),
        el('span', { class: 'recent-text', text: pitchSummary(p) + (p.marks.length ? '　【' + p.marks.map(function (m) { return MARK_LABEL[m]; }).join('・') + '】' : '') })
      ])
    ]);
    if (sel) item.appendChild(buildMarkButtons(p));
    list.appendChild(item);
  });
  box.appendChild(list);
  return box;
}
function buildMarkButtons(p) {
  const lastSeq = R.pitches.length ? R.pitches[R.pitches.length - 1].seq : 0;
  const pa = R.pas.find(function (a) { return a.id === p.paId; });
  const paMax = R.pitches.filter(function (x) { return x.paId === p.paId; }).reduce(function (m, x) { return Math.max(m, x.paSeq); }, 0);
  const avail = MARK_ORDER.filter(function (m) {
    if (p.marks.indexOf(m) >= 0) return true;                                      // すでに付いている印は、外せるように出す
    if (m === 'CAUGHT_OUT') return p.result === 'FOUL' && p.paSeq === paMax && pa && (pa.endType === null || pa.endType === 'CAUGHT_FOUL') && (p.seq === lastSeq);
    if (m === 'NICE_PLAY') return p.result === 'INPLAY' || p.result === 'FOUL';       // 好守：打球があった球だけ
    if (BUNT_MARKS.indexOf(m) >= 0) return p.result === 'INPLAY' && !!p.inplay && p.inplay.kind === 'BUNT';   // バントの種類：バントで転がした球だけ
    if (m === 'DROPPED_K') return pa && pa.endType === 'K' && p.paSeq === paMax && (p.result === 'MISS' || (p.result === 'TAKEN' && p.takenCall === 'S'));   // 振り逃げ：三振の球だけ
    if (m === 'IBB') return pa && pa.endType === 'BB' && p.paSeq === paMax && p.result === 'TAKEN';                                        // 敬遠：四球の球だけ
    return true;
  });
  if (avail.length === 0) return el('p', { class: 'sub tiny', text: 'この球に付けられる印はありません' });
  return el('div', { class: 'btn-row wrap marks' }, avail.map(function (m) {
    const on = p.marks.indexOf(m) >= 0;
    return el('button', { type: 'button', class: 'btn small' + (on ? ' on' : ''), 'data-mark': m, 'aria-pressed': on ? 'true' : 'false', text: MARK_LABEL[m], onclick: function () { addMark(p.id, m); } });
  }));
}
// 印を付ける・外す（もう一度押すと外れる）
async function addMark(pitchId, mark) {
  if (R.isSaving) return;
  if (typeof awakeTouch === 'function') awakeTouch();
  const p = R.pitches.find(function (x) { return x.id === pitchId; });
  if (!p) return;
  let marks = p.marks.slice();
  const i = marks.indexOf(mark);
  if (i >= 0) marks.splice(i, 1);
  else {
    if (BUNT_MARKS.indexOf(mark) >= 0) marks = marks.filter(function (m) { return BUNT_MARKS.indexOf(m) < 0; });
    marks.push(mark);
  }
  let res = null;
  const ok = await runSaving(async function () { res = await updatePitchMarksTx(pitchId, marks); });
  if (!ok) return;
  try { await reloadGame(); } catch (e) { showNotice(MSG.SAVE_FAIL(e.message), true); return; }
  showNotice('', false);
  renderRecord();
}
