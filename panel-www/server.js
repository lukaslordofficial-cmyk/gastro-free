/**
 * Panel WWW / broker Node — Furgonetka (InPost Kurier) + etykiety PDF.
 *
 * Env:
 *   PORT, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (opcjonalnie — osobny webhook)
 *   FURGONETKA_CLIENT_ID, FURGONETKA_CLIENT_SECRET
 *   FURGONETKA_USERNAME, FURGONETKA_PASSWORD  LUB  FURGONETKA_ACCESS_TOKEN
 *   FURGONETKA_INPOST_SERVICE_ID (opcjonalnie)
 *   FURGONETKA_LABEL_PAGE=a6|a4
 *
 * Endpointy:
 *   POST /api/stripe/webhook-lp     — Stripe checkout.session.completed → Furgonetka
 *   POST /api/orders/:orderId/ship  — ręcznie utwórz przesyłkę (po paid)
 *   GET  /api/orders/:orderId/label — PDF etykiety dla przetwórcy
 *   GET  /api/health
 */

const express = require('express');
const Stripe = require('stripe');
const {
  createShipmentForPaidOrder,
  getLabelPdfForOrder,
  furgonetkaConfigured,
} = require('./furgonetka/shipmentService');

const app = express();
const port = Number(process.env.PORT || 3001);

// Surowy body tylko dla Stripe webhook
app.post(
  '/api/stripe/webhook-lp',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    const key = (process.env.STRIPE_SECRET_KEY || '').trim();
    if (!secret || !key) {
      return res.status(503).json({ detail: 'Brak STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY' });
    }
    const stripe = new Stripe(key);
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        secret,
      );
    } catch (e) {
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const meta = session.metadata || {};
        if (meta.kind === 'local_producer_order' && meta.order_id) {
          const paid = ['paid', 'no_payment_required'].includes(
            String(session.payment_status || '').toLowerCase(),
          );
          if (paid) {
            const shipment = await createShipmentForPaidOrder(meta.order_id);
            return res.json({ ok: true, action: 'furgonetka_shipment', shipment });
          }
        }
      }
      return res.json({ ok: true, ignored: true, type: event.type });
    } catch (e) {
      console.error('webhook-lp failed', e);
      return res.status(500).json({ ok: false, detail: e.message });
    }
  },
);

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'gastro-panel-www-broker',
    furgonetka_configured: furgonetkaConfigured(),
  });
});

/**
 * Wywołanie wewnętrzne po płatności (np. z Python Railway: HTTP POST).
 * Body: { order_id }
 */
app.post('/api/orders/:orderId/ship', async (req, res) => {
  try {
    const orderId = req.params.orderId || req.body?.order_id;
    if (!orderId) return res.status(400).json({ detail: 'Brak order_id' });
    const shipment = await createShipmentForPaidOrder(orderId);
    return res.json(shipment);
  } catch (e) {
    console.error(e);
    return res.status(502).json({ detail: e.message });
  }
});

/**
 * Etykieta PDF — przetwórca drukuje w panelu WWW.
 * GET /api/orders/:orderId/label
 */
app.get('/api/orders/:orderId/label', async (req, res) => {
  try {
    const { pdf, packageId } = await getLabelPdfForOrder(req.params.orderId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="etykieta-${packageId}.pdf"`,
    );
    return res.send(pdf);
  } catch (e) {
    console.error(e);
    return res.status(502).json({ detail: e.message });
  }
});

app.get('/api/producer-orders/:orderId/label', async (req, res) => {
  try {
    const { pdf, packageId } = await getLabelPdfForOrder(req.params.orderId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="etykieta-${packageId}.pdf"`);
    return res.send(pdf);
  } catch (e) {
    return res.status(502).json({ detail: e.message });
  }
});

app.listen(port, () => {
  console.log(`gastro-panel-www-broker listening on :${port}`);
  console.log(`Furgonetka configured: ${furgonetkaConfigured()}`);
});
