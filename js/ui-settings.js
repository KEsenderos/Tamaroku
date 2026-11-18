'use strict';
// ui-settings.js（球録 v0.1.7）設定タブ。確認の画面（kyrDialog）もここ

// 確認・案内の画面。buttons: [{label, value, primary}]。押したボタンの value で解決する。link: {href, name}（保存のリンク）
function kyrDialog(opts) {
  return new Promise(function (resolve) {
    const root = document.getElementById('dialog-root');
    root.textContent = '';
    const done = function (v) { root.textContent = ''; root.hidden = true; resolve(v); };
    const box = el('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || '確認' }, [
      opts.title ? el('h2', { text: opts.title }) : null,
      el('p', { text: opts.message || '' }),
      opts.link ? el('p', null, [el('a', { class: 'btn', href: opts.link.href, download: opts.link.name, text: 'ファイルを保存する（' + opts.link.name + '）' })]) : null,
      el('div', { class: 'btn-row' }, (opts.buttons || [{ label: 'OK', value: true, primary: true }]).map(function (b) {
        return el('button', { type: 'button', class: 'btn' + (b.primary ? ' primary' : ''), text: b.label, onclick: function () { done(b.value); } });
      }))
    ]);
    root.appendChild(el('div', { class: 'dialog-bg' }, box));
    root.hidden = false;
  });
}
// 書き出しで、共有が使えないときに呼ばれる：リンクを出して「保存できましたか？」を聞く
function askFileSaved(url, name) {
  return kyrDialog({ title: 'ファイルを保存してください', message: '下のボタンを押してファイルを保存し、そのあと［保存できた］を押してください。', link: { href: url, name: name },
    buttons: [{ label: '保存できた', value: true, primary: true }, { label: '保存できなかった', value: false }] });
}
function daysSince(ms) { return Math.floor((Date.now() - ms) / 86400000); }

const S = { msg: '', msgError: false, games: [], unreadable: 0, lastExportAt: null, lastExportCount: 0, storage: null, importMode: 'add', checkMsg: '' };

function setSettingsMsg(text, isError) {
  S.msg = text || ''; S.msgError = !!isError;
  const n = document.getElementById('settings-msg');
  if (n) { n.textContent = S.msg; n.hidden = !S.msg; n.className = 'notice' + (isError ? ' error' : ''); }
}

async function renderSettings() {
  const panel = document.getElementById('panel-settings');
  if (!panel) return;
  try {
    const lg = await listGames();
    S.games = lg.games; S.unreadable = lg.unreadable;
    S.lastExportAt = await getMeta('lastExportAt');
    S.lastExportCount = await getMeta('lastExportPitchCount');
    R.types = await getPitchTypes();
  } catch (e) {
    panel.textContent = '';
    panel.appendChild(el('p', { class: 'notice error', text: (e && e.code === 'NO_IDB') ? MSG.NO_DB : MSG.SAVE_FAIL(e.message || '不明') }));
    return;
  }
  panel.textContent = '';
  const stack = el('div', { class: 'stack' });
  stack.appendChild(el('p', { id: 'settings-msg', class: 'notice' + (S.msgError ? ' error' : ''), text: S.msg, hidden: !S.msg, role: 'status' }));
  if (S.unreadable > 0) stack.appendChild(el('p', { class: 'banner', text: MSG.UNREADABLE(S.unreadable) }));
  stack.appendChild(buildTypesCard());
  stack.appendChild(buildExportCard());
  stack.appendChild(buildImportCard());
  stack.appendChild(buildGamesCard());
  stack.appendChild(buildAwakeCard());
  stack.appendChild(buildThemeCard());
  stack.appendChild(buildStorageCard());
  stack.appendChild(buildAboutCard());
  panel.appendChild(stack);
  refreshStorageInfo();
}

// ---- 球種の一覧 ----
function isDefaultCode(code) { return DEFAULT_PITCH_TYPES.some(function (t) { return t.code === code; }); }
function buildTypesCard() {
  const rows = R.types.map(function (t) {
    const input = el('input', { type: 'text', value: t.name, maxlength: PITCHTYPE_NAME_MAX, 'aria-label': t.code + 'の名前', 'data-code': t.code });
    const kids = [el('span', { class: 'dot', style: { background: t.color }, text: t.code }), input,
      el('button', { type: 'button', class: 'btn small', text: '名前を保存', onclick: function () { renamePitchType(t.code, input.value); } })];
    if (!isDefaultCode(t.code)) kids.push(el('button', { type: 'button', class: 'btn small', text: '削除', onclick: function () { deletePitchType(t.code); } }));
    return el('div', { class: 'row-form' }, kids);
  });
  const customs = R.types.filter(function (t) { return !isDefaultCode(t.code); }).length;
  const add = el('div', { class: 'row-form' }, [
    el('input', { type: 'text', id: 'new-type-name', maxlength: PITCHTYPE_NAME_MAX, placeholder: '独自の球種の名前', 'aria-label': '独自の球種の名前' }),
    el('button', { type: 'button', class: 'btn small', id: 'add-type-btn', text: '追加', disabled: customs >= CUSTOM_PITCHTYPE_MAX, onclick: addPitchType })
  ]);
  return el('div', { class: 'card', id: 'card-types' }, [
    el('h2', { text: '球種の一覧' }), el('p', { class: 'sub', text: '名前を変えられます。独自の球種は最大' + CUSTOM_PITCHTYPE_MAX + 'つ。使った球種は削除できません。' }),
    el('div', null, rows), add
  ]);
}
async function savePitchTypes(types, okMsg) {
  try { await setMeta('pitchTypes', types); R.types = types; setSettingsMsg(okMsg, false); await renderSettings(); if (typeof renderRecord === 'function') renderRecord(); }
  catch (e) { setSettingsMsg(MSG.SAVE_FAIL(e.message || '不明'), true); }
}
function renamePitchType(code, name) {
  const nm = name.trim();
  if (nm.length < 1 || nm.length > PITCHTYPE_NAME_MAX) { setSettingsMsg('名前は1〜' + PITCHTYPE_NAME_MAX + '字で入れてください', true); return; }
  savePitchTypes(R.types.map(function (t) { return t.code === code ? { code: t.code, name: nm, color: t.color } : t; }), '名前を保存しました');
}
function addPitchType() {
  const nm = document.getElementById('new-type-name').value.trim();
  if (nm.length < 1 || nm.length > PITCHTYPE_NAME_MAX) { setSettingsMsg('名前は1〜' + PITCHTYPE_NAME_MAX + '字で入れてください', true); return; }
  const customs = R.types.filter(function (t) { return !isDefaultCode(t.code); });
  if (customs.length >= CUSTOM_PITCHTYPE_MAX || R.types.length >= PITCHTYPE_LIST_MAX) { setSettingsMsg('これ以上は足せません', true); return; }
  let n = 1;
  while (R.types.some(function (t) { return t.code === 'X' + n; })) n += 1;
  const used = R.types.map(function (t) { return t.color; });
  const color = CUSTOM_COLORS.find(function (c) { return used.indexOf(c) < 0; }) || CUSTOM_COLORS[0];
  savePitchTypes(R.types.concat([{ code: 'X' + n, name: nm, color: color }]), '球種を足しました');
}
async function deletePitchType(code) {
  try {
    const used = await countPitchTypeUse(code);
    if (used > 0) { setSettingsMsg('この球種は ' + used + ' 球で使っているため、削除できません', true); return; }
  } catch (e) { setSettingsMsg(MSG.SAVE_FAIL(e.message || '不明'), true); return; }
  savePitchTypes(R.types.filter(function (t) { return t.code !== code; }), '球種を削除しました');
}

// ---- 書き出し ----
function buildExportCard() {
  const last = (typeof S.lastExportAt === 'number') ? (dayStr(new Date(S.lastExportAt)) + '（' + daysSince(S.lastExportAt) + '日前）') : 'まだありません';
  return el('div', { class: 'card', id: 'card-export' }, [
    el('h2', { text: '書き出し（控え）' }),
    el('p', { id: 'last-export', text: '最後に控えを取った日：' + last }),
    el('button', { type: 'button', class: 'btn primary', id: 'export-btn', text: '記録を書き出す', onclick: onExportTap }),
    el('p', { class: 'sub', text: 'iPhoneでは、出てきた画面で［ファイルに保存］を選びます。' })
  ]);
}
async function onExportTap() {
  setSettingsMsg('', false);
  const res = await exportAll(askFileSaved);
  if (res.ok) setSettingsMsg('控えを取りました', false); else setSettingsMsg(MSG.EXPORT_FAIL, true);
  await renderSettings();
}

// ---- 取り込み ----
function buildImportCard() {
  const file = el('input', { type: 'file', id: 'import-file', accept: 'application/json,.json', hidden: true, onchange: function (ev) { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (f) onImportFile(f); } });
  const radio = function (v, label) {
    return el('label', { class: 'rad' }, [el('input', { type: 'radio', name: 'importMode', value: v, checked: S.importMode === v, onchange: function () { S.importMode = v; } }), el('span', { text: label })]);
  };
  return el('div', { class: 'card', id: 'card-import' }, [
    el('h2', { text: '取り込み' }),
    el('div', { class: 'btn-row wrap' }, [radio('add', '足す（同じ試合は飛ばす）'), radio('replace', '置き換える')]),
    file,
    el('button', { type: 'button', class: 'btn', id: 'import-btn', text: '記録を取り込む', onclick: function () { file.click(); } })
  ]);
}
async function onImportFile(file) {
  setSettingsMsg('', false);
  if (file.size > IMPORT_MAX_BYTES) { setSettingsMsg('ファイルが大きすぎます（50MBまで）。書き込みませんでした', true); return; }
  let obj;
  try { obj = JSON.parse(await file.text()); } catch (e) { setSettingsMsg('ファイルが読めません（JSONではありません）。書き込みませんでした', true); return; }
  const v = validateBackup(migrateBackup(obj));
  if (!v.ok) { setSettingsMsg('取り込めません：' + v.errors.slice(0, 3).join(' / ') + (v.counts ? '（試合' + v.counts.games + '・打席' + v.counts.pas + '・球' + v.counts.pitches + '）' : '') + '。書き込みませんでした', true); return; }
  const mode = S.importMode === 'replace' ? 'replace' : 'add';
  if (mode === 'replace') {
    const yes = await kyrDialog({ title: '置き換えの確認', message: MSG.REPLACE_CONFIRM, buttons: [{ label: '置き換える', value: true, primary: true }, { label: 'やめる', value: false }] });
    if (!yes) return;
    const ex = await exportAll(askFileSaved);                           // 自動書き出し。失敗したら中止
    if (!ex.ok) { setSettingsMsg(MSG.EXPORT_ABORT, true); return; }
  }
  try {
    const r = await importBackup(obj, mode);
    if (mode === 'replace' && typeof leaveGameSilently === 'function') leaveGameSilently();
    setSettingsMsg('取り込みました：試合' + r.games + '・打席' + r.pas + '・球' + r.pitches + (r.skippedGames ? '（同じ試合 ' + r.skippedGames + ' 件は飛ばしました）' : ''), false);
    if (typeof recordInit === 'function') await recordInit();
  } catch (e) {
    setSettingsMsg('取り込めませんでした：' + (e.message || '不明'), true);
  }
  await renderSettings();
}

// ---- 試合の管理 ----
function buildGamesCard() {
  const rows = S.games.map(function (g) {
    const p = g.pitchers[g.pitchers.length - 1];
    const names = g.batters.map(function (b) { return b.name; }).join('・');
    return el('div', { class: 'game-row' }, [
      el('p', { class: 'gl-main', text: g.date + '　投手：' + p.name + '　打者：' + names }),
      el('div', { class: 'btn-row' }, [
        el('button', { type: 'button', class: 'btn small', text: '続きを記録', onclick: function () { resumeGame(g.id); } }),
        el('button', { type: 'button', class: 'btn small danger', text: '削除', onclick: function () { onDeleteGame(g); } })
      ])
    ]);
  });
  return el('div', { class: 'card', id: 'card-games' }, [
    el('h2', { text: '試合の管理' }),
    rows.length ? el('div', null, rows) : el('p', { class: 'sub', text: 'まだ試合がありません' })
  ]);
}
async function resumeGame(gameId) {
  try { await openGameById(gameId); } catch (e) { setSettingsMsg(MSG.SAVE_FAIL(e.message || '不明'), true); return; }
  renderRecord(); switchTab('record');
  if (typeof awakeRefresh === 'function') awakeRefresh();
}
async function onDeleteGame(g) {
  const yes = await kyrDialog({ title: '試合の削除', message: g.date + ' の試合を削除します。削除の前に、記録を自動で書き出します。', buttons: [{ label: '書き出して削除', value: true, primary: true }, { label: 'やめる', value: false }] });
  if (!yes) return;
  const ex = await exportAll(askFileSaved);
  if (!ex.ok) { setSettingsMsg(MSG.EXPORT_ABORT, true); return; }          // 控えが取れなければ、削除しない
  try {
    await deleteGameTx(g.id);
    if (R.game && R.game.id === g.id) { leaveGameSilently(); }
    setSettingsMsg('削除しました', false);
  } catch (e) { setSettingsMsg(MSG.SAVE_FAIL(e.message || '不明'), true); }
  await recordRefreshSuggestions();
  renderRecord();
  await renderSettings();
}
function leaveGameSilently() {
  R.game = null; R.pas = []; R.pitches = []; R.state = 'NO_GAME'; R.draft = null; R.form = null;
  try { localStorage.removeItem(LS_LAST_GAME); } catch (e) { /* 何もしない */ }
}

// ---- 画面の点灯・見た目 ----
function buildAwakeCard() {
  const on = awakeEnabled();
  return el('div', { class: 'card', id: 'card-awake' }, [
    el('h2', { text: '画面の点灯' }),
    el('label', { class: 'chk' }, [el('input', { type: 'checkbox', id: 'keep-awake-toggle', checked: on, onchange: onKeepAwakeToggle }), el('span', { text: '記録中は画面を点けたままにする' })]),
    el('p', { class: 'sub', text: '電池を多く使い、端末が熱を持ちます。3時間の試合では、満充電で始めるか、充電しながら使ってください。30分操作しないと、自動でやめます。' })
  ]);
}
function onKeepAwakeToggle() {
  const on = document.getElementById('keep-awake-toggle').checked;
  try { localStorage.setItem(LS_KEEP_AWAKE, on ? '1' : '0'); } catch (e) { /* 何もしない */ }
  if (typeof awakeRefresh === 'function') awakeRefresh();
}
function applyTheme() {
  let v = 'auto';
  try { v = localStorage.getItem(LS_THEME) || 'auto'; } catch (e) { v = 'auto'; }
  if (v !== 'light' && v !== 'dark') v = 'auto';
  if (v === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v);
  return v;
}
function buildThemeCard() {
  const cur = applyTheme();
  const opt = function (v, label) {
    return el('label', { class: 'rad' }, [el('input', { type: 'radio', name: 'theme', value: v, checked: cur === v, onchange: function () { try { localStorage.setItem(LS_THEME, v); } catch (e) { /* 何もしない */ } applyTheme(); } }), el('span', { text: label })]);
  };
  return el('div', { class: 'card', id: 'card-theme' }, [el('h2', { text: '見た目' }), el('div', { class: 'btn-row wrap' }, [opt('auto', '自動'), opt('light', 'ノーマル'), opt('dark', 'ダーク')])]);
}

// ---- 保存容量 ----
function buildStorageCard() {
  return el('div', { class: 'card', id: 'card-storage' }, [el('h2', { text: '保存容量' }), el('p', { id: 'storage-info', text: '確認中…' })]);
}
async function refreshStorageInfo() {
  const n = document.getElementById('storage-info');
  if (!n) return;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
      const mb = function (b) { return (b / 1048576).toFixed(1) + ' MB'; };
      n.textContent = '使用量の目安：' + mb(est.usage || 0) + '（上限の目安：' + mb(est.quota || 0) + '）　保存領域の保護：' + (persisted === true ? 'あり' : (persisted === false ? 'なし（認められていません）' : '不明'));
    } else { n.textContent = 'この端末では、使用量を調べられません'; }
  } catch (e) { n.textContent = '使用量を調べられませんでした'; }
}

// ---- このアプリ ----
function buildAboutCard() {
  return el('div', { class: 'card', id: 'card-about' }, [
    el('h2', { text: 'このアプリ' }),
    el('p', { id: 'app-version', text: '版 ' + APP_VERSION + '（段階 ' + APP_STAGE + '）' }),
    el('button', { type: 'button', class: 'btn', id: 'check-update-btn', text: '更新を確認', onclick: onCheckUpdateTap }),
    el('p', { id: 'update-result', class: 'sub', text: S.checkMsg }),
    el('p', { class: 'sub', text: '【注意】ホーム画面に追加したアプリと、Safariで開いたページは、記録の置き場所が別です。記録は、必ずホーム画面のアイコンから入れてください。ホーム画面のアイコンを消す前に、［記録を書き出す］で控えを取ってください。' })
  ]);
}
async function onCheckUpdateTap() {
  const n = document.getElementById('update-result');
  if (n) n.textContent = '確認中…';
  const r = await checkForUpdate(true);
  S.checkMsg = (r === 'new') ? '新しい版があります。上の帯の［更新する］を押してください' : (r === 'unknown' ? '確認できませんでした（電波がないときなど）' : '最新です');
  const n2 = document.getElementById('update-result');
  if (n2) n2.textContent = S.checkMsg;
}
