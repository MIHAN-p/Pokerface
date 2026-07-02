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

module.exports = { Player };
