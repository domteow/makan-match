import { useNavigate } from "react-router-dom";
import Logo from "../components/Logo.jsx";
import SwipeDeck from "../components/SwipeDeck.jsx";

export default function Swipe({ deck, onSwipe }) {
  const navigate = useNavigate();

  const handleSwipe = (id, liked) => {
    const remaining = onSwipe(id, liked);
    if (remaining === 0) {
      setTimeout(() => navigate("/results"), 350);
    }
  };

  return (
    <div className="shell">
      <Logo />
      <div className="deck-status">{deck.length} left · near Tanjong Pagar</div>
      <SwipeDeck deck={deck} onSwipe={handleSwipe} />
    </div>
  );
}
