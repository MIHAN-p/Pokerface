const { WebSocketServer } = require('ws');
const { actionFromDto, randomCode } = require('./online-protocol');

function wrapWs(ws) {
  return {
    write: (data) => {
      if (ws.readyState === 1) {
        ws.send(typeof data === 'string' ? data.replace(/\n$/, '') : data);
      }
    },
  };
}

class WsPokerServer {
  constructor({ host = "0.0.0.0", port = 3001, manager } = {}) {
    this.host = host;
    this.port = port;
    this.manager = manager;
    this.wsRooms = new Map();
    this.wss = new WebSocketServer({ host, port });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.wss.once('error', reject);
      // WebSocketServer starts listening immediately in constructor,
      // but we need to handle the case where it might fail.
      process.nextTick(() => {
        this.wss.off('error', reject);
        console.log("Pokerface WebSocket 服务已启动");
        console.log(`地址：${this.host}`);
        console.log(`端口：${this.port}`);
        resolve();
      });
    });
  }

  close() {
    return new Promise((resolve) => this.wss.close(resolve));
  }

  handleConnection(ws) {
    ws.isAlive = true;
    this.sendJson(ws, { type: "welcome", protocol: "pokerface-ws-v1" });

    ws.on('message', (data) => {
      ws.isAlive = true;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        this.sendJson(ws, { type: "action_error", message: "消息格式错误，需要 JSON" });
        return;
      }
      try {
        this.handleMessage(ws, msg);
      } catch (error) {
        this.sendJson(ws, { type: "action_error", message: error.message });
      }
    });

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('close', () => this.disconnect(ws));
    ws.on('error', () => this.disconnect(ws));
  }

  handleMessage(ws, msg) {
    if (msg.type === "ping") {
      this.sendJson(ws, { type: "pong" });
      return;
    }

    if (msg.type === "create_room") {
      const sessionId = msg.sessionId || randomCode(16);
      const room = this.manager.createRoom({
        adminToken: msg.adminToken || this.manager.adminToken,
        sessionId,
        displayName: msg.displayName || "房主",
        config: msg.config,
        socket: wrapWs(ws),
      });
      this.wsRooms.set(ws, { roomCode: room.roomCode, sessionId });
      this.sendJson(ws, {
        type: "room_created",
        roomCode: room.roomCode,
        sessionId,
      });
      console.log(`[${new Date().toISOString()}] [WS] 房间创建 ${room.roomCode}`);
      room.broadcast();
      return;
    }

    if (msg.type === "join_room") {
      const sessionId = msg.sessionId || randomCode(16);
      const { room, session } = this.manager.joinRoom({
        roomCode: msg.roomCode,
        sessionId,
        displayName: msg.displayName || "玩家",
        socket: wrapWs(ws),
      });
      this.wsRooms.set(ws, { roomCode: room.roomCode, sessionId: session.sessionId });
      this.sendJson(ws, {
        type: "joined_room",
        roomCode: room.roomCode,
        sessionId: session.sessionId,
      });
      console.log(`[${new Date().toISOString()}] [WS] 玩家连接 房间 ${room.roomCode} ${session.displayName}`);
      room.broadcast();
      return;
    }

    const binding = this.wsRooms.get(ws);
    if (!binding) throw new Error("请先创建或加入房间");
    const room = this.manager.rooms.get(binding.roomCode);
    if (!room) throw new Error("房间不存在或已关闭");
    const sessionId = binding.sessionId;

    if (msg.type === "sit_down") room.sit(sessionId, msg.seatIndex);
    else if (msg.type === "leave_seat") room.leaveSeat(sessionId);
    else if (msg.type === "add_bot") room.addBot(sessionId, msg);
    else if (msg.type === "remove_bot") room.removeBot(sessionId, msg.seatIndex);
    else if (msg.type === "start_game") {
      room.startGame(sessionId);
      console.log(`[${new Date().toISOString()}] [WS] 单手开始 房间 ${room.roomCode}`);
    } else if (msg.type === "next_hand") {
      room.nextHand(sessionId);
      console.log(`[${new Date().toISOString()}] [WS] 下一手 房间 ${room.roomCode}`);
    } else if (msg.type === "reset_game") {
      room.resetGame(sessionId);
      console.log(`[${new Date().toISOString()}] [WS] 重置牌局 房间 ${room.roomCode}`);
    } else if (msg.type === "player_action") {
      room.applyPlayerAction(sessionId, actionFromDto(msg.action), msg.clientActionId);
      if (room.engine?.handFinished) console.log(`[${new Date().toISOString()}] [WS] 单手结束 房间 ${room.roomCode}`);
    } else if (msg.type === "room_snapshot") {
      this.sendJson(ws, room.snapshotFor(sessionId));
      return;
    } else {
      throw new Error("未知消息类型");
    }
    room.broadcast();
  }

  disconnect(ws) {
    const binding = this.wsRooms.get(ws);
    if (!binding) return;
    this.wsRooms.delete(ws);
    const room = this.manager.rooms.get(binding.roomCode);
    if (!room) return;
    room.disconnectSession(binding.sessionId);
    console.log(`[${new Date().toISOString()}] [WS] 玩家断开 房间 ${room.roomCode}`);
    if (!room.hasConnectedHumans()) {
      if (room.hasHumanSeats()) {
        // 有真人入座但全部断线：给 5 分钟宽限期等待重连
        if (!room.pendingCloseTimer) {
          room.pendingCloseTimer = setTimeout(() => {
            this.manager.removeRoom(room.roomCode);
            console.log(`[${new Date().toISOString()}] [WS] 房间超时关闭（无人重连） ${room.roomCode}`);
          }, 5 * 60 * 1000);
          room.pendingCloseTimer.unref?.();
          console.log(`[${new Date().toISOString()}] [WS] 房间进入宽限期（5分钟） ${room.roomCode}`);
        }
        room.broadcast();
      } else {
        // 无真人入座，直接关闭
        this.manager.removeRoom(room.roomCode);
        console.log(`[${new Date().toISOString()}] [WS] 房间自动关闭（无真人） ${room.roomCode}`);
      }
    } else {
      room.broadcast();
    }
  }

  sendJson(ws, payload) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}

module.exports = { WsPokerServer };
