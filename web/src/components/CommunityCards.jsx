import { PlayingCard } from './Card.jsx';

export default function CommunityCards({ board }) {
  const cards = board || [];
  const ghostCount = Math.max(0, 5 - cards.length);

  return (
    <div className="community">
      {cards.map((card, i) => (
        <PlayingCard key={i} card={card} />
      ))}
      {Array.from({ length: ghostCount }, (_, i) => (
        <PlayingCard key={`ghost-${i}`} card={null} />
      ))}
    </div>
  );
}
