import SeatCard from './SeatCard.jsx';
import CommunityCards from './CommunityCards.jsx';

const STAGE_EN = {
  '翻牌前': 'PREFLOP',
  '翻牌圈': 'FLOP',
  '转牌圈': 'TURN',
  '河牌圈': 'RIVER',
  '摊牌': 'SHOWDOWN',
};

export default function PokerTable({
  // Common
  mode, // 'waiting' | 'playing'
  // Room data
  room,
  you,
  // Waiting callbacks
  onSitDown,
  onLeaveSeat,
  onAddBot,
  onRemoveBot,
  // Playing data
  game,
}) {
  const isHost = you?.isHost;
  const mySeatIndex = you?.seatIndex;
  const totalSeats = mode === 'waiting'
    ? (room?.seats?.length || 0)
    : (game?.players?.length || room?.seats?.length || 0);

  const renderSeats = () => {
    if (mode === 'waiting') {
      return (room?.seats || []).map((seat) => (
        <SeatCard
          key={seat.index}
          seatIndex={seat.index}
          totalSeats={totalSeats}
          mode="waiting"
          seat={seat}
          isYou={seat.isYou}
          isHost={seat.isHost}
          isViewerHost={isHost}
          onSitDown={onSitDown}
          onLeaveSeat={onLeaveSeat}
          onAddBot={onAddBot}
          onRemoveBot={onRemoveBot}
        />
      ));
    }

    // Playing mode
    return (game?.players || []).map((player) => (
      <SeatCard
        key={player.seatIndex}
        seatIndex={player.seatIndex}
        totalSeats={totalSeats}
        mode="playing"
        player={player}
        isYou={player.seatIndex === mySeatIndex}
        isActive={game?.actionSeatIndex === player.seatIndex}
        handFinished={game?.handFinished}
        lastHandResult={game?.lastHandResult}
      />
    ));
  };

  const renderFeltCenter = () => {
    if (mode === 'waiting' || !game) {
      return (
        <div className="felt-center">
          <div className="stage">WAITING ROOM</div>
          <div className="pot">等待开始</div>
          <div className="pot-label">点击空位入座，或由房主添加 AI</div>
        </div>
      );
    }

    const stageEn = STAGE_EN[game.stage] || '';
    const stageText = stageEn ? `${stageEn} · ${game.stage}` : game.stage;
    const handFinished = game.handFinished;

    const showActionInfo = !handFinished && game.actionSeatIndex !== null;

    return (
      <div className="felt-center">
        <div className="stage">{stageText}</div>
        <CommunityCards board={game.board} />
        <div>
          <div className="pot-label">{handFinished ? '已分配底池' : '底池'}</div>
          <div className="pot">{game.pot}</div>
        </div>
        {showActionInfo && (
          <div className="felt-action-info">
            {game.currentBet > 0 && <span className="tag">当前注 {game.currentBet}</span>}
            <span className="tag gold">{game.actionPlayerName} 行动中</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="table-zone">
      <div className="poker-table">
        {renderSeats()}
        <div className="felt">
          {renderFeltCenter()}
        </div>
      </div>
    </div>
  );
}
