import { useState, useRef, useEffect } from "react";

// ---------- Mock data ----------
const IMG = (id) => `https://images.unsplash.com/${id}?w=640&q=75&fit=crop`;
const EATERIES = [
  { id: 1, name: "Tian Tian Chicken Rice", cuisine: "Hainanese", emoji: "🍗", price: "$", dist: "450m", rating: 4.6, tag: "Maxwell Food Centre", img: IMG("photo-1617093727343-374698b1b08d") },
  { id: 2, name: "Koh Grill & Sushi Bar", cuisine: "Japanese", emoji: "🍣", price: "$$", dist: "1.2km", rating: 4.4, tag: "Wisma Atria", img: IMG("photo-1579871494447-9811cf80d66c") },
  { id: 3, name: "328 Katong Laksa", cuisine: "Peranakan", emoji: "🍜", price: "$", dist: "800m", rating: 4.5, tag: "East Coast Rd", img: IMG("photo-1569718212165-3a8278d5f624") },
  { id: 4, name: "Burnt Ends", cuisine: "Modern BBQ", emoji: "🔥", price: "$$$$", dist: "2.1km", rating: 4.7, tag: "Dempsey Hill", img: IMG("photo-1544025162-d76694265947") },
  { id: 5, name: "Nakhon Kitchen", cuisine: "Thai", emoji: "🌶️", price: "$$", dist: "650m", rating: 4.3, tag: "Holland Village", img: IMG("photo-1455619452474-d2be8b1e70cd") },
  { id: 6, name: "Muthu's Curry", cuisine: "Indian", emoji: "🍛", price: "$$", dist: "1.5km", rating: 4.4, tag: "Race Course Rd", img: IMG("photo-1585937421612-70a008356fbe") },
  { id: 7, name: "Haidilao Hot Pot", cuisine: "Sichuan", emoji: "🍲", price: "$$$", dist: "900m", rating: 4.5, tag: "Clarke Quay", img: IMG("photo-1547592180-85f173990554") },
  { id: 8, name: "Two Men Bagel House", cuisine: "Brunch", emoji: "🥯", price: "$$", dist: "1.1km", rating: 4.5, tag: "Icon Village", img: IMG("photo-1525351484163-7529414344d8") },
];

const FRIENDS = [
  { name: "You", color: "#E8542F" },
  { name: "Treva", color: "#2E8B57" },
  { name: "Wei Jie", color: "#D4A017" },
  { name: "Sarah", color: "#7B5EA7" },
];

// Simulated friend votes (deterministic, so "matches" feel real)
const FRIEND_VOTES = {
  1: [true, true, true], 2: [true, false, true], 3: [true, true, true],
  4: [false, true, false], 5: [true, true, false], 6: [false, false, true],
  7: [true, true, true], 8: [true, false, false],
};

const SWIPE_THRESHOLD = 110;

// ---------- Swipeable card ----------
function SwipeCard({ eatery, onSwipe, isTop, stackIndex }) {
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false });
  const [imgFailed, setImgFailed] = useState(false);
  const [leaving, setLeaving] = useState(null);
  const start = useRef({ x: 0, y: 0 });

  const handleDown = (e) => {
    if (!isTop || leaving) return;
    const p = e.touches ? e.touches[0] : e;
    start.current = { x: p.clientX, y: p.clientY };
    setDrag((d) => ({ ...d, active: true }));
  };
  const handleMove = (e) => {
    if (!drag.active || leaving) return;
    const p = e.touches ? e.touches[0] : e;
    setDrag({ x: p.clientX - start.current.x, y: p.clientY - start.current.y, active: true });
  };
  const release = () => {
    if (!drag.active || leaving) return;
    if (Math.abs(drag.x) > SWIPE_THRESHOLD) {
      const dir = drag.x > 0 ? "right" : "left";
      setLeaving(dir);
      setTimeout(() => onSwipe(eatery.id, dir === "right"), 260);
    } else {
      setDrag({ x: 0, y: 0, active: false });
    }
  };

  // programmatic swipe via buttons
  useEffect(() => {
    if (eatery._forced && !leaving) {
      setLeaving(eatery._forced);
      setTimeout(() => onSwipe(eatery.id, eatery._forced === "right"), 260);
    }
  }, [eatery._forced]); // eslint-disable-line

  const x = leaving ? (leaving === "right" ? 600 : -600) : drag.x;
  const y = leaving ? drag.y - 40 : drag.y;
  const rot = x / 18;
  const yesOpacity = Math.min(Math.max(x / SWIPE_THRESHOLD, 0), 1);
  const noOpacity = Math.min(Math.max(-x / SWIPE_THRESHOLD, 0), 1);

  const scale = isTop ? 1 : 1 - stackIndex * 0.045;
  const offsetY = isTop ? 0 : stackIndex * 14;

  return (
    <div
      onMouseDown={handleDown} onMouseMove={handleMove} onMouseUp={release} onMouseLeave={release}
      onTouchStart={handleDown} onTouchMove={handleMove} onTouchEnd={release}
      style={{
        position: "absolute", inset: 0,
        transform: `translate(${isTop ? x : 0}px, ${isTop ? y + offsetY : offsetY}px) rotate(${isTop ? rot : 0}deg) scale(${scale})`,
        transition: drag.active ? "none" : "transform 0.26s cubic-bezier(.2,.8,.3,1)",
        cursor: isTop ? "grab" : "default",
        zIndex: 10 - stackIndex,
        userSelect: "none", touchAction: "none",
      }}
    >
      <div style={{
        height: "100%", borderRadius: 20, overflow: "hidden",
        background: "#FDF6E3", border: "2px solid #1A1512",
        boxShadow: isTop ? "0 12px 32px rgba(0,0,0,0.35)" : "0 4px 12px rgba(0,0,0,0.2)",
        display: "flex", flexDirection: "column",
      }}>
        {/* Food header */}
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          background: `repeating-linear-gradient(45deg, #F3E9D0, #F3E9D0 14px, #EFE3C4 14px, #EFE3C4 28px)`,
          borderBottom: "2px solid #1A1512", position: "relative", minHeight: 180, overflow: "hidden",
        }}>
          {/* Emoji fallback layer (visible if photo fails) */}
          <span style={{ fontSize: 96, filter: "drop-shadow(0 6px 8px rgba(0,0,0,0.15))" }}>{eatery.emoji}</span>
          {/* Real photo */}
          {!imgFailed && (
            <img
              src={eatery.img} alt={eatery.name} draggable={false}
              onError={() => setImgFailed(true)}
              style={{
                position: "absolute", inset: 0, width: "100%", height: "100%",
                objectFit: "cover", pointerEvents: "none",
              }}
            />
          )}
          {/* Bottom gradient so stamps + card edge read cleanly over photos */}
          <div style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            background: "linear-gradient(to top, rgba(26,21,18,0.25), transparent 35%)",
          }} />
          {/* Stamps */}
          <div style={{
            position: "absolute", top: 18, left: 16, opacity: yesOpacity,
            transform: "rotate(-14deg)", border: "4px solid #2FBF71", color: "#2FBF71",
            background: "rgba(253,246,227,0.9)",
            padding: "4px 14px", borderRadius: 8, fontWeight: 900, fontSize: 28, letterSpacing: 2,
            fontFamily: "'Archivo Black', system-ui, sans-serif",
          }}>SHIOK</div>
          <div style={{
            position: "absolute", top: 18, right: 16, opacity: noOpacity,
            transform: "rotate(14deg)", border: "4px solid #C8331F", color: "#C8331F",
            background: "rgba(253,246,227,0.9)",
            padding: "4px 14px", borderRadius: 8, fontWeight: 900, fontSize: 28, letterSpacing: 2,
            fontFamily: "'Archivo Black', system-ui, sans-serif",
          }}>PASS</div>
        </div>
        {/* Info */}
        <div style={{ padding: "16px 18px 18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ margin: 0, fontSize: 22, fontFamily: "'Archivo Black', system-ui, sans-serif", color: "#1A1512", lineHeight: 1.15 }}>{eatery.name}</h2>
            <span style={{ fontWeight: 800, color: "#1A1512", fontSize: 15, marginLeft: 8, whiteSpace: "nowrap" }}>{eatery.price}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 14, color: "#5A5148" }}>{eatery.cuisine} · {eatery.tag}</div>
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <Chip>★ {eatery.rating}</Chip>
            <Chip>{eatery.dist} away</Chip>
          </div>
        </div>
      </div>
    </div>
  );
}

const Chip = ({ children }) => (
  <span style={{
    background: "#1A1512", color: "#FDF6E3", borderRadius: 999,
    padding: "4px 12px", fontSize: 12.5, fontWeight: 700,
  }}>{children}</span>
);

// ---------- Main app ----------
export default function MakanMatch() {
  const [screen, setScreen] = useState("home"); // home | lobby | swipe | results
  const [deck, setDeck] = useState(EATERIES);
  const [votes, setVotes] = useState({});
  const [joined, setJoined] = useState(1);
  const roomCode = "MKN-7B3";

  // fake friends joining the lobby
  useEffect(() => {
    if (screen !== "lobby") return;
    if (joined >= FRIENDS.length) return;
    const t = setTimeout(() => setJoined((j) => j + 1), 900);
    return () => clearTimeout(t);
  }, [screen, joined]);

  const handleSwipe = (id, liked) => {
    setVotes((v) => ({ ...v, [id]: liked }));
    setDeck((d) => {
      const next = d.filter((e) => e.id !== id);
      if (next.length === 0) setTimeout(() => setScreen("results"), 350);
      return next;
    });
  };
  const forceSwipe = (dir) => {
    setDeck((d) => d.map((e, i) => (i === 0 ? { ...e, _forced: dir } : e)));
  };

  const matches = EATERIES.map((e) => {
    const all = [votes[e.id], ...(FRIEND_VOTES[e.id] || [])];
    const yes = all.filter(Boolean).length;
    return { ...e, yes, total: all.length, unanimous: yes === all.length };
  }).filter((m) => m.yes >= 3).sort((a, b) => b.yes - a.yes);

  const shell = {
    minHeight: "100vh", background: "#0E3B36",
    backgroundImage: "radial-gradient(circle at 20% 10%, rgba(255,255,255,0.05), transparent 40%)",
    fontFamily: "'Public Sans', system-ui, sans-serif",
    display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px",
  };
  const btn = (bg, color = "#FDF6E3") => ({
    background: bg, color, border: "2px solid #1A1512", borderRadius: 14,
    padding: "14px 28px", fontSize: 16, fontWeight: 800, cursor: "pointer",
    boxShadow: "0 4px 0 #1A1512", fontFamily: "inherit",
  });

  const Logo = () => (
    <div style={{ textAlign: "center", marginBottom: 8 }}>
      <div style={{
        fontFamily: "'Archivo Black', system-ui, sans-serif", fontSize: 34, color: "#FDF6E3",
        letterSpacing: 1, lineHeight: 1,
      }}>MAKAN<span style={{ color: "#E8542F" }}>MATCH</span></div>
      <div style={{ color: "#9DC4BC", fontSize: 13, marginTop: 6, fontWeight: 600 }}>swipe. match. makan.</div>
    </div>
  );

  // ---------- Screens ----------
  if (screen === "home") return (
    <div style={shell}>
      <div style={{ flex: 1 }} />
      <Logo />
      <p style={{ color: "#C9DDD8", maxWidth: 300, textAlign: "center", fontSize: 15, lineHeight: 1.5 }}>
        Stop the "anything lah" loop. Start a session, everyone swipes, eat where you all match.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20, width: 260 }}>
        <button style={btn("#E8542F")} onClick={() => setScreen("lobby")}>Start a session</button>
        <button style={btn("#FDF6E3", "#1A1512")} onClick={() => setScreen("lobby")}>Join with code</button>
      </div>
      <div style={{ flex: 1.4 }} />
    </div>
  );

  if (screen === "lobby") return (
    <div style={shell}>
      <Logo />
      <div style={{
        marginTop: 28, background: "#FDF6E3", border: "2px dashed #1A1512", borderRadius: 16,
        padding: "18px 30px", textAlign: "center",
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#5A5148", letterSpacing: 2 }}>ROOM CODE</div>
        <div style={{ fontFamily: "'Archivo Black', system-ui, sans-serif", fontSize: 36, color: "#1A1512", letterSpacing: 3 }}>{roomCode}</div>
      </div>
      <div style={{ marginTop: 28, width: "100%", maxWidth: 320 }}>
        <div style={{ color: "#9DC4BC", fontSize: 13, fontWeight: 700, marginBottom: 12, letterSpacing: 1 }}>IN THE QUEUE ({joined}/4)</div>
        {FRIENDS.slice(0, joined).map((f) => (
          <div key={f.name} style={{
            display: "flex", alignItems: "center", gap: 12, background: "rgba(253,246,227,0.08)",
            borderRadius: 12, padding: "10px 14px", marginBottom: 8,
          }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: f.color, border: "2px solid #FDF6E3", display: "flex", alignItems: "center", justifyContent: "center", color: "#FDF6E3", fontWeight: 800 }}>{f.name[0]}</div>
            <span style={{ color: "#FDF6E3", fontWeight: 700 }}>{f.name}</span>
            {f.name === "You" && <span style={{ marginLeft: "auto", fontSize: 11, color: "#9DC4BC", fontWeight: 700 }}>HOST</span>}
          </div>
        ))}
      </div>
      <button
        style={{ ...btn(joined === 4 ? "#E8542F" : "#5A6E6A"), marginTop: 24, opacity: joined === 4 ? 1 : 0.7 }}
        disabled={joined < 4}
        onClick={() => setScreen("swipe")}
      >{joined === 4 ? "Start swiping →" : "Waiting for friends…"}</button>
    </div>
  );

  if (screen === "swipe") return (
    <div style={shell}>
      <Logo />
      <div style={{ color: "#9DC4BC", fontSize: 13, fontWeight: 700, marginTop: 4 }}>{deck.length} left · near Tanjong Pagar</div>
      <div style={{ position: "relative", width: "100%", maxWidth: 330, height: 430, marginTop: 20 }}>
        {deck.slice(0, 3).map((e, i) => (
          <SwipeCard key={e.id} eatery={e} isTop={i === 0} stackIndex={i} onSwipe={handleSwipe} />
        )).reverse()}
        {deck.length === 0 && (
          <div style={{ color: "#FDF6E3", textAlign: "center", paddingTop: 160, fontWeight: 700 }}>Tallying votes…</div>
        )}
      </div>
      {deck.length > 0 && (
        <div style={{ display: "flex", gap: 20, marginTop: 18 }}>
          <button onClick={() => forceSwipe("left")} style={{ ...btn("#C8331F"), width: 74, fontSize: 22, padding: "12px 0" }}>✕</button>
          <button onClick={() => forceSwipe("right")} style={{ ...btn("#1F7A4D"), width: 74, fontSize: 22, padding: "12px 0" }}>♥</button>
        </div>
      )}
    </div>
  );

  // results
  return (
    <div style={shell}>
      <Logo />
      <div style={{
        fontFamily: "'Archivo Black', system-ui, sans-serif", color: "#FDF6E3", fontSize: 22, marginTop: 20,
      }}>{matches.length > 0 ? "It's a makan! 🎉" : "No matches 😅"}</div>
      <div style={{ width: "100%", maxWidth: 340, marginTop: 16 }}>
        {matches.map((m, i) => (
          <div key={m.id} style={{
            background: "#FDF6E3", border: "2px solid #1A1512", borderRadius: 16, padding: "14px 16px",
            marginBottom: 10, display: "flex", alignItems: "center", gap: 14,
            boxShadow: i === 0 ? "0 0 0 3px #E8542F" : "none",
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: 12, overflow: "hidden", flexShrink: 0,
              border: "2px solid #1A1512", display: "flex", alignItems: "center", justifyContent: "center",
              background: "#F3E9D0", fontSize: 26, position: "relative",
            }}>
              <span>{m.emoji}</span>
              <img src={m.img} alt="" draggable={false}
                onError={(e) => { e.target.style.display = "none"; }}
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: "#1A1512", fontSize: 15.5 }}>{m.name}</div>
              <div style={{ fontSize: 12.5, color: "#5A5148" }}>{m.cuisine} · {m.dist} · {m.price}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{
                fontFamily: "'Archivo Black', system-ui, sans-serif", fontSize: 18,
                color: m.unanimous ? "#1F7A4D" : "#B8860B",
              }}>{m.yes}/{m.total}</div>
              {m.unanimous && <div style={{ fontSize: 10, fontWeight: 800, color: "#1F7A4D" }}>ALL IN</div>}
            </div>
          </div>
        ))}
        {matches.length === 0 && (
          <p style={{ color: "#C9DDD8", textAlign: "center" }}>Everyone too picky lah. Try a wider radius?</p>
        )}
      </div>
      <button style={{ ...btn("#FDF6E3", "#1A1512"), marginTop: 16 }} onClick={() => {
        setDeck(EATERIES); setVotes({}); setJoined(1); setScreen("home");
      }}>New session</button>
    </div>
  );
}
