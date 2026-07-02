const crypto = require('node:crypto');
const { ActionKind, RANK_NAMES, SUIT_ICONS, SUIT_NAMES } = require('./constants');
const { Action, InputParser } = require('./actions');

function actionToDto(action) {
  return { kind: action.kind, amount: action.amount };
}

function actionFromDto(dto) {
  if (!dto || !dto.kind) throw new Error("动作格式错误");
  return new Action(dto.kind, dto.amount ?? null);
}

function sendJson(socket, payload) {
  socket.write(`${JSON.stringify(payload)}\n`);
}

function sendSnapshot(socket, snapshot) {
  if (socket._pokerfaceTextClient) {
    sendText(socket, renderOnlineSnapshot(snapshot));
    socket.write("> ");
    return;
  }
  sendJson(socket, snapshot);
}

function sendText(socket, text) {
  socket.write(`${text.replace(/\n/g, "\r\n")}\r\n`);
}

function decodeTelnetInput(chunk) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
  const outputBytes = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === 255) {
      const command = bytes[i + 1];
      if ([251, 252, 253, 254].includes(command)) {
        i += 2;
        continue;
      }
      if (command === 250) {
        i += 2;
        while (i < bytes.length && !(bytes[i] === 255 && bytes[i + 1] === 240)) i += 1;
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    outputBytes.push(byte);
  }
  return Buffer.from(outputBytes).toString("utf8");
}

function parseOnlineClientCommand(text) {
  const lower = text.toLowerCase();
  if (["s", "状态", "status"].includes(lower)) return { type: "room_snapshot" };
  const parts = text.split(/\s+/);
  if (["入座", "sit"].includes(parts[0])) return { type: "sit_down", seatIndex: parseSeatIndex(parts[1]) };
  if (["离座", "leave"].includes(parts[0])) return { type: "leave_seat" };
  if (["开始", "start"].includes(parts[0])) return { type: "start_game" };
  if (["下一手", "next"].includes(parts[0])) return { type: "next_hand" };
  if (parts[0] === "bot" && parts[1] === "add") {
    return { type: "add_bot", seatIndex: parts[2] ? parseSeatIndex(parts[2]) : null, name: parts[3], difficulty: parts[4] };
  }
  if (parts[0] === "bot" && parts[1] === "remove") return { type: "remove_bot", seatIndex: parseSeatIndex(parts[2]) };
  if (parts[0] === "bot" && parts[1] === "config") {
    return { type: "update_bot", seatIndex: parseSeatIndex(parts[2]), name: parts[3], difficulty: parts[4] };
  }
  if (parts[0] === "添加AI") return { type: "add_bot", seatIndex: parts[1] ? parseSeatIndex(parts[1]) : null, name: parts[2], difficulty: parts[3] };
  if (parts[0] === "移除AI") return { type: "remove_bot", seatIndex: parseSeatIndex(parts[1]) };
  return {
    type: "player_action",
    action: actionToDto(InputParser.parse(text)),
    clientActionId: randomCode(12),
  };
}

function randomCode(size = 8) {
  return crypto.randomBytes(size).toString("base64url").slice(0, size);
}

function normalizeRoomConfig(config = {}) {
  const playerCount = clampInt(config.playerCount ?? 6, 2, 9);
  const smallBlind = clampInt(config.smallBlind ?? 5, 1);
  const bigBlind = clampInt(config.bigBlind ?? Math.max(10, smallBlind * 2), smallBlind + 1);
  return {
    playerCount,
    initialStack: clampInt(config.initialStack ?? 1000, 1),
    smallBlind,
    bigBlind,
    underwater: config.underwater ?? true,
    difficulty: normalizeDifficulty(config.difficulty),
    actionTimeoutSeconds: clampInt(config.actionTimeoutSeconds ?? 60, 5),
  };
}

function normalizeDifficulty(value) {
  return ["简单", "普通", "困难"].includes(value) ? value : "普通";
}

function clampInt(value, min, max = null) {
  const number = Number.parseInt(value, 10);
  const safe = Number.isInteger(number) ? number : min;
  return Math.min(Math.max(safe, min), max ?? safe);
}

function parseSeatIndex(value) {
  const seatIndex = Number.parseInt(value, 10);
  if (!Number.isInteger(seatIndex) || String(seatIndex) !== String(value) || seatIndex < 1 || seatIndex > 9) {
    throw new Error("座位号必须是 1-9");
  }
  return seatIndex;
}

function parseConfigInt(value, min, max, label) {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || String(number) !== String(value) || number < min || (max !== null && number > max)) {
    throw new Error(`${label}必须是${max === null ? `不小于 ${min}` : `${min}-${max}`} 的整数`);
  }
  return number;
}

function parseConfigBool(value) {
  const text = value.trim().toLowerCase();
  if (["是", "y", "yes", "true", "1"].includes(text)) return true;
  if (["否", "n", "no", "false", "0"].includes(text)) return false;
  throw new Error("请输入 是 或 否");
}

function renderOnlineSnapshot(snapshot) {
  const { room, you, game } = snapshot;
  const divider = "=".repeat(56);
  const section = "-".repeat(56);
  const roomStatus = game?.handFinished ? "手牌结束" : room.status === "waiting" ? "等待中" : "牌局中";
  const lines = ["", divider, `房间：${room.roomCode}`, `状态：${roomStatus}`];
  lines.push(`配置：${room.config.playerCount} 人桌`);
  lines.push(`筹码：${room.config.initialStack}`);
  lines.push(`盲注：${room.config.smallBlind}/${room.config.bigBlind}`);
  lines.push(`水下：${room.config.underwater ? "开" : "关"}`);
  lines.push(`超时：${room.config.actionTimeoutSeconds} 秒`);
  lines.push(section, "座位：");
  for (const seat of room.seats) {
    if (seat.type === "empty") {
      lines.push(`座 ${seat.index}：空`);
      continue;
    }
    const host = seat.isHost ? "（房主）" : "";
    const youLabel = seat.isYou ? "（你）" : "";
    const type = seat.type === "bot" ? `AI ${seat.botDifficulty}` : "真人";
    const online = seat.type === "bot" ? "在线" : seat.connected ? "在线" : "离线";
    lines.push(`座 ${seat.index}：${seat.displayName}${youLabel}${host}`);
    lines.push(`  类型：${type} | ${online} | 筹码 ${seat.stack}`);
  }
  if (!game) {
    lines.push(section);
    if (you?.isHost) {
      lines.push("房主命令：");
      lines.push("  start");
      lines.push("  bot add [座位] [名称] [难度]");
      lines.push("  bot remove 座位");
      lines.push("  bot config 座位 名称 难度");
    } else {
      lines.push("玩家命令：");
      lines.push("  sit 位置");
      lines.push("  leave");
      lines.push("  s");
      lines.push("  q");
    }
    lines.push(divider);
    return lines.join("\n");
  }
  lines.push(section, `第 ${game.handNo} 手`, `阶段：${game.stage}`, `轮到：${game.actionPlayerName ?? "无"}`);
  lines.push(`公共牌：${formatCardDtos(game.board)}`);
  const hero = game.players.find((player) => player.seatIndex === you?.seatIndex);
  if (hero?.hole) lines.push(`你的手牌：${formatCardDtos(hero.hole)}`);
  lines.push(`底池：${game.pot}`, `当前最高下注：${game.currentBet}`);
  lines.push(section, "牌桌：");
  for (const player of game.players) {
    const hole = player.hole && (player.seatIndex === you?.seatIndex || game.lastHandResult?.revealed?.[player.seatIndex]) ? ` 手牌 ${formatCardDtos(player.hole)}` : "";
    const mark = player.marks ? ` | ${player.marks}` : "";
    const hand = hole ? ` |${hole}` : "";
    const handName = player.handName ? ` | ${player.handName}` : "";
    lines.push(`座 ${player.seatIndex}：${player.name}${mark}`);
    lines.push(`  位置：${player.position || "-"}`);
    lines.push(`  筹码：${player.stack} | 本轮：${player.currentBet}`);
    lines.push(`  状态：${player.status}${hand}${handName}`);
  }
  lines.push(section, "最近行动：", ...(game.logs.length ? game.logs : ["无"]));
  if (game.handFinished) {
    lines.push(section, `本手结束：${game.lastHandResult?.summary ?? ""}`);
    lines.push(you?.isHost ? "房间仍在。输入 下一手/next 开始下一手。" : "房间仍在，等待房主开始下一手。");
  } else if (game.actionSeatIndex === you?.seatIndex) {
    lines.push(section, "轮到你行动。可输入：");
    if (hero?.hole) lines.push(`你的手牌：${formatCardDtos(hero.hole)}`);
    for (const action of game.legalActions) lines.push(`  ${action.label}`);
    lines.push("  状态/s");
    lines.push("  退出/q");
  } else {
    lines.push(section, `等待 ${game.actionPlayerName} 行动...`);
  }
  lines.push(divider);
  return lines.join("\n");
}

function formatCardDtos(cards) {
  return cards?.length ? cards.map((card) => `${RANK_NAMES[card.rank]}${SUIT_ICONS[card.suit]}${SUIT_NAMES[card.suit]}`).join(" ") : "无";
}

module.exports = {
  actionFromDto,
  actionToDto,
  clampInt,
  decodeTelnetInput,
  formatCardDtos,
  normalizeDifficulty,
  normalizeRoomConfig,
  parseConfigBool,
  parseConfigInt,
  parseOnlineClientCommand,
  parseSeatIndex,
  randomCode,
  renderOnlineSnapshot,
  sendJson,
  sendSnapshot,
  sendText,
};
