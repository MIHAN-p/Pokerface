const { ActionKind, Stage } = require('./constants');
const { Action, InputParser } = require('./actions');
const { BotPlayer } = require('./bot-player');
const { Deck } = require('./cards');
const { HandEvaluator } = require('./hand-evaluator');
const { Player } = require('./player');
const { Random } = require('./random');

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
      return "弃牌/f，跟注/c，加注 金额/r 金额，全下/a，状态/st，退出/q";
    }
    if (this.currentBet > 0) {
      return "弃牌/f，过牌/c，加注 金额/r 金额，全下/a，状态/st，退出/q";
    }
    return "弃牌/f，过牌/c，下注 金额/b 金额，全下/a，状态/st，退出/q";
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

function formatCards(cards) {
  return cards.length ? cards.map((card) => card.text()).join(" ") : "无";
}

module.exports = { GameEngine, formatCards };
