const { ActionKind } = require('./constants');

class Action {
  constructor(kind, amount = null) {
    this.kind = kind;
    this.amount = amount;
  }
}

class InputParser {
  static parse(raw) {
    const text = raw.trim().toLowerCase();
    if (!text) throw new Error("请输入命令");
    const aliases = {
      弃牌: ActionKind.FOLD,
      fold: ActionKind.FOLD,
      f: ActionKind.FOLD,
      过牌: ActionKind.CHECK_CALL,
      跟注: ActionKind.CHECK_CALL,
      call: ActionKind.CHECK_CALL,
      check: ActionKind.CHECK_CALL,
      c: ActionKind.CHECK_CALL,
      全下: ActionKind.ALL_IN,
      allin: ActionKind.ALL_IN,
      "all-in": ActionKind.ALL_IN,
      a: ActionKind.ALL_IN,
      状态: ActionKind.STATUS,
      status: ActionKind.STATUS,
      s: ActionKind.STATUS,
      退出: ActionKind.QUIT,
      quit: ActionKind.QUIT,
      q: ActionKind.QUIT,
    };
    if (aliases[text]) return new Action(aliases[text]);

    const parts = text.split(/\s+/);
    if (parts.length === 2 && ["下注", "bet", "b"].includes(parts[0])) {
      return new Action(ActionKind.BET, parseAmount(parts[1]));
    }
    if (parts.length === 2 && ["加注", "raise", "r"].includes(parts[0])) {
      return new Action(ActionKind.RAISE, parseAmount(parts[1]));
    }
    throw new Error("无法识别命令");
  }
}

function parseAmount(raw) {
  const amount = Number.parseInt(raw, 10);
  if (!Number.isInteger(amount) || String(amount) !== raw || amount <= 0) {
    throw new Error("金额必须是大于 0 的整数");
  }
  return amount;
}

module.exports = { Action, InputParser, parseAmount };
