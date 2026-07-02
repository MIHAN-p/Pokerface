const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { GameEngine } = require('./game-engine');
const { CliClient } = require('./cli-client');
const { PokerServer } = require('./poker-server');
const { TelnetPokerServer } = require('./telnet-server');

function parseOptions(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) options[key] = true;
    else {
      options[key] = next;
      i += 1;
    }
  }
  return options;
}

async function askInt(rl, prompt, defaultValue, min, max = null) {
  while (true) {
    const raw = (await rl.question(`${prompt}（默认 ${defaultValue}）：`)).trim();
    if (!raw) return defaultValue;
    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || String(value) !== raw) {
      console.log("请输入整数。");
      continue;
    }
    if (value < min) {
      console.log(`不能小于 ${min}。`);
      continue;
    }
    if (max !== null && value > max) {
      console.log(`不能大于 ${max}。`);
      continue;
    }
    return value;
  }
}

async function askBool(rl, prompt, defaultValue) {
  const defaultText = defaultValue ? "是" : "否";
  while (true) {
    const raw = (await rl.question(`${prompt}（默认 ${defaultText}，是/否）：`)).trim().toLowerCase();
    if (!raw) return defaultValue;
    if (["是", "y", "yes", "true", "1"].includes(raw)) return true;
    if (["否", "n", "no", "false", "0"].includes(raw)) return false;
    console.log("请输入 是 或 否。");
  }
}

async function askDifficulty(rl) {
  while (true) {
    const raw = (await rl.question("AI 难度：简单 / 普通 / 困难（默认 普通）：")).trim();
    if (!raw) return "普通";
    if (["简单", "普通", "困难"].includes(raw)) return raw;
    console.log("请输入：简单、普通 或 困难。");
  }
}

async function setupConfig(rl) {
  console.log("单人文字德州扑克");
  const playerCount = await askInt(rl, "总人数 2-9", 6, 2, 9);
  const initialStack = await askInt(rl, "初始筹码", 1000, 1);
  const smallBlind = await askInt(rl, "小盲注", 5, 1);
  const bigBlind = await askInt(rl, "大盲注", Math.max(10, smallBlind * 2), smallBlind + 1);
  const underwater = await askBool(rl, "开启水下模式", true);
  const difficulty = await askDifficulty(rl);
  return { playerCount, initialStack, smallBlind, bigBlind, underwater, difficulty };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "server") {
    const options = parseOptions(args);
    const host = options.host || process.env.HOST || "0.0.0.0";
    const port = Number.parseInt(options.port || process.env.PORT || "3000", 10);
    const server = new PokerServer({
      host,
      port,
      adminToken: options.token,
      allowMultipleRooms: Boolean(options["multi-room"]),
    });
    try {
      await server.listen();
    } catch (error) {
      if (error.code === "EADDRINUSE") console.error(`端口已占用：${host}:${port}`);
      else if (error.code === "EACCES") console.error(`权限不足，无法监听：${host}:${port}`);
      else if (error.code === "EADDRNOTAVAIL") console.error(`地址不可绑定：${host}`);
      else console.error(`服务启动失败：${error.message}`);
      process.exitCode = 1;
    }
    return;
  }
  if (command === "telnet") {
    const options = parseOptions(args);
    const host = options.host || process.env.HOST || "0.0.0.0";
    const port = Number.parseInt(options.port || process.env.PORT || "8787", 10);
    const server = new TelnetPokerServer({ host, port });
    try {
      await server.listen();
    } catch (error) {
      if (error.code === "EADDRINUSE") console.error(`端口已占用：${host}:${port}`);
      else if (error.code === "EACCES") console.error(`权限不足，无法监听：${host}:${port}`);
      else if (error.code === "EADDRNOTAVAIL") console.error(`地址不可绑定：${host}`);
      else console.error(`服务启动失败：${error.message}`);
      process.exitCode = 1;
    }
    return;
  }
  if (command === "create") {
    const endpoint = args[0];
    if (!endpoint) throw new Error("用法：node poker.js create host:port");
    await new CliClient({ endpoint, mode: "create" }).run();
    return;
  }
  if (command === "join") {
    const endpoint = args[0];
    const roomCode = args[1];
    if (!endpoint || !roomCode) throw new Error("用法：node poker.js join host:port 房间码");
    await new CliClient({ endpoint, mode: "join", roomCode }).run();
    return;
  }
  if (command === "host") {
    const options = parseOptions(args);
    const host = options.host || "127.0.0.1";
    const port = Number.parseInt(options.port || "3000", 10);
    const server = new PokerServer({ host, port, adminToken: options.token });
    await server.listen();
    await new CliClient({ endpoint: `${host}:${port}`, mode: "create", localServer: server }).run();
    return;
  }
  if (command && ["help", "-h", "--help"].includes(command)) {
    console.log("用法：");
    console.log("  node poker.js                         启动单机命令行游戏");
    console.log("  node poker.js server --host 0.0.0.0 --port 3000");
    console.log("  node poker.js create your-server.com:3000");
    console.log("  node poker.js join your-server.com:3000 房间码");
    console.log("  node poker.js telnet --host 0.0.0.0 --port 8787  启动 nc/telnet 纯终端桌");
    console.log("  node poker.js host                    本机启动服务端并创建房间");
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const config = await setupConfig(rl);
    const engine = new GameEngine(config, {
      readInput: (prompt) => rl.question(prompt),
      writeOutput: (text) => console.log(text),
    });
    await engine.run();
  } finally {
    rl.close();
  }
}

module.exports = { main, parseOptions, setupConfig };
