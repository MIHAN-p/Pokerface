const { ActionKind, Stage } = require('./constants');
const { Action } = require('./actions');
const { Deck } = require('./cards');
const { GameEngine } = require('./game-engine');
const { HandEvaluator } = require('./hand-evaluator');
const { Player } = require('./player');
const { Random } = require('./random');

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
    this.handNo = options.handNo ?? 0;
    this.dealer = options.dealer ?? this.rng.int(0, this.players.length - 1);
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
      const revealed = {};
      if (active[0].player.hole && active[0].player.hole.length > 1) {
        revealed[active[0].player.seatIndex] = {
          cards: active[0].player.hole.map(cardToDto),
          handName: null,
        };
      }
      this.lastHandResult = {
        winners: [active[0].player.seatIndex],
        pot: finalPot,
        revealed,
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
        underwaterHands: player.underwaterHands,
        underwaterDebt: player.underwaterDebt,
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

function cardToDto(card) {
  return { rank: card.rank, suit: card.suit, text: card.text() };
}

module.exports = { OnlineGameEngine };
