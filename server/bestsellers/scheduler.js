// Recomputes bestsellers on an interval. Unlike the Sheets sync, this
// needs no external credentials — it only reads your own order data —
// so it's on by default. Disable with BESTSELLER_AUTO_ENABLED=false if
// you'd rather trigger it via OS cron using bestsellers/run.js instead.
import { computeBestsellers } from "./compute.js";

export function startBestsellerScheduler() {
  if (process.env.BESTSELLER_AUTO_ENABLED === "false") return;

  const hours = Number(process.env.BESTSELLER_INTERVAL_HOURS) || 6;
  const intervalMs = hours * 60 * 60 * 1000;

  console.log(`[bestsellers] scheduler enabled — recomputing every ${hours} hour(s).`);
  try {
    computeBestsellers(); // once at startup
  } catch (err) {
    console.error("[bestsellers] initial computation failed:", err);
  }
  setInterval(() => {
    try {
      computeBestsellers();
    } catch (err) {
      console.error("[bestsellers] scheduled computation failed:", err);
    }
  }, intervalMs);
}
