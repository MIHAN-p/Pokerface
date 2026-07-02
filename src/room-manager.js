const crypto = require('node:crypto');
const { ActionKind } = require('./constants');
const { Action } = require('./actions');
const { OnlineGameEngine } = require('./online-game-engine');
const { normalizeDifficulty, normalizeRoomConfig, randomCode, sendSnapshot } = require('./online-protocol');

class PokerRoom {
  constructor({ roomCode, hostSessionId, config }) {
    this.roomCode = roomCode;
    this.hostSessionId = hostSessionId;
    this.status = "waiting";
    this.config = normalizeRoomConfig(config);
    this.seats = Array.from({ length: this.config.playerCount }, (_, index) => ({
      index: index + 1,
      type: "empty",
      displayName: "",
      sessionId: null,
      connected: false,
      reconnectCode: null,
      stack: this.config.initialStack,
      underwaterHands: 0,
      underwaterDebt: 0,
      botConfig: null,
    }));
    this.sessions = new Map();
    this.clients = new Map();
    this.engine = null;
    this.processedActions = new Set();
    this.actionTimer = null;
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  addSession({ sessionId, displayName, isHost, socket }) {
    const session = this.sessions.get(sessionId) ?? {
      sessionId,
      displayName,
      isHost,
      seatIndex: null,
      reconnectCode: randomCode(10),
      connected: true,
      lastSeenAt: new Date(),
    };
    session.displayName = displayName || session.displayName;
    session.isHost = session.isHost || isHost;
    session.connected = true;
    session.lastSeenAt = new Date();
    this.sessions.set(sessionId, session);
    this.clients.set(sessionId, socket);
    if (session.seatIndex) {
      const seat = this.getSeat(session.seatIndex);
      seat.connected = true;
      seat.sessionId = sessionId;
      seat.displayName = session.displayName;
    }
    return session;
  }

  disconnectSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.connected = false;
    session.lastSeenAt = new Date();
    this.clients.delete(sessionId);
    if (session.seatIndex) {
      const seat = this.getSeat(session.seatIndex);
      if (seat?.type === "human") seat.connected = false;
    }
  }

  sit(sessionId, seatIndex) {
    if (this.status !== "waiting") throw new Error("牌局中不能换座");
    const session = this.requireSession(sessionId);
    const seat = this.getSeat(seatIndex);
    if (!seat) throw new Error("座位不存在");
    if (seat.type !== "empty") throw new Error("该座位已被占用");
    if (session.seatIndex) this.leaveSeat(sessionId);
    seat.type = "human";
    seat.displayName = session.displayName;
    seat.sessionId = sessionId;
    seat.connected = true;
    seat.reconnectCode = session.reconnectCode;
    seat.stack = seat.stack ?? this.config.initialStack;
    session.seatIndex = seat.index;
  }

  leaveSeat(sessionId) {
    if (this.status !== "waiting") throw new Error("牌局中不能离座");
    const session = this.requireSession(sessionId);
    if (!session.seatIndex) return;
    const seat = this.getSeat(session.seatIndex);
    Object.assign(seat, {
      type: "empty",
      displayName: "",
      sessionId: null,
      connected: false,
      reconnectCode: null,
      stack: this.config.initialStack,
      underwaterHands: 0,
      underwaterDebt: 0,
      botConfig: null,
    });
    session.seatIndex = null;
  }

  addBot(sessionId, { seatIndex, name, difficulty }) {
    this.requireHost(sessionId);
    if (this.status !== "waiting") throw new Error("牌局中不能添加 AI");
    const seat = seatIndex ? this.getSeat(seatIndex) : this.seats.find((item) => item.type === "empty");
    if (!seat) throw new Error("没有可用空座位");
    if (seat.type !== "empty") throw new Error("该座位已被占用");
    const botNo = this.seats.filter((item) => item.type === "bot").length + 1;
    seat.type = "bot";
    seat.displayName = name || `AI-${botNo}`;
    seat.connected = true;
    seat.botConfig = { name: seat.displayName, difficulty: normalizeDifficulty(difficulty), style: "稳健" };
    seat.stack = this.config.initialStack;
  }

  updateBot(sessionId, { seatIndex, name, difficulty }) {
    this.requireHost(sessionId);
    if (this.status !== "waiting") throw new Error("牌局中不能配置 AI");
    const seat = this.getSeat(seatIndex);
    if (!seat || seat.type !== "bot") throw new Error("该座位不是 AI");
    if (name) seat.displayName = name;
    seat.botConfig = {
      ...(seat.botConfig ?? {}),
      name: seat.displayName,
      difficulty: normalizeDifficulty(difficulty ?? seat.botConfig?.difficulty),
    };
  }

  removeBot(sessionId, seatIndex) {
    this.requireHost(sessionId);
    if (this.status !== "waiting") throw new Error("牌局中不能移除 AI");
    const seat = this.getSeat(seatIndex);
    if (!seat || seat.type !== "bot") throw new Error("该座位不是 AI");
    Object.assign(seat, {
      type: "empty",
      displayName: "",
      connected: false,
      botConfig: null,
      stack: this.config.initialStack,
    });
  }

  fillEmptySeatsWithBots() {
    let botNo = this.seats.filter((seat) => seat.type === "bot").length + 1;
    for (const seat of this.seats) {
      if (seat.type !== "empty") continue;
      seat.type = "bot";
      seat.displayName = `AI-${botNo}`;
      seat.connected = true;
      seat.sessionId = null;
      seat.reconnectCode = null;
      seat.stack = this.config.initialStack;
      seat.botConfig = {
        name: seat.displayName,
        difficulty: this.config.difficulty,
        style: "稳健",
      };
      botNo += 1;
    }
  }

  startGame(sessionId) {
    this.requireHost(sessionId);
    this.fillEmptySeatsWithBots();
    const occupied = this.seats.filter((seat) => seat.type !== "empty");
    if (occupied.length < 2) throw new Error("至少需要 2 个可参与座位才能开局");
    const offline = occupied.filter((seat) => seat.type === "human" && !seat.connected);
    if (offline.length) throw new Error(`真人座位离线：${offline.map((seat) => seat.index).join("、")}`);
    this.engine = new OnlineGameEngine(occupied, this.config);
    this.engine.startHand();
    this.status = "playing";
    this.updatedAt = new Date();
  }

  nextHand(sessionId) {
    if (!this.engine?.handFinished) throw new Error("当前手牌尚未结束");
    const prevHandNo = this.engine.handNo;
    this.syncStacksFromEngine();
    this.fillEmptySeatsWithBots();
    this.engine = new OnlineGameEngine(this.seats.filter((seat) => seat.type !== "empty"), this.config, { handNo: prevHandNo });
    // 继承水下状态
    for (const player of this.engine.players) {
      const seat = this.getSeat(player.seatIndex);
      if (seat) {
        player.underwaterHands = seat.underwaterHands ?? 0;
        player.underwaterDebt = seat.underwaterDebt ?? 0;
      }
    }
    this.engine.startHand();
    this.status = "playing";
    this.processedActions.clear();
    this.updatedAt = new Date();
  }

  resetGame(sessionId) {
    this.requireHost(sessionId);
    for (const seat of this.seats) {
      if (seat.type === "bot") {
        // 清除 AI，释放座位
        seat.type = "empty";
        seat.displayName = "";
        seat.sessionId = null;
        seat.connected = false;
        seat.stack = this.config.initialStack;
        seat.underwaterHands = 0;
        seat.underwaterDebt = 0;
        seat.botConfig = null;
      } else if (seat.type === "human") {
        seat.stack = this.config.initialStack;
        seat.underwaterHands = 0;
        seat.underwaterDebt = 0;
      }
    }
    this.engine = null;
    this.status = "waiting";
    this.processedActions.clear();
    this.updatedAt = new Date();
  }

  applyPlayerAction(sessionId, action, clientActionId) {
    const session = this.requireSession(sessionId);
    if (!session.seatIndex) throw new Error("请先入座");
    if (!this.engine) throw new Error("牌局尚未开始");
    const key = clientActionId ? `${sessionId}:${clientActionId}` : null;
    if (key && this.processedActions.has(key)) return;
    this.engine.applySeatAction(session.seatIndex, action);
    if (key) this.processedActions.add(key);
    if (this.engine.handFinished) this.syncStacksFromEngine();
    this.updatedAt = new Date();
  }

  syncStacksFromEngine() {
    if (!this.engine) return;
    for (const player of this.engine.players) {
      const seat = this.getSeat(player.seatIndex);
      if (seat) {
        seat.stack = player.stack;
        seat.underwaterHands = player.underwaterHands;
        seat.underwaterDebt = player.underwaterDebt;
      }
    }
  }

  snapshotFor(sessionId) {
    const session = this.sessions.get(sessionId);
    const viewerSeatIndex = session?.seatIndex ?? null;
    return {
      type: "room_snapshot",
      room: {
        roomCode: this.roomCode,
        status: this.status,
        config: this.config,
        seats: this.seats.map((seat) => ({
          index: seat.index,
          type: seat.type,
          displayName: seat.displayName,
          connected: seat.type === "bot" ? true : seat.connected,
          stack: seat.stack,
          isYou: seat.sessionId === sessionId,
          isHost: seat.sessionId === this.hostSessionId,
          botDifficulty: seat.type === "bot" ? seat.botConfig?.difficulty ?? this.config.difficulty : null,
          underwaterHands: seat.underwaterHands ?? 0,
          underwaterDebt: seat.underwaterDebt ?? 0,
        })),
      },
      you: session
        ? {
            sessionId: session.sessionId,
            displayName: session.displayName,
            isHost: session.isHost,
            seatIndex: session.seatIndex,
            reconnectCode: session.reconnectCode,
          }
        : null,
      game: this.engine?.publicSnapshot(viewerSeatIndex) ?? null,
    };
  }

  broadcast() {
    this.scheduleActionTimeout();
    for (const [sessionId, socket] of this.clients) {
      sendSnapshot(socket, this.snapshotFor(sessionId));
    }
  }

  scheduleActionTimeout() {
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
    if (!this.engine || this.engine.handFinished || this.engine.actionIndex === null) return;
    const player = this.engine.players[this.engine.actionIndex];
    if (!player?.isHuman) return;
    this.actionTimer = setTimeout(() => {
      try {
        if (!this.engine || this.engine.handFinished || this.engine.players[this.engine.actionIndex]?.seatIndex !== player.seatIndex) return;
        this.engine.applySeatAction(player.seatIndex, new Action(ActionKind.FOLD));
        if (this.engine.handFinished) this.syncStacksFromEngine();
        this.broadcast();
      } catch {
        // 超时兜底不能影响服务端主循环。
      }
    }, this.config.actionTimeoutSeconds * 1000);
    this.actionTimer.unref?.();
  }

  getSeat(seatIndex) {
    return this.seats[Number(seatIndex) - 1] ?? null;
  }

  requireSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("会话不存在");
    return session;
  }

  requireHost(sessionId) {
    const session = this.requireSession(sessionId);
    if (!session.isHost) throw new Error("只有房主可以执行该命令");
    return session;
  }
}

class RoomManager {
  constructor({ adminToken, allowMultipleRooms = false } = {}) {
    this.adminToken = adminToken || randomCode(8);
    this.allowMultipleRooms = allowMultipleRooms;
    this.rooms = new Map();
  }

  createRoom({ adminToken, sessionId, displayName, config, socket }) {
    if (adminToken !== this.adminToken) throw new Error("管理口令错误");
    if (!this.allowMultipleRooms && this.rooms.size > 0) throw new Error("当前服务端只允许创建一个房间");
    let roomCode = (config.roomCode || "").trim();
    if (!roomCode || this.rooms.has(roomCode)) {
      do {
        roomCode = String(crypto.randomInt(100000, 1000000));
      } while (this.rooms.has(roomCode));
    }
    const room = new PokerRoom({ roomCode, hostSessionId: sessionId, config });
    room.addSession({ sessionId, displayName, isHost: true, socket });
    room.sit(sessionId, 1);
    this.rooms.set(roomCode, room);
    return room;
  }

  removeRoom(roomCode) {
    this.rooms.delete(String(roomCode));
  }

  joinRoom({ roomCode, sessionId, displayName, socket, reconnectCode }) {
    const room = this.rooms.get(String(roomCode));
    if (!room) throw new Error("房间不存在或已关闭");
    const existingSeat = room.seats.find((seat) => seat.reconnectCode && seat.reconnectCode === reconnectCode);
    const session = room.addSession({
      sessionId: existingSeat?.sessionId ?? sessionId,
      displayName: displayName || existingSeat?.displayName,
      isHost: existingSeat?.sessionId === room.hostSessionId,
      socket,
    });
    if (existingSeat) {
      existingSeat.sessionId = session.sessionId;
      existingSeat.connected = true;
      session.seatIndex = existingSeat.index;
    }
    return room;
  }
}

module.exports = { PokerRoom, RoomManager };
