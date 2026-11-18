'use strict';
// awake.js（球録 v0.1.4）記録中は画面を点けたままにする（5.9）
let _awSentinel = null;
let _awLastTouch = Date.now();
let _awDenied = false;          // 取得に失敗した（拒否）
let _awUnsupported = false;     // 未対応
let _awRetryUsed = false;       // 拒否のあと、次の操作で取り直すのは1回だけ
let _awAcquiring = false;
let _awTimer = null;

function awakeEnabled() {
  try { return localStorage.getItem(LS_KEEP_AWAKE) !== '0'; } catch (e) { return true; }   // 初期値はオン
}
function awakeContext() {
  return {
    enabled: awakeEnabled(),
    tab: (typeof currentTab !== 'undefined') ? currentTab : 'record',
    hasGame: (typeof R !== 'undefined') && !!R.game,
    visible: typeof document === 'undefined' || document.visibilityState === 'visible',
    idleMs: Date.now() - _awLastTouch
  };
}
// 状態：ON / OFF_IDLE / OFF_DENIED / OFF_UNSUPPORTED / OFF_SETTING / OFF_HIDDEN（表示しない場面）
function awakeStatus() {
  const c = awakeContext();
  if (!c.enabled) return 'OFF_SETTING';
  if (c.tab !== 'record' || !c.hasGame || !c.visible) return 'OFF_HIDDEN';
  if (!keepAwakeWanted(c)) return 'OFF_IDLE';
  if (_awSentinel) return 'ON';
  if (_awUnsupported) return 'OFF_UNSUPPORTED';
  if (_awDenied) return 'OFF_DENIED';
  return 'OFF_HIDDEN';          // 取得の途中
}
const AWAKE_TEXT = {
  ON: '画面を点けたままにしています',
  OFF_IDLE: '30分操作がないので、画面を点けたままにするのをやめました。どれかを押すと、また点けたままにします',
  OFF_DENIED: '画面を点けたままにできません。iPhoneの［設定］→［画面表示と明るさ］→［自動ロック］を［なし］にしてください（試合のあとで戻します）',
  OFF_UNSUPPORTED: '画面を点けたままにできません。iPhoneの［設定］→［画面表示と明るさ］→［自動ロック］を［なし］にしてください（試合のあとで戻します）'
};
function awakeShow() {
  const node = document.getElementById('awake-status');
  if (!node) return;
  const st = awakeStatus();
  const text = AWAKE_TEXT[st];
  if (text) { node.textContent = text; node.hidden = false; node.setAttribute('data-state', st); }
  else { node.textContent = ''; node.hidden = true; node.removeAttribute('data-state'); }
}
async function awakeAcquire() {
  if (_awAcquiring || _awSentinel) return;
  if (typeof navigator === 'undefined' || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') { _awUnsupported = true; return; }
  _awAcquiring = true;
  try {
    const s = await navigator.wakeLock.request('screen');
    _awSentinel = s; _awDenied = false; _awRetryUsed = false;
    s.addEventListener('release', function () { if (_awSentinel === s) _awSentinel = null; awakeShow(); });
  } catch (e) {
    _awDenied = true;
  } finally {
    _awAcquiring = false;
  }
}
function awakeRelease() {
  const s = _awSentinel;
  _awSentinel = null;
  if (s) { try { s.release().catch(function () { /* 何もしない */ }); } catch (e) { /* 何もしない */ } }
}
// 条件を見直して、取る・解除する。表示も直す
async function awakeRefresh() {
  const wanted = keepAwakeWanted(awakeContext());
  if (wanted && !_awSentinel && !_awDenied) await awakeAcquire();
  else if (!wanted && _awSentinel) awakeRelease();
  awakeShow();
}
// 記録タブの押す操作のたびに呼ぶ
async function awakeTouch() {
  const wasIdle = (Date.now() - _awLastTouch) >= KEEP_AWAKE_IDLE_MIN * 60000;
  _awLastTouch = Date.now();
  if (_awDenied && !_awRetryUsed && keepAwakeWanted(awakeContext())) { _awRetryUsed = true; _awDenied = false; }
  if (wasIdle || !_awSentinel) await awakeRefresh(); else awakeShow();
}
function awakeInit() {
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', function () {
      if (_awSentinel && _awSentinel.released === true) _awSentinel = null;   // 裏に回ると、ブラウザが自動で解除する
      awakeRefresh();                                                         // 画面が戻ったら、条件を見直して取り直す
    });
  }
  if (_awTimer) clearInterval(_awTimer);
  _awTimer = setInterval(awakeRefresh, 60000);
  awakeRefresh();
}
