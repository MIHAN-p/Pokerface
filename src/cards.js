const { RANK_NAMES, SUITS, SUIT_NAMES } = require('./constants');
const { Random } = require('./random');

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

module.exports = { Card, Deck };
