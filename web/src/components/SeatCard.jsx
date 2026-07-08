import { PlayingCard, CardBack } from './Card.jsx';

const BLIND_POSITIONS = new Set(['SB', 'BB']);

/**
 * 根据座位索引和总座位数，计算围绕椭圆牌桌均匀分布的位置。
 * seatIndex 为 1-based（1 到 totalSeats），从正上方 12 点钟方向开始顺时针排列。
 * 返回 CSS inline style 对象。
 */
function getSeatStyle(seatIndex, totalSeats) {
  if (!totalSeats || totalSeats < 1) return {};
  const angle = ((seatIndex - 1) / totalSeats) * 2 * Math.PI - Math.PI / 2;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  // 使用 CSS 变量 --seat-rx / --seat-ry 控制椭圆半径，
 // 媒体查询可覆盖变量值实现移动端自适应
  return {
    left: `calc(50% + var(--seat-rx, 50%) * ${cosA})`,
    top: `calc(50% + var(--seat-ry, 50%) * ${sinA})`,
    transform: 'translate(-50%, -50%)',
  };
}

export default function SeatCard({
  // Common
  seatIndex,
  totalSeats,
  mode, // 'waiting' | 'playing'
  isYou,
  isHost,
  // Waiting state
  seat, // room.seats[i]
  isViewerHost,
  onSitDown,
  onLeaveSeat,
  onAddBot,
  onRemoveBot,
  // Playing state
  player, // game.players[i]
  isActive,
  handFinished,
  lastHandResult,
}) {
  const seatStyle = getSeatStyle(seatIndex, totalSeats);

  if (mode === 'waiting') {
    return <WaitingSeat
      seatIndex={seatIndex}
      seat={seat}
      isYou={isYou}
      isHost={isHost}
      isViewerHost={isViewerHost}
      onSitDown={onSitDown}
      onLeaveSeat={onLeaveSeat}
      onAddBot={onAddBot}
      onRemoveBot={onRemoveBot}
      seatStyle={seatStyle}
    />;
  }

  return <PlayingSeat
    seatIndex={seatIndex}
    player={player}
    isYou={isYou}
    isActive={isActive}
    handFinished={handFinished}
    lastHandResult={lastHandResult}
    seatStyle={seatStyle}
  />;
}

function WaitingSeat({ seatIndex, seat, isYou, isHost, isViewerHost, onSitDown, onLeaveSeat, onAddBot, onRemoveBot, seatStyle }) {
  if (!seat || seat.type === 'empty') {
    return (
      <div className="seat empty" style={seatStyle}>
        <div className="seat-card">
          <div className="empty-plus">+</div>
          <div className="empty-title">空位</div>
          <div className="seat-actions">
            <button className="btn small primary" onClick={() => onSitDown?.(seatIndex)}>入座</button>
            {isViewerHost && (
              <button className="btn small ghost" onClick={() => onAddBot?.(seatIndex)}>AI</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isBot = seat.type === 'bot';

  return (
    <div className={`seat ${isYou ? 'you' : ''}`} style={seatStyle}>
      <div className="seat-card">
        {isHost && <span className="dealer">房</span>}
        <div className="seat-meta">
          {isHost && <span className="position host">房主</span>}
          {isBot && <span className="position">AI</span>}
          {isYou && !isHost && <span className="position host">你</span>}
        </div>
        <div className="pname">{seat.displayName}</div>
        <div className="pstack">{seat.stack}</div>
        <div className="pstatus">
          {isBot ? (seat.botDifficulty || '普通') : '已入座'}
        </div>
        <div className="seat-actions">
          {isYou && <button className="btn small ghost" onClick={() => onLeaveSeat?.()}>离座</button>}
          {isBot && isViewerHost && (
            <button className="btn small red" onClick={() => onRemoveBot?.(seatIndex)}>移除</button>
          )}
        </div>
      </div>
    </div>
  );
}

function PlayingSeat({ seatIndex, player, isYou, isActive, handFinished, lastHandResult, seatStyle }) {
  if (!player) return null;

  const isFolded = player.folded;
  const isEliminated = player.eliminated;
  const showHole = player.hole && player.hole.length > 0;
  const revealed = lastHandResult?.revealed?.[seatIndex];
  const showFace = isYou || revealed;
  const position = player.position;
  const isBlind = BLIND_POSITIONS.has(position);
  const hasDealer = player.marks?.includes('庄');

  // 检测是否刚执行了加注或全下
  const statusText = player.status || '';
  const isRaise = statusText.includes('加注') || statusText.includes('下注');
  const isAllIn = statusText.includes('全下') || player.allIn;
  const isAggressive = (isRaise || isAllIn) && !isFolded && !isEliminated && !handFinished;

  // 摊牌阶段：赢家高亮
  const isWinner = handFinished && lastHandResult?.winners?.includes(seatIndex);
  const revealedHandName = revealed?.handName;

  const classes = [
    'seat',
    isYou ? 'you' : '',
    isActive ? 'active' : '',
    isFolded ? 'folded' : '',
    isAggressive ? (isAllIn ? 'allin-flash' : 'raise-flash') : '',
    isWinner ? 'winner' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} style={seatStyle}>
      {showHole && (
        <div className="hole">
          {player.hole.map((card, i) => (
            showFace
              ? <PlayingCard key={i} card={card} />
              : <CardBack key={i} />
          ))}
        </div>
      )}
      <div className="seat-card">
        {hasDealer && <span className="dealer">D</span>}
        <div className="seat-meta">
          {position && position !== '-' && (
            <span className={`position ${isBlind ? 'blind' : ''}`}>{position}</span>
          )}
        </div>
        <div className="pname">{player.name}</div>
        <div className="pstack">{player.stack}</div>
        <div className={`pstatus ${isAggressive ? (isAllIn ? 'allin-text' : 'raise-text') : ''} ${isWinner && revealedHandName ? 'winner-text' : ''}`}>
          {revealedHandName || player.handName || player.status}
        </div>
        {player.currentBet > 0 && !isFolded && !isEliminated && (
          <div className={`pbet ${isAggressive ? 'pbet-hot' : ''}`}>{player.currentBet}</div>
        )}
      </div>
    </div>
  );
}
