// Run once from your server directory after the pgvector migration:
//   node scripts/backfillEmbeddings.js
// Safe to re-run any time — only embeds photos that don't have an
// embedding yet (see imageMatch.js), so it also works as the "catch up
// new product photos" job if you add products between runs.
import "dotenv/config";
import { backfillProductEmbeddings } from "../imageMatch.js";

backfillProductEmbeddings()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
