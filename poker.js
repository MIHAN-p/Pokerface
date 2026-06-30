const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");

const SUITS = ["S", "H", "D", "C"];
const SUIT_NAMES = { S: "黑桃", H: "红桃", D: "方片", C: "梅花" };
const RANK_NAMES = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

class Random {
  constructor(seed = Date.now()) {
    this.seed = seed >>> 0;
  }

  next() {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

class Card {
  constructor(rank, suit) {
    this.rank = rank;
    this.suit = suit;
  }

  key() {
    return `${this.rank}${this.suit}`;
  }

  text() {
    return `${RANK_NAMES[this.rank]}${SUIT_NAMES[this.suit]}`;
  }
}

class Deck {
  constructor(rng = new Random()) {
    this.rng = rng;
    this.cards = [];
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank += 1) {
        this.cards.push(new Card(rank, suit));
      }
    }
  }

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i -= 1) {
      const j = this.rng.int(0, i);
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  deal(count = 1) {
    if (count > this.cards.length) {
      throw new Error("牌堆剩余牌数不足");
    }
    return this.cards.splice(0, count);
  }
}

const HAND_NAMES = {
  9: "皇家同花顺",
  8: "同花顺",
  7: "四条",
  6: "葫芦",
  5: "同花",
  4: "顺子",
  3: "三条",
  2: "两对",
  1: "一对",
  0: "高牌",
};

class HandScore {
  constructor(category, tiebreakers, cards = []) {
    this.category = category;
    this.tiebreakers = tiebreakers;
    this.cards = cards;
  }

  name() {
    return HAND_NAMES[this.category];
  }

  compare(other) {
    if (this.category !== other.category) {
      return this.category - other.category;
    }
    const length = Math.max(this.tiebreakers.length, other.tiebreakers.length);
    for (let i = 0; i < length; i += 1) {
      const diff = (this.tiebreakers[i] ?? 0) - (other.tiebreakers[i] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }
}

class HandEvaluator {
  static best(cards) {
    if (cards.length < 5) {
      throw new Error("至少需要 5 张牌才能判断牌型");
    }
    let best = null;
    for (const combo of combinations(cards, 5)) {
      const score = HandEvaluator.scoreFive(combo);
      if (!best || score.compare(best) > 0) {
        best = score;
      }
    }
    return best;
  }

  static scoreFive(cards) {
    const five = [...cards].sort((a, b) => b.rank - a.rank);
    const ranks = five.map((card) => card.rank);
    const suits = five.map((card) => card.suit);
    const counts = new Map();
    for (const rank of ranks) counts.set(rank, (counts.get(rank) || 0) + 1);
    const grouped = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const isFlush = new Set(suits).size === 1;
    const straightHigh = straightHighCard(ranks);

    if (isFlush && straightHigh) {
      return new HandScore(straightHigh === 14 ? 9 : 8, [straightHigh], five);
    }
    if (grouped[0][1] === 4) {
      const quad = grouped[0][0];
      const kicker = Math.max(...ranks.filter((rank) => rank !== quad));
      return new HandScore(7, [quad, kicker], five);
    }
    if (grouped[0][1] === 3 && grouped[1][1] === 2) {
      return new HandScore(6, [grouped[0][0], grouped[1][0]], five);
    }
    if (isFlush) {
      return new HandScore(5, [...ranks].sort((a, b) => b - a), five);
    }
    if (straightHigh) {
      return new HandScore(4, [straightHigh], five);
    }
    if (grouped[0][1] === 3) {
      const trip = grouped[0][0];
      const kickers = ranks.filter((rank) => rank !== trip).sort((a, b) => b - a);
      return new HandScore(3, [trip, ...kickers], five);
    }
    const pairs = [...counts.entries()]
      .filter(([, count]) => count === 2)
      .map(([rank]) => rank)
      .sort((a, b) => b - a);
    if (pairs.length === 2) {
      const kicker = Math.max(...ranks.filter((rank) => !pairs.includes(rank)));
      return new HandScore(2, [pairs[0], pairs[1], kicker], five);
    }
    if (pairs.length === 1) {
      const pair = pairs[0];
      const kickers = ranks.filter((rank) => rank !== pair).sort((a, b) => b - a);
      return new HandScore(1, [pair, ...kickers], five);
    }
    return new HandScore(0, [...ranks].sort((a, b) => b - a), five);
  }
}

const Stage = {
  PREFLOP: "翻牌前",
  FLOP: "翻牌圈",
  TURN: "转牌圈",
  RIVER: "河牌圈",
  SHOWDOWN: "摊牌",
};

const ActionKind = {
  FOLD: "fold",
  CHECK_CALL: "check_call",
  BET: "bet",
  RAISE: "raise",
  ALL_IN: "all_in",
  STATUS: "status",
  QUIT: "quit",
};

class Action {
  constructor(kind, amount = null) {
    this.kind = kind;
    this.amount = amount;
  }
}

class Player {
  constructor(name, isHuman, stack) {
    this.name = name;
    this.isHuman = isHuman;
    this.stack = stack;
    this.hole = [];
    this.folded = false;
    this.allIn = false;
    this.currentBet = 0;
    this.totalBet = 0;
    this.lastAction = "";
    this.bluffStreak = 0;
    this.eliminated = false;
    this.handStartStack = stack;
    this.underwaterHands = 0;
    this.underwaterDebt = 0;
  }

  resetForHand() {
    this.handStartStack = this.stack;
    this.hole = [];
    this.folded = false;
    this.allIn = false;
    this.currentBet = 0;
    this.totalBet = 0;
    this.lastAction = "";
  }

  resetForStreet() {
    this.currentBet = 0;
    this.lastAction = "";
  }

  get active() {
    return !this.eliminated && !this.folded;
  }
}

class InputParser {
  static parse(raw) {
    const text = raw.trim().toLowerCase();
    if (!text) throw new Error("请输入命令");
    const aliases = {
      弃牌: ActionKind.FOLD,
      fold: ActionKind.FOLD,
      f: ActionKind.FOLD,
      过牌: ActionKind.CHECK_CALL,
      跟注: ActionKind.CHECK_CALL,
      call: ActionKind.CHECK_CALL,
      check: ActionKind.CHECK_CALL,
      c: ActionKind.CHECK_CALL,
      全下: ActionKind.ALL_IN,
      allin: ActionKind.ALL_IN,
      "all-in": ActionKind.ALL_IN,
      a: ActionKind.ALL_IN,
      状态: ActionKind.STATUS,
      status: ActionKind.STATUS,
      s: ActionKind.STATUS,
      退出: ActionKind.QUIT,
      quit: ActionKind.QUIT,
      q: ActionKind.QUIT,
    };
    if (aliases[text]) return new Action(aliases[text]);

    const parts = text.split(/\s+/);
    if (parts.length === 2 && ["下注", "bet", "b"].includes(parts[0])) {
      return new Action(ActionKind.BET, parseAmount(parts[1]));
    }
    if (parts.length === 2 && ["加注", "raise", "r"].includes(parts[0])) {
      return new Action(ActionKind.RAISE, parseAmount(parts[1]));
    }
    throw new Error("无法识别命令");
  }
}

class BotPlayer {
  constructor(rng) {
    this.rng = rng;
  }

  decide({ player, players, board, stage, pot, toCall, currentBet, bigBlind, difficulty }) {
    const strength = this.strength(player.hole, board, stage);
    const activeOpponents = players.filter((p) => p !== player && p.active).length;
    const params = this.params(difficulty);
    const pressure = toCall / Math.max(pot + toCall, 1);
    const bluff = this.shouldBluff(player, stage, activeOpponents, pressure, params);

    if (toCall <= 0) {
      if (strength >= params.valueBet || bluff) {
        return new Action(ActionKind.BET, this.betSize(pot, bigBlind, strength, bluff));
      }
      return new Action(ActionKind.CHECK_CALL);
    }

    if (strength >= params.raiseValue && pressure < 0.55) {
      if (this.rng.next() < params.raiseRate) {
        return new Action(ActionKind.RAISE, currentBet + this.betSize(pot, bigBlind, strength, false));
      }
      return new Action(ActionKind.CHECK_CALL);
    }

    if (bluff && pressure < params.bluffPressureCap) {
      return new Action(ActionKind.RAISE, currentBet + Math.max(bigBlind, Math.floor(pot / 3)));
    }

    const callThreshold = params.callBase + strength * params.callStrengthWeight;
    return pressure <= callThreshold ? new Action(ActionKind.CHECK_CALL) : new Action(ActionKind.FOLD);
  }

  params(difficulty) {
    if (difficulty === "简单") {
      return { valueBet: 0.66, raiseValue: 0.82, raiseRate: 0.25, callBase: 0.08, callStrengthWeight: 0.38, bluff: 0.03, bluffPressureCap: 0.18 };
    }
    if (difficulty === "困难") {
      return { valueBet: 0.54, raiseValue: 0.74, raiseRate: 0.55, callBase: 0.16, callStrengthWeight: 0.55, bluff: 0.12, bluffPressureCap: 0.32 };
    }
    return { valueBet: 0.6, raiseValue: 0.78, raiseRate: 0.4, callBase: 0.12, callStrengthWeight: 0.46, bluff: 0.07, bluffPressureCap: 0.25 };
  }

  strength(hole, board, stage) {
    if (stage === Stage.PREFLOP) {
      const [a, b] = hole.map((card) => card.rank).sort((x, y) => y - x);
      const suited = hole[0].suit === hole[1].suit;
      if (a === b) return Math.min(0.58 + a / 28, 0.98);
      let score = (a + b) / 30;
      if (suited) score += 0.06;
      if (Math.abs(a - b) === 1) score += 0.04;
      return Math.min(score, 0.82);
    }
    const score = HandEvaluator.best([...hole, ...board]);
    return Math.min(score.category / 9 + score.tiebreakers.slice(0, 2).reduce((sum, value) => sum + value, 0) / 224, 1);
  }

  shouldBluff(player, stage, activeOpponents, pressure, params) {
    if (player.bluffStreak >= 2) return false;
    const stageFactor = stage === Stage.PREFLOP ? 0.45 : 1;
    const opponentFactor = activeOpponents <= 1 ? 1.4 : activeOpponents === 2 ? 1 : 0.65;
    const pressureFactor = Math.max(0.2, 1 - pressure * 2);
    return this.rng.next() < params.bluff * stageFactor * opponentFactor * pressureFactor;
  }

  betSize(pot, bigBlind, strength, bluff) {
    let base = Math.max(bigBlind, Math.floor(pot / (bluff ? 3 : 2)));
    if (strength > 0.85) base = Math.max(base, Math.floor(pot * 0.75));
    return Math.max(bigBlind, base + this.rng.int(0, Math.max(bigBlind, base)));
  }
}

class GameEngine {
  constructor(config = {}, options = {}) {
    this.config = {
      playerCount: config.playerCount ?? 6,
      initialStack: config.initialStack ?? 1000,
      smallBlind: config.smallBlind ?? 5,
      bigBlind: config.bigBlind ?? 10,
      underwater: config.underwater ?? true,
      difficulty: config.difficulty ?? "普通",
      pauseBetweenStreets: config.pauseBetweenStreets ?? true,
    };
    if (this.config.playerCount < 2 || this.config.playerCount > 9) {
      throw new Error("人数必须在 2-9 之间");
    }
    this.rng = options.rng ?? new Random();
    this.readInput = options.readInput;
    this.writeOutput = options.writeOutput ?? ((text) => console.log(text));
    this.players = [
      new Player("你", true, this.config.initialStack),
      ...Array.from({ length: this.config.playerCount - 1 }, (_, i) => new Player(`AI-${i + 1}`, false, this.config.initialStack)),
    ];
    this.dealer = this.rng.int(0, this.players.length - 1);
    this.handNo = 0;
    this.deck = null;
    this.board = [];
    this.stage = Stage.PREFLOP;
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.config.bigBlind;
    this.actionIndex = null;
    this.pendingHumanRaw = null;
    this.logs = [];
    this.bot = new BotPlayer(this.rng);
    this.quitRequested = false;
  }

  async run() {
    this.writeOutput("\n德州扑克开始。输入“退出”或 q 可随时结束。");
    while (!this.quitRequested) {
      await this.playHand();
      if (this.quitRequested) break;
      const answer = (await this.readInput("\n继续下一手？直接回车继续，输入 退出/q 结束：")).trim().toLowerCase();
      if (["退出", "q", "quit"].includes(answer)) break;
    }
    this.writeOutput("游戏结束。");
  }

  async playHand() {
    this.handNo += 1;
    this.stage = Stage.PREFLOP;
    this.board = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.config.bigBlind;
    this.logs = [];
    this.deck = new Deck(this.rng);
    this.deck.shuffle();
    for (const player of this.players) {
      player.eliminated = !this.config.underwater && player.stack <= 0;
      if (this.config.underwater && player.stack <= 0) this.borrowOneHand(player);
      player.resetForHand();
      if (player.eliminated) {
        player.folded = true;
        player.lastAction = "已淘汰";
      }
    }
    if (this.activeSeatIndices().length < 2) {
      this.writeOutput("可继续游戏的玩家不足 2 人，游戏结束。");
      this.quitRequested = true;
      return;
    }
    if (this.players[this.dealer].eliminated) this.dealer = this.nextActiveIndex(this.dealer);

    const [smallBlindIdx, bigBlindIdx] = this.blindIndices();
    this.postBlind(smallBlindIdx, this.config.smallBlind, "小盲");
    this.postBlind(bigBlindIdx, this.config.bigBlind, "大盲");
    this.currentBet = this.players[bigBlindIdx].currentBet;

    for (let i = 0; i < 2; i += 1) {
      for (const player of this.players) {
        if (!player.eliminated) player.hole.push(...this.deck.deal(1));
      }
    }

    await this.bettingRound(this.nextIndex(bigBlindIdx));
    if (this.quitRequested) return;
    if (this.activeCount() > 1) {
      this.dealBoard(3);
      this.stage = Stage.FLOP;
      this.resetStreetBets();
      await this.pauseForStreet();
      await this.bettingRound(this.nextIndex(this.dealer));
    }
    if (this.quitRequested) return;
    if (this.activeCount() > 1) {
      this.dealBoard(1);
      this.stage = Stage.TURN;
      this.resetStreetBets();
      await this.pauseForStreet();
      await this.bettingRound(this.nextIndex(this.dealer));
    }
    if (this.quitRequested) return;
    if (this.activeCount() > 1) {
      this.dealBoard(1);
      this.stage = Stage.RIVER;
      this.resetStreetBets();
      await this.pauseForStreet();
      await this.bettingRound(this.nextIndex(this.dealer));
    }
    if (this.quitRequested) return;
    this.stage = Stage.SHOWDOWN;
    this.settleHand();
    this.dealer = this.nextActiveIndex(this.dealer);
  }

  postBlind(idx, amount, label) {
    const player = this.players[idx];
    const committed = this.commit(player, amount);
    player.currentBet += committed;
    this.logs.push(`${player.name} 支付${label} ${committed}`);
  }

  borrowOneHand(player) {
    player.stack = this.config.initialStack;
    player.underwaterHands += 1;
    player.underwaterDebt += this.config.initialStack;
    player.lastAction = `水下${player.underwaterHands}手`;
    this.logs.push(`${player.name} 水下借入一手 ${this.config.initialStack}`);
  }

  dealBoard(count) {
    this.board.push(...this.deck.deal(count));
    this.logs.push(`发公共牌：${formatCards(this.board)}`);
  }

  resetStreetBets() {
    this.currentBet = 0;
    for (const player of this.players) player.resetForStreet();
  }

  async pauseForStreet() {
    const human = this.players.find((player) => player.isHuman);
    if (!this.config.pauseBetweenStreets || !human || !human.active || human.allIn) return;

    this.writeOutput(this.renderState());
    const raw = (await this.readInput("\n按回车进入本轮行动，也可直接输入本轮动作 / Enter or action: ")).trim();
    if (raw) this.pendingHumanRaw = raw;
  }

  async bettingRound(startIdx) {
    const acted = new Set();
    let idx = this.nextActionableIndex(startIdx - 1);
    while (idx !== null && this.activeCount() > 1) {
      if (this.roundComplete(acted)) return;
      const player = this.players[idx];
      let action;
      this.actionIndex = idx;
      if (player.isHuman) {
        action = await this.readHumanAction(player);
        if (action.kind === ActionKind.QUIT) {
          this.quitRequested = true;
          this.actionIndex = null;
          return;
        }
        if (action.kind === ActionKind.STATUS) {
          this.writeOutput(this.renderState());
          continue;
        }
      } else {
        action = this.normalizeAction(
          player,
          this.bot.decide({
          player,
          players: this.players,
          board: this.board,
          stage: this.stage,
          pot: this.pot,
          toCall: this.currentBet - player.currentBet,
          currentBet: this.currentBet,
          bigBlind: this.config.bigBlind,
          difficulty: this.config.difficulty,
          }),
        );
      }
      const raised = this.applyAction(idx, action);
      this.actionIndex = null;
      if (raised) {
        acted.clear();
        acted.add(idx);
      } else {
        acted.add(idx);
      }
      idx = this.nextActionableIndex(idx);
    }
  }

  async readHumanAction(player) {
    while (true) {
      this.writeOutput(this.renderState());
      const raw = this.pendingHumanRaw ?? (await this.readInput("> "));
      this.pendingHumanRaw = null;
      try {
        const action = this.normalizeAction(player, InputParser.parse(raw));
        if ([ActionKind.STATUS, ActionKind.QUIT].includes(action.kind)) return action;
        this.validateAction(player, action);
        return action;
      } catch (error) {
        this.writeOutput(`输入无效：${error.message}`);
      }
    }
  }

  normalizeAction(player, action) {
    if (action.kind === ActionKind.BET && this.currentBet > 0) {
      return new Action(ActionKind.RAISE, action.amount);
    }
    if (action.kind === ActionKind.RAISE && this.currentBet <= 0) {
      return new Action(ActionKind.BET, action.amount);
    }
    return action;
  }

  validateAction(player, action) {
    const toCall = this.currentBet - player.currentBet;
    const additional = action.amount ? action.amount - player.currentBet : 0;
    if (action.kind === ActionKind.BET) {
      if (this.currentBet > 0) throw new Error("当前已有下注，请使用“跟注”或“加注”");
      if (!action.amount || action.amount < this.config.bigBlind) throw new Error(`下注至少为大盲 ${this.config.bigBlind}`);
      if (additional > player.stack) throw new Error("筹码不足，请选择全下");
    }
    if (action.kind === ActionKind.RAISE) {
      if (this.currentBet <= 0) throw new Error("当前无人下注，请使用“下注”");
      if (!action.amount || action.amount <= this.currentBet) throw new Error(`加注金额必须高于当前最高下注 ${this.currentBet}`);
      if (additional > player.stack) throw new Error("筹码不足，请选择全下");
    }
    if (action.kind === ActionKind.CHECK_CALL && toCall > player.stack) {
      throw new Error("筹码不足以跟注，请选择全下");
    }
  }

  applyAction(idx, action) {
    const player = this.players[idx];
    const toCall = this.currentBet - player.currentBet;
    let raised = false;

    if (action.kind === ActionKind.FOLD) {
      player.folded = true;
      player.lastAction = "弃牌";
      this.logs.push(`${player.name} 弃牌`);
      return false;
    }
    if (action.kind === ActionKind.CHECK_CALL) {
      if (toCall <= 0) {
        player.lastAction = "过牌";
        this.logs.push(`${player.name} 过牌`);
      } else {
        const committed = this.commit(player, toCall);
        player.currentBet += committed;
        player.lastAction = `跟注 ${committed}`;
        this.logs.push(`${player.name} 跟注 ${committed}`);
      }
      return false;
    }
    if (action.kind === ActionKind.BET) {
      const committed = this.commit(player, action.amount);
      player.currentBet += committed;
      this.currentBet = player.currentBet;
      player.lastAction = `下注 ${this.currentBet}`;
      this.logs.push(`${player.name} 下注 ${this.currentBet}`);
      raised = true;
    }
    if (action.kind === ActionKind.RAISE) {
      const committed = this.commit(player, action.amount - player.currentBet);
      player.currentBet += committed;
      if (player.currentBet > this.currentBet) {
        this.currentBet = player.currentBet;
        player.lastAction = `加注到 ${player.currentBet}`;
        this.logs.push(`${player.name} 加注到 ${player.currentBet}`);
        raised = true;
      } else {
        player.lastAction = `全下到 ${player.currentBet}`;
        this.logs.push(`${player.name} 全下到 ${player.currentBet}`);
      }
    }
    if (action.kind === ActionKind.ALL_IN) {
      const committed = this.commit(player, this.allInAmount(player));
      player.currentBet += committed;
      player.allIn = true;
      player.lastAction = `全下到 ${player.currentBet}`;
      if (player.currentBet > this.currentBet) {
        this.currentBet = player.currentBet;
        raised = true;
      }
      this.logs.push(`${player.name} 全下到 ${player.currentBet}`);
    }
    if (raised && !player.isHuman) {
      if (this.isLikelyBluff(player)) player.bluffStreak += 1;
      else player.bluffStreak = 0;
    }
    return raised;
  }

  commit(player, amount) {
    if (amount <= 0) return 0;
    let committed = amount;
    if (amount >= player.stack) {
      committed = Math.max(0, player.stack);
      player.allIn = true;
    }
    player.stack -= committed;
    player.totalBet += committed;
    this.pot += committed;
    return committed;
  }

  allInAmount(player) {
    return Math.max(0, player.stack);
  }

  settleHand() {
    const active = this.players.map((player, idx) => ({ player, idx })).filter(({ player }) => player.active);
    this.writeOutput(this.renderState(true));
    if (active.length === 1) {
      active[0].player.stack += this.pot;
      this.logs.push(`${active[0].player.name} 赢得底池 ${this.pot}`);
      this.writeOutput(`\n本手结束：${active[0].player.name} 获胜，赢得 ${this.pot}。`);
      this.writeOutput(this.renderHandReview());
      this.pot = 0;
      return;
    }

    const scores = new Map();
    for (const { player, idx } of active) {
      scores.set(idx, HandEvaluator.best([...player.hole, ...this.board]));
    }
    this.settlePots(scores);
    const winners = this.bestPlayers(active, scores);
    const winnerIndexes = new Set(winners.map(({ idx }) => idx));
    const lines = ["\n摊牌结果：", "玩家        手牌                 牌型", "----------  -------------------  --------"];
    for (const { player, idx } of active) {
      const score = scores.get(idx);
      lines.push(`${this.playerReviewName(player, idx, winnerIndexes).padEnd(10, " ")}  ${formatCards(player.hole).padEnd(19, " ")}  ${score.name()}`);
    }
    lines.push("结算完成。");
    this.writeOutput(lines.join("\n"));
    this.writeOutput(this.renderHandReview(scores));
    this.pot = 0;
  }

  renderHandReview(scores = null) {
    const fullBoard = [...this.board, ...this.deck.cards.slice(0, Math.max(0, 5 - this.board.length))];
    const lines = [
      "",
      "本手复盘：",
      `完整公共牌：${formatCards(fullBoard)}`,
      "",
      "玩家手牌：",
      "位置   玩家        状态     手牌                 牌型",
      "-----  ----------  -------  -------------------  --------",
    ];
    const winnerIndexes = scores ? new Set(this.bestPlayers(this.players.map((player, idx) => ({ player, idx })).filter(({ player }) => player.active), scores).map(({ idx }) => idx)) : new Set();
    for (const [idx, player] of this.players.entries()) {
      const score = scores?.get(idx);
      const handName = score ? score.name() : "-";
      lines.push(`${this.positionName(idx).padEnd(5, " ")}  ${this.playerReviewName(player, idx, winnerIndexes).padEnd(10, " ")}  ${this.reviewStatus(player).padEnd(7, " ")}  ${formatCards(player.hole).padEnd(19, " ")}  ${handName}`);
    }
    return lines.join("\n");
  }

  playerReviewName(player, idx, winnerIndexes) {
    return winnerIndexes.has(idx) ? `${player.name}(赢家)` : player.name;
  }

  bestPlayers(active, scores) {
    let best = active[0];
    for (const item of active.slice(1)) {
      if (scores.get(item.idx).compare(scores.get(best.idx)) > 0) best = item;
    }
    return active.filter((item) => scores.get(item.idx).compare(scores.get(best.idx)) === 0);
  }

  reviewStatus(player) {
    let status;
    if (player.eliminated) status = "已淘汰";
    else if (player.folded) status = "已弃牌";
    else if (player.allIn) status = "已全下";
    else status = "未弃牌";
    const underwater = this.underwaterLabel(player);
    return underwater ? `${status} ${underwater}` : status;
  }

  settlePots(scores) {
    const levels = [...new Set(this.players.map((p) => p.totalBet).filter((bet) => bet > 0))].sort((a, b) => a - b);
    let previous = 0;
    for (const level of levels) {
      const contributors = this.players.map((player, idx) => ({ player, idx })).filter(({ player }) => player.totalBet >= level);
      const amount = (level - previous) * contributors.length;
      const eligible = contributors.filter(({ player }) => player.active);
      if (!eligible.length || amount <= 0) {
        previous = level;
        continue;
      }
      let best = eligible[0];
      for (const item of eligible.slice(1)) {
        if (scores.get(item.idx).compare(scores.get(best.idx)) > 0) best = item;
      }
      const winners = eligible.filter((item) => scores.get(item.idx).compare(scores.get(best.idx)) === 0);
      const share = Math.floor(amount / winners.length);
      let remainder = amount % winners.length;
      for (const { player } of winners) {
        player.stack += share + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
      }
      this.logs.push(`${winners.map(({ player }) => player.name).join("、")} 分得底池 ${amount}`);
      previous = level;
    }
  }

  renderState(showAll = false) {
    const human = this.players[0];
    const divider = "------------------------------------------------------------";
    const lines = [
      "",
      divider,
      `第 ${this.handNo} 手 | ${this.stage} | 你的位置：${this.positionLabel(0)}`,
      divider,
      `公共牌：${formatCards(this.board)}`,
      `你的手牌：${formatCards(human.hole)}`,
      "",
      divider,
      `底池：${this.pot}`,
      `当前最高下注：${this.currentBet}`,
      `你需要跟注：${Math.max(0, this.currentBet - human.currentBet)}`,
      "",
      divider,
      "座位：",
      "标记  位置   玩家    筹码   本轮   状态",
      "----  -----  ------  -----  -----  ------",
    ];
    for (const [idx, player] of this.players.entries()) {
      lines.push(
        `${this.seatMark(idx).padEnd(4, " ")}  ${this.positionName(idx).padEnd(5, " ")}  ${player.name.padEnd(6, " ")}  ${String(player.stack).padEnd(5, " ")}  ${String(player.currentBet).padEnd(5, " ")}  ${this.playerStatus(player, idx)}`,
      );
    }
    lines.push("", divider, "最近行动：");
    lines.push(...(this.logs.length ? this.logs.slice(-6) : ["无"]));
    if (this.stage !== Stage.SHOWDOWN) {
      lines.push("", divider, `请输入：${this.commandPrompt()}`);
    }
    lines.push(divider);
    return lines.join("\n");
  }

  commandPrompt() {
    const human = this.players[0];
    const toCall = Math.max(0, this.currentBet - human.currentBet);
    if (toCall > 0) {
      return "弃牌/f，跟注/c，加注 金额/r 金额，全下/a，状态/s，退出/q";
    }
    if (this.currentBet > 0) {
      return "弃牌/f，过牌/c，加注 金额/r 金额，全下/a，状态/s，退出/q";
    }
    return "弃牌/f，过牌/c，下注 金额/b 金额，全下/a，状态/s，退出/q";
  }

  playerStatus(player, idx) {
    let status;
    if (player.eliminated) status = "已淘汰";
    else if (player.folded) status = "已弃牌";
    else if (player.allIn) status = "已全下";
    else if (idx === this.actionIndex) status = "行动中";
    else status = player.lastAction || "等待";
    const underwater = this.underwaterLabel(player);
    return underwater ? `${status} ${underwater}` : status;
  }

  underwaterLabel(player) {
    if (!player.underwaterHands || !player.underwaterDebt) return "";
    return `水下${player.underwaterHands}手（-${player.underwaterDebt}）`;
  }

  seatMark(idx) {
    const [smallBlindIdx, bigBlindIdx] = this.blindIndices();
    const marks = [];
    if (idx === this.dealer) marks.push("庄");
    if (idx === smallBlindIdx) marks.push("小");
    if (idx === bigBlindIdx) marks.push("大");
    return marks.join("");
  }

  positionLabel(idx) {
    const aliases = {
      BTN: "BTN（按钮位）",
      SB: "SB（小盲）",
      BB: "BB（大盲）",
      UTG: "UTG（枪口位）",
      MP: "MP（中位）",
      HJ: "HJ（劫位）",
      CO: "CO（关煞位）",
    };
    const position = this.positionName(idx);
    return aliases[position] ?? position;
  }

  positionName(idx) {
    if (this.players[idx].eliminated) return "-";
    const [smallBlindIdx, bigBlindIdx] = this.blindIndices();
    if (idx === this.dealer) return "BTN";
    if (idx === smallBlindIdx) return "SB";
    if (idx === bigBlindIdx) return "BB";

    const activeSeats = this.activeSeatIndices();
    const labelsByCount = {
      4: ["UTG"],
      5: ["UTG", "CO"],
      6: ["UTG", "MP", "CO"],
      7: ["UTG", "MP", "HJ", "CO"],
      8: ["UTG", "UTG+1", "MP", "HJ", "CO"],
      9: ["UTG", "UTG+1", "MP1", "MP2", "HJ", "CO"],
    };
    const labels = labelsByCount[activeSeats.length] ?? [];
    let offset = 0;
    let seat = this.nextActiveIndex(bigBlindIdx);
    while (seat !== this.dealer) {
      if (seat === idx) return labels[offset] ?? `P${offset + 1}`;
      offset += 1;
      seat = this.nextActiveIndex(seat);
    }
    return "";
  }

  roundComplete(acted) {
    return this.players.every((player, idx) => !player.active || player.allIn || (player.currentBet === this.currentBet && acted.has(idx)));
  }

  activeCount() {
    return this.players.filter((player) => player.active).length;
  }

  activeSeatIndices() {
    return this.players.map((player, idx) => ({ player, idx })).filter(({ player }) => !player.eliminated).map(({ idx }) => idx);
  }

  nextIndex(idx) {
    return (idx + 1 + this.players.length) % this.players.length;
  }

  nextActiveIndex(idx) {
    for (let step = 1; step <= this.players.length; step += 1) {
      const next = (idx + step + this.players.length) % this.players.length;
      if (!this.players[next].eliminated) return next;
    }
    return idx;
  }

  nextActionableIndex(idx) {
    if (this.players.every((player) => !player.active || player.allIn)) return null;
    for (let step = 1; step <= this.players.length; step += 1) {
      const next = (idx + step + this.players.length) % this.players.length;
      const player = this.players[next];
      if (player.active && !player.allIn) return next;
    }
    return null;
  }

  blindIndices() {
    const activeSeats = this.activeSeatIndices();
    if (activeSeats.length === 2) return [this.dealer, this.nextActiveIndex(this.dealer)];
    const small = this.nextActiveIndex(this.dealer);
    return [small, this.nextActiveIndex(small)];
  }

  isLikelyBluff(player) {
    if (player.isHuman || this.board.length < 3) return false;
    return this.bot.strength(player.hole, this.board, this.stage) < 0.35;
  }
}

function* combinations(items, size, start = 0, prefix = []) {
  if (prefix.length === size) {
    yield prefix;
    return;
  }
  for (let i = start; i <= items.length - (size - prefix.length); i += 1) {
    yield* combinations(items, size, i + 1, [...prefix, items[i]]);
  }
}

function straightHighCard(ranks) {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i += 1) {
    const window = unique.slice(i, i + 5);
    if (window[0] - window[4] === 4 && new Set(window).size === 5) return window[0];
  }
  return null;
}

function parseAmount(raw) {
  const amount = Number.parseInt(raw, 10);
  if (!Number.isInteger(amount) || String(amount) !== raw || amount <= 0) {
    throw new Error("金额必须是大于 0 的整数");
  }
  return amount;
}

function formatCards(cards) {
  return cards.length ? cards.map((card) => card.text()).join(" ") : "无";
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

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  Action,
  ActionKind,
  BotPlayer,
  Card,
  Deck,
  GameEngine,
  HandEvaluator,
  HandScore,
  InputParser,
  Random,
  Stage,
  formatCards,
};
