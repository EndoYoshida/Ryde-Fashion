import React, { useMemo } from "react";

export default function Petals() {
  const petals = useMemo(() => Array.from({ length: 10 }, (_, i) => ({
    left: `${(i * 9.6) % 100}%`,
    delay: `${(i * 1.3) % 9}s`,
    dur: `${11 + (i % 5) * 2}s`,
    size: 10 + (i % 4) * 4,
  })), []);
  return (
    <div className="petals" aria-hidden="true">
      {petals.map((p, i) => (
        <span key={i} className="petal" style={{ left: p.left, animationDelay: p.delay, animationDuration: p.dur, width: p.size, height: p.size }} />
      ))}
    </div>
  );
}
