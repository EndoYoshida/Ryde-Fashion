import crypto from "crypto";

// PayMongo integration — Checkout Sessions (hosted payment page).
//
// How this fits together:
//   1. A shopper places an order as usual (POST /api/orders) — unchanged.
//   2. If they picked "Pay Online" at checkout, the frontend calls
//      POST /api/orders/:id/paymongo-session, which uses this module to
//      create a PayMongo Checkout Session for that order's total and
//      returns the hosted checkout_url. The frontend redirects the
//      browser there.
//   3. PayMongo redirects the shopper back to success_url/cancel_url
//      (see routes/orders.js) once they finish (or abandon) payment.
//   4. Independently — and this is the part that actually marks the
//      order paid — PayMongo POSTs a `checkout_session.payment.paid`
//      event to /api/paymongo/webhook (see routes/paymongoWebhook.js).
//      Never trust the success_url redirect alone to mark something
//      paid: a shopper can land on success_url without ever actually
//      paying (closing the tab early, a flaky network, or just typing
//      the URL), so the webhook is the only source of truth.
//
// Required env vars (see server/.env.example):
//   PAYMONGO_SECRET_KEY     — sk_test_... while testing, sk_live_... once
//                             PayMongo approves your live account.
//   PAYMONGO_WEBHOOK_SECRET — from the webhook endpoint you register in
//                             the PayMongo Dashboard (Developers ->
//                             Webhooks). Used to verify incoming events
//                             really came from PayMongo.
//   PAYMONGO_PAYMENT_METHODS — comma-separated list of method types to
//                             offer on the Checkout Session, e.g.
//                             "qrph,gcash,card,paymaya". IMPORTANT: only
//                             list methods that show "Active" in your
//                             PayMongo Dashboard's Payment Methods page
//                             (Settings -> Payment Methods) — passing one
//                             that's still "Submitted"/pending review or
//                             "Inactive" makes session creation fail
//                             outright. Defaults to "qrph" alone, since
//                             as of this integration that's the only
//                             method shown Active on the account — add
//                             gcash/card/paymaya to this list the moment
//                             their dashboard status flips to Active.

const PAYMONGO_API = "https://api.paymongo.com/v1";

const SECRET_KEY = process.env.PAYMONGO_SECRET_KEY || "";
const WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET || "";

export const isPaymongoConfigured = Boolean(SECRET_KEY);
// PayMongo secret keys are always prefixed sk_test_ or sk_live_ — use that
// rather than a separate env flag, so there's only one place (the key
// itself) that can ever disagree with which mode is actually active.
export const isPaymongoTestMode = !SECRET_KEY || SECRET_KEY.startsWith("sk_test_");

export const paymongoEnabledMethods = (process.env.PAYMONGO_PAYMENT_METHODS || "qrph")
  .split(",")
  .map((m) => m.trim().toLowerCase())
  .filter(Boolean);

function authHeader() {
  // PayMongo uses HTTP Basic auth with the secret key as the username
  // and an empty password.
  return "Basic " + Buffer.from(`${SECRET_KEY}:`).toString("base64");
}

// Creates a PayMongo Checkout Session for an already-created order and
// returns the full session object (its `attributes.checkout_url` is what
// the frontend redirects the browser to). Amounts to PayMongo are always
// in the smallest currency unit — centavos for PHP — so the order's peso
// total is multiplied by 100.
export async function createCheckoutSession({ order, successUrl, cancelUrl }) {
  if (!isPaymongoConfigured) {
    throw new Error("PayMongo is not configured — set PAYMONGO_SECRET_KEY in server/.env");
  }
  if (paymongoEnabledMethods.length === 0) {
    throw new Error("No PayMongo payment methods are enabled (PAYMONGO_PAYMENT_METHODS is empty)");
  }

  const res = await fetch(`${PAYMONGO_API}/checkout_sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
    },
    body: JSON.stringify({
      data: {
        attributes: {
          billing: {
            name: order.customer,
            email: order.email,
            phone: order.phone || undefined,
          },
          send_email_receipt: false, // we already send our own branded receipt on order creation
          show_description: true,
          show_line_items: true,
          line_items: [
            {
              currency: "PHP",
              amount: Math.round(order.total * 100),
              name: `Ryde Fashion order #${order.id}`,
              quantity: 1,
            },
          ],
          payment_method_types: paymongoEnabledMethods,
          description: `Ryde Fashion order #${order.id}`,
          // Lets the webhook (and the PayMongo dashboard) trace this
          // session straight back to our order id.
          reference_number: order.id,
          success_url: successUrl,
          cancel_url: cancelUrl,
        },
      },
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.errors?.[0]?.detail || `PayMongo error (${res.status})`;
    throw new Error(message);
  }
  return json.data;
}

// Verifies the `Paymongo-Signature` header PayMongo sends on every
// webhook request. Header format: "t=<unix_ts>,te=<test_sig>,li=<live_sig>"
// — te/li are HMAC-SHA256 hex digests of "<t>.<raw_body>" computed with
// the webhook's secret key, one for test-mode events and one for live.
// Which one applies depends on the *webhook secret's* mode, which always
// matches the API key's mode (a test-mode endpoint only ever fires
// test-mode events), so isPaymongoTestMode is reused here too.
export function verifyPaymongoSignature(rawBody, signatureHeader) {
  if (!WEBHOOK_SECRET) return false;
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k?.trim(), v?.trim()];
    })
  );
  const timestamp = parts.t;
  const expectedSig = isPaymongoTestMode ? parts.te : parts.li;
  if (!timestamp || !expectedSig) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const computed = crypto.createHmac("sha256", WEBHOOK_SECRET).update(signedPayload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(expectedSig));
  } catch {
    return false; // length mismatch etc. — definitely not a match
  }
}

export const isPaymongoWebhookConfigured = Boolean(WEBHOOK_SECRET);
