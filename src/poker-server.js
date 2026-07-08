const net = require('node:net');
const { actionFromDto, randomCode, sendJson } = require('./online-protocol');
const { RoomManager } = require('./room-manager');

class PokerServer {
  constructor({ host = "0.0.0.0", port = 3000, adminToken, allowMultipleRooms = false, manager } = {}) {
    this.host = host;
    this.port = port;
    this.manager = manager ?? new RoomManager({ adminToken, allowMultipleRooms });
    this.server = net.createServer((socket) => this.handleSocket(socket));
    this.socketRooms = new Map();
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        console.log("Pokerface 联机服务已启动");
        console.log(`地址：${this.host}`);
        console.log(`端口：${this.port}`);
        console.log(`管理口令：${this.manager.adminToken}`);
        console.log("");
        console.log(`房主创建房间命令：node poker.js create ${this.host === "0.0.0.0" ? "your-server.com" : this.host}:${this.port}`);
        resolve();
      });
    });
  }

  close() {
    return new Promise((resolve) => this.server.close(resolve));
  }

  handleSocket(socket) {
    socket.setEncoding("utf8");
    let buffer = "";
    sendJson(socket, { type: "welcome", protocol: "pokerface-jsonl-v1" });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.handleMessage(socket, JSON.parse(line));
        } catch (error) {
          sendJson(socket, { type: "action_error", message: error.message });
        }
      }
    });
    socket.on("close", () => this.disconnect(socket));
    socket.on("error", () => this.disconnect(socket));
  }

  handleMessage(socket, msg) {
    if (msg.type === "ping") {
      sendJson(socket, { type: "pong" });
      return;
    }
    if (msg.type === "create_room") {
      const sessionId = msg.sessionId || randomCode(16);
      const room = this.manager.createRoom({
        adminToken: msg.adminToken,
        sessionId,
        displayName: msg.displayName || "房主",
        config: msg.config,
        socket,
      });
      this.socketRooms.set(socket, { roomCode: room.roomCode, sessionId });
      sendJson(socket, { type: "room_created", roomCode: room.roomCode, sessionId, reconnectCode: room.sessions.get(sessionId).reconnectCode });
      console.log(`[${new Date().toISOString()}] 房间创建 ${room.roomCode}`);
      room.broadcast();
      return;
    }
    if (msg.type === "join_room") {
      const sessionId = msg.sessionId || randomCode(16);
      const room = this.manager.joinRoom({
        roomCode: msg.roomCode,
        sessionId,
        displayName: msg.displayName || "玩家",
        socket,
        reconnectCode: msg.reconnectCode,
      });
      const session = [...room.sessions.values()].find((item) => item.sessionId === sessionId || item.reconnectCode === msg.reconnectCode) ?? room.sessions.get(sessionId);
      this.socketRooms.set(socket, { roomCode: room.roomCode, sessionId: session.sessionId });
      sendJson(socket, { type: "joined_room", roomCode: room.roomCode, sessionId: session.sessionId, reconnectCode: session.reconnectCode });
      console.log(`[${new Date().toISOString()}] 玩家连接 房间 ${room.roomCode} ${session.displayName}`);
      room.broadcast();
      return;
    }

    const binding = this.socketRooms.get(socket);
    if (!binding) throw new Error("请先创建或加入房间");
    const room = this.manager.rooms.get(binding.roomCode);
    if (!room) throw new Error("房间不存在或已关闭");
    const sessionId = binding.sessionId;
    if (msg.type === "sit_down") room.sit(sessionId, msg.seatIndex);
    else if (msg.type === "leave_seat") room.leaveSeat(sessionId);
    else if (msg.type === "add_bot") room.addBot(sessionId, msg);
    else if (msg.type === "update_bot") room.updateBot(sessionId, msg);
    else if (msg.type === "remove_bot") room.removeBot(sessionId, msg.seatIndex);
    else if (msg.type === "start_game") {
      room.startGame(sessionId);
      console.log(`[${new Date().toISOString()}] 单手开始 房间 ${room.roomCode}`);
    } else if (msg.type === "next_hand") {
      room.nextHand(sessionId);
      console.log(`[${new Date().toISOString()}] 下一手 房间 ${room.roomCode}`);
    } else if (msg.type === "reset_game") {
      room.resetGame(sessionId);
      console.log(`[${new Date().toISOString()}] 重置牌局 房间 ${room.roomCode}`);
    } else if (msg.type === "player_action") {
      room.applyPlayerAction(sessionId, actionFromDto(msg.action), msg.clientActionId);
      if (room.engine?.handFinished) console.log(`[${new Date().toISOString()}] 单手结束 房间 ${room.roomCode}`);
    } else if (msg.type === "room_snapshot") {
      sendJson(socket, room.snapshotFor(sessionId));
      return;
    } else {
      throw new Error("未知消息类型");
    }
    room.broadcast();
  }

  disconnect(socket) {
    const binding = this.socketRooms.get(socket);
    if (!binding) return;
    this.socketRooms.delete(socket);
    const room = this.manager.rooms.get(binding.roomCode);
    if (!room) return;
    room.disconnectSession(binding.sessionId);
    console.log(`[${new Date().toISOString()}] 玩家断开 房间 ${room.roomCode}`);
    room.broadcast();
  }
}

module.exports = { PokerServer };
