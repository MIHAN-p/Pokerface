const { ActionKind, Stage } = require('./src/constants');
const { Action, InputParser } = require('./src/actions');
const { BotPlayer } = require('./src/bot-player');
const { Card, Deck } = require('./src/cards');
const { GameEngine, formatCards } = require('./src/game-engine');
const { HandEvaluator, HandScore } = require('./src/hand-evaluator');
const { OnlineGameEngine } = require('./src/online-game-engine');
const { renderOnlineSnapshot } = require('./src/online-protocol');
const { Player } = require('./src/player');
const { PokerRoom, RoomManager } = require('./src/room-manager');
const { PokerServer } = require('./src/poker-server');
const { Random } = require('./src/random');
const { TelnetPokerServer } = require('./src/telnet-server');
const { main } = require('./src/cli');

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
  Player,
  PokerRoom,
  PokerServer,
  Random,
  RoomManager,
  Stage,
  TelnetPokerServer,
  formatCards,
  renderOnlineSnapshot,
};
