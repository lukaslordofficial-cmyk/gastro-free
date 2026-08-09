/**
 * Przykład integracji Stripe Connect Express dla panelu WWW dystrybutora (Node.js).
 *
 * W produkcji gastro-16 te same ścieżki są w Python FastAPI (Railway):
 *   POST /api/stripe/connect
 *   GET  /api/stripe/connect/callback
 *   GET  /api/stripe/connect/status
 *   webhook account.updated → /api/billing/webhook
 *
 * Ten plik możesz skopiować do osobnego panelu Next/Express i wołać Stripe
 * bezpośrednio ALBO proxy'ować do backendu Railway.
 *
 * Wymagane env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * npm i stripe @supabase/supabase-js express
 */
/* eslint-disable no-console */

const express = require('express');
const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const PUBLIC_BASE = (process.env.PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

function returnUrl(producerId) {
  return `${PUBLIC_BASE}/api/stripe/connect/callback?producer_id=${producerId}`;
}
function refreshUrl(producerId) {
  return `${PUBLIC_BASE}/api/stripe/connect?producer_id=${producerId}&refresh=1`;
}

/**
 * POST /api/stripe/connect
 * Body: { producer_id }
 * Header: Authorization: Bearer <supabase_access_token>
 */
async function createConnectOnboarding(req, res) {
  try {
    const producerId = (req.body?.producer_id || '').trim();
    if (!producerId) return res.status(400).json({ detail: 'Brak producer_id' });

    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!auth) return res.status(401).json({ detail: 'Zaloguj się' });

    const { data: userData, error: userErr } = await supabase.auth.getUser(auth);
    if (userErr || !userData?.user) return res.status(401).json({ detail: 'Nieprawidłowy JWT' });

    const { data: producer, error } = await supabase
      .from('local_producers')
      .select('*')
      .eq('id', producerId)
      .maybeSingle();
    if (error || !producer) return res.status(404).json({ detail: 'Dystrybutor nie istnieje' });
    if (producer.auth_user_id && producer.auth_user_id !== userData.user.id) {
      return res.status(403).json({ detail: 'To nie jest Twój profil dystrybutora' });
    }

    let accountId = (producer.stripe_connect_id || producer.stripe_account_id || '').trim();
    if (!accountId.startsWith('acct_')) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'PL',
        email: producer.email || undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'company',
        metadata: { producer_id: producerId, kind: 'local_producer_connect' },
      });
      accountId = account.id;
      await supabase
        .from('local_producers')
        .update({ stripe_connect_id: accountId, stripe_account_id: accountId })
        .eq('id', producerId);
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl(producerId),
      return_url: returnUrl(producerId),
      type: 'account_onboarding',
    });

    return res.json({ ok: true, account_id: accountId, url: link.url });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ detail: e.message || 'Stripe Connect error' });
  }
}

/**
 * GET /api/stripe/connect/callback?producer_id=
 * Po powrocie ze Stripe — zapisuje acct_... i flagi onboardingu.
 */
async function connectCallback(req, res) {
  try {
    const producerId = String(req.query.producer_id || '').trim();
    if (!producerId) return res.status(400).send('Brak producer_id');

    const { data: producer } = await supabase
      .from('local_producers')
      .select('stripe_connect_id,stripe_account_id')
      .eq('id', producerId)
      .maybeSingle();

    const accountId = (producer?.stripe_connect_id || producer?.stripe_account_id || '').trim();
    if (!accountId.startsWith('acct_')) {
      return res.status(400).send('Brak stripe_connect_id — uruchom onboarding ponownie');
    }

    const account = await stripe.accounts.retrieve(accountId);
    const payoutsEnabled = !!account.payouts_enabled;
    const onboardingComplete = !!account.details_submitted && (account.charges_enabled || payoutsEnabled);

    await supabase
      .from('local_producers')
      .update({
        stripe_connect_id: account.id,
        stripe_account_id: account.id,
        payouts_enabled: payoutsEnabled,
        stripe_onboarding_complete: onboardingComplete,
      })
      .eq('id', producerId);

    const www = process.env.STRIPE_CONNECT_WWW_SUCCESS_URL || `${PUBLIC_BASE}/panel/stripe-ok`;
    return res.redirect(303, `${www}?producer_id=${producerId}&stripe_connect_id=${account.id}`);
  } catch (e) {
    console.error(e);
    return res.status(502).send(e.message || 'Callback error');
  }
}

/**
 * Fragment Checkout Session (Destination Charge) — analog backendu Python.
 * transfer_data.amount = wyłącznie produkty (grosze); kurier + 5% zostaje na platformie.
 */
async function createMarketplaceCheckoutSession({
  order,
  producer,
  successUrl,
  cancelUrl,
  customerEmail,
}) {
  const connectId = (producer.stripe_connect_id || producer.stripe_account_id || '').trim();
  if (!connectId.startsWith('acct_')) {
    throw new Error('Dystrybutor nie ma stripe_connect_id — najpierw Connect onboarding');
  }

  const productsGrosze = Math.round(Number(order.producer_amount || 0) * 100);
  const feeGrosze = Math.round(Number(order.platform_fee || 0) * 100);
  const courierGrosze = Math.round(Number(order.delivery_cost || order.shipping_cost || 0) * 100);
  const totalGrosze = Math.round(Number(order.total_price || 0) * 100);

  return stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerEmail || undefined,
    payment_method_types: ['card', 'blik'],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'pln',
          unit_amount: productsGrosze,
          product_data: { name: `Produkty — ${producer.company_name || 'Dystrybutor'}` },
        },
      },
      ...(courierGrosze > 0
        ? [{
          quantity: 1,
          price_data: {
            currency: 'pln',
            unit_amount: courierGrosze,
            product_data: { name: 'Kurier InPost' },
          },
        }]
        : []),
      ...(feeGrosze > 0
        ? [{
          quantity: 1,
          price_data: {
            currency: 'pln',
            unit_amount: feeGrosze,
            product_data: { name: 'Opłata serwisu platformy (5%)' },
          },
        }]
        : []),
    ].filter(Boolean),
    metadata: {
      kind: 'local_producer_order',
      order_id: order.id,
      stripe_connect_id: connectId,
      split_mode: 'destination',
    },
    payment_intent_data: {
      metadata: { kind: 'local_producer_order', order_id: order.id },
      transfer_data: {
        destination: connectId,
        amount: productsGrosze, // wyłącznie produkty → dystrybutor
      },
      // reszta (kurier + 5%) automatycznie zostaje na saldzie platformy
    },
    // sanity: total line items ≈ totalGrosze
    locale: 'pl',
  });
}

function mountStripeConnectRoutes(app = express()) {
  app.post('/api/stripe/connect', express.json(), createConnectOnboarding);
  app.get('/api/stripe/connect/callback', connectCallback);
  return app;
}

module.exports = {
  createConnectOnboarding,
  connectCallback,
  createMarketplaceCheckoutSession,
  mountStripeConnectRoutes,
};

if (require.main === module) {
  const app = express();
  mountStripeConnectRoutes(app);
  const port = Number(process.env.PORT || 3001);
  app.listen(port, () => console.log(`Stripe Connect example on :${port}`));
}
