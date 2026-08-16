import React from "react";
import { Star } from "lucide-react";

export default function Stars({ rating }) {
  return (
    <span className="stars" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={13} fill={i <= Math.round(rating) ? "#C9A15F" : "none"} color="#C9A15F" />
      ))}
    </span>
  );
}
