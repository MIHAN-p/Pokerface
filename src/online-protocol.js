const crypto = require('node:crypto');
const iconv = require("iconv-lite");
const { ActionKind, RANK_NAMES, SUIT_NAMES } = require('./constants');
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
  const snapshotText = renderOnlineSnapshot(snapshot).replace(/\n/g, "\r\n");
  if (socket._pokerfaceTextClient) {
    if (socket._gbkEncoding) {
      socket.write(iconv.encode(`${snapshotText}\r\n> `, "gbk"));
    } else {
      socket.write(`${snapshotText}\r\n> `);
    }
    return;
  }
  sendJson(socket, snapshot);
}

function sendText(socket, text) {
  const out = `${text.replace(/\n/g, "\r\n")}\r\n`;
  if (socket && socket._gbkEncoding) {
    socket.write(iconv.encode(out, "gbk"));
  } else {
    socket.write(out);
  }
}

function decodeTelnetInput(chunk) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
  if (bytes.length >= 3 && bytes[0] === 255 && [251, 252, 253, 254].includes(bytes[1])) {
    return null;
  }
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
  if (["st", "状态", "status"].includes(lower)) return { type: "room_snapshot" };
  const parts = text.split(/\s+/);
  if (["入座", "sit"].includes(parts[0])) return { type: "sit_down", seatIndex: parseSeatIndex(parts[1]) };
  if (["离座", "leave"].includes(parts[0])) return { type: "leave_seat" };
  if (["开始", "start", "s"].includes(parts[0])) return { type: "start_game" };
  if (["下一手", "next", "n"].includes(parts[0])) return { type: "next_hand" };
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
    actionTimeoutSeconds: clampInt(config.actionTimeoutSeconds ?? 120, 5),
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
  const RST = "\x1b[0m", GRN = "\x1b[32m", YLW = "\x1b[33m", RED = "\x1b[31m", CYN = "\x1b[36m", BLD = "\x1b[1m";
  const divider = "=".repeat(56);
  const section = "-".repeat(56);
  const roomStatus = game?.handFinished ? "手牌结束" : room.status === "waiting" ? "等待中" : "牌局中";
  const lines = [
    "",
    divider,
    `房间：${room.roomCode}  ${roomStatus}  ${room.config.playerCount}人  ${room.config.initialStack}筹码  盲${room.config.smallBlind}/${room.config.bigBlind}`,
  ];
  if (!game) {
    lines.push(section, "座位：");
    for (const seat of room.seats) {
      if (seat.type === "empty") {
        lines.push(`  ${seat.index}. 空`);
        continue;
      }
      const tags = [];
      if (seat.isHost) tags.push("房主");
      if (seat.isYou) tags.push("你");
      const tagStr = tags.length ? `(${tags.join(" ")})` : "";
      const type = seat.type === "bot" ? `AI${seat.botDifficulty}` : "真人";
      const online = seat.type === "bot" ? "" : seat.connected ? "在线" : "离线";
      const uw = seat.underwaterHands ? `(-${seat.underwaterHands}*)` : "";
      lines.push(`  ${seat.index}. ${seat.displayName}${tagStr}${uw}  ${type}  ${online}  $${seat.stack}`);
    }
    lines.push("");
    if (you?.isHost) {
      lines.push("房主：s | bot add 座 名 难度 | bot remove 座");
    } else {
      lines.push("玩家：sit N | leave | s | q");
    }
    lines.push(divider);
    return lines.join("\n");
  }
  const hero = game.players.find((player) => player.seatIndex === you?.seatIndex);
  const handInfo = hero?.hole ? `${GRN}手牌：${formatCardDtos(hero.hole)}${RST}` : "";
  const boardInfo = game.board.length ? `${GRN}公牌：${formatCardDtos(game.board)}${RST}` : "";
  const turnInfo =
    game.actionSeatIndex === you?.seatIndex
      ? `${YLW}轮到：${game.actionPlayerName}${RST}`
      : `轮到：${game.actionPlayerName ?? "无"}`;
  lines.push("");
  lines.push(`第${game.handNo}手  ${game.stage}  ${turnInfo}  底池：${game.pot}  最高：${game.currentBet}`);
  if (boardInfo) lines.push(boardInfo);
  if (handInfo) lines.push(handInfo);
  lines.push(section, "牌桌：");
  lines.push("  #  Name            Pos       Stack/Bet    Status");
  for (const player of game.players) {
    const holeStr =
      player.hole && (player.seatIndex === you?.seatIndex || game.lastHandResult?.revealed?.[player.seatIndex])
        ? `  ${formatCardDtos(player.hole)}`
        : "";
    const uw = player.underwaterHands ? `(-${player.underwaterHands}*)` : "";
    const isMe = player.seatIndex === you?.seatIndex;
    const nameStr = (player.name + uw).padEnd(18);
    const name = isMe ? `${BLD}${GRN}${nameStr}${RST}` : nameStr;
    const pos = (player.position || "-").padEnd(8);
    const stackBet = `$${player.stack}/$${player.currentBet}`.padEnd(11);
    lines.push(`  ${player.seatIndex}. ${name} ${pos} ${stackBet} ${player.status}${holeStr}`);
  }
  lines.push("");
  lines.push(section, "最近行动：");
  const showLogs = game.logs && game.logs.length ? game.logs : ["无"];
  lines.push(...showLogs.map((line) => `  ${line.replace(/加注/g, `${RED}加注${RST}`).replace(/全下/g, `${RED}全下${RST}`)}`));
  if (game.handFinished) {
    lines.push("");
    lines.push(section, "亮牌：");
    const winners = new Set(game.lastHandResult?.winners ?? []);
    for (const player of game.players) {
      const uw = player.underwaterHands ? `(-${player.underwaterHands}*)` : "";
      const isWinner = winners.has(player.seatIndex);
      const winLabel = isWinner ? `${RED}(赢家)${RST}` : "";
      const name = (player.name + uw + winLabel).padEnd(18);
      if (player.hole) {
        const handName = player.handName ? `  (${player.handName})` : "";
        lines.push(`  ${player.seatIndex}. ${name} ${formatCardDtos(player.hole)}${handName}`);
      } else {
        lines.push(`  ${player.seatIndex}. ${name} --`);
      }
    }
    lines.push("");
    lines.push(`结果：${game.lastHandResult?.summary ?? ""}`);
    lines.push(you?.isHost ? "n/next 下一手 | st 状态 | q 退出" : "等待房主开始下一手...");
  } else if (game.actionSeatIndex === you?.seatIndex) {
    lines.push("");
    const actionLabels = game.legalActions.map((action) => action.label).concat(["状态/st", "退出/q"]).join(" ");
    if (hero?.hole) lines.push(`${GRN}你的手牌：${formatCardDtos(hero.hole)}${RST}`);
    lines.push(`${YLW}${actionLabels}${RST}`);
  } else {
    lines.push("");
    lines.push(`等待 ${CYN}${game.actionPlayerName}${RST} 行动...`);
  }
  lines.push(divider);
  return lines.join("\n");
}

function formatCardDtos(cards) {
  return cards?.length ? cards.map((card) => `${RANK_NAMES[card.rank]}${SUIT_NAMES[card.suit]}`).join(" ") : "无";
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
