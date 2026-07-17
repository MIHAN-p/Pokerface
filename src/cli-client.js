const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { parseOnlineClientCommand, renderOnlineSnapshot, sendJson } = require('./online-protocol');

class CliClient {
  constructor({ endpoint, mode, roomCode, localServer = null }) {
    this.endpoint = endpoint;
    this.mode = mode;
    this.roomCode = roomCode;
    this.localServer = localServer;
    this.socket = null;
    this.rl = null;
    this.session = loadSession(endpoint, roomCode);
    this.latestSnapshot = null;
  }

  async run() {
    const { host, port } = parseEndpoint(this.endpoint);
    this.rl = readline.createInterface({ input, output });
    this.socket = net.createConnection({ host, port });
    this.socket.setEncoding("utf8");
    let buffer = "";
    this.socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.handleServerMessage(JSON.parse(line));
        } catch {
          console.log("连接的端口不是 Pokerface JSON 联机服务。");
          console.log("如果服务端跑的是 nc/telnet 纯终端模式，请直接用 nc 或 telnet 连接，不要使用 create/join。");
          this.socket.end();
          return;
        }
      }
    });
    this.socket.on("close", () => {
      console.log("\nDisconnected.");
      this.rl?.close();
      this.localServer?.close();
    });
    await onceConnect(this.socket);
    if (this.mode === "create") await this.createRoom();
    else await this.joinRoom();
    await this.inputLoop();
  }

  async createRoom() {
    const displayName = await this.ask("昵称（默认 房主）：", "房主");
    const adminToken = this.localServer?.manager.adminToken ?? (await this.ask("管理口令："));
    const config = await askRoomConfig(this.rl);
    sendJson(this.socket, {
      type: "create_room",
      adminToken,
      displayName,
      sessionId: this.session?.sessionId,
      config,
    });
  }

  async joinRoom() {
    const displayName = await this.ask("昵称（默认 玩家）：", "玩家");
    sendJson(this.socket, {
      type: "join_room",
      roomCode: this.roomCode,
      displayName,
      sessionId: this.session?.sessionId,
    });
  }

  async inputLoop() {
    while (true) {
      const raw = await this.rl.question("> ");
      const text = raw.trim();
      if (!text) continue;
      try {
        if (["q", "退出", "quit"].includes(text.toLowerCase())) {
          this.socket.end();
          return;
        }
        const message = this.parseClientCommand(text);
        if (message) sendJson(this.socket, message);
      } catch (error) {
        console.log(`输入无效：${error.message}`);
      }
    }
  }

  parseClientCommand(text) {
    return parseOnlineClientCommand(text);
  }

  handleServerMessage(msg) {
    if (msg.type === "welcome") return;
    if (msg.type === "action_error") {
      console.log(`错误：${msg.message}`);
      return;
    }
    if (msg.type === "room_created") {
      console.log(`房间已创建：${msg.roomCode}`);
      console.log(`朋友加入命令：node poker.js join ${this.endpoint} ${msg.roomCode}`);
      saveSession(this.endpoint, msg.roomCode, msg);
      return;
    }
    if (msg.type === "joined_room") {
      console.log(`已加入房间：${msg.roomCode}`);
      saveSession(this.endpoint, msg.roomCode, msg);
      return;
    }
    if (msg.type === "room_snapshot") {
      this.latestSnapshot = msg;
      console.log(renderOnlineSnapshot(msg));
    }
  }

  async ask(prompt, defaultValue = "") {
    const raw = (await this.rl.question(prompt)).trim();
    return raw || defaultValue;
  }
}

function parseEndpoint(endpoint) {
  const [host, rawPort] = String(endpoint || "").split(":");
  if (!host) throw new Error("服务器地址不能为空");
  const port = Number.parseInt(rawPort || "3000", 10);
  if (!Number.isInteger(port) || port <= 0) throw new Error("端口格式错误");
  return { host, port };
}

function onceConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
}

async function askRoomConfig(rl) {
  const playerCount = await askInt(rl, "总座位数 2-9", 6, 2, 9);
  const initialStack = await askInt(rl, "初始筹码", 1000, 1);
  const smallBlind = await askInt(rl, "小盲注", 5, 1);
  const bigBlind = await askInt(rl, "大盲注", Math.max(10, smallBlind * 2), smallBlind + 1);
  const underwater = await askBool(rl, "开启水下模式", true);
  const actionTimeoutSeconds = await askInt(rl, "行动超时秒数", 120, 5);
  const difficulty = await askDifficulty(rl);
  return { playerCount, initialStack, smallBlind, bigBlind, underwater, actionTimeoutSeconds, difficulty };
}

function sessionStorePath() {
  return path.join(process.cwd(), ".pokerface-sessions.json");
}

function loadSession(endpoint, roomCode) {
  try {
    const data = JSON.parse(fs.readFileSync(sessionStorePath(), "utf8"));
    return data[`${endpoint}|${roomCode ?? "create"}`] ?? null;
  } catch {
    return null;
  }
}

function saveSession(endpoint, roomCode, session) {
  try {
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(sessionStorePath(), "utf8"));
    } catch {
      data = {};
    }
    data[`${endpoint}|${roomCode}`] = {
      sessionId: session.sessionId,
    };
    fs.writeFileSync(sessionStorePath(), `${JSON.stringify(data, null, 2)}\n`);
  } catch {
    // 会话缓存失败不影响本次游戏。
  }
}

module.exports = { CliClient, askRoomConfig, loadSession, onceConnect, parseEndpoint, saveSession };
