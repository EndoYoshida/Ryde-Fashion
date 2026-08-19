// Optional: starts an interval that runs the sheet sync automatically
// while the server is up. This is the alternative to using an OS cron
// job with sync/run.js — pick one or the other, not both, or you'll get
// double syncs. Off by default; enabled by setting SHEETS_SYNC_ENABLED=true.
import { isSheetsSyncConfigured } from "./googleAuth.js";
import { runSheetsSync } from "./sheetsSync.js";

export function startSheetsSyncScheduler() {
  if (process.env.SHEETS_SYNC_ENABLED !== "true") return;

  if (!isSheetsSyncConfigured()) {
    console.warn(
      "[sheets-sync] SHEETS_SYNC_ENABLED=true but GOOGLE_SERVICE_ACCOUNT_KEY_FILE / SHEETS_SYNC_SHEET_ID " +
      "aren't set — sync will not run. See server/sync/README-SHEETS-SYNC.md."
    );
    return;
  }

  const minutes = Number(process.env.SHEETS_SYNC_INTERVAL_MINUTES) || 15;
  const intervalMs = minutes * 60 * 1000;

  console.log(`[sheets-sync] scheduler enabled — syncing every ${minutes} minute(s).`);
  runSheetsSync(); // run once at startup, then on the interval
  setInterval(runSheetsSync, intervalMs);
}
