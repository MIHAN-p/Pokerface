const SUIT_ICONS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS = new Set(['H', 'D']);
const RANK_LABELS = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function PlayingCard({ card, className = '', size = '' }) {
  if (!card) {
    return <div className={`card ghost ${size}`.trim()} />;
  }

  const rank = RANK_LABELS[card.rank] || (card.text ? card.text.slice(0, -1) : '');
  const suit = SUIT_ICONS[card.suit] || '';
  const isRed = RED_SUITS.has(card.suit);

  return (
    <div className={`card ${isRed ? 'red' : ''} ${size} ${className}`.trim()}>
      <div>
        <span className="rank">{rank}</span>
        <br />
        <span className="suit">{suit}</span>
      </div>
    </div>
  );
}

export function CardBack({ size = '' }) {
  return <div className={`card back ${size}`.trim()} />;
}
