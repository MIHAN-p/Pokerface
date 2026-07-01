const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const net = require("node:net");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SUITS = ["S", "H", "D", "C"];
const SUIT_NAMES = { S: "黑桃", H: "红桃", D: "方片", C: "梅花" };
const SUIT_ICONS = { S: "\u2660", H: "\u2665", D: "\u2666", C: "\u2663" };
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
    return `${RANK_NAMES[this.rank]}${SUIT_ICONS[this.suit]}${SUIT_NAMES[this.suit]}`;
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
      lines.push("", divider, `你的手牌：${formatCards(human.hole)}`, `请输入：${this.commandPrompt()}`);
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

class OnlineGameEngine extends GameEngine {
  constructor(seats, config = {}, options = {}) {
    super(
      {
        ...config,
        playerCount: seats.length,
        pauseBetweenStreets: false,
      },
      {
        rng: options.rng ?? new Random(),
        writeOutput: () => {},
      },
    );
    this.seatOrder = seats.map((seat) => seat.index);
    this.players = seats.map((seat) => {
      const player = new Player(seat.displayName, seat.type === "human", seat.stack ?? this.config.initialStack);
      player.seatIndex = seat.index;
      player.botConfig = seat.botConfig ?? null;
      return player;
    });
    this.actionState = null;
    this.handFinished = false;
    this.lastHandResult = null;
  }

  startHand() {
    this.handNo += 1;
    this.stage = Stage.PREFLOP;
    this.board = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.config.bigBlind;
    this.logs = [];
    this.deck = new Deck(this.rng);
    this.deck.shuffle();
    this.actionState = { acted: new Set() };
    this.handFinished = false;
    this.lastHandResult = null;

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
      throw new Error("至少需要 2 个可参与座位才能开局");
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

    this.actionIndex = this.nextActionableIndex(this.nextIndex(bigBlindIdx) - 1);
    this.advanceBots();
  }

  applySeatAction(seatIndex, action) {
    if (this.handFinished) throw new Error("本手已经结束，请由房主开始下一手");
    const playerIndex = this.players.findIndex((player) => player.seatIndex === seatIndex);
    if (playerIndex < 0) throw new Error("该座位不在当前牌局中");
    if (playerIndex !== this.actionIndex) throw new Error("还没有轮到该座位行动");
    const player = this.players[playerIndex];
    if (!player.isHuman) throw new Error("AI 座位不能提交真人动作");
    const normalized = this.normalizeAction(player, action);
    this.validateAction(player, normalized);
    const raised = this.applyAction(playerIndex, normalized);
    this.afterAction(playerIndex, raised);
    this.advanceBots();
  }

  advanceBots() {
    let guard = 0;
    while (!this.handFinished && this.actionIndex !== null && guard < 200) {
      guard += 1;
      const player = this.players[this.actionIndex];
      if (player.isHuman) return;
      const difficulty = player.botConfig?.difficulty ?? this.config.difficulty;
      const proposed = this.normalizeAction(
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
          difficulty,
        }),
      );
      const action = this.safeBotAction(player, proposed);
      this.validateAction(player, action);
      const raised = this.applyAction(this.actionIndex, action);
      this.afterAction(this.actionIndex, raised);
    }
    if (guard >= 200) throw new Error("AI 推进超过安全上限");
  }

  safeBotAction(player, action) {
    try {
      this.validateAction(player, action);
      return action;
    } catch {
      const toCall = this.currentBet - player.currentBet;
      if (player.stack > 0 && toCall >= player.stack) return new Action(ActionKind.ALL_IN);
      if (toCall <= 0) return new Action(ActionKind.CHECK_CALL);
      return new Action(ActionKind.FOLD);
    }
  }

  afterAction(playerIndex, raised) {
    if (this.activeCount() <= 1) {
      this.finishHand();
      return;
    }
    if (raised) {
      this.actionState.acted.clear();
      this.actionState.acted.add(playerIndex);
    } else {
      this.actionState.acted.add(playerIndex);
    }
    if (this.roundComplete(this.actionState.acted)) {
      this.advanceStreet();
      return;
    }
    this.actionIndex = this.nextActionableIndex(playerIndex);
  }

  advanceStreet() {
    if (this.activeCount() <= 1) {
      this.finishHand();
      return;
    }
    const needsMoreCards = this.board.length < 5;
    const everyoneAllIn = this.players.every((player) => !player.active || player.allIn);
    if (everyoneAllIn) {
      while (this.board.length < 5) this.dealBoard(this.board.length === 0 ? 3 : 1);
      this.finishHand();
      return;
    }
    if (this.stage === Stage.PREFLOP) {
      this.dealBoard(3);
      this.stage = Stage.FLOP;
    } else if (this.stage === Stage.FLOP) {
      this.dealBoard(1);
      this.stage = Stage.TURN;
    } else if (this.stage === Stage.TURN) {
      this.dealBoard(1);
      this.stage = Stage.RIVER;
    } else if (this.stage === Stage.RIVER || !needsMoreCards) {
      this.finishHand();
      return;
    }
    this.resetStreetBets();
    this.actionState.acted.clear();
    this.actionIndex = this.nextActionableIndex(this.dealer);
  }

  finishHand() {
    this.stage = Stage.SHOWDOWN;
    this.actionIndex = null;
    this.handFinished = true;
    const finalPot = this.pot;
    const active = this.players.map((player, idx) => ({ player, idx })).filter(({ player }) => player.active);

    if (active.length === 1) {
      active[0].player.stack += this.pot;
      this.logs.push(`${active[0].player.name} 赢得底池 ${this.pot}`);
      this.lastHandResult = {
        winners: [active[0].player.seatIndex],
        pot: finalPot,
        revealed: {},
        summary: `${active[0].player.name} 获胜，赢得 ${finalPot}`,
      };
      this.pot = 0;
      this.dealer = this.nextActiveIndex(this.dealer);
      return;
    }

    const scores = new Map();
    for (const { player, idx } of active) {
      scores.set(idx, HandEvaluator.best([...player.hole, ...this.board]));
    }
    this.settlePots(scores);
    const winners = this.bestPlayers(active, scores);
    const revealed = {};
    for (const { player, idx } of active) {
      revealed[player.seatIndex] = {
        cards: player.hole.map(cardToDto),
        handName: scores.get(idx).name(),
      };
    }
    this.lastHandResult = {
      winners: winners.map(({ player }) => player.seatIndex),
      pot: finalPot,
      revealed,
      summary: `${winners.map(({ player }) => player.name).join("、")} 分得底池 ${finalPot}`,
    };
    this.pot = 0;
    this.dealer = this.nextActiveIndex(this.dealer);
  }

  publicSnapshot(viewerSeatIndex = null) {
    const actionPlayer = this.actionIndex === null ? null : this.players[this.actionIndex];
    return {
      handNo: this.handNo,
      stage: this.stage,
      board: this.board.map(cardToDto),
      pot: this.pot,
      currentBet: this.currentBet,
      actionSeatIndex: actionPlayer?.seatIndex ?? null,
      actionPlayerName: actionPlayer?.name ?? null,
      logs: this.logs.slice(-8),
      handFinished: this.handFinished,
      lastHandResult: this.lastHandResult,
      players: this.players.map((player, idx) => ({
        seatIndex: player.seatIndex,
        name: player.name,
        type: player.isHuman ? "human" : "bot",
        stack: player.stack,
        currentBet: player.currentBet,
        totalBet: player.totalBet,
        folded: player.folded,
        allIn: player.allIn,
        eliminated: player.eliminated,
        status: this.playerStatus(player, idx),
        position: this.positionName(idx),
        marks: this.seatMark(idx),
        hole:
          player.seatIndex === viewerSeatIndex || this.lastHandResult?.revealed?.[player.seatIndex]
            ? player.hole.map(cardToDto)
            : null,
        handName: this.lastHandResult?.revealed?.[player.seatIndex]?.handName ?? null,
      })),
      legalActions: viewerSeatIndex === actionPlayer?.seatIndex ? this.legalActions(this.players[this.actionIndex]) : [],
    };
  }

  legalActions(player) {
    const toCall = Math.max(0, this.currentBet - player.currentBet);
    const actions = [{ kind: ActionKind.FOLD, label: "弃牌/f" }, { kind: ActionKind.ALL_IN, label: "全下/a" }];
    if (toCall > 0) {
      actions.push({ kind: ActionKind.CHECK_CALL, label: "跟注/c" });
      if (player.stack > toCall) actions.push({ kind: ActionKind.RAISE, label: "加注/r 金额" });
    } else if (this.currentBet > 0) {
      actions.push({ kind: ActionKind.CHECK_CALL, label: "过牌/c" }, { kind: ActionKind.RAISE, label: "加注/r 金额" });
    } else {
      actions.push({ kind: ActionKind.CHECK_CALL, label: "过牌/c" }, { kind: ActionKind.BET, label: "下注/b 金额" });
    }
    return actions;
  }
}

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
    this.requireHost(sessionId);
    if (!this.engine?.handFinished) throw new Error("当前手牌尚未结束");
    this.syncStacksFromEngine();
    this.fillEmptySeatsWithBots();
    this.engine = new OnlineGameEngine(this.seats.filter((seat) => seat.type !== "empty"), this.config);
    this.engine.startHand();
    this.status = "playing";
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
      if (seat) seat.stack = player.stack;
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
    let roomCode;
    do {
      roomCode = String(crypto.randomInt(100000, 1000000));
    } while (this.rooms.has(roomCode));
    const room = new PokerRoom({ roomCode, hostSessionId: sessionId, config });
    room.addSession({ sessionId, displayName, isHost: true, socket });
    room.sit(sessionId, 1);
    this.rooms.set(roomCode, room);
    return room;
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

class PokerServer {
  constructor({ host = "0.0.0.0", port = 3000, adminToken, allowMultipleRooms = false } = {}) {
    this.host = host;
    this.port = port;
    this.manager = new RoomManager({ adminToken, allowMultipleRooms });
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

class TelnetPokerServer {
  constructor({ host = "0.0.0.0", port = 80 } = {}) {
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
    socket.write(Buffer.from([255, 251, 1, 255, 251, 3]));
    socket.write("欢迎来到 Pokerface 纯终端联机桌。\r\n");
    socket.write("本模式支持 nc/telnet，朋友不需要拉代码。\r\n\r\n");

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
    if (this.manager.rooms.size === 0 && this.pendingHost) {
      socket.write("房主正在创建房间，请稍后重新连接。\r\n");
      socket.end();
      return;
    }
    if (state.isHost) {
      this.pendingHost = true;
      socket.write("你是第一个连接的玩家，将成为房主。\r\n");
      this.prompt(state, "昵称（默认 房主）：");
    } else {
      this.prompt(state, "昵称（默认 玩家）：");
    }

    socket.on("data", (chunk) => this.handleData(state, chunk));
    socket.on("close", () => this.disconnect(state));
    socket.on("error", () => this.disconnect(state));
  }

  handleData(state, chunk) {
    const text = decodeTelnetInput(chunk);
    if (!text) return;
    state.socket.write(text.replace(/\n/g, "\r\n"));
    state.buffer += text.replace(/\r/g, "");
    const lines = state.buffer.split("\n");
    state.buffer = lines.pop();
    for (const line of lines) this.handleLine(state, line.trim());
  }

  handleLine(state, text) {
    try {
      if (state.step === "name") {
        state.displayName = text || (state.isHost ? "房主" : "玩家");
        if (state.isHost) {
          state.step = "playerCount";
          this.prompt(state, "总座位数 2-9（默认 6）：");
        } else {
          const room = [...this.manager.rooms.values()][0];
          if (!room) throw new Error("房间还不存在，请稍后重新连接");
          state.room = this.manager.joinRoom({
            roomCode: room.roomCode,
            sessionId: state.sessionId,
            displayName: state.displayName,
            socket: state.socket,
          });
          state.step = "command";
          sendText(state.socket, `已加入房间 ${state.room.roomCode}。输入 sit 位置 入座。`);
          state.room.broadcast();
        }
        return;
      }

      if (this.handleHostConfigLine(state, text)) return;

      if (state.step === "command") {
        if (!text) {
          sendSnapshot(state.socket, state.room.snapshotFor(state.sessionId));
          return;
        }
        if (["q", "退出", "quit"].includes(text.toLowerCase())) {
          state.socket.end("已断开。\r\n");
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
      playerCount: 6,
      initialStack: 1000,
      smallBlind: 5,
      bigBlind: 10,
      underwater: true,
      actionTimeoutSeconds: 60,
      difficulty: "普通",
    };
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
      this.prompt(state, "行动超时秒数（默认 60）：");
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
      state.room.broadcast();
    }
  }

  prompt(state, text) {
    if (text) state.socket.write(text);
  }
}

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
      console.log("\n服务器已断开。");
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
      reconnectCode: this.session?.reconnectCode,
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

function cardToDto(card) {
  return { rank: card.rank, suit: card.suit, text: card.text() };
}

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
  if (socket._pokerfaceTextClient) {
    sendText(socket, renderOnlineSnapshot(snapshot));
    socket.write("> ");
    return;
  }
  sendJson(socket, snapshot);
}

function sendText(socket, text) {
  socket.write(`${text.replace(/\n/g, "\r\n")}\r\n`);
}

function decodeTelnetInput(chunk) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
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
  if (["s", "状态", "status"].includes(lower)) return { type: "room_snapshot" };
  const parts = text.split(/\s+/);
  if (["入座", "sit"].includes(parts[0])) return { type: "sit_down", seatIndex: parseSeatIndex(parts[1]) };
  if (["离座", "leave"].includes(parts[0])) return { type: "leave_seat" };
  if (["开始", "start"].includes(parts[0])) return { type: "start_game" };
  if (["下一手", "next"].includes(parts[0])) return { type: "next_hand" };
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
    actionTimeoutSeconds: clampInt(config.actionTimeoutSeconds ?? 60, 5),
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

function parseEndpoint(endpoint) {
  const [host, rawPort] = String(endpoint || "").split(":");
  if (!host) throw new Error("服务器地址不能为空");
  const port = Number.parseInt(rawPort || "3000", 10);
  if (!Number.isInteger(port) || port <= 0) throw new Error("端口格式错误");
  return { host, port };
}

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
  const actionTimeoutSeconds = await askInt(rl, "行动超时秒数", 60, 5);
  const difficulty = await askDifficulty(rl);
  return { playerCount, initialStack, smallBlind, bigBlind, underwater, actionTimeoutSeconds, difficulty };
}

function renderOnlineSnapshot(snapshot) {
  const { room, you, game } = snapshot;
  const divider = "=".repeat(72);
  const section = "-".repeat(72);
  const roomStatus = game?.handFinished ? "手牌结束" : room.status === "waiting" ? "等待中" : "牌局中";
  const lines = ["", divider, `房间 ${room.roomCode} | ${roomStatus}`];
  lines.push(
    `配置：${room.config.playerCount} 人桌 | 初始筹码 ${room.config.initialStack} | 盲注 ${room.config.smallBlind}/${room.config.bigBlind} | 水下：${room.config.underwater ? "开" : "关"} | 超时：${room.config.actionTimeoutSeconds} 秒`,
  );
  lines.push(section, "座位：");
  for (const seat of room.seats) {
    if (seat.type === "empty") {
      lines.push(`${seat.index}. 空`);
      continue;
    }
    const host = seat.isHost ? "（房主）" : "";
    const youLabel = seat.isYou ? "（你）" : "";
    const type = seat.type === "bot" ? `AI ${seat.botDifficulty}` : "真人";
    const online = seat.type === "bot" ? "在线" : seat.connected ? "在线" : "离线";
    lines.push(`${seat.index}. ${seat.displayName}${youLabel}${host}  ${type}  ${online}  筹码 ${seat.stack}`);
  }
  if (!game) {
    lines.push(
      section,
      you?.isHost ? "房主命令：开始/start，添加AI/bot add [座位] [名称] [难度]，移除AI/bot remove 座位，设置AI/bot config 座位 名称 难度" : "玩家命令：入座 位置/sit 位置，离座/leave，刷新/s，退出/q",
      divider,
    );
    return lines.join("\n");
  }
  lines.push(section, `第 ${game.handNo} 手 | ${game.stage} | 轮到：${game.actionPlayerName ?? "无"}`);
  lines.push(`公共牌：${formatCardDtos(game.board)}`);
  const hero = game.players.find((player) => player.seatIndex === you?.seatIndex);
  if (hero?.hole) lines.push(`你的手牌：${formatCardDtos(hero.hole)}`);
  lines.push(`底池：${game.pot}`, `当前最高下注：${game.currentBet}`);
  lines.push(section, "牌桌：");
  for (const player of game.players) {
    const hole = player.hole && (player.seatIndex === you?.seatIndex || game.lastHandResult?.revealed?.[player.seatIndex]) ? ` 手牌 ${formatCardDtos(player.hole)}` : "";
    lines.push(`${player.marks.padEnd(2, " ")} ${String(player.position).padEnd(5, " ")} 座${player.seatIndex} ${player.name} 筹码 ${player.stack} 本轮 ${player.currentBet} ${player.status}${hole}${player.handName ? ` ${player.handName}` : ""}`);
  }
  lines.push(section, "最近行动：", ...(game.logs.length ? game.logs : ["无"]));
  if (game.handFinished) {
    lines.push(section, `本手结束：${game.lastHandResult?.summary ?? ""}`);
    lines.push(you?.isHost ? "房间仍在。输入 下一手/next 开始下一手。" : "房间仍在，等待房主开始下一手。");
  } else if (game.actionSeatIndex === you?.seatIndex) {
    lines.push(section, `请输入：${game.legalActions.map((action) => action.label).join("，")}，状态/s，退出/q`);
  } else {
    lines.push(section, `等待 ${game.actionPlayerName} 行动...`);
  }
  lines.push(divider);
  return lines.join("\n");
}

function formatCardDtos(cards) {
  return cards?.length ? cards.map((card) => card.text).join(" ") : "无";
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
      reconnectCode: session.reconnectCode,
    };
    fs.writeFileSync(sessionStorePath(), `${JSON.stringify(data, null, 2)}\n`);
  } catch {
    // 会话缓存失败不影响本次游戏。
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
    const port = Number.parseInt(options.port || process.env.PORT || "80", 10);
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
    console.log("  node poker.js telnet --host 0.0.0.0 --port 80  启动 nc/telnet 纯终端桌");
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
  OnlineGameEngine,
  PokerRoom,
  PokerServer,
  RoomManager,
  TelnetPokerServer,
  Random,
  Stage,
  formatCards,
};
