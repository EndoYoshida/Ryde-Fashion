# Automatic Bestsellers

Instead of relying only on manually tagging a product "Bestseller" in the
admin dashboard, the server can periodically compute real bestsellers
from your actual paid order history and flag them automatically.

## How it works

On a schedule (every 6 hours by default), the server:

1. Sums up units sold (`order_items.qty`) per product, counting only
   orders where `payment_status = 'paid'` and `status != 'cancelled'` —
   pending/unpaid/failed/cancelled orders don't count as real demand.
2. Restricts this to the last **90 days** by default, so "Best Sellers"
   reflects what's popular *now*, not just whatever's been listed the
   longest.
3. Requires a product to have sold at least **3** units in that window
   to qualify at all — this stops a single lucky sale in a quiet store
   from being labeled a bestseller.
4. Flags the **top 8** qualifying products by marking a
   `products.auto_bestseller` column.

A product shows up as a bestseller on the storefront (homepage tile,
shop filter, footer link) if **either**:
- it was auto-flagged by this computation, **or**
- someone manually set its `tag` to `Bestseller` in the admin dashboard
  or the sheet sync.

The two don't conflict — a manually-tagged product stays a bestseller
even between automatic recomputations, and the automatic list doesn't
touch the `tag` field at all.

## Configuring it

All optional — in `server/.env`:

```
# Set to "false" to disable automatic computation entirely and only rely
# on manual tag="Bestseller" assignments.
BESTSELLER_AUTO_ENABLED=true

# How often to recompute (built-in scheduler), in hours.
BESTSELLER_INTERVAL_HOURS=6

# How many products get flagged.
BESTSELLER_COUNT=8

# Trailing window, in days. Set to 0 to use all-time sales instead.
BESTSELLER_WINDOW_DAYS=90

# Minimum units sold in the window to qualify at all.
BESTSELLER_MIN_QTY=3
```

## Running it manually / via OS cron

Instead of the built-in scheduler, you can trigger a one-off recompute:

```
cd server
npm run compute:bestsellers
```

Useful for testing, or if you'd rather drive this from an external
cron job (set `BESTSELLER_AUTO_ENABLED=false` in that case, so you don't
end up with two things recomputing at once):

```
0 */6 * * * cd /path/to/ryde-storefront/server && npm run compute:bestsellers >> bestsellers.log 2>&1
```

## Notes

- This only needs your own database — no external credentials, unlike
  the Google Sheets sync — so it's on by default.
- A store with very few orders may end up with zero auto-flagged
  bestsellers if nothing clears `BESTSELLER_MIN_QTY` yet. That's
  intentional — better to show nothing than a misleading "bestseller."
  Manually tagging a product in the meantime works fine as a fallback.
