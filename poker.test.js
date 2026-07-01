const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const {
  Action,
  ActionKind,
  Card,
  Deck,
  GameEngine,
  HandEvaluator,
  HandScore,
  InputParser,
  OnlineGameEngine,
  RoomManager,
  TelnetPokerServer,
  Random,
  Stage,
} = require("./poker");

const c = (rank, suit) => new Card(rank, suit);

test("deck has 52 unique cards after shuffle", () => {
  const deck = new Deck(new Random(1));
  deck.shuffle();
  const cards = deck.deal(52);
  assert.equal(cards.length, 52);
  assert.equal(new Set(cards.map((card) => card.key())).size, 52);
});

test("hand evaluator detects royal flush", () => {
  const score = HandEvaluator.best([
    c(14, "S"),
    c(13, "S"),
    c(12, "S"),
    c(11, "S"),
    c(10, "S"),
    c(2, "D"),
    c(3, "C"),
  ]);
  assert.equal(score.name(), "皇家同花顺");
});

test("hand evaluator handles wheel straight", () => {
  const score = HandEvaluator.best([
    c(14, "S"),
    c(2, "H"),
    c(3, "D"),
    c(4, "C"),
    c(5, "S"),
    c(9, "D"),
    c(13, "C"),
  ]);
  assert.equal(score.name(), "顺子");
  assert.deepEqual(score.tiebreakers, [5]);
});

test("pair kicker comparison works", () => {
  const better = HandEvaluator.best([c(14, "S"), c(14, "H"), c(13, "D"), c(9, "C"), c(7, "S"), c(4, "D"), c(2, "C")]);
  const worse = HandEvaluator.best([c(14, "D"), c(14, "C"), c(12, "D"), c(9, "H"), c(7, "D"), c(4, "C"), c(2, "S")]);
  assert.ok(better.compare(worse) > 0);
});

test("board pair counts as a pair hand", () => {
  const score = HandEvaluator.best([c(5, "D"), c(7, "S"), c(6, "C"), c(6, "S"), c(9, "H"), c(3, "S"), c(13, "H")]);

  assert.equal(score.name(), "一对");
});

test("input parser accepts Chinese and shortcuts", () => {
  assert.equal(InputParser.parse("弃牌").kind, ActionKind.FOLD);
  assert.equal(InputParser.parse("f").kind, ActionKind.FOLD);
  assert.equal(InputParser.parse("跟注").kind, ActionKind.CHECK_CALL);
  assert.deepEqual(InputParser.parse("b 50"), new Action(ActionKind.BET, 50));
  assert.deepEqual(InputParser.parse("加注 120"), new Action(ActionKind.RAISE, 120));
  assert.equal(InputParser.parse("退出").kind, ActionKind.QUIT);
});

test("big blind option can raise and accepts b as raise shorthand", () => {
  const engine = new GameEngine({ playerCount: 2 }, { rng: new Random(1), writeOutput: () => {} });
  const player = engine.players[0];
  player.stack = 1000;
  player.currentBet = 10;
  engine.currentBet = 10;

  const action = engine.normalizeAction(player, InputParser.parse("b 50"));
  engine.validateAction(player, action);
  const raised = engine.applyAction(0, action);

  assert.equal(action.kind, ActionKind.RAISE);
  assert.equal(raised, true);
  assert.equal(player.currentBet, 50);
  assert.equal(player.stack, 960);
  assert.equal(engine.currentBet, 50);
  assert.match(engine.commandPrompt(), /加注 金额\/r 金额/);
});

test("big blind can raise when action returns in the first betting round", async () => {
  const engine = new GameEngine(
    { playerCount: 2 },
    {
      rng: new Random(1),
      readInput: async () => "b 50",
      writeOutput: () => {},
    },
  );
  engine.dealer = 1;
  let botDecisionCount = 0;
  engine.bot.decide = ({ currentBet, player }) => {
    botDecisionCount += 1;
    if (botDecisionCount === 1 && player.currentBet < currentBet) return new Action(ActionKind.CHECK_CALL);
    return new Action(ActionKind.FOLD);
  };

  await engine.playHand();

  assert.equal(engine.currentBet, 50);
  assert.equal(engine.players[0].currentBet, 50);
  assert.equal(engine.players[0].totalBet, 50);
});

test("side pot settlement uses contribution levels", () => {
  const engine = new GameEngine({ playerCount: 3 }, { rng: new Random(1), writeOutput: () => {} });
  for (const player of engine.players) {
    player.stack = 0;
    player.folded = false;
  }
  engine.players[0].totalBet = 50;
  engine.players[1].totalBet = 100;
  engine.players[2].totalBet = 100;
  const scores = new Map([
    [0, new HandScore(7, [14, 2])],
    [1, new HandScore(1, [13, 12, 11, 9])],
    [2, new HandScore(0, [14, 11, 9, 7, 3])],
  ]);

  engine.settlePots(scores);

  assert.equal(engine.players[0].stack, 150);
  assert.equal(engine.players[1].stack, 100);
  assert.equal(engine.players[2].stack, 0);
});

test("underwater mode caps positive-stack players before borrowing", () => {
  const engine = new GameEngine({ playerCount: 2, underwater: true }, { rng: new Random(1), writeOutput: () => {} });
  const player = engine.players[0];
  player.stack = 50;
  player.handStartStack = 50;

  const committed = engine.commit(player, 80);

  assert.equal(committed, 50);
  assert.equal(player.stack, 0);
  assert.equal(player.totalBet, 50);
  assert.equal(player.allIn, true);
});

test("underwater mode borrows exactly one hand at the next hand start", () => {
  const engine = new GameEngine({ playerCount: 2, underwater: true, initialStack: 1000 }, { rng: new Random(1), writeOutput: () => {} });
  const player = engine.players[0];
  player.stack = 0;

  engine.borrowOneHand(player);

  assert.equal(player.stack, 1000);
  assert.equal(player.underwaterHands, 1);
  assert.equal(player.underwaterDebt, 1000);
  assert.equal(engine.underwaterLabel(player), "水下1手（-1000）");
});

test("non-underwater mode eliminates zero-stack players before a hand", async () => {
  const engine = new GameEngine(
    { playerCount: 3, underwater: false },
    {
      rng: new Random(1),
      readInput: async () => "f",
      writeOutput: () => {},
    },
  );
  engine.dealer = 0;
  engine.players[1].stack = 0;

  await engine.playHand();

  assert.equal(engine.players[1].eliminated, true);
  assert.equal(engine.players[1].hole.length, 0);
  assert.equal(engine.players[1].totalBet, 0);
});

test("play hand completes with check-call strategy", async () => {
  const inputs = Array.from({ length: 100 }, () => "c");
  const engine = new GameEngine(
    { playerCount: 3, difficulty: "简单" },
    {
      rng: new Random(2),
      readInput: async (prompt) => (prompt.includes("Enter to continue") ? "" : inputs.shift() ?? "c"),
      writeOutput: () => {},
    },
  );
  engine.bot.decide = () => new Action(ActionKind.CHECK_CALL);

  await engine.playHand();

  assert.equal(engine.handNo, 1);
  assert.equal(engine.board.length, 5);
  assert.equal(engine.quitRequested, false);
});

test("hand review shows all hole cards and completed board after folds", () => {
  const outputs = [];
  const engine = new GameEngine({ playerCount: 3 }, { rng: new Random(1), writeOutput: (text) => outputs.push(text) });
  engine.handNo = 1;
  engine.dealer = 1;
  engine.stage = Stage.SHOWDOWN;
  engine.board = [c(10, "H"), c(6, "D"), c(4, "H")];
  engine.deck = { cards: [c(4, "D"), c(3, "H")] };
  engine.pot = 200;
  engine.players[0].hole = [c(3, "D"), c(14, "C")];
  engine.players[1].hole = [c(6, "H"), c(8, "H")];
  engine.players[2].hole = [c(11, "H"), c(14, "S")];
  engine.players[0].folded = false;
  engine.players[1].folded = true;
  engine.players[2].folded = true;

  engine.settleHand();

  const review = outputs.join("\n");
  assert.match(review, /本手复盘/);
  assert.match(review, /完整公共牌：10♥红桃 6♦方片 4♥红桃 4♦方片 3♥红桃/);
  assert.match(review, /你\s+未弃牌\s+3♦方片 A♣梅花/);
  assert.match(review, /AI-1\s+已弃牌\s+6♥红桃 8♥红桃/);
  assert.match(review, /AI-2\s+已弃牌\s+J♥红桃 A♠黑桃/);
});

test("showdown marks winners inline in the player table", () => {
  const outputs = [];
  const engine = new GameEngine({ playerCount: 2 }, { rng: new Random(1), writeOutput: (text) => outputs.push(text) });
  engine.handNo = 1;
  engine.stage = Stage.SHOWDOWN;
  engine.board = [c(14, "H"), c(9, "D"), c(3, "C"), c(2, "S"), c(7, "H")];
  engine.deck = { cards: [] };
  engine.players[0].hole = [c(14, "S"), c(13, "H")];
  engine.players[1].hole = [c(9, "S"), c(8, "H")];
  engine.players[0].folded = false;
  engine.players[1].folded = false;
  engine.players[0].totalBet = 10;
  engine.players[1].totalBet = 10;
  engine.pot = 20;

  engine.settleHand();

  const text = outputs.join("\n");
  assert.doesNotMatch(text, /赢家：/);
  assert.match(text, /你\(赢家\)\s+A♠黑桃 K♥红桃\s+一对/);
  assert.match(text, /AI-1\s+9♠黑桃 8♥红桃\s+一对/);
});

test("street pause can carry an entered action into the betting round", async () => {
  const inputs = ["c"];
  const outputs = [];
  const engine = new GameEngine(
    { playerCount: 3 },
    {
      readInput: async () => inputs.shift() ?? "",
      writeOutput: (text) => outputs.push(text),
    },
  );
  engine.handNo = 1;
  engine.stage = Stage.FLOP;
  engine.board = [c(5, "D"), c(13, "C"), c(7, "H")];
  engine.players[0].hole = [c(10, "C"), c(2, "S")];

  await engine.pauseForStreet();

  assert.equal(inputs.length, 0);
  assert.equal(engine.pendingHumanRaw, "c");
  const action = await engine.readHumanAction(engine.players[0]);
  assert.equal(action.kind, ActionKind.CHECK_CALL);
});

test("render state highlights hero position and uses seat table", () => {
  const engine = new GameEngine({ playerCount: 6 }, { rng: new Random(1), writeOutput: () => {} });
  engine.dealer = 1;
  engine.handNo = 1;
  engine.currentBet = 10;
  engine.actionIndex = 0;
  engine.players[0].hole = [c(13, "S"), c(4, "S")];

  const state = engine.renderState();

  assert.match(state, /-{20,}/);
  assert.match(state, /第 1 手 \| 翻牌前 \| 你的位置：CO（关煞位）/);
  assert.match(state, /标记\s+位置\s+玩家\s+筹码\s+本轮\s+状态/);
  assert.match(state, /CO\s+你\s+1000\s+0\s+行动中/);
  assert.match(state, /最近行动：[\s\S]*你的手牌：K♠黑桃 4♠黑桃[\s\S]*请输入：/);
  assert.match(state, /庄\s+BTN\s+AI-1/);
  assert.match(state, /小\s+SB\s+AI-2/);
  assert.match(state, /大\s+BB\s+AI-3/);
  assert.match(state, /请输入：弃牌\/f，跟注\/c，加注 金额\/r 金额，全下\/a，状态\/s，退出\/q/);
});

test("position names are still available for strategy", () => {
  const engine = new GameEngine({ playerCount: 6 }, { rng: new Random(1), writeOutput: () => {} });
  engine.dealer = 1;

  assert.equal(engine.positionName(0), "CO");
  assert.equal(engine.positionName(1), "BTN");
  assert.equal(engine.positionName(2), "SB");
  assert.equal(engine.positionName(3), "BB");
  assert.equal(engine.positionName(4), "UTG");
  assert.equal(engine.positionName(5), "MP");
});

test("online snapshots only expose the viewer hole cards before showdown", () => {
  const engine = new OnlineGameEngine(
    [
      { index: 1, type: "human", displayName: "Alice", stack: 1000 },
      { index: 2, type: "human", displayName: "Bob", stack: 1000 },
    ],
    { playerCount: 2, initialStack: 1000, smallBlind: 5, bigBlind: 10 },
    { rng: new Random(3) },
  );

  engine.startHand();

  const aliceView = engine.publicSnapshot(1);
  const bobView = engine.publicSnapshot(2);
  assert.equal(aliceView.players.find((player) => player.seatIndex === 1).hole.length, 2);
  assert.equal(aliceView.players.find((player) => player.seatIndex === 2).hole, null);
  assert.equal(bobView.players.find((player) => player.seatIndex === 1).hole, null);
  assert.equal(bobView.players.find((player) => player.seatIndex === 2).hole.length, 2);
  assert.doesNotMatch(JSON.stringify(aliceView), /deck|cards":\[/);
});

test("room manager creates a host room, enforces host bot permissions, and reconnects a seat", () => {
  const manager = new RoomManager({ adminToken: "TOKEN" });
  const socket = { write: () => {} };
  const room = manager.createRoom({
    adminToken: "TOKEN",
    sessionId: "host-session",
    displayName: "Host",
    config: { playerCount: 3, initialStack: 500, smallBlind: 5, bigBlind: 10 },
    socket,
  });

  assert.equal(room.seats[0].type, "human");
  assert.equal(room.seats[0].displayName, "Host");
  assert.throws(() => room.addBot("missing-session", { seatIndex: 2 }), /会话不存在/);

  const guestSocket = { write: () => {} };
  manager.joinRoom({ roomCode: room.roomCode, sessionId: "guest-session", displayName: "Guest", socket: guestSocket });
  room.sit("guest-session", 2);
  const reconnectCode = room.seats[1].reconnectCode;
  room.disconnectSession("guest-session");
  assert.equal(room.seats[1].connected, false);

  manager.joinRoom({ roomCode: room.roomCode, sessionId: "new-session", displayName: "Guest", socket: guestSocket, reconnectCode });

  assert.equal(room.seats[1].connected, true);
  assert.equal(room.seats[1].sessionId, "guest-session");
});

test("starting a room auto-fills empty seats with bots", () => {
  const manager = new RoomManager({ adminToken: "TOKEN" });
  const socket = { write: () => {} };
  const room = manager.createRoom({
    adminToken: "TOKEN",
    sessionId: "host-session",
    displayName: "Host",
    config: { playerCount: 4, initialStack: 500, smallBlind: 5, bigBlind: 10, difficulty: "困难" },
    socket,
  });

  room.startGame("host-session");

  assert.equal(room.seats.filter((seat) => seat.type === "empty").length, 0);
  assert.equal(room.seats.filter((seat) => seat.type === "bot").length, 3);
  assert.equal(room.engine.players.length, 4);
  assert.equal(room.seats[1].botConfig.difficulty, "困难");
});

test("timeout fold ends only the current hand and allows next hand", async () => {
  const manager = new RoomManager({ adminToken: "TOKEN" });
  const writes = [];
  const socket = { write: (text) => writes.push(text), _pokerfaceTextClient: true };
  const room = manager.createRoom({
    adminToken: "TOKEN",
    sessionId: "host-session",
    displayName: "Host",
    config: { playerCount: 2, initialStack: 500, smallBlind: 5, bigBlind: 10, actionTimeoutSeconds: 5 },
    socket,
  });
  room.startGame("host-session");
  const hostPlayer = room.engine.players.find((player) => player.seatIndex === 1);
  const otherPlayer = room.engine.players.find((player) => player.seatIndex !== 1);
  assert.equal(hostPlayer.isHuman, true);

  room.engine.applySeatAction(hostPlayer.seatIndex, new Action(ActionKind.FOLD));
  room.syncStacksFromEngine();
  room.broadcast();

  assert.equal(room.engine.handFinished, true);
  assert.equal(room.status, "playing");
  assert.match(writes.join(""), /房间仍在。输入 下一手\/next 开始下一手。/);

  room.nextHand("host-session");

  assert.equal(room.engine.handFinished, false);
  assert.equal(room.engine.players.length, 2);
  assert.equal(room.engine.players.some((player) => player.seatIndex === otherPlayer.seatIndex), true);
});

test("telnet server creates a room through plain terminal input", async () => {
  const server = new TelnetPokerServer({ host: "127.0.0.1", port: 0 });
  const originalLog = console.log;
  console.log = () => {};
  let text;
  try {
    await server.listen();
    const port = server.server.address().port;

    text = await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      let output = "";
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("telnet smoke test timed out"));
      }, 5000);
      socket.on("data", (chunk) => {
        output += chunk.toString("utf8");
        if (output.includes("房间已创建")) {
          clearTimeout(timeout);
          socket.end("q\n");
          resolve(output);
        }
      });
      socket.on("connect", () => {
        socket.write("\n\n\n\n\n\n\n\n");
      });
      socket.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  } finally {
    console.log = originalLog;
    await server.close();
  }

  assert.match(text, /Pokerface 纯终端联机桌/);
  assert.match(text, /房间已创建/);
  assert.match(text, /朋友连接命令：nc 服务器IP \d+/);
});
