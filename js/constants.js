'use strict';
// constants.js（球録 v0.1.7・段階3）定数。core.js の定数（DAY_START_HOUR など）はここに重ねて書かない
const APP_VERSION = '0.1.7';
const APP_STAGE = 3;                  // 1=記録・設定 / 2=振り返り / 3=シルエット（6.4）
const SCHEMA_VERSION = 1;             // 保存の形の版
const DB_NAME = 'kyr-db';
const DB_VERSION = 1;                 // DBの版（保存の形の版とは別）
const LS_LAST_TAB = 'kyr_lastTab';
const LS_THEME = 'kyr_theme';
const LS_LAST_GAME = 'kyr_lastGameId';
const LS_KEEP_AWAKE = 'kyr_keepAwake';
const EXPORT_REMIND_DAYS = 14;
const EXPORT_REMIND_PITCHES = 200;
const STORAGE_WARN_RATIO = 0.8;
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;
const NAME_MAX = 20;
const MEMO_MAX = 100;
const PITCHTYPE_NAME_MAX = 10;
const PITCHTYPE_LIST_MAX = 15;
const CUSTOM_PITCHTYPE_MAX = 6;
const BATTER_MAX = 3;
const IMPORT_MAX_BYTES = 50 * 1024 * 1024;
const IMPORT_MAX_GAMES = 1000;
const IMPORT_MAX_PAS = 20000;
const IMPORT_MAX_PITCHES = 100000;
const RECENT_PITCH_ROWS = 8;

// 球種（7.3）。color は点の背景（文字は黒）
const DEFAULT_PITCH_TYPES = [
  { code: 'ST', name: 'ストレート', color: '#E5E7EB' },
  { code: 'TW', name: 'ツーシーム', color: '#FDBA74' },
  { code: 'CT', name: 'カットボール', color: '#FCD34D' },
  { code: 'SL', name: 'スライダー', color: '#86EFAC' },
  { code: 'CV', name: 'カーブ', color: '#67E8F9' },
  { code: 'FK', name: 'フォーク', color: '#93C5FD' },
  { code: 'CH', name: 'チェンジアップ', color: '#C4B5FD' },
  { code: 'SK', name: 'シンカー', color: '#F9A8D4' },
  { code: 'SP', name: 'スプリット', color: '#FCA5A5' }
];
const CUSTOM_COLORS = ['#D9F99D', '#FDE68A', '#A5F3FC', '#DDD6FE', '#FBCFE8', '#FED7AA'];
const DEFAULT_START_TYPES = ['ST', 'SL', 'CV', 'CH'];

// 画面の表示名（内部の値とは分ける）
const RESULT_ORDER = ['TAKEN', 'MISS', 'FOUL', 'HBP', 'INPLAY'];
const RESULT_LABEL = { TAKEN: '見逃し', MISS: '空振り', FOUL: 'ファウル', HBP: '死球', INPLAY: 'インプレー' };
const FOUL_ORDER = ['PULL_CUT', 'LATE_OPPO', 'BACK_GOOD', 'CUT', 'UNDER_NICK', 'OWN_BALL', 'OTHER'];
const FOUL_LABEL = { PULL_CUT: '引っ張り切れ', LATE_OPPO: '遅れ流し', BACK_GOOD: '後方好打', CUT: 'カット', UNDER_NICK: '下かすり', OWN_BALL: '自打球', OTHER: 'その他のファウル' };
const FOULDIR_ORDER = ['F1B', 'F3B', 'FBK', 'FLN'];
const FOULDIR_LABEL = { F1B: '一塁側', F3B: '三塁側', FBK: '後方', FLN: 'ライン際' };
const KIND_ORDER = ['GR_HARD', 'GR_MID', 'GR_SOFT', 'LINER', 'FLY_SHALLOW', 'FLY_MID', 'FLY_DEEP', 'FLY_INF', 'BUNT'];
const KIND_LABEL = { GR_HARD: 'ゴロ（強）', GR_MID: 'ゴロ（普通）', GR_SOFT: 'ゴロ（弱）', LINER: 'ライナー', FLY_SHALLOW: 'フライ（浅い）', FLY_MID: 'フライ（普通）', FLY_DEEP: 'フライ（深い）', FLY_INF: '内野フライ', BUNT: 'バント（転がした）' };
// 方向の18か所（野球場の図。行ごと・左が三塁側。null は空き）
const FIELD_ROWS = [
  [null, 'LCF', 'CF', 'RCF', null],
  ['LF', null, null, null, 'RF'],
  ['LFL', null, null, null, 'RFL'],
  [null, '3BSS', '2BSS', '1B2B', null],
  ['3B', 'SS', 'P', '2B', '1B'],
  ['3BL', null, 'C', null, '1BL']
];
const DIR_LABEL = { P: '投', C: '捕', '1B': '一', '2B': '二', '3B': '三', SS: '遊', LF: '左', CF: '中', RF: '右', '1B2B': '一二間', '2BSS': '二遊間', '3BSS': '三遊間', LCF: '左中間', RCF: '右中間', '1BL': '一塁線', '3BL': '三塁線', LFL: '左翼線', RFL: '右翼線' };
const DIR_ALL = Object.keys(DIR_LABEL);
const OUTCOME_ORDER = ['OUT', 'IH', 'H1', 'H2', 'H3', 'HR', 'ERR', 'FC', 'DP', 'SAC_BUNT', 'SAC_FLY', 'INTERF'];
const OUTCOME_LABEL = { OUT: 'アウト', IH: '内安', H1: '単打', H2: '二塁打', H3: '三塁打', HR: '本塁打', ERR: '失策', FC: '野選', DP: '併殺打', SAC_BUNT: '犠打', SAC_FLY: '犠飛', INTERF: '打撃妨害' };
// Aに合わせて目立たせる候補（5.5。目立たせるだけ）
const OUTCOME_HINT = {
  GR_HARD: ['OUT', 'IH', 'DP'], GR_MID: ['OUT', 'IH', 'DP'], GR_SOFT: ['OUT', 'IH', 'DP'],
  LINER: ['OUT', 'H1', 'H2'],
  FLY_SHALLOW: ['OUT', 'SAC_FLY', 'H2', 'HR'], FLY_MID: ['OUT', 'SAC_FLY', 'H2', 'HR'], FLY_DEEP: ['OUT', 'SAC_FLY', 'H2', 'HR'], FLY_INF: ['OUT', 'SAC_FLY', 'H2', 'HR'],
  BUNT: ['SAC_BUNT', 'IH', 'OUT']
};
const MARK_ORDER = ['NICE_PLAY', 'BUNT_SAC', 'BUNT_SAFETY', 'BUNT_SQUEEZE', 'DROPPED_K', 'IBB', 'CAUGHT_OUT'];
const MARK_LABEL = { NICE_PLAY: '好守', BUNT_SAC: 'バント（送り）', BUNT_SAFETY: 'バント（セーフティ）', BUNT_SQUEEZE: 'バント（スクイズ）', DROPPED_K: '振り逃げ', IBB: '敬遠', CAUGHT_OUT: '捕球アウト' };
const BUNT_MARKS = ['BUNT_SAC', 'BUNT_SAFETY', 'BUNT_SQUEEZE'];
const END_TYPES = ['K', 'BB', 'HBP', 'INPLAY', 'CAUGHT_FOUL', 'SKIPPED'];
const END_LABEL = { K: '三振', BB: '四球', HBP: '死球', INPLAY: 'インプレー', CAUGHT_FOUL: 'ファウルフライ捕球', SKIPPED: '終わりの球の記録なし' };

// 文言（7.5）
const MSG = {
  SAVE_FAIL: function (why) { return '保存できませんでした。入力はそのまま残してあります。もう一度押してください。（理由：' + why + '）'; },
  NO_DB: 'このブラウザでは記録を保存できません。ホーム画面のアイコンから開き直してください。',
  UNREADABLE: function (n) { return '読めない記録があります（' + n + '件）。設定の「書き出し」で控えを取ってから、作者に伝えてください。'; },
  EXPORT_REMIND: function (n) { return '最後に控えを取ってから ' + n + ' 日たちました。設定で［記録を書き出す］を押してください。'; },
  EXPORT_REMIND_NEVER: 'まだ一度も控えを取っていません。設定で［記録を書き出す］を押してください。',
  EXPORT_REMIND_PITCHES: function (n) { return '最後に控えを取ってから、球が ' + n + ' 球増えました。設定で［記録を書き出す］を押してください。'; },
  STORAGE_WARN: '保存の容量が少なくなっています。古い試合を書き出してから削除してください。',
  REPLACE_CONFIRM: 'いまの記録をすべて、ファイルの内容に置き換えます。実行の前に、いまの記録を自動で書き出します。',
  CHECK_SITUATION: 'アウトと走者を確かめてください',
  ASK_OUTS: 'アウトは何個増えましたか',
  EXPORT_FAIL: '控えが取れませんでした',
  EXPORT_ABORT: '控えが取れなかったので、中止しました',
  BLOCKED: 'ほかの球録の画面を閉じてください',
  VERSION_CHANGE: '更新があります。開き直してください',
  NEWER_DB: '新しい版の記録です。アプリを更新してください'
};

// ---- 振り返り・シルエット（11章）----
const MOTION_MS = 1200;              // 1球の動きの長さ（ミリ秒）
// 野球場の図（SVGの座標 0〜100。本塁 (50,90)、中堅が上、左が三塁側）。方向18か所の行き先
const FIELD_HOME = [50, 90];
const FIELD_POINTS = {
  P: [50, 70], C: [50, 84], '1B': [72, 68], '2B': [60, 54], '3B': [28, 68], SS: [40, 54],
  LF: [20, 26], CF: [50, 14], RF: [80, 26],
  '1B2B': [68, 60], '2BSS': [50, 52], '3BSS': [32, 60], LCF: [35, 17], RCF: [65, 17],
  '1BL': [80, 60], '3BL': [20, 60], LFL: [6, 46], RFL: [94, 46]
};
const FOUL_POINTS = { F1B: [88, 80], F3B: [12, 80], FBK: [50, 99], FLN: [90, 50] };   // ファウルの行き先の目安
const FLY_FACTOR = { FLY_SHALLOW: 0.75, FLY_MID: 1.0, FLY_DEEP: 1.18, FLY_INF: 0.55 };   // 本塁からの距離の倍率
const BUNT_FACTOR = 0.45;
const HR_FACTOR = 1.12;
const COUNT_LIST = ['0-0', '1-0', '2-0', '3-0', '0-1', '1-1', '2-1', '3-1', '0-2', '1-2', '2-2', '3-2'];   // ボール-ストライク
const REVIEW_VIEWS = [['play', '再生'], ['list', '一覧'], ['zone', 'ゾーン図'], ['trend', '傾向']];
