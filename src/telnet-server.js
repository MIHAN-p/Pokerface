const net = require('node:net');
const iconv = require("iconv-lite");
const { actionFromDto, decodeTelnetInput, normalizeDifficulty, parseConfigBool, parseConfigInt, parseOnlineClientCommand, randomCode, sendSnapshot, sendText } = require('./online-protocol');
const { RoomManager } = require('./room-manager');

class TelnetPokerServer {
  constructor({ host = "0.0.0.0", port = 8787 } = {}) {
    this.host = host;
    this.port = port;
    this.adminToken = randomCode(8);
    this.manager = new RoomManager({ adminToken: this.adminToken, allowMultipleRooms: false });
    this.server = net.createServer((socket) => this.handleSocket(socket));
    this.pendingHost = false;
  }

  listen() {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        this.port = this.server.address().port;
        console.log("Pokerface 纯终端服务已启动");
        console.log(`地址：${this.host}`);
        console.log(`端口：${this.port}`);
        console.log("");
        console.log(`朋友连接命令：nc ${this.host === "0.0.0.0" ? "your-server.com" : this.host} ${this.port}`);
        console.log(`Windows 可用：telnet ${this.host === "0.0.0.0" ? "your-server.com" : this.host} ${this.port}`);
        resolve();
      });
    });
  }

  close() {
    return new Promise((resolve) => this.server.close(resolve));
  }

  handleSocket(socket) {
    socket._pokerfaceTextClient = true;
    socket._gbkEncoding = false;
    socket._welcomeSent = false;
    socket.write(Buffer.from([255, 251, 1, 255, 251, 3]));

    const sendWelcome = () => {
      if (socket._welcomeSent) return;
      socket._welcomeSent = true;
      const actualIsHost = this.manager.rooms.size === 0 && !this.pendingHost;
      if (this.manager.rooms.size === 0 && this.pendingHost) {
        sendText(socket, "房主正在创建房间，请稍后重新连接。");
        socket.end();
        return;
      }
      sendText(socket, "欢迎来到 Pokerface 纯终端联机桌。");
      sendText(socket, "");
      if (actualIsHost) {
        this.pendingHost = true;
        state.isHost = true;
        sendText(socket, "你是第一个连接的玩家，将成为房主。");
        this.prompt(state, "昵称（默认 房主）：");
      } else {
        state.isHost = false;
        this.prompt(state, "昵称（默认 玩家）：");
      }
      if (state._preWelcomeBuffer && state._preWelcomeBuffer.length) {
        for (const buffered of state._preWelcomeBuffer) {
          this.handleData(state, buffered);
        }
        state._preWelcomeBuffer = [];
      }
    };

    const state = {
      socket,
      buffer: "",
      sessionId: randomCode(16),
      room: null,
      step: "name",
      displayName: "",
      isHost: this.manager.rooms.size === 0 && !this.pendingHost,
      config: {},
    };

    const welcomeTimer = setTimeout(() => sendWelcome(), 300);

    socket.on("data", (chunk) => {
      if (!socket._welcomeSent && chunk.length >= 3 && chunk[0] === 255 && [251, 252, 253, 254].includes(chunk[1])) {
        socket._gbkEncoding = true;
        clearTimeout(welcomeTimer);
        sendWelcome();
        return;
      }
      if (!socket._welcomeSent) {
        if (!state._preWelcomeBuffer) state._preWelcomeBuffer = [];
        state._preWelcomeBuffer.push(chunk);
        return;
      }
      this.handleData(state, chunk);
    });
    socket.on("close", () => {
      clearTimeout(welcomeTimer);
      this.disconnect(state);
    });
    socket.on("error", () => {});
  }

  handleData(state, chunk) {
    const text = decodeTelnetInput(chunk);
    if (text === null) {
      state.socket._gbkEncoding = true;
      return;
    }
    if (!text) return;
    const echoBytes = [];
    for (const ch of text) {
      if (ch === "\x7f" || ch === "\b") {
        echoBytes.push(0x08, 0x20, 0x08);
      } else if (ch === "\r" || ch === "\n") {
        echoBytes.push(0x0d, 0x0a);
      } else if (ch >= " ") {
        if (state.socket._gbkEncoding) {
          echoBytes.push(...iconv.encode(ch, "gbk"));
        } else {
          echoBytes.push(...Buffer.from(ch, "utf8"));
        }
      }
    }
    if (echoBytes.length) state.socket.write(Buffer.from(echoBytes));
    state.buffer += text.replace(/\r/g, "");
    const lines = state.buffer.split("\n");
    state.buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      this.handleLine(state, trimmed);
    }
  }

  handleLine(state, text) {
    try {
      if (state.step === "name") {
        state.displayName = text || (state.isHost ? "房主" : "玩家");
        if (state.isHost) {
          state.step = "roomCode";
          this.prompt(state, "设置房间号（回车自动生成）：");
        } else {
          state.step = "joinRoomCode";
          this.prompt(state, "输入房间号：");
        }
        return;
      }

      if (this.handleHostConfigLine(state, text)) return;

      if (state.step === "joinRoomCode") {
        if (!text) {
          this.prompt(state, "输入房间号：");
        } else {
          const roomCode = text.trim();
          const room = this.manager.rooms.get(roomCode);
          if (!room) throw new Error(`房间 ${roomCode} 不存在`);
          state.room = this.manager.joinRoom({
            roomCode,
            sessionId: state.sessionId,
            displayName: state.displayName,
            socket: state.socket,
          });
          state.step = "command";
          const cfg = state.room.config;
          sendText(state.socket, `已加入房间 ${state.room.roomCode}：${cfg.playerCount}人桌  ${cfg.initialStack}筹码  盲${cfg.smallBlind}/${cfg.bigBlind}  ${cfg.actionTimeoutSeconds}秒超时`);
          sendText(state.socket, "输入 sit 位置 入座，使用 s 查看状态。");
          // 通知其他玩家
          for (const [otherSessionId, otherSocket] of state.room.clients) {
            if (otherSessionId !== state.sessionId) {
              sendText(otherSocket, `${state.displayName} 加入，正在选择座位。`);
            }
          }
          state.room.broadcast();
        }
        return;
      }

      if (state.step === "command") {
        if (!text) {
          sendSnapshot(state.socket, state.room.snapshotFor(state.sessionId));
          return;
        }
        if (["q", "退出", "quit"].includes(text.toLowerCase())) {
          state.socket.end("Disconnected.\r\n");
          return;
        }
        const message = parseOnlineClientCommand(text);
        this.applyTextCommand(state, message);
      }
    } catch (error) {
      sendText(state.socket, `错误：${error.message}`);
      this.prompt(state, state.step === "command" ? "> " : "");
    }
  }

  handleHostConfigLine(state, text) {
    if (!state.isHost) return false;
    const defaults = {
      roomCode: "",
      playerCount: 6,
      initialStack: 1000,
      smallBlind: 5,
      bigBlind: 10,
      underwater: true,
      actionTimeoutSeconds: 120,
      difficulty: "普通",
    };
    if (state.step === "roomCode") {
      state.config.roomCode = (text || defaults.roomCode).trim();
      state.step = "playerCount";
      this.prompt(state, "总座位数 2-9（默认 6）：");
      return true;
    }
    if (state.step === "playerCount") {
      state.config.playerCount = text ? parseConfigInt(text, 2, 9, "总座位数") : defaults.playerCount;
      state.step = "initialStack";
      this.prompt(state, "初始筹码（默认 1000）：");
      return true;
    }
    if (state.step === "initialStack") {
      state.config.initialStack = text ? parseConfigInt(text, 1, null, "初始筹码") : defaults.initialStack;
      state.step = "smallBlind";
      this.prompt(state, "小盲注（默认 5）：");
      return true;
    }
    if (state.step === "smallBlind") {
      state.config.smallBlind = text ? parseConfigInt(text, 1, null, "小盲注") : defaults.smallBlind;
      state.step = "bigBlind";
      this.prompt(state, `大盲注（默认 ${Math.max(10, state.config.smallBlind * 2)}）：`);
      return true;
    }
    if (state.step === "bigBlind") {
      const defaultBigBlind = Math.max(10, state.config.smallBlind * 2);
      state.config.bigBlind = text ? parseConfigInt(text, state.config.smallBlind + 1, null, "大盲注") : defaultBigBlind;
      state.step = "underwater";
      this.prompt(state, "开启水下模式（默认 是，是/否）：");
      return true;
    }
    if (state.step === "underwater") {
      state.config.underwater = text ? parseConfigBool(text) : defaults.underwater;
      state.step = "actionTimeoutSeconds";
      this.prompt(state, "行动超时秒数（默认 120）：");
      return true;
    }
    if (state.step === "actionTimeoutSeconds") {
      state.config.actionTimeoutSeconds = text ? parseConfigInt(text, 5, null, "行动超时秒数") : defaults.actionTimeoutSeconds;
      state.step = "difficulty";
      this.prompt(state, "AI 难度：简单 / 普通 / 困难（默认 普通）：");
      return true;
    }
    if (state.step === "difficulty") {
      state.config.difficulty = text ? normalizeDifficulty(text) : defaults.difficulty;
      const room = this.manager.createRoom({
        adminToken: this.adminToken,
        sessionId: state.sessionId,
        displayName: state.displayName,
        config: state.config,
        socket: state.socket,
      });
      state.room = room;
      state.step = "command";
      this.pendingHost = false;
      sendText(state.socket, `房间已创建：${room.roomCode}`);
      sendText(state.socket, `朋友连接命令：nc 服务器IP ${this.port}`);
      room.broadcast();
      return true;
    }
    return false;
  }

  applyTextCommand(state, message) {
    const room = state.room;
    if (!room) throw new Error("尚未加入房间");
    if (message.type === "sit_down") room.sit(state.sessionId, message.seatIndex);
    else if (message.type === "leave_seat") room.leaveSeat(state.sessionId);
    else if (message.type === "add_bot") room.addBot(state.sessionId, message);
    else if (message.type === "update_bot") room.updateBot(state.sessionId, message);
    else if (message.type === "remove_bot") room.removeBot(state.sessionId, message.seatIndex);
    else if (message.type === "start_game") room.startGame(state.sessionId);
    else if (message.type === "next_hand") room.nextHand(state.sessionId);
    else if (message.type === "reset_game") room.resetGame(state.sessionId);
    else if (message.type === "player_action") room.applyPlayerAction(state.sessionId, actionFromDto(message.action), message.clientActionId);
    else if (message.type === "room_snapshot") {
      sendSnapshot(state.socket, room.snapshotFor(state.sessionId));
      return;
    } else {
      throw new Error("未知命令");
    }
    room.broadcast();
  }

  disconnect(state) {
    if (state.isHost && state.step !== "command") this.pendingHost = false;
    if (state.room) {
      state.room.disconnectSession(state.sessionId);
      if (state.room.clients.size === 0) {
        this.manager.removeRoom(state.room.roomCode);
        this.pendingHost = false;
      } else {
        state.room.broadcast();
      }
    }
  }

  prompt(state, text) {
    if (!text) return;
    const out = text.replace(/\n/g, "\r\n");
    if (state.socket._gbkEncoding) {
      state.socket.write(iconv.encode(out, "gbk"));
    } else {
      state.socket.write(out);
    }
  }
}

module.exports = { TelnetPokerServer };
