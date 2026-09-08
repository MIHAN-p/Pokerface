const test = require('node:test');
const assert = require('node:assert/strict');
const { BotPlayer, Player, Card, Stage, Action, ActionKind: K, GameEngine, OnlineGameEngine, Random } = require('./poker');
const cards = (s) => s.split(' ').map((s) => new Card('23456789TJQKA'.indexOf(s[0]) + 2, s[1]));
const bot = new BotPlayer({ next: () => 0 }); // Force every permitted mixed bluff to fire.
function spot(hole, board = '', overrides = {}) {
  const player = new Player('bot', false, 2000);
  player.hole = cards(hole);
  const players = [player, ...Array.from({ length: (overrides.count ?? 2) - 1 }, (_, i) => new Player(`opponent${i}`, true, 2000))];
  return { player, players, board: board ? cards(board) : [], stage: board ? board.split(' ').length === 5 ? Stage.RIVER : board.split(' ').length === 4 ? Stage.TURN : Stage.FLOP : Stage.PREFLOP,
    pot: 150, toCall: 50, currentBet: 50, bigBlind: 10, position: 'BTN', inPosition: true, ...overrides };
}
const aggressive = (stage, playerIndex = 1, extra = {}) => ({ stage, playerIndex, aggressive: true, paid: 50, betSize: 0.5, position: 'UTG', ...extra });

test('ordinary river air and weak pairs never raise, for every personality, size and player count', () => {
  for (const personality of ['balanced', 'tight', 'loose aggressive', 'calling station']) {
    for (const count of [2, 3, 6]) {
      for (const amount of [33, 50, 67, 75, 100, 150]) {
        for (const hole of ['QC 4D', '8C 5D', '5C 3D', '9C 4D']) {
          const c = spot(hole, 'KS 9H 7D 2C 3S', { personality, count, pot: 100 + amount, currentBet: amount, toCall: amount });
          const action = bot.decide(c);
          assert.ok([K.FOLD, K.CHECK_CALL].includes(action.kind), `${personality} ${count} ${hole} ${amount}`);
          if (count >= 3 || hole === 'QC 4D' || hole === '8C 5D') assert.equal(action.kind, K.FOLD);
        }
      }
    }
  }
});

test('multiple callers do not dilute the original large bet size', () => {
  const c = spot('KC QD', 'KS 9H 7D 2C 3S', { count: 4, pot: 400, toCall: 100, currentBet: 100,
    history: [aggressive(Stage.RIVER, 1, { betSize: 1 }), { stage: Stage.RIVER, playerIndex: 2, paid: 100 }, { stage: Stage.RIVER, playerIndex: 3, paid: 100 }] });
  assert.equal(bot.context(c).betSizeBucket, 'pot');
  assert.equal(bot.context(c).callers, 2);
  assert.equal(bot.decide(c).kind, K.FOLD);
});

test('top pair calls a small heads-up bet but folds pot and overbets', () => {
  for (const [amount, expected] of [[33, K.CHECK_CALL], [50, K.CHECK_CALL], [67, K.CHECK_CALL], [100, K.FOLD], [150, K.FOLD]]) {
    assert.equal(bot.decide(spot('KC QD', 'KS 9H 7D 2C 3S', { pot: 100 + amount, currentBet: amount, toCall: amount })).kind, expected);
  }
});

test('preflop weak offsuit hands fold even on button and against a raise', () => {
  for (const hole of ['QC 4D', '8C 5D', '5C 3D', 'AC 3D', 'KC 5D']) {
    for (const currentBet of [10, 30]) {
      assert.equal(bot.decide(spot(hole, '', { pot: 45, currentBet, toCall: currentBet, personality: 'loose aggressive' })).kind, K.FOLD);
    }
  }
});

test('position opens nested ranges, while early raises tighten calls', () => {
  assert.equal(bot.decide(spot('9S 8S', '', { currentBet: 10, toCall: 10, position: 'UTG' })).kind, K.FOLD);
  assert.equal(bot.decide(spot('9S 8S', '', { currentBet: 10, toCall: 10, position: 'BTN' })).kind, K.RAISE);
  assert.equal(bot.decide(spot('9S 8S', '', { currentBet: 30, toCall: 30 })).kind, K.FOLD);
  const c = spot('9S 9D', '', { currentBet: 30, toCall: 30, history: [aggressive(Stage.PREFLOP, 1, { position: 'BTN' })] });
  assert.equal(bot.decide(c).kind, K.CHECK_CALL);
  c.history[0].position = 'UTG';
  assert.equal(bot.decide(c).kind, K.FOLD);
});

test('3bet, 4bet and 5bet narrow continuation; AA retains value aggression', () => {
  const act = (hole, n, currentBet) => bot.decide(spot(hole, '', { pot: currentBet * 3, currentBet, toCall: currentBet,
    history: Array.from({ length: n }, () => aggressive(Stage.PREFLOP)) })).kind;
  assert.equal(act('AS QD', 1, 30), K.CHECK_CALL);
  assert.equal(act('AS QD', 2, 100), K.FOLD);
  assert.equal(act('QS QD', 2, 100), K.CHECK_CALL);
  assert.equal(act('QS QD', 3, 240), K.FOLD);
  assert.equal(act('KS KD', 3, 240), K.CHECK_CALL);
  assert.equal(act('KS KD', 4, 500), K.FOLD);
  assert.ok([K.RAISE, K.ALL_IN].includes(act('AS AD', 4, 500)));
});

test('big blind checks trash for free instead of folding or limping voluntarily', () => {
  const c = spot('QC 4D', '', { currentBet: 10, toCall: 0, position: 'BB' });
  c.player.currentBet = 10;
  assert.equal(bot.decide(c).kind, K.CHECK_CALL);
});

test('postflop re-raises reject medium value, including previously invested chips', () => {
  const c = spot('KC QD', 'KS 9H 7D 2C', { count: 3, pot: 400, currentBet: 100, toCall: 30,
    history: [aggressive(Stage.TURN, 0), aggressive(Stage.TURN, 1)] });
  c.player.currentBet = 70;
  assert.equal(bot.decide(c).kind, K.FOLD);
});

test('made hand bands distinguish nuts, strong, medium, weak and air', () => {
  assert.equal(bot.analyze(cards('AS QS'), cards('KS 9S 7S 2D 3C')).made, 'nuts');
  assert.equal(bot.analyze(cards('KS 9D'), cards('KC 9H 7D 2C 3S')).made, 'strong');
  assert.equal(bot.analyze(cards('KC QD'), cards('KS 9H 7D 2C 3S')).made, 'medium');
  assert.equal(bot.analyze(cards('9C 4D'), cards('KS 9H 7D 2C 3S')).made, 'weak_pair');
  assert.equal(bot.analyze(cards('QC 4D'), cards('KS 9H 7D 2C 3S')).made, 'air');
});

test('nuts value bet and raise in multiway pots; shared royal flush never raises', () => {
  assert.equal(bot.decide(spot('AS QS', 'KS 9S 7S 2D 3C', { count: 5 })).kind, K.RAISE);
  assert.equal(bot.decide(spot('AS QS', 'KS 9S 7S 2D 3C', { count: 5, toCall: 0, currentBet: 0 })).kind, K.BET);
  assert.equal(bot.decide(spot('2D 3C', 'AS KS QS JS TS', { count: 2 })).kind, K.CHECK_CALL);
  assert.equal(bot.decide(spot('2D 3C', 'AS KS QS JS TS', { count: 6, toCall: 0, currentBet: 0 })).kind, K.CHECK_CALL);
  assert.equal(bot.decide(spot('2D 3C', 'AS KS QS JS TS', { count: 6 })).kind, K.FOLD);
});

test('paired board and four-flush do not turn irrelevant hole cards into strong hands', () => {
  assert.equal(bot.analyze(cards('QC 4D'), cards('KS KH 7D 2C 3S')).made, 'air');
  assert.equal(bot.decide(spot('2S 3D', 'AS KS 9S 7S 4D', { count: 4 })).kind, K.FOLD);
});

test('draws distinguish nut flush, low flush, open end, gutshot and combo without double counts', () => {
  const nut = bot.analyze(cards('AS QS'), cards('KS 7S 2D'));
  const low = bot.analyze(cards('5S 3S'), cards('KS 7S 2D'));
  const open = bot.analyze(cards('8S 9D'), cards('6C 7H KD'));
  const gut = bot.analyze(cards('8S 9D'), cards('5C 7H KD'));
  const combo = bot.analyze(cards('8S 9S'), cards('6S 7H KS'));
  assert.equal(nut.band, 'strong_draw');
  assert.equal(nut.draw.outs, 9);
  assert.equal(low.band, 'weak_draw');
  assert.ok(low.draw.cleanOuts < nut.draw.cleanOuts / 2);
  assert.equal(open.draw.straightOuts, 8);
  assert.equal(open.band, 'strong_draw');
  assert.equal(gut.draw.straightOuts, 4);
  assert.equal(gut.band, 'weak_draw');
  assert.equal(combo.draw.outs, 15);
});

test('draws pay only affordable odds, and expire on river', () => {
  const c = spot('AS QS', 'KS 7S 2D', { pot: 120, toCall: 20, currentBet: 20, personality: 'calling station' });
  assert.equal(bot.decide(c).kind, K.CHECK_CALL);
  assert.equal(bot.decide({ ...c, pot: 200, toCall: 100, currentBet: 100 }).kind, K.FOLD);
  assert.equal(bot.decide(spot('5S 3S', 'KS 7S 2D', { pot: 120, toCall: 20, currentBet: 20 })).kind, K.FOLD);
  assert.equal(bot.analyze(cards('AS QS'), cards('KS 7S 2D 3C 9H')).draw.outs, 0);
  assert.equal(bot.decide(spot('AS QS', 'KS 7S 2D 3C 9H')).kind, K.FOLD);
});

test('river blocker alone is insufficient; a coherent heads-up line can mix a bluff', () => {
  const c = spot('AS QD', 'KS 9S 7D 2C 3S', { pot: 105, toCall: 5, currentBet: 5,
    history: [aggressive(Stage.PREFLOP, 0), aggressive(Stage.TURN, 0), aggressive(Stage.RIVER, 1, { betSize: 0.05 })] });
  assert.equal(bot.decide(c).kind, K.RAISE);
  assert.equal(bot.decide({ ...c, history: [aggressive(Stage.RIVER)] }).kind, K.FOLD);
  assert.equal(bot.decide({ ...c, players: [...c.players, new Player('third', true, 2000)] }).kind, K.FOLD);
  assert.equal(bot.decide({ ...c, personality: 'calling station' }).kind, K.FOLD);
});

test('all-in sizing is legal and does not rescue trash; inaccessible side pots excluded', () => {
  const c = spot('AS QS', 'KS 9S 7S 2D 3C');
  c.player.stack = 20;
  assert.equal(bot.decide(c).kind, K.ALL_IN);
  c.player.hole = cards('QC 4D');
  assert.equal(bot.decide(c).kind, K.FOLD);
  c.players[1].totalBet = 1000;
  const context = bot.context({ ...c, pot: 1020 });
  assert.equal(context.pot, 40);
  assert.equal(context.potOdds, 1 / 3);
});

test('engine records public action history, position, callers and street resets', () => {
  const e = new GameEngine({ playerCount: 4 }, { rng: new Random(1), writeOutput: () => {} });
  e.dealer = 0;
  e.stage = Stage.RIVER;
  e.pot = 100;
  for (const p of e.players) p.isHuman = true;
  e.applyAction(1, new Action(K.BET, 100));
  e.applyAction(2, new Action(K.CHECK_CALL));
  const ctx = e.botContext(e.players[0]);
  assert.equal(ctx.position, 'BTN');
  assert.equal(ctx.inPosition, true);
  assert.equal(ctx.history[0].betSize, 1);
  assert.equal(ctx.history[1].paid, 100);
  assert.equal(ctx.minRaise, 100);
  assert.ok(ctx.history.every((a) => !('hole' in a)));
  e.resetStreetBets();
  assert.equal(e.minRaise, 10);
  assert.equal(e.actionHistory.length, 2);
});

test('bot decisions never inspect opponent hole cards', () => {
  const c = spot('KC QD', 'KS 9H 7D 2C 3S');
  for (const p of c.players.slice(1)) Object.defineProperty(p, 'hole', { get() { throw new Error('hidden cards read'); } });
  assert.equal(bot.decide(c).kind, K.CHECK_CALL);
});

test('seeded online games terminate, produce legal actions and conserve chips', () => {
  let postflopHands = 0;
  for (let seed = 1; seed <= 100; seed += 1) {
    const e = new OnlineGameEngine(Array.from({ length: 6 }, (_, index) => ({ index, type: 'bot', displayName: `bot${index}`, stack: 400 })),
      { underwater: false }, { rng: new Random(Math.imul(seed, 2654435761) >>> 0) });
    e.startHand();
    assert.equal(e.handFinished, true, `seed ${seed}`);
    assert.equal(e.players.reduce((sum, p) => sum + p.stack, 0), 2400);
    assert.ok(e.players.every((p) => p.stack >= 0));
    assert.ok(e.actionHistory.length > 0);
    if (e.board.length >= 3) postflopHands += 1;
  }
  assert.ok(postflopHands >= 5, 'simulation must exercise postflop decisions');
});

test('generated standalone HTML compiles and includes the same bot policy', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const html = fs.readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8');
  for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script);
  const core = html.split('// POKER_CORE_START: generated from poker.js')[1].split('// POKER_CORE_END')[0];
  const BrowserBot = vm.runInNewContext(`${core}\nBotPlayer;`);
  const c = spot('QC 4D', 'KS 9H 7D 2C 3S', { count: 6 });
  assert.equal(new BrowserBot({ next: () => 0 }).decide(c).kind, K.FOLD);
  assert.equal(BrowserBot.prototype.decide.toString().replace(/\s/g, ''), BotPlayer.prototype.decide.toString().replace(/\s/g, ''));
});
