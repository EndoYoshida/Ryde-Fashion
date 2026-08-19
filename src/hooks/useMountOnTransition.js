import { useEffect, useState } from "react";

// `open ? <Drawer /> : null` unmounts the drawer the instant it closes,
// which kills any slide/fade-out animation before it can play. This hook
// keeps the component mounted for `duration` ms after `open` goes false
// (long enough for the CSS close animation to finish), exposing a
// `closing` flag the component can use to switch from its open animation
// to its close animation.
//
// Usage:
//   const { shouldRender, closing } = useMountOnTransition(open, 280);
//   if (!shouldRender) return null;
//   <div className={`overlay ${closing ? "closing" : ""}`}>...
export default function useMountOnTransition(open, duration = 280) {
  const [shouldRender, setShouldRender] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setClosing(false);
      return;
    }
    if (!shouldRender) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setShouldRender(false);
      setClosing(false);
    }, duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { shouldRender, closing };
}
