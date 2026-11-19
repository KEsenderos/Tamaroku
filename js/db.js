'use strict';
// db.js（球録 v0.1.13）IndexedDB の読み書き・書き出し・取り込み。画面にはさわらない（通知は kyrOn… の関数を呼ぶだけ）
let _db = null;
let _dbOpening = null;

function openDb() {
  if (_db) return Promise.resolve(_db);
  if (_dbOpening) return _dbOpening;
  const p = new Promise(function (resolve, reject) {
    if (typeof indexedDB === 'undefined' || !indexedDB) { const e = new Error('IndexedDBが使えません'); e.code = 'NO_IDB'; reject(e); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { e.code = 'NO_IDB'; reject(e); return; }
    req.onupgradeneeded = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains('games')) db.createObjectStore('games', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pas')) { db.createObjectStore('pas', { keyPath: 'id' }).createIndex('byGame', 'gameId'); }
      if (!db.objectStoreNames.contains('pitches')) {
        const s = db.createObjectStore('pitches', { keyPath: 'id' });
        s.createIndex('byGame', 'gameId'); s.createIndex('byPa', 'paId');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = function () {
      _db = req.result;
      _db.onversionchange = function () { try { _db.close(); } catch (e) { /* 何もしない */ } _db = null; if (typeof kyrOnDbVersionChange === 'function') kyrOnDbVersionChange(); };
      _db.onclose = function () { _db = null; };
      resolve(_db);
    };
    req.onerror = function () {
      const e = req.error || new Error('DBを開けません');
      if (e.name === 'VersionError') e.code = 'VERSION';
      reject(e);
    };
    req.onblocked = function () { if (typeof kyrOnDbBlocked === 'function') kyrOnDbBlocked(); };
  });
  _dbOpening = p;
  const clear = function () { _dbOpening = null; };
  p.then(clear, clear);
  return p;
}

// work(tx, setResult, fail)：トランザクションの中で行う処理。tx が完了したら、setResult した値で解決する
async function dbTx(storeNames, mode, work) {
  const db = await openDb();
  return new Promise(function (resolve, reject) {
    let tx;
    try { tx = db.transaction(storeNames, mode); } catch (e) { _db = null; reject(e); return; }
    let result;
    let failed = null;
    tx.oncomplete = function () { if (failed) reject(failed); else resolve(result); };
    tx.onerror = function () { if (!failed) failed = tx.error || new Error('保存に失敗しました'); };
    tx.onabort = function () { reject(failed || tx.error || new Error('保存が取り消されました')); };
    const setResult = function (v) { result = v; };
    const fail = function (msg) { failed = new Error(msg); try { tx.abort(); } catch (e) { /* 何もしない */ } };
    try { work(tx, setResult, fail); } catch (e) { failed = e; try { tx.abort(); } catch (e2) { /* 何もしない */ } }
  });
}

// ---- メタ ----
function normalizePitchTypes(v) {
  if (!Array.isArray(v) || v.length === 0 || v.length > PITCHTYPE_LIST_MAX) return null;
  for (const t of v) {
    if (!t || typeof t.code !== 'string' || typeof t.name !== 'string' || typeof t.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(t.color)) return null;
  }
  return v;
}
async function getMeta(key) {
  return dbTx(['meta'], 'readonly', function (tx, setRes) {
    tx.objectStore('meta').get(key).onsuccess = function (e) { setRes(e.target.result ? e.target.result.value : undefined); };
  });
}
async function setMeta(key, value) {
  return dbTx(['meta'], 'readwrite', function (tx) { tx.objectStore('meta').put({ key: key, value: value }); });
}
async function getPitchTypes() {
  const v = normalizePitchTypes(await getMeta('pitchTypes'));
  return v || DEFAULT_PITCH_TYPES.map(function (t) { return Object.assign({}, t); });
}
async function initMeta() {
  await dbTx(['meta'], 'readwrite', function (tx) {
    const s = tx.objectStore('meta');
    s.get('schemaVersion').onsuccess = function (e) { if (!e.target.result) s.put({ key: 'schemaVersion', value: SCHEMA_VERSION }); };
    s.get('pitchTypes').onsuccess = function (e) {
      if (!normalizePitchTypes(e.target.result ? e.target.result.value : null)) s.put({ key: 'pitchTypes', value: DEFAULT_PITCH_TYPES.map(function (t) { return Object.assign({}, t); }) });
    };
  });
}

// ---- 打席・球 ----
// 打者のボタンを押して、打席を作る（球はまだない）。pa と、games の liveSit を1つのトランザクションで書く
function startPaTx(pa, liveSit) {
  return dbTx(['games', 'pas'], 'readwrite', function (tx, setRes, fail) {
    tx.objectStore('pas').put(pa);
    const gs = tx.objectStore('games');
    gs.get(pa.gameId).onsuccess = function (e) {
      const g = e.target.result;
      if (!g) { fail('試合が見つかりません'); return; }
      g.liveSit = liveSit; gs.put(g);
    };
  });
}

// 1球の保存：球・打席・今の状況を、1つのトランザクションで書く（8.4）
function savePitchTx(pitch, pa, liveSit) {
  return dbTx(['games', 'pas', 'pitches'], 'readwrite', function (tx, setRes, fail) {
    tx.objectStore('pitches').put(pitch);
    tx.objectStore('pas').put(pa);
    const gs = tx.objectStore('games');
    gs.get(pitch.gameId).onsuccess = function (e) {
      const g = e.target.result;
      if (!g) { fail('試合が見つかりません'); return; }
      g.liveSit = liveSit; gs.put(g);
    };
  });
}

function saveLiveSitTx(gameId, liveSit) {
  return dbTx(['games'], 'readwrite', function (tx, setRes, fail) {
    const gs = tx.objectStore('games');
    gs.get(gameId).onsuccess = function (e) {
      const g = e.target.result;
      if (!g) { fail('試合が見つかりません'); return; }
      g.liveSit = liveSit; gs.put(g); setRes(liveSit);
    };
  });
}

// 最後の1球を消し、打席と状況を戻す（8.4）。戻り値：{ liveSit }
function deleteLastPitchTx(gameId) {
  return dbTx(['games', 'pas', 'pitches'], 'readwrite', function (tx, setRes, fail) {
    const ps = tx.objectStore('pitches');
    ps.index('byGame').getAll(gameId).onsuccess = function (e) {
      const list = e.target.result.sort(function (a, b) { return a.seq - b.seq; });
      if (list.length === 0) { fail('取り消せる球がありません'); return; }
      const last = list[list.length - 1];
      const restInPa = list.filter(function (p) { return p.paId === last.paId && p.id !== last.id; });
      ps.delete(last.id);
      const gs = tx.objectStore('games'); const as = tx.objectStore('pas');
      gs.get(gameId).onsuccess = function (ge) {
        const g = ge.target.result;
        if (!g) { fail('試合が見つかりません'); return; }
        as.get(last.paId).onsuccess = function (pe) {
          const pa = pe.target.result;
          const s = last.sit;
          const nl = { inning: s.inning, half: s.half, outs: s.outs, runners: s.runners, balls: s.balls, strikes: s.strikes, openPaId: null, edited: !!last.sitEdited };
          if (pa && restInPa.length === 0) {
            as.delete(pa.id);                       // 打席の最初の球なら、打席ごと消す
          } else if (pa) {
            pa.endType = null; pa.outcome = null; as.put(pa); nl.openPaId = pa.id;
          }
          g.liveSit = nl; gs.put(g); setRes({ liveSit: nl });
        };
      };
    };
  });
}

// 打席を閉じる（終わりの球を記録しないまま。5.10）
function closePaTx(gameId) {
  return dbTx(['games', 'pas'], 'readwrite', function (tx, setRes, fail) {
    const gs = tx.objectStore('games'); const as = tx.objectStore('pas');
    gs.get(gameId).onsuccess = function (e) {
      const g = e.target.result;
      if (!g || !g.liveSit.openPaId) { fail('閉じる打席がありません'); return; }
      as.get(g.liveSit.openPaId).onsuccess = function (pe) {
        const pa = pe.target.result;
        if (!pa || pa.endType !== null) { fail('閉じる打席がありません'); return; }
        pa.endType = 'SKIPPED'; as.put(pa);
        const nl = Object.assign({}, g.liveSit, { balls: 0, strikes: 0, openPaId: null, edited: true });
        g.liveSit = nl; gs.put(g); setRes({ liveSit: nl });
      };
    };
  });
}

// 閉じた打席を開き直す（球は消さない）。カウントは、最後の球から計算し直す
function reopenPaTx(gameId) {
  return dbTx(['games', 'pas', 'pitches'], 'readwrite', function (tx, setRes, fail) {
    const gs = tx.objectStore('games'); const as = tx.objectStore('pas'); const ps = tx.objectStore('pitches');
    gs.get(gameId).onsuccess = function (e) {
      const g = e.target.result;
      if (!g || g.liveSit.openPaId) { fail('開き直せる打席がありません'); return; }
      as.index('byGame').getAll(gameId).onsuccess = function (pe) {
        const list = pe.target.result.sort(function (a, b) { return a.paNo - b.paNo; });
        const pa = list[list.length - 1];
        if (!pa || pa.endType !== 'SKIPPED') { fail('開き直せる打席がありません'); return; }
        ps.index('byPa').getAll(pa.id).onsuccess = function (qe) {
          const pl = qe.target.result.sort(function (a, b) { return a.paSeq - b.paSeq; });
          let balls = 0, strikes = 0;
          if (pl.length > 0) {
            const lp = pl[pl.length - 1];
            const c = applyPitchToCount(lp.sit.balls, lp.sit.strikes, { result: lp.result, takenCall: lp.takenCall, caught: false });
            balls = c.balls; strikes = c.strikes;
          }
          pa.endType = null; as.put(pa);
          const nl = Object.assign({}, g.liveSit, { balls: balls, strikes: strikes, openPaId: pa.id });
          g.liveSit = nl; gs.put(g); setRes({ liveSit: nl });
        };
      };
    };
  });
}

// 球が1つもない打席を消す（打者のボタンの押し間違い）
function deleteEmptyPaTx(gameId) {
  return dbTx(['games', 'pas', 'pitches'], 'readwrite', function (tx, setRes, fail) {
    const gs = tx.objectStore('games'); const as = tx.objectStore('pas');
    gs.get(gameId).onsuccess = function (e) {
      const g = e.target.result;
      if (!g || !g.liveSit.openPaId) { fail('消せる打席がありません'); return; }
      const paId = g.liveSit.openPaId;
      tx.objectStore('pitches').index('byPa').count(paId).onsuccess = function (ce) {
        if (ce.target.result !== 0) { fail('球がある打席は消せません'); return; }
        as.delete(paId);
        const nl = Object.assign({}, g.liveSit, { openPaId: null });
        g.liveSit = nl; gs.put(g); setRes({ liveSit: nl });
      };
    };
  });
}

// 印の付け足し・外し（5.5のD。8.4）。CAUGHT_OUT は、結果が FOUL で、打席の最後の球にだけ付けられる
function updatePitchMarksTx(pitchId, marks) {
  return dbTx(['games', 'pas', 'pitches'], 'readwrite', function (tx, setRes, fail) {
    const ps = tx.objectStore('pitches'); const gs = tx.objectStore('games'); const as = tx.objectStore('pas');
    ps.get(pitchId).onsuccess = function (e) {
      const pitch = e.target.result;
      if (!pitch) { fail('球が見つかりません'); return; }
      const had = (pitch.marks || []).indexOf('CAUGHT_OUT') >= 0;
      const want = marks.indexOf('CAUGHT_OUT') >= 0;
      if (had === want) { pitch.marks = marks; ps.put(pitch); setRes({ liveSit: null }); return; }
      if (pitch.result !== 'FOUL') { fail('この印は、ファウルの球にだけ付けられます'); return; }
      ps.index('byPa').getAll(pitch.paId).onsuccess = function (qe) {
        const maxSeq = qe.target.result.reduce(function (m, p) { return Math.max(m, p.paSeq); }, 0);
        if (pitch.paSeq !== maxSeq) { fail('この印は、打席の最後の球にだけ付けられます'); return; }
        gs.get(pitch.gameId).onsuccess = function (ge) {
          const g = ge.target.result;
          if (!g) { fail('試合が見つかりません'); return; }
          as.get(pitch.paId).onsuccess = function (pe) {
            const pa = pe.target.result;
            if (!pa) { fail('打席が見つかりません'); return; }
            const live = g.liveSit;
            let nl;
            if (want) {
              if (pa.endType !== null || live.openPaId !== pa.id) { fail('この打席には、いま印を付けられません'); return; }
              const adv = advanceSituation({ inning: live.inning, half: live.half, outs: live.outs, runners: live.runners }, 'CAUGHT_FOUL', null, null);
              pa.endType = 'CAUGHT_FOUL';
              nl = Object.assign({}, live, { inning: adv.inning, half: adv.half, outs: adv.outs, runners: adv.runners, balls: 0, strikes: 0, openPaId: null });
            } else {
              if (pa.endType !== 'CAUGHT_FOUL' || live.openPaId !== null) { fail('この印は、いま外せません'); return; }
              pa.endType = null;
              nl = Object.assign({}, live, { openPaId: pa.id });
              if (live.outs > 0) { nl.outs = live.outs - 1; }
              else { nl.inning = pitch.sit.inning; nl.half = pitch.sit.half; nl.outs = pitch.sit.outs; nl.runners = pitch.sit.runners; }
              const c = applyPitchToCount(pitch.sit.balls, pitch.sit.strikes, { result: 'FOUL', takenCall: null, caught: false });
              nl.balls = c.balls; nl.strikes = c.strikes;
            }
            pitch.marks = marks; ps.put(pitch); as.put(pa); g.liveSit = nl; gs.put(g); setRes({ liveSit: nl });
          };
        };
      };
    };
  });
}

// ---- 試合 ----
function saveGameTx(game) {
  return dbTx(['games'], 'readwrite', function (tx) { tx.objectStore('games').put(game); });
}
function deleteGameTx(gameId) {
  return dbTx(['games', 'pas', 'pitches'], 'readwrite', function (tx) {
    tx.objectStore('games').delete(gameId);
    const as = tx.objectStore('pas'); const ps = tx.objectStore('pitches');
    as.index('byGame').getAllKeys(gameId).onsuccess = function (e) { e.target.result.forEach(function (k) { as.delete(k); }); };
    ps.index('byGame').getAllKeys(gameId).onsuccess = function (e) { e.target.result.forEach(function (k) { ps.delete(k); }); };
  });
}
function loadGame(gameId) {
  return dbTx(['games', 'pas', 'pitches'], 'readonly', function (tx, setRes) {
    let game, pas, pitches;
    const done = function () { if (game !== undefined && pas && pitches) setRes(game ? { game: game, pas: pas.sort(function (a, b) { return a.paNo - b.paNo; }), pitches: pitches.sort(function (a, b) { return a.seq - b.seq; }) } : null); };
    tx.objectStore('games').get(gameId).onsuccess = function (e) { game = e.target.result || null; done(); };
    tx.objectStore('pas').index('byGame').getAll(gameId).onsuccess = function (e) { pas = e.target.result; done(); };
    tx.objectStore('pitches').index('byGame').getAll(gameId).onsuccess = function (e) { pitches = e.target.result; done(); };
  });
}
function isReadableGame(g) {
  return !!(g && typeof g === 'object' && typeof g.id === 'string' && typeof g.date === 'string' &&
    Array.isArray(g.pitchers) && g.pitchers.length > 0 && Array.isArray(g.batters) && g.liveSit && typeof g.liveSit === 'object');
}
// 試合の一覧（球は読まない。8.6）。戻り値：{ games, unreadable }（読めない試合の件数）
function listGames() {
  return dbTx(['games'], 'readonly', function (tx, setRes) {
    tx.objectStore('games').getAll().onsuccess = function (e) {
      const all = e.target.result;
      const games = all.filter(isReadableGame).sort(function (a, b) { return a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.id < b.id ? 1 : -1); });
      setRes({ games: games, unreadable: all.length - games.length });
    };
  });
}
function countPitches() {
  return dbTx(['pitches'], 'readonly', function (tx, setRes) {
    tx.objectStore('pitches').count().onsuccess = function (e) { setRes(e.target.result); };
  });
}
function countPitchTypeUse(code) {
  return dbTx(['pitches'], 'readonly', function (tx, setRes) {
    let n = 0;
    tx.objectStore('pitches').openCursor().onsuccess = function (e) {
      const c = e.target.result;
      if (!c) { setRes(n); return; }
      if (c.value.pitchType === code) n += 1;
      c.continue();
    };
  });
}

// ---- 書き出し ----
function buildBackup() {
  return dbTx(['games', 'pas', 'pitches', 'meta'], 'readonly', function (tx, setRes) {
    const out = { app: 'kyr', schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, exportedAt: Date.now(), meta: { pitchTypes: null }, games: null, pas: null, pitches: null };
    const done = function () { if (out.games && out.pas && out.pitches && out.meta.pitchTypes) setRes(out); };
    tx.objectStore('games').getAll().onsuccess = function (e) { out.games = e.target.result; done(); };
    tx.objectStore('pas').getAll().onsuccess = function (e) { out.pas = e.target.result; done(); };
    tx.objectStore('pitches').getAll().onsuccess = function (e) { out.pitches = e.target.result; done(); };
    tx.objectStore('meta').get('pitchTypes').onsuccess = function (e) {
      const v = normalizePitchTypes(e.target.result ? e.target.result.value : null);
      out.meta.pitchTypes = v || DEFAULT_PITCH_TYPES.map(function (t) { return Object.assign({}, t); }); done();
    };
  });
}
function pad2(n) { return String(n).padStart(2, '0'); }
// 戻り値：{ ok, error? }。成功のときだけ lastExportAt・lastExportPitchCount を保存する（8.7）。
// askSaved(url, name)：共有が使えないとき、リンクを出して「保存できましたか？」を聞く関数（画面側が用意。Promise<boolean>）
async function exportAll(askSaved) {
  let url = null;
  try {
    const data = await buildBackup();
    const text = JSON.stringify(data);
    const now = new Date();
    const name = 'kyr-backup_' + dayStr(now) + '_' + pad2(now.getHours()) + pad2(now.getMinutes()) + '.json';
    let ok = false;
    let file = null;
    try { file = new File([text], name, { type: 'application/json' }); } catch (e) { file = null; }
    if (file && typeof navigator !== 'undefined' && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: '球録の記録' }); ok = true; } catch (e) { ok = false; }   // 取り消し（AbortError）も失敗
    } else {
      url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      ok = (typeof askSaved === 'function') ? !!(await askSaved(url, name)) : false;
    }
    if (ok) {
      await dbTx(['meta'], 'readwrite', function (tx) {
        const s = tx.objectStore('meta');
        s.put({ key: 'lastExportAt', value: Date.now() });
        s.put({ key: 'lastExportPitchCount', value: data.pitches.length });
      });
    }
    return { ok: ok };
  } catch (e) {
    return { ok: false, error: e };
  } finally {
    if (url) setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }
}

// ---- 取り込み ----
function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function isInt(v, lo, hi) { return Number.isInteger(v) && v >= lo && v <= hi; }
function isNameStr(v) { return typeof v === 'string' && v.length >= 1 && v.length <= NAME_MAX; }
function validSit(s, withCount) {
  if (!isObj(s)) return false;
  if (!isInt(s.inning, 1, 30) || (s.half !== 'T' && s.half !== 'B') || !isInt(s.outs, 0, 2) || !isInt(s.runners, 0, 7)) return false;
  return isInt(s.balls, 0, 3) && isInt(s.strikes, 0, 2);
}
// 戻り値：{ ok, errors:[文], counts }
function validateBackup(obj) {
  const errors = [];
  const bad = function (msg) { if (errors.length < 10) errors.push(msg); };
  if (!isObj(obj)) return { ok: false, errors: ['ファイルの形が違います'], counts: null };
  if (obj.app !== 'kyr') return { ok: false, errors: ['球録の書き出しファイルではありません'], counts: null };
  if (typeof obj.schemaVersion !== 'number' || !Number.isInteger(obj.schemaVersion) || obj.schemaVersion < 1) return { ok: false, errors: ['版の情報が読めません'], counts: null };
  if (obj.schemaVersion > SCHEMA_VERSION) return { ok: false, errors: ['新しい版のアプリで書き出された記録です'], counts: null };
  if (!Array.isArray(obj.games) || !Array.isArray(obj.pas) || !Array.isArray(obj.pitches)) return { ok: false, errors: ['試合・打席・球の一覧が読めません'], counts: null };
  const counts = { games: obj.games.length, pas: obj.pas.length, pitches: obj.pitches.length };
  if (counts.games > IMPORT_MAX_GAMES || counts.pas > IMPORT_MAX_PAS || counts.pitches > IMPORT_MAX_PITCHES) return { ok: false, errors: ['件数が上限を超えています（試合' + IMPORT_MAX_GAMES + '・打席' + IMPORT_MAX_PAS + '・球' + IMPORT_MAX_PITCHES + '）'], counts: counts };
  // 球種の一覧
  let codes = DEFAULT_PITCH_TYPES.map(function (t) { return t.code; });
  if (obj.meta !== undefined) {
    if (!isObj(obj.meta)) bad('meta が読めません');
    else if (obj.meta.pitchTypes !== undefined) {
      const pt = normalizePitchTypes(obj.meta.pitchTypes);
      if (!pt) bad('球種の一覧が読めません（15個以内の {code, name, color}）');
      else { codes = pt.map(function (t) { return t.code; }); pt.forEach(function (t) { if (t.name.length > PITCHTYPE_NAME_MAX * 2 || t.code.length > 4) bad('球種の名前・コードが長すぎます'); }); }
    }
  }
  const gameIds = new Map(); const paGame = new Map(); const pitchIds = new Set();
  obj.games.forEach(function (g, i) {
    if (!isObj(g) || typeof g.id !== 'string') { bad('試合' + (i + 1) + '：IDが読めません'); return; }
    if (gameIds.has(g.id)) { bad('試合のIDが重なっています'); return; }
    gameIds.set(g.id, true);
    if (typeof g.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(g.date)) bad('試合' + (i + 1) + '：日付が読めません');
    if (!Array.isArray(g.pitchers) || g.pitchers.length < 1 || g.pitchers.length > 30 || !g.pitchers.every(function (p) { return isObj(p) && isNameStr(p.name) && (p.hand === 'R' || p.hand === 'L') && Array.isArray(p.pitchTypes) && p.pitchTypes.every(function (c) { return typeof c === 'string'; }); })) bad('試合' + (i + 1) + '：投手の情報が読めません');
    if (!Array.isArray(g.batters) || g.batters.length > 30 || !g.batters.every(function (b) { return isObj(b) && typeof b.id === 'string' && isNameStr(b.name) && (b.side === 'R' || b.side === 'L'); })) bad('試合' + (i + 1) + '：打者の情報が読めません');
    if (!validSit(g.liveSit) || (g.liveSit.openPaId !== null && typeof g.liveSit.openPaId !== 'string')) bad('試合' + (i + 1) + '：状況が範囲外です');
    if (!isInt(g.batterSeq, 0, 1000000)) bad('試合' + (i + 1) + '：打者の番号が読めません');
    if (typeof g.createdAt !== 'number') bad('試合' + (i + 1) + '：作った時刻が読めません');
    if (g.note !== undefined && (typeof g.note !== 'string' || g.note.length > 200)) bad('試合' + (i + 1) + '：メモが長すぎます');
  });
  obj.pas.forEach(function (a, i) {
    if (!isObj(a) || typeof a.id !== 'string') { bad('打席' + (i + 1) + '：IDが読めません'); return; }
    if (paGame.has(a.id)) { bad('打席のIDが重なっています'); return; }
    paGame.set(a.id, a.gameId);
    if (!gameIds.has(a.gameId)) bad('打席' + (i + 1) + '：存在しない試合に属しています');
    if (!isInt(a.paNo, 1, 1000000)) bad('打席' + (i + 1) + '：通し番号が読めません');
    if (typeof a.batterId !== 'string' || !isNameStr(a.batterName) || (a.side !== 'R' && a.side !== 'L')) bad('打席' + (i + 1) + '：打者の情報が読めません');
    if (a.endType !== null && END_TYPES.indexOf(a.endType) < 0) bad('打席' + (i + 1) + '：終わり方が決まった値ではありません');
    if (a.outcome !== null && OUTCOME_ORDER.indexOf(a.outcome) < 0) bad('打席' + (i + 1) + '：結果が決まった値ではありません');
    if (typeof a.startedAt !== 'number') bad('打席' + (i + 1) + '：開始の時刻が読めません');
  });
  obj.pitches.forEach(function (p, i) {
    if (!isObj(p) || typeof p.id !== 'string') { bad('球' + (i + 1) + '：IDが読めません'); return; }
    if (pitchIds.has(p.id)) { bad('球のIDが重なっています'); return; }
    pitchIds.add(p.id);
    if (!paGame.has(p.paId) || paGame.get(p.paId) !== p.gameId) bad('球' + (i + 1) + '：存在しない打席・試合に属しています');
    if (!isInt(p.seq, 1, 1000000) || !isInt(p.paSeq, 1, 1000)) bad('球' + (i + 1) + '：番号が読めません');
    if (!isObj(p.pitcher) || !isNameStr(p.pitcher.name) || (p.pitcher.hand !== 'R' && p.pitcher.hand !== 'L')) bad('球' + (i + 1) + '：投手の情報が読めません');
    if (!isInt(p.row, 1, 5) || !isInt(p.col, 1, 5)) bad('球' + (i + 1) + '：ゾーンが範囲外です');
    if (typeof p.pitchType !== 'string' || codes.indexOf(p.pitchType) < 0) bad('球' + (i + 1) + '：球種が一覧にありません');
    if (RESULT_ORDER.indexOf(p.result) < 0) bad('球' + (i + 1) + '：結果が決まった値ではありません');
    if (p.takenCall !== null && p.takenCall !== 'S' && p.takenCall !== 'B') bad('球' + (i + 1) + '：判定が読めません');
    if (p.reaction !== undefined && p.reaction !== null && REACT_ORDER.indexOf(p.reaction) < 0) bad('球' + (i + 1) + '：反応が読めません');
    if (p.foulType !== null && FOUL_ORDER.indexOf(p.foulType) < 0) bad('球' + (i + 1) + '：ファウルの種類が読めません');
    if (p.foulDir !== null && FOULDIR_ORDER.indexOf(p.foulDir) < 0) bad('球' + (i + 1) + '：ファウルの方向が読めません');
    if (p.inplay !== null) {
      const ip = p.inplay;
      if (!isObj(ip) || KIND_ORDER.indexOf(ip.kind) < 0 || DIR_ALL.indexOf(ip.dir) < 0 || OUTCOME_ORDER.indexOf(ip.outcome) < 0) bad('球' + (i + 1) + '：打球の情報が読めません');
      else if (ip.outsAdded !== undefined && ip.outsAdded !== null && !isInt(ip.outsAdded, 0, 2)) bad('球' + (i + 1) + '：アウトの数が範囲外です');
    }
    if (!Array.isArray(p.marks) || !p.marks.every(function (m) { return MARK_ORDER.indexOf(m) >= 0; })) bad('球' + (i + 1) + '：印が読めません');
    if (!validSit(p.sit)) bad('球' + (i + 1) + '：状況が範囲外です');
    if (p.sitEdited !== undefined && typeof p.sitEdited !== 'boolean') bad('球' + (i + 1) + '：直した印が読めません');
    if (p.memo !== undefined && (typeof p.memo !== 'string' || p.memo.length > MEMO_MAX)) bad('球' + (i + 1) + '：メモが長すぎます');
    if (typeof p.createdAt !== 'number') bad('球' + (i + 1) + '：時刻が読めません');
  });
  return { ok: errors.length === 0, errors: errors, counts: counts };
}

// 古い版を、今の版に変換する（今は版1だけなので、そのまま返す。8.7）
function migrateBackup(obj) { return obj; }

// mode：'add'（足す）| 'replace'（置き換える）。確認・自動書き出しは、呼ぶ前に画面側で済ませる。戻り値：件数
async function importBackup(obj, mode) {
  const data = migrateBackup(obj);
  const v = validateBackup(data);
  if (!v.ok) { const e = new Error(v.errors.join(' / ')); e.validation = v; throw e; }
  const incomingTypes = (data.meta && normalizePitchTypes(data.meta.pitchTypes)) || null;
  return dbTx(['games', 'pas', 'pitches', 'meta'], 'readwrite', function (tx, setRes) {
    const gs = tx.objectStore('games'), as = tx.objectStore('pas'), ps = tx.objectStore('pitches'), ms = tx.objectStore('meta');
    if (mode === 'replace') {
      gs.clear(); as.clear(); ps.clear();
      data.games.forEach(function (g) { gs.put(g); });
      data.pas.forEach(function (a) { as.put(a); });
      data.pitches.forEach(function (p) { ps.put(p); });
      if (incomingTypes) ms.put({ key: 'pitchTypes', value: incomingTypes });
      setRes({ games: data.games.length, pas: data.pas.length, pitches: data.pitches.length, skippedGames: 0 });
      return;
    }
    // 足す：同じIDの試合は、打席・球ごと丸ごと飛ばす
    gs.getAllKeys().onsuccess = function (ke) {
      const have = new Set(ke.target.result);
      const skip = new Set();
      const addGames = [];
      data.games.forEach(function (g) { if (have.has(g.id)) skip.add(g.id); else addGames.push(g); });
      as.getAllKeys().onsuccess = function (ae) {
        const haveA = new Set(ae.target.result);
        ps.getAllKeys().onsuccess = function (pe) {
          const haveP = new Set(pe.target.result);
          let nA = 0, nP = 0;
          addGames.forEach(function (g) { gs.put(g); });
          data.pas.forEach(function (a) { if (!skip.has(a.gameId) && !haveA.has(a.id)) { as.put(a); nA += 1; } });
          data.pitches.forEach(function (p) { if (!skip.has(p.gameId) && !haveP.has(p.id)) { ps.put(p); nP += 1; } });
          ms.get('pitchTypes').onsuccess = function (me) {
            const cur = normalizePitchTypes(me.target.result ? me.target.result.value : null) || DEFAULT_PITCH_TYPES.map(function (t) { return Object.assign({}, t); });
            if (incomingTypes) {
              incomingTypes.forEach(function (t) { if (!cur.some(function (c) { return c.code === t.code; }) && cur.length < PITCHTYPE_LIST_MAX) cur.push(t); });
            }
            ms.put({ key: 'pitchTypes', value: cur });
          };
          setRes({ games: addGames.length, pas: nA, pitches: nP, skippedGames: skip.size });
        };
      };
    };
  });
}
