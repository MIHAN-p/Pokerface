/**
 * Pokerface TCP 服务
 * 将命令行德州扑克包装成 TCP 服务，支持远程终端连接游玩
 *
 * 用法：
 *   node poker-server.js [端口号]
 *
 * 客户端连接：
 *   nc <host> <port>
 *   telnet <host> <port>
 */

const net = require("node:net");
const { GameEngine, formatCards } = require("./poker.js");

const PORT = Number.parseInt(process.argv[2], 10) || 8787;

// 安全防护配置
const SAFETY = {
  maxConcurrent: 5,           // 最大并发连接数
  maxConnPerIP: 2,            // 每 IP 最大连接数
  idleTimeoutMs: 30_000,       // 空闲超时（30秒无输入断开）
  maxGameDurationMs: 3_600_000, // 单局游戏最长 1 小时
  dataRateLimit: 100,          // 每秒最多接收 100 行输入
};

const connections = new Map(); // ip -> count

function guard(socket) {
  const ip = socket.remoteAddress;
  const current = connections.get(ip) || 0;
  if (current >= SAFETY.maxConnPerIP) {
    const msg = "该 IP 连接数已达上限，请关闭旧连接后重试。\r\n";
    socket.write(msg);
    console.log(`[拦截] ${ip} 超过每 IP 上限`);
    socket.destroy();
    return false;
  }
  const total = [...connections.values()].reduce((a, b) => a + b, 0);
  if (total >= SAFETY.maxConcurrent) {
    const msg = "服务繁忙，请稍后重试。\r\n";
    socket.write(msg);
    console.log(`[拦截] ${ip} 超过总连接上限`);
    socket.destroy();
    return false;
  }
  connections.set(ip, current + 1);
  return true;
}

function unguard(socket) {
  const ip = socket.remoteAddress;
  const current = connections.get(ip) || 0;
  if (current <= 1) connections.delete(ip);
  else connections.set(ip, current - 1);
}

function createServer() {
  const server = net.createServer((socket) => {
    const addr = `${socket.remoteAddress}:${socket.remotePort}`;

    // 安全检查
    if (!guard(socket)) return;

    console.log(`[连接] ${addr}`);

    // 空闲超时定时器
    let idleTimer = null;
    function resetIdleTimer() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        writeOutput("\r\n连接超时，已断开。\r\n");
        socket.destroy();
      }, SAFETY.idleTimeoutMs);
    }
    resetIdleTimer();

    // 整体游戏超时
    const gameTimer = setTimeout(() => {
      writeOutput("\r\n游戏时间已达上限，已断开。\r\n");
      socket.destroy();
    }, SAFETY.maxGameDurationMs);

    // 速率限制
    let dataTimestamps = [];

    // 缓冲区，处理粘包
    let buffer = "";
    let inputResolve = null;

    function write(text) {
      // 清理 ANSI 控制字符，用纯文本
      const clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
      socket.write(clean.replace(/\n/g, "\r\n"));
    }

    // 别名，避免与局部变量冲突
    const writeOutput = write;

    function readInput(prompt) {
      return new Promise((resolve) => {
        write(prompt);
        inputResolve = resolve;
      });
    }

    socket.on("data", (chunk) => {
      resetIdleTimer();

      // 速率限制检查
      const now = Date.now();
      dataTimestamps = dataTimestamps.filter(t => now - t < 1000);
      const lineCount = (chunk.toString().match(/\n/g) || []).length;
      dataTimestamps.push(...Array(lineCount || 1).fill(now));
      if (dataTimestamps.length > SAFETY.dataRateLimit) {
        writeOutput("\r\n输入过快，请慢一点。\r\n");
        return;
      }

      buffer += chunk.toString();
      // 处理退格
      buffer = buffer.replace(/\x7f/g, "").replace(/\x08/g, "");

      // 按行处理
      let nlIndex;
      while ((nlIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nlIndex).trim();
        buffer = buffer.slice(nlIndex + 1);
        if (inputResolve) {
          const resolve = inputResolve;
          inputResolve = null;
          resolve(line);
        }
      }
    });

    socket.on("close", () => {
      unguard(socket);
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(gameTimer);
      console.log(`[断开] ${addr}`);
      if (inputResolve) {
        inputResolve("退出");
        inputResolve = null;
      }
    });

    socket.on("error", (err) => {
      unguard(socket);
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(gameTimer);
      console.error(`[错误] ${addr}: ${err.message}`);
      if (inputResolve) {
        inputResolve("退出");
        inputResolve = null;
      }
    });

    // 启动游戏（不经过 setupConfig，直接使用交互式配置）
    write(
      "\r\n" +
        "╔══════════════════════════════════════╗\r\n" +
        "║       Pokerface 德州扑克 TCP 版      ║\r\n" +
        "║       输入 退出/q 随时结束            ║\r\n" +
        "╚══════════════════════════════════════╝\r\n" +
        "\r\n",
    );

    (async () => {
      try {
        // 交互配置
        write("总人数 2-9（默认 6）：");
        const playerCount = await readLineOrQuit();
        let config = {};

        // 等待用户输入配置
        config.playerCount = parseOrDefault(playerCount, 6, 2, 9);

        write("初始筹码（默认 1000）：");
        const stack = await readLineOrQuit();
        config.initialStack = parseOrDefault(stack, 1000, 1);

        write("小盲注（默认 5）：");
        const sb = await readLineOrQuit();
        config.smallBlind = parseOrDefault(sb, 5, 1);

        write("大盲注（默认 10）：");
        const bb = await readLineOrQuit();
        config.bigBlind = parseOrDefault(bb, 10, 2);

        write("开启水下模式？是/否（默认 是）：");
        const underwater = await readLineOrQuit();
        config.underwater = parseBool(underwater, true);

        write("AI 难度？简单/普通/困难（默认 普通）：");
        const diff = await readLineOrQuit();
        config.difficulty = ["简单", "普通", "困难"].includes(diff.trim()) ? diff.trim() : "普通";

        write(`\r\n配置：${config.playerCount}人 | ${config.initialStack}筹码 | ${config.smallBlind}/${config.bigBlind}盲注 | 水下${config.underwater ? "开" : "关"} | 难度${config.difficulty}\r\n`);
        write("\r\n===== 开始游戏 =====\r\n");

        const engine = new GameEngine(config, {
          readInput: (prompt) => readInput(prompt),
          writeOutput: (text) => write(text),
          pauseBetweenStreets: true,
        });

        await engine.run();

        write("\r\n游戏已结束。输入任意键断开连接...\r\n");
        await readLineOrQuit();
      } catch (err) {
        if (err.message !== "quit") {
          write(`\r\n错误：${err.message}\r\n`);
        }
      } finally {
        socket.destroy();
      }
    })();

    let quitFlag = false;

    async function readLineOrQuit() {
      const line = await readInput("");
      if (["退出", "q", "quit"].includes(line.trim().toLowerCase())) {
        write("\r\n退出游戏...\r\n");
        throw new Error("quit");
      }
      if (!socket.writable) throw new Error("quit");
      return line;
    }

    function parseOrDefault(raw, defaultVal, min, max) {
      const trimmed = raw.trim();
      if (!trimmed) return defaultVal;
      const num = Number.parseInt(trimmed, 10);
      if (!Number.isInteger(num) || String(num) !== trimmed) return defaultVal;
      if (num < min) return defaultVal;
      if (max !== undefined && num > max) return defaultVal;
      return num;
    }

    function parseBool(raw, defaultVal) {
      const trimmed = raw.trim().toLowerCase();
      if (!trimmed) return defaultVal;
      return ["是", "y", "yes", "true", "1"].includes(trimmed);
    }
  });

  server.on("error", (err) => {
    console.error(`[服务错误] ${err.message}`);
  });

  return server;
}

const server = createServer();

// 只监听本地回环地址，通过 SSH 隧道安全访问
server.listen(PORT, "127.0.0.1", () => {
  const ips = [];
  const os = require("os");
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }

  console.log("╔══════════════════════════════════════════╗");
  console.log("║      Pokerface 德州扑克 TCP 服务已启动   ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  端口: ${String(PORT).padEnd(34, " ")} ║`);
  for (const ip of ips) {
    console.log(`║  IP: ${(ip + ":" + PORT).padEnd(36, " ")} ║`);
  }
  console.log("║                                          ║");
  console.log("║  客户端连接:                             ║");
  for (const ip of ips) {
    const isPublic = !ip.startsWith("10.") && !ip.startsWith("172.") && !ip.startsWith("192.168.");
    if (isPublic) {
      console.log(`║    nc ${ip} ${PORT}                    ║`);
    }
  }
  console.log("╚══════════════════════════════════════════╝");
});
