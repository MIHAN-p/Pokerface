const { ActionKind, Stage } = require('./constants');
const { Action } = require('./actions');
const { HandEvaluator } = require('./hand-evaluator');

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

module.exports = { BotPlayer };
