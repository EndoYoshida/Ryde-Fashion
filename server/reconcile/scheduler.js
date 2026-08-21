import cron from "node-cron";
import { runReconciliation } from "../scripts/reconcile-firebase-customers.js";

// Runs the Firebase/customers reconciliation on a schedule, in-process.
// Uses the shared runReconciliation() (see scripts/reconcile-firebase-customers.js)
// rather than spawning the CLI script as a subprocess, so it can log
// through the app's normal console and never risks calling process.exit()
// on the running server.
//
// Schedule: every hour, on the hour. Change the cron expression below if
// you want a different cadence (e.g. "0 */6 * * *" for every 6 hours).
const SCHEDULE = "0 * * * *";

export function startReconcileScheduler() {
  cron.schedule(SCHEDULE, async () => {
    try {
      const summary = await runReconciliation({ delete: true });
      if (summary.strays.length || summary.mismatches.length) {
        console.log(
          `[reconcile-firebase-customers] deleted ${summary.deleted.length} orphaned Firebase user(s), ` +
          `flagged ${summary.mismatches.length} mismatch(es) for review.`
        );
      }
    } catch (err) {
      console.error("[reconcile-firebase-customers] scheduled run failed:", err.message);
    }
  });
  console.log(`Firebase/customers reconciliation scheduled (cron "${SCHEDULE}").`);
}
