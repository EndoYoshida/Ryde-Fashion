// Run the sheet sync once and exit. Use this for:
//   - a manual test:            node sync/run.js
//   - a system cron job, e.g.:  */15 * * * * cd /path/to/server && node sync/run.js >> sync.log 2>&1
//
// This is a separate entrypoint from index.js on purpose — it doesn't
// start the Express server or the email poller, so a cron job invoking
// this doesn't spin up a second copy of your API by accident.
import "dotenv/config";
import { isSheetsSyncConfigured } from "./googleAuth.js";
import { runSheetsSync } from "./sheetsSync.js";

if (!isSheetsSyncConfigured()) {
  console.error(
    "[sheets-sync] Not configured — set GOOGLE_SERVICE_ACCOUNT_KEY_FILE and SHEETS_SYNC_SHEET_ID in server/.env. " +
    "See server/sync/README-SHEETS-SYNC.md."
  );
  process.exit(1);
}

(async () => {
  try {
    const summary = await runSheetsSync();
    process.exit(summary.errors.length ? 1 : 0);
  } catch (err) {
    console.error("[sheets-sync] fatal error:", err);
    process.exit(1);
  }
})();
