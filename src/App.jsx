import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import Home from "./screens/Home.jsx";
import Lobby from "./screens/Lobby.jsx";
import Swipe from "./screens/Swipe.jsx";
import Results from "./screens/Results.jsx";
import { EATERIES } from "./data/mockEateries.js";

export default function App() {
  const [votes, setVotes] = useState({});
  const [joined, setJoined] = useState(1);

  const deck = EATERIES.filter((e) => !(e.id in votes));

  // Records the vote and returns how many cards remain after it,
  // so the Swipe screen knows when to move on to results.
  const handleSwipe = (id, liked) => {
    setVotes((v) => ({ ...v, [id]: liked }));
    return deck.length - 1;
  };

  const reset = () => {
    setVotes({});
    setJoined(1);
  };

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/lobby" element={<Lobby joined={joined} setJoined={setJoined} />} />
      <Route path="/swipe" element={<Swipe deck={deck} onSwipe={handleSwipe} />} />
      <Route path="/results" element={<Results votes={votes} onReset={reset} />} />
    </Routes>
  );
}
