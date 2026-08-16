import React from "react";

export default function BlossomDivider() {
  return (
    <div className="divider" role="presentation">
      <svg width="120" height="24" viewBox="0 0 120 24" fill="none">
        <path d="M0 12H45" stroke="#C9A15F" strokeWidth="1" />
        <path d="M75 12H120" stroke="#C9A15F" strokeWidth="1" />
        <g transform="translate(60,12)">
          <circle r="3" fill="#C9A15F" />
          {[0, 72, 144, 216, 288].map((deg) => (
            <ellipse key={deg} cx="0" cy="-7" rx="3.4" ry="5.5" fill="#E3A9BE" transform={`rotate(${deg})`} opacity="0.85" />
          ))}
        </g>
      </svg>
    </div>
  );
}
