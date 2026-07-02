const SUITS = ["S", "H", "D", "C"];
const SUIT_NAMES = { S: "黑桃", H: "红桃", D: "方片", C: "梅花" };
const SUIT_ICONS = { S: "\u2660", H: "\u2665", D: "\u2666", C: "\u2663" };
const RANK_NAMES = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

const HAND_NAMES = {
  9: "皇家同花顺",
  8: "同花顺",
  7: "四条",
  6: "葫芦",
  5: "同花",
  4: "顺子",
  3: "三条",
  2: "两对",
  1: "一对",
  0: "高牌",
};

const Stage = {
  PREFLOP: "翻牌前",
  FLOP: "翻牌圈",
  TURN: "转牌圈",
  RIVER: "河牌圈",
  SHOWDOWN: "摊牌",
};

const ActionKind = {
  FOLD: "fold",
  CHECK_CALL: "check_call",
  BET: "bet",
  RAISE: "raise",
  ALL_IN: "all_in",
  STATUS: "status",
  QUIT: "quit",
};

module.exports = {
  ActionKind,
  HAND_NAMES,
  RANK_NAMES,
  SUITS,
  SUIT_ICONS,
  SUIT_NAMES,
  Stage,
};
