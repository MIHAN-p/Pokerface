import { useState, useCallback, useEffect } from 'react';
import PlayerHand from './PlayerHand.jsx';

let actionIdCounter = 0;

export default function ActionPanel({
  game,
  you,
  isHost,
  isSpectating,
  onAction,
  onNextHand,
  onResetGame,
  actionDeadline,
  config,
}) {
  const [betAmount, setBetAmount] = useState('');
  const [remainingMs, setRemainingMs] = useState(0);

  const isMyTurn = game?.actionSeatIndex === you?.seatIndex && you?.seatIndex !== null;
  const handFinished = game?.handFinished;
  const legalActions = isMyTurn ? (game?.legalActions || []) : [];
  const hero = game?.players?.find((p) => p.seatIndex === you?.seatIndex);
  const heroHandName = game?.heroHandName;

  const handleAction = useCallback((kind, amount = null) => {
    const action = { kind };
    if (amount !== null) action.amount = Number(amount);
    onAction({
      type: 'player_action',
      action,
      clientActionId: `act-${Date.now()}-${++actionIdCounter}`,
    });
  }, [onAction]);

  const raiseAction = legalActions.find((a) => a.kind === 'raise' || a.kind === 'bet');
  const checkCallAction = legalActions.find((a) => a.kind === 'check_call');
  const foldAction = legalActions.find((a) => a.kind === 'fold');
  const allInAction = legalActions.find((a) => a.kind === 'all_in');

  const toCall = game ? Math.max(0, game.currentBet - (hero?.currentBet || 0)) : 0;

  // === Countdown timer ===
  useEffect(() => {
    if (!actionDeadline || handFinished || !isMyTurn) {
      setRemainingMs(0);
      return;
    }
    const tick = () => {
      const ms = Math.max(0, actionDeadline - Date.now());
      setRemainingMs(ms);
    };
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, [actionDeadline, handFinished, isMyTurn]);

  const totalMs = (config?.actionTimeoutSeconds || 120) * 1000;
  const progressPercent = totalMs > 0 && remainingMs > 0 ? (remainingMs / totalMs) * 100 : 0;

  // === Spectating ===
  if (isSpectating) {
    return (
      <footer className="action-dock spectate-panel">
        <strong>你正在旁观</strong>
        <span className="tag blue">
          {handFinished
            ? '本手牌已结束，等待房主操作'
            : '本手牌结束后，房主可允许你加入；加入会重置回等待选座'}
        </span>
      </footer>
    );
  }

  // === Hand Finished ===
  if (handFinished) {
    const summary = game?.lastHandResult?.summary;
    const isWinner = game?.lastHandResult?.winners?.includes(you?.seatIndex);
    return (
      <footer className="action-dock result-panel">
        {hero && <PlayerHand hero={hero} handFinished={handFinished} lastHandResult={game?.lastHandResult} heroHandName={heroHandName} />}
        <strong>
          {isWinner ? `你赢得底池 ${game?.lastHandResult?.pot || ''}` : (summary || '本手结束')}
        </strong>
        <span className="tag">
          {isHost ? '房主可开始下一手；若允许旁观者加入，将先重置回等待状态' : '等待房主开始下一手…'}
        </span>
        {isHost && (
          <div className="host-buttons" style={{ justifyContent: 'center' }}>
            <button className="btn red" onClick={onResetGame}>重置牌局</button>
            <button className="btn primary" onClick={onNextHand}>下一手</button>
          </div>
        )}
      </footer>
    );
  }

  // === Playing (not your turn) ===
  if (!isMyTurn) {
    return (
      <footer className="action-dock">
        {hero && <PlayerHand hero={hero} handFinished={handFinished} lastHandResult={game?.lastHandResult} heroHandName={heroHandName} />}
        <div className="dock-header">
          <span>等待 {game?.actionPlayerName || '...'} 行动…</span>
        </div>
        {isHost && (
          <div className="host-buttons" style={{ justifyContent: 'center', marginTop: '8px' }}>
            <button className="btn red small" onClick={onResetGame}>重置牌局</button>
          </div>
        )}
      </footer>
    );
  }

  // === Playing (your turn) ===
  return (
    <footer className="action-dock">
      {hero && <PlayerHand hero={hero} handFinished={handFinished} lastHandResult={game?.lastHandResult} heroHandName={heroHandName} />}
      <div className="dock-header">
        <span>
          {toCall > 0 ? `轮到你行动，当前需要跟注 ${toCall}` : '轮到你行动'}
        </span>
        {progressPercent > 0 && (
          <span className="timer">{Math.ceil(remainingMs / 1000)}s</span>
        )}
      </div>
      {progressPercent > 0 && (
        <div className="timer-bar">
          <span style={{ width: `${progressPercent}%` }} />
        </div>
      )}
      <div className="actions">
        {foldAction && (
          <button className="btn red" onClick={() => handleAction('fold')}>
            弃牌
          </button>
        )}
        {checkCallAction && (
          <button className="btn ghost" onClick={() => handleAction('check_call')}>
            {toCall > 0 ? `跟注 ${toCall}` : '过牌'}
          </button>
        )}
        {raiseAction && (
          <div className="bet-group">
            <input
              type="number"
              value={betAmount}
              placeholder="金额"
              min={toCall > 0 ? game.currentBet + 1 : (game?.currentBet || 0) + 1}
              onChange={(e) => setBetAmount(e.target.value)}
            />
            <button
              className="btn gold"
              disabled={!betAmount || Number(betAmount) <= 0}
              onClick={() => handleAction(raiseAction.kind, betAmount)}
            >
              {raiseAction.kind === 'bet' ? '下注' : '加注'}
            </button>
          </div>
        )}
        {allInAction && (
          <button className="btn primary" onClick={() => handleAction('all_in')}>
            全下
          </button>
        )}
      </div>
    </footer>
  );
}
