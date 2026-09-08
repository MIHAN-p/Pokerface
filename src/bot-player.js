const { ActionKind, Stage, SUITS } = require('./constants');
const { Action } = require('./actions');
const { HandEvaluator, straightHighCard } = require('./hand-evaluator');

const key = (c) => `${c.rank}${c.suit}`;
const deck = () => SUITS.flatMap((suit) => Array.from({ length: 13 }, (_, i) => ({ rank: i + 2, suit })));
const unseenCards = (cards) => deck().filter((c) => !cards.some((known) => key(c) === key(known)));
const PROFILES = {
  tight: { range: 5, margin: 0.025, bluff: 0.025 },
  'loose aggressive': { range: -4, margin: 0, bluff: 0.08 },
  'calling station': { range: -2, margin: -0.02, bluff: 0 },
  balanced: { range: 0, margin: 0, bluff: 0.05 },
};

class BotPlayer {
  constructor(rng) {
    this.rng = rng;
    this.handCache = new Map();
  }

  // An explainable conservative policy, not a solver or random action table.
  decide(input) {
    const c = this.context(input);
    return this.legalize(c, c.stage === Stage.PREFLOP ? this.preflop(c) : this.postflop(c));
  }

  context(input) {
    const { player, players, stage, pot, bigBlind } = input;
    const history = input.history ?? [];
    const playerIndex = input.playerIndex ?? players.indexOf(player);
    const street = history.filter((a) => a.stage === stage);
    const aggression = street.filter((a) => a.aggressive);
    const last = aggression.at(-1);
    const opponents = players.filter((p) => p !== player && p.active);
    const currentBet = input.currentBet ?? 0;
    const toCall = Math.max(0, input.toCall ?? currentBet - (player.currentBet ?? 0));
    const callCost = Math.min(toCall, player.stack);
    // Exclude chips inaccessible to a short stack calling into a side pot.
    const cap = (player.totalBet ?? 0) + player.stack;
    const inaccessible = players.reduce((sum, p) => sum + Math.max(0, (p.totalBet ?? 0) - cap), 0);
    const contestablePot = Math.max(0, pot - inaccessible);
    const aliases = { 稳健: 'balanced', lag: 'loose aggressive', loose_aggressive: 'loose aggressive', calling_station: 'calling station' };
    const name = input.personality ?? player.botConfig?.personality ?? player.botConfig?.style ?? 'balanced';
    const profile = PROFILES[aliases[name] ?? name] ?? PROFILES.balanced;
    const preflop = history.filter((a) => a.stage === Stage.PREFLOP && a.aggressive);
    const callers = last ? street.slice(street.indexOf(last) + 1).filter((a) => !a.aggressive && a.paid > 0 && a.playerIndex !== playerIndex).length : 0;
    const betSize = last?.betSize ?? toCall / Math.max(1, pot - toCall);
    return {
      ...input, pot: contestablePot, currentBet, toCall, callCost, playerIndex,
      history, street, aggression, callers, opponents: opponents.length,
      profile, position: input.position ?? 'UTG', inPosition: input.inPosition ?? input.position === 'BTN',
      potOdds: callCost / Math.max(1, contestablePot + callCost), betSize,
      betSizeBucket: betSize <= 0.36 ? '1/3' : betSize <= 0.55 ? '1/2' : betSize <= 0.72 ? '2/3' : betSize <= 1.05 ? 'pot' : 'overbet',
      stackToPotRatio: Math.min(player.stack, Math.max(0, ...opponents.map((p) => p.stack + (p.currentBet ?? 0)))) / Math.max(1, contestablePot),
      rangeAdvantage: preflop.at(-1)?.playerIndex === playerIndex,
      openerPosition: preflop[0]?.position,
      opponentAggression: aggression.filter((a) => a.playerIndex !== playerIndex).length,
      canBluff: opponents.length === 1 && !opponents[0].allIn && (player.bluffStreak ?? 0) < 2,
    };
  }

  preflopScore(hole) {
    const [hi, lo] = hole.map((c) => c.rank).sort((a, b) => b - a);
    if (hi === lo) return ({ 14: 100, 13: 96, 12: 92, 11: 87, 10: 82, 9: 76, 8: 71, 7: 66, 6: 61, 5: 56, 4: 52, 3: 49, 2: 46 })[hi];
    const suited = hole[0].suit === hole[1].suit;
    const broadway = { '14,13': 86, '14,12': 78, '14,11': 70, '14,10': 63, '13,12': 69, '13,11': 61, '13,10': 54, '12,11': 58, '12,10': 50, '11,10': 49 };
    if (broadway[`${hi},${lo}`]) return broadway[`${hi},${lo}`] + (suited ? 8 : 0);
    if (!suited) return 15;
    if (hi === 14) return lo >= 6 ? 49 + lo : lo === 5 || lo === 4 ? 60 : 54;
    if (hi - lo === 1 && lo >= 5) return 4 * lo + 26;
    if (hi - lo === 2 && lo >= 7) return 4 * lo + 17;
    if (hi === 13 && lo >= 8) return 48 + lo;
    return 25;
  }

  preflop(c) {
    const score = this.preflopScore(c.player.hole);
    const raises = Math.max(c.aggression.length, c.currentBet > c.bigBlind ? 1 : 0);
    const fold = () => new Action(c.toCall ? ActionKind.FOLD : ActionKind.CHECK_CALL);
    if (!raises) {
      const thresholds = { UTG: 66, MP: 63, MP1: 63, MP2: 62, HJ: 60, CO: 56, BTN: 50, SB: 60, BB: 60 };
      const limpers = c.street.filter((a) => a.paid > 0 && !a.aggressive).length;
      const threshold = (thresholds[c.position] ?? 66) + c.profile.range + Math.min(10, limpers * 3);
      if (score < threshold) return fold();
      return new Action(ActionKind.RAISE, Math.round(c.bigBlind * (2.5 + limpers)));
    }
    // Strict nested continuation ranges: open -> 3bet -> 4bet -> 5bet.
    const earlyOpen = /^(UTG|MP)/.test(c.openerPosition ?? 'UTG');
    const sizePenalty = Math.max(0, c.currentBet / c.bigBlind - (raises === 1 ? 3 : raises === 2 ? 10 : 24));
    const threshold = (raises === 1 ? (earlyOpen ? 78 : 72) : raises === 2 ? 86 : raises === 3 ? 96 : 100)
      + Math.min(12, sizePenalty * 1.3) + Math.min(8, c.callers * 3) + c.profile.range;
    if (score === 100) return this.wager(c, 0.8, c.currentBet * 2.4);
    if (score < threshold || (c.potOdds > 0.4 && score < 96)) return fold();
    const valueThreshold = raises === 1 ? 90 : raises === 2 ? 96 : 100;
    if (score >= valueThreshold) return this.wager(c, 0.75, c.currentBet * (c.inPosition ? 3 : 3.5));
    if (c.callCost > c.player.stack * 0.25 && score < (raises >= 2 ? 96 : 86)) return fold();
    return new Action(ActionKind.CHECK_CALL);
  }

  analyze(hole, board) {
    const cacheKey = `${hole.map(key).sort().join(',')}/${board.map(key).sort().join(',')}`;
    if (this.handCache.has(cacheKey)) return this.handCache.get(cacheKey);
    const cards = [...hole, ...board];
    const score = HandEvaluator.best(cards);
    const ranks = board.reduce((m, c) => m.set(c.rank, (m.get(c.rank) ?? 0) + 1), new Map());
    const maxSuit = Math.max(...SUITS.map((suit) => board.filter((c) => c.suit === suit).length));
    const paired = [...ranks.values()].some((n) => n >= 2);
    const windows = Array.from({ length: 10 }, (_, i) => Array.from({ length: 5 }, (_, j) => i + j + 1).map((r) => r === 1 ? 14 : r));
    const connected = Math.max(...windows.map((w) => w.filter((r) => ranks.has(r)).length));
    const texture = { paired, maxSuit, connected, dangerous: maxSuit >= 3 || connected >= 4, wet: maxSuit >= 2 || connected >= 3 };
    const playsBoard = board.length === 5 && score.compare(HandEvaluator.best(board)) === 0;
    const top = Math.max(...board.map((c) => c.rank));
    const ownPair = score.category === 1 && hole.some((c) => c.rank === score.tiebreakers[0]) && (ranks.get(score.tiebreakers[0]) ?? 0) < 2;
    const topPair = ownPair && score.tiebreakers[0] >= top;
    const kicker = hole.find((c) => c.rank !== score.tiebreakers[0])?.rank ?? 14;
    const ownTrips = score.category === 3 && hole.some((c) => c.rank === score.tiebreakers[0]) && (ranks.get(score.tiebreakers[0]) ?? 0) < 3;
    const ownTwoPair = score.category === 2 && score.tiebreakers.slice(0, 2).every((r) => hole.some((c) => c.rank === r) && ranks.get(r) === 1);
    let made = 'air';
    if (!playsBoard) {
      if (score.category >= 4 || ownTrips || (ownTwoPair && score.tiebreakers[0] === top && !texture.dangerous)) made = 'strong';
      else if (ownTwoPair || (topPair && kicker >= 11)) made = 'medium';
      else if (ownPair || score.category >= 2) made = 'weak_pair';
    }
    const unseen = unseenCards(cards);
    // Relative made-hand strength only, NOT showdown equity against an assumed range.
    let betterFraction = 1;
    let unbeatable = false;
    if (score.category >= 2 && !playsBoard) {
      let better = 0;
      let total = 0;
      for (let a = 0; a < unseen.length; a += 1) {
        for (let b = a + 1; b < unseen.length; b += 1) {
          total += 1;
          if (HandEvaluator.best([...board, unseen[a], unseen[b]]).compare(score) > 0) better += 1;
        }
      }
      betterFraction = better / total;
      unbeatable = better === 0;
      if (made === 'strong' && unbeatable) made = 'nuts';
      else if (made === 'strong' && betterFraction <= 0.012 && score.category >= 3) made = 'near_nuts';
      else if (made === 'strong' && betterFraction > 0.12) made = 'medium';
    }
    const draw = this.draws(hole, board, unseen, texture);
    const blockerSuit = SUITS.find((suit) => board.filter((c) => c.suit === suit).length >= 3 && hole.some((c) => c.suit === suit && c.rank === 14));
    const result = { score, made, band: ['air', 'weak_pair'].includes(made) && draw.outs ? draw.strong ? 'strong_draw' : 'weak_draw' : made,
      draw, texture, topPair, ownTwoPair, playsBoard, unbeatable, betterFraction, blockerValue: blockerSuit ? 1 : 0, blockerSuit };
    if (this.handCache.size >= 128) this.handCache.delete(this.handCache.keys().next().value);
    this.handCache.set(cacheKey, result);
    return result;
  }

  draws(hole, board, unseen, texture) {
    if (board.length >= 5) return { outs: 0, cleanOuts: 0, equity: 0, strong: false, nutFlush: false, straightOuts: 0 };
    const cards = [...hole, ...board];
    const currentStraight = straightHighCard(cards.map((c) => c.rank));
    const flushSuit = SUITS.find((suit) => cards.filter((c) => c.suit === suit).length === 4 && hole.some((c) => c.suit === suit));
    const boardFlushRanks = board.filter((c) => c.suit === flushSuit).map((c) => c.rank);
    const nutRank = Array.from({ length: 13 }, (_, i) => 14 - i).find((r) => !boardFlushRanks.includes(r));
    const nutFlush = Boolean(flushSuit && hole.some((c) => c.suit === flushSuit && c.rank === nutRank));
    const highFlush = flushSuit && Math.max(...hole.filter((c) => c.suit === flushSuit).map((c) => c.rank)) >= 12;
    let outs = 0;
    let cleanOuts = 0;
    let straightOuts = 0;
    for (const card of unseen) {
      const nextBoard = [...board, card];
      const nextStraight = straightHighCard([...cards, card].map((c) => c.rank));
      const boardStraight = straightHighCard(nextBoard.map((c) => c.rank));
      const straight = !currentStraight && nextStraight && nextStraight > (boardStraight ?? 0);
      const flush = flushSuit === card.suit;
      if (straight) straightOuts += 1;
      if (!straight && !flush) continue;
      outs += 1; // Union: cards completing both draws are counted once.
      let quality = flush ? nutFlush ? 1 : highFlush ? 0.7 : 0.4 : 1;
      if (straight && !flush) {
        // Discount the low end of a straight: completion can still be dominated.
        const boardRanks = new Set(nextBoard.map((c) => c.rank));
        const bestPossible = Array.from({ length: 10 }, (_, i) => {
          const run = Array.from({ length: 5 }, (_, j) => i + j + 1).map((r) => r === 1 ? 14 : r);
          return run.filter((r) => boardRanks.has(r)).length >= 3 ? i + 5 : 0;
        });
        if (nextStraight < Math.max(...bestPossible)) quality *= 0.65;
      }
      if (straight && !flush && nextBoard.filter((c) => c.suit === card.suit).length >= 3) quality *= 0.5;
      if (texture.maxSuit >= 3 && !flush) quality *= 0.5;
      if (texture.paired || board.some((c) => c.rank === card.rank)) quality *= 0.65;
      cleanOuts += quality;
    }
    const strong = nutFlush || straightOuts >= 8 || (flushSuit && straightOuts >= 4);
    // One card odds: calling a flop bet does not purchase a free river.
    return { outs, cleanOuts, equity: cleanOuts / unseen.length, strong: Boolean(strong), nutFlush, straightOuts };
  }

  postflop(c) {
    const h = this.analyze(c.player.hole, c.board);
    const multi = c.opponents >= 2;
    const river = c.stage === Stage.RIVER;
    const raised = c.aggression.length >= 2;
    const reraised = c.aggression.length >= 3;
    const premium = h.made === 'nuts' || h.made === 'near_nuts';
    const call = () => new Action(ActionKind.CHECK_CALL);
    const fold = () => new Action(c.toCall > 0 ? ActionKind.FOLD : ActionKind.CHECK_CALL);
    if (c.toCall <= 0) {
      if (h.playsBoard) return call();
      if (premium || h.made === 'strong') return this.wager(c, h.texture.wet || multi ? 0.75 : 0.6);
      if (h.made === 'medium' && h.topPair && !multi && !h.texture.dangerous && c.aggression.length === 0) return this.wager(c, 0.4);
      if (this.bluffCandidate(c, h, false)) return this.wager(c, 0.5);
      return call();
    }
    // Shared-board strength never justifies a raise; account for split-pot returns.
    if (h.playsBoard) {
      if (h.score.category >= 4) {
        const unseen = unseenCards([...c.board, ...c.player.hole]);
        const beaten = unseen.some((a, i) => unseen.slice(i + 1).some((b) => HandEvaluator.best([...c.board, a, b]).compare(h.score) > 0));
        if (!beaten && 1 / (c.opponents + 1) >= c.potOdds) return call();
      }
      return fold();
    }
    const strongValue = h.made === 'strong' && !h.texture.dangerous && (!multi || (h.score.category >= 3 && c.callers === 0));
    if (h.made === 'nuts' || (h.made === 'near_nuts' && (!reraised || !multi)) || (strongValue && !raised && c.betSize <= 0.75)) {
      return this.wager(c, multi ? 0.85 : 0.7);
    }
    if (this.bluffCandidate(c, h, true)) return this.wager(c, 0.65);
    // Hard gates apply to every personality, before equity-based calls.
    if ((raised || c.betSize > 0.72 || c.callers > 0) && ['air', 'weak_pair'].includes(h.made) && (river || !h.draw.strong)) return fold();
    if (multi && ['air', 'weak_pair'].includes(h.made) && (river || !h.draw.strong)) return fold();
    if (raised && h.made === 'medium' && (multi || c.betSize >= 0.5)) return fold();
    if (reraised && !premium) return fold();
    if (river && h.made === 'air') return fold();
    let equity = ({ nuts: 0.99, near_nuts: 0.83, strong: 0.66, medium: 0.45, weak_pair: 0.26, air: 0.02 })[h.made];
    equity *= Math.pow(0.78, Math.max(0, c.opponents - 1));
    equity -= Math.min(0.22, c.callers * 0.065) + Math.max(0, c.aggression.length - 1) * 0.10;
    if (h.texture.dangerous && !premium) equity -= 0.07;
    equity -= c.betSize > 1.05 ? 0.17 : c.betSize > 0.72 ? 0.10 : c.betSize > 0.55 ? 0.05 : 0;
    if (!river && h.draw.outs > 0) {
      let drawEquity = h.draw.equity * Math.pow(h.draw.nutFlush ? 0.97 : 0.87, Math.max(0, c.opponents - 1));
      if (c.player.stack <= c.toCall && c.stage === Stage.FLOP) {
        const outs = h.draw.cleanOuts;
        drawEquity = (1 - (47 - outs) / 47 * (46 - outs) / 46) * (h.draw.nutFlush ? 0.95 : 0.8);
      }
      if (h.draw.strong && c.stackToPotRatio > 3 && c.inPosition && !raised && c.betSize <= 0.55) drawEquity += 0.025;
      equity = Math.max(equity, drawEquity);
    }
    const margin = 0.025 + c.profile.margin + (c.inPosition ? 0 : 0.015);
    return equity >= c.potOdds + margin ? call() : fold();
  }

  bluffCandidate(c, h, facingBet) {
    if (!c.canBluff || c.callers || c.profile.bluff === 0 || c.aggression.length > (facingBet ? 1 : 0)) return false;
    if (c.toCall >= c.player.stack || c.stackToPotRatio < 2 || (facingBet && c.betSize > 0.55)) return false;
    const river = c.stage === Stage.RIVER;
    if (river) {
      // Nut-flush blocker plus a prior barrel supplies a coherent value story.
      const turnBarrel = c.history.some((a) => a.stage === Stage.TURN && a.playerIndex === c.playerIndex && a.aggressive);
      if (h.made !== 'air' || !h.blockerValue || !turnBarrel || !c.rangeAdvantage || !c.inPosition
        || c.board.slice(0, 4).filter((card) => card.suit === h.blockerSuit).length < 2) return false;
    } else if (!(h.draw.strong && h.draw.cleanOuts >= 7 && !h.texture.paired && h.texture.maxSuit < 3)
      && !(h.made === 'air' && c.rangeAdvantage && c.inPosition && !h.texture.wet && c.stage === Stage.FLOP && !facingBet)) return false;
    // Only mix near break-even candidates; cap bluff frequency relative to value.
    const foldEquity = 0.30 + (c.rangeAdvantage ? 0.08 : 0) + (c.inPosition ? 0.04 : 0) + h.blockerValue * 0.05 - (facingBet ? 0.07 : 0);
    const risk = facingBet ? c.toCall + (c.pot + c.toCall) * 0.65 : c.pot * 0.5;
    const equity = river ? 0 : h.draw.equity;
    const ev = foldEquity * c.pot + (1 - foldEquity) * (equity * (c.pot + risk) - (1 - equity) * risk);
    const passiveEv = facingBet ? Math.max(0, equity * (c.pot + c.toCall) - c.toCall) : equity * c.pot;
    if (Math.abs(ev - passiveEv) > c.pot * 0.05) return false;
    const frequency = (c.difficulty === '简单' ? 0.5 : 1) * c.profile.bluff * (river ? 0.5 : 1);
    return this.rng.next() < frequency;
  }

  wager(c, fraction, target = null) {
    const increment = Math.max(c.bigBlind, c.minRaise ?? c.bigBlind, Math.round((c.pot + c.toCall) * fraction));
    const amount = Math.max(c.currentBet + (c.minRaise ?? c.bigBlind), Math.round(target ?? c.currentBet + increment));
    return new Action(c.currentBet > 0 ? ActionKind.RAISE : ActionKind.BET, amount);
  }

  legalize(c, action) {
    if (action.kind === ActionKind.CHECK_CALL && c.toCall > 0 && c.toCall >= c.player.stack) return new Action(ActionKind.ALL_IN);
    if ([ActionKind.BET, ActionKind.RAISE].includes(action.kind)) {
      const max = (c.player.currentBet ?? 0) + c.player.stack;
      if (max <= c.currentBet) return new Action(c.toCall > 0 ? ActionKind.ALL_IN : ActionKind.CHECK_CALL);
      if (action.amount >= max) return new Action(ActionKind.ALL_IN);
    }
    return action;
  }

  strength(hole, board, stage) {
    if (stage === Stage.PREFLOP) return this.preflopScore(hole) / 100;
    return ({ nuts: 1, near_nuts: 0.9, strong: 0.75, medium: 0.5, weak_pair: 0.25, air: 0.05 })[this.analyze(hole, board).made];
  }
}

module.exports = { BotPlayer };
