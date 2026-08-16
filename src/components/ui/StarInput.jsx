import React, { useState } from "react";
import { Star } from "lucide-react";

export default function StarInput({ value, onChange }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="star-input">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          type="button"
          key={i}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(i)}
          aria-label={`${i} star${i > 1 ? "s" : ""}`}
        >
          <Star size={22} fill={i <= (hover || value) ? "#C9A15F" : "none"} color="#C9A15F" />
        </button>
      ))}
    </div>
  );
}
