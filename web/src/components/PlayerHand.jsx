import { PlayingCard } from './Card.jsx';

export default function PlayerHand({ hero, handFinished, lastHandResult, heroHandName }) {
  if (!hero) return null;

  const hole = hero.hole || [];
  const handName = hero.handName || (handFinished && lastHandResult?.revealed?.[hero.seatIndex]?.handName);
  // 对战中的实时牌型（flop/turn/river 时显示）
  const liveHandName = !handFinished && heroHandName ? heroHandName : null;

  return (
    <div className="hand-line">
      <span>你的手牌</span>
      {hole.length > 0 ? (
        hole.map((card, i) => (
          <PlayingCard key={i} card={card} />
        ))
      ) : (
        <>
          <PlayingCard card={null} />
          <PlayingCard card={null} />
        </>
      )}
      {handName && <span className="tag gold">{handName}</span>}
      {liveHandName && <span className="tag green">{liveHandName}</span>}
    </div>
  );
}
