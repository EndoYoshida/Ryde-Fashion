import React, { useState, useRef, useEffect } from "react";

// A text input that filters a list of {code, name} options as you type,
// showing matches in a dropdown styled to match the rest of the site
// (unlike a native <select>'s popup, which can't be restyled). Used for
// Province/City/Barangay in checkout, where each list can be long and
// cascades from the level above it.
export default function SearchableSelect({ value, options, onSelect, onClear, placeholder, disabled, loading }) {
  const [query, setQuery] = useState(value || "");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Keep the visible text in sync if the value changes from outside
  // (e.g. the parent clears it because a level above was changed).
  useEffect(() => { setQuery(value || ""); }, [value]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery(value || "");
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [value]);

  const filtered = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  const pick = (opt) => {
    onSelect(opt);
    setQuery(opt.name);
    setOpen(false);
  };

  const handleChange = (e) => {
    const next = e.target.value;
    setQuery(next);
    setOpen(true);
    if (!next) onClear?.();
  };

  return (
    <div className={`searchable-select ${disabled ? "disabled" : ""}`} ref={wrapRef}>
      <input
        value={query}
        disabled={disabled}
        placeholder={loading ? "Loading\u2026" : placeholder}
        onChange={handleChange}
        onFocus={() => !disabled && setOpen(true)}
      />
      {open && !disabled && (
        <div className="searchable-select-list">
          {loading ? (
            <div className="searchable-select-empty">Loading&hellip;</div>
          ) : filtered.length === 0 ? (
            <div className="searchable-select-empty">No matches</div>
          ) : (
            filtered.slice(0, 100).map((o) => (
              <div key={o.code} className="searchable-select-option" onMouseDown={() => pick(o)}>
                {o.name}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
