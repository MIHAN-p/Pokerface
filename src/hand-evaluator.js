const { HAND_NAMES } = require('./constants');

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

module.exports = {
  HandEvaluator,
  HandScore,
  combinations,
  straightHighCard,
};
