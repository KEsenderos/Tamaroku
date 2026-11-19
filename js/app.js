'use strict';
// app.js（球録 v0.1.14）起動・タブの切り替え・更新ボタン・サービスワーカーの登録
let currentTab = 'record';
let swRegistration = null;
let lastUpdateCheck = 0;
let updateRequested = false;      // ボタンが押されたときだけ true（初回の起動で読み込み直さないため）
const TAB_IDS = ['record', 'review', 'settings'];     // 段階2・3で 'review' を足した（6.4）

function switchTab(tabId) {
  if (TAB_IDS.indexOf(tabId) < 0) tabId = 'record';
  currentTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(function (b) {
    const on = b.getAttribute('data-tab') === tabId;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(function (p) { p.hidden = (p.id !== 'panel-' + tabId); });
  try { localStorage.setItem(LS_LAST_TAB, tabId); } catch (e) { /* 何もしない */ }
  if (tabId === 'settings') renderSettings();
  if (tabId === 'review') renderReview();
  if (typeof awakeRefresh === 'function') awakeRefresh();
  window.scrollTo(0, 0);
}

// ---- 更新の感知と更新ボタン（ルールブック3-12） ----
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return null;
  try { return await navigator.serviceWorker.register('./sw.js'); } catch (e) { return null; }
}
async function initUpdateNotice() {
  swRegistration = await registerServiceWorker();
  if (!swRegistration) return;
  lastUpdateCheck = Date.now();
  if (swRegistration.waiting && navigator.serviceWorker.controller) showUpdateButton();
  swRegistration.addEventListener('updatefound', function () {
    const worker = swRegistration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', function () {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateButton();
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!updateRequested) return;
    updateRequested = false;
    location.reload();
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') checkForUpdate(); });
  document.getElementById('update-btn').addEventListener('click', applyUpdate);
  setInterval(function () { checkForUpdate(); }, UPDATE_CHECK_INTERVAL_MS);
}
// force=true（設定の［更新を確認］）：間隔を待たずに確認し、'new'／'latest'／'unknown' を返す
async function checkForUpdate(force) {
  if (!swRegistration) return force ? 'unknown' : undefined;
  if (!force && Date.now() - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return undefined;
  lastUpdateCheck = Date.now();
  try { await swRegistration.update(); } catch (e) { return force ? 'unknown' : undefined; }     // 電波が無いときは何もしない
  if (!force) return undefined;
  const w = swRegistration.waiting || swRegistration.installing;
  if (swRegistration.waiting) { showUpdateButton(); return 'new'; }
  if (w) { await new Promise(function (r) { setTimeout(r, 1500); }); if (swRegistration.waiting) { showUpdateButton(); return 'new'; } }
  return 'latest';
}
function showUpdateButton() {
  document.getElementById('update-btn').hidden = false;
  document.getElementById('update-note').hidden = false;
}
function applyUpdate() {
  document.getElementById('update-btn').hidden = true;
  document.getElementById('update-note').hidden = true;
  const waiting = swRegistration && swRegistration.waiting;
  if (waiting) { updateRequested = true; waiting.postMessage({ type: 'SKIP_WAITING' }); }
  else location.reload();
}

// ---- DBの通知（db.js から呼ばれる）----
function kyrOnDbBlocked() { showGlobalMsg(MSG.BLOCKED); }
function kyrOnDbVersionChange() { showGlobalMsg(MSG.VERSION_CHANGE); }
function showGlobalMsg(text) {
  const n = document.getElementById('global-msg');
  if (n) { n.textContent = text; n.hidden = !text; }
}

// ---- 起動 ----
async function appStart() {
  applyTheme();
  document.querySelectorAll('.tab-btn').forEach(function (b) { b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); }); });
  let tab = 'record';
  try { tab = localStorage.getItem(LS_LAST_TAB) || 'record'; } catch (e) { tab = 'record'; }
  switchTab(tab);
  try {
    await openDb();
    await initMeta();
    if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(function () { /* 認められなくても動く */ }); }
  } catch (e) {
    R.dbError = e;
    renderRecord();
    initUpdateNotice();
    return;
  }
  await recordInit();
  awakeInit();
  initUpdateNotice();
  // 画面が戻ったとき、DBの接続が切れていたら、1回やり直す（8.4）
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') openDb().catch(function (e) { R.dbError = e; renderRecord(); });
  });
  if (tab === 'settings') renderSettings();
  if (tab === 'review') renderReview();
}
document.addEventListener('DOMContentLoaded', appStart);
