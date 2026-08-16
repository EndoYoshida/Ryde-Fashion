import React from "react";

// Escapes special regex characters so the raw search query can be
// safely used inside a RegExp (e.g. if someone searches "R.Y.D.E").
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Renders `text`, wrapping every substring that matches `query`
 * (case-insensitive, word-for-word) in a <mark> so it can be styled.
 * If `query` is empty, the text renders unchanged.
 */
export default function HighlightText({ text, query }) {
  if (!query || !query.trim()) return <>{text}</>;

  const safeQuery = escapeRegExp(query.trim());
  const parts = text.split(new RegExp(`(${safeQuery})`, "gi"));

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.trim().toLowerCase() ? (
          <mark className="search-highlight" key={i}>{part}</mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}
