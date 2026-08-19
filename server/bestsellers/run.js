// Recompute bestsellers once and exit. Use for a manual run, or an
// OS cron job, e.g.: 0 */6 * * * cd /path/to/server && node bestsellers/run.js >> bestsellers.log 2>&1
import "dotenv/config";
import { computeBestsellers } from "./compute.js";

try {
  computeBestsellers();
  process.exit(0);
} catch (err) {
  console.error("[bestsellers] failed:", err);
  process.exit(1);
}
