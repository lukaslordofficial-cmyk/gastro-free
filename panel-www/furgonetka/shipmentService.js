/**
 * Tworzenie przesyłki Furgonetka (InPost Kurier) na podstawie zamówienia z Supabase.
 * Nadawca = przetwórca (local_producers), odbiorca = restaurator (lp_ship w notes / profiles).
 */

const { createClient } = require('@supabase/supabase-js');
const {
  furgonetkaConfigured,
  createAndOrderInpostCourier,
  downloadLabelPdf,
} = require('./client');

function supabaseAdmin() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('Brak SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function parseLpShip(notes) {
  if (!notes) return null;
  const idx = notes.indexOf('lp_ship:');
  if (idx < 0) return null;
  let raw = notes.slice(idx + 'lp_ship:'.length).trim();
  if (raw.includes(' |')) raw = raw.split(' |')[0].trim();
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function splitStreet(address) {
  const text = String(address || 'ul. Producenta').trim();
  const m = text.match(/^(.*?)[\s,]+(\d+[A-Za-z]?(?:\/\d+[A-Za-z]?)?)\s*$/);
  if (m) return { street: `${m[1].trim()} ${m[2]}`.trim(), building: m[2] };
  return { street: text, building: '1' };
}

function toFurgonetkaParty({ name, company, email, phone, street, city, postcode }) {
  return {
    name: (name || company || 'Odbiorca').slice(0, 70),
    company: (company || name || '').slice(0, 70),
    email: (email || 'orders@gastromanager.app').slice(0, 100),
    phone: String(phone || '500600700').replace(/\s+/g, '').slice(0, 20),
    street: (street || 'ul. Przykładowa 1').slice(0, 70),
    city: (city || 'Warszawa').slice(0, 40),
    country_code: 'PL',
    postcode: String(postcode || '00-001').replace(/\s+/g, '').slice(0, 10),
    county: '',
  };
}

async function loadOrderContext(orderId) {
  const sb = supabaseAdmin();
  const { data: order, error } = await sb
    .from('producer_orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (error || !order) throw new Error(error?.message || 'Zamówienie nie istnieje');

  const { data: producer } = await sb
    .from('local_producers')
    .select('*')
    .eq('id', order.producer_id)
    .maybeSingle();
  if (!producer) throw new Error('Brak producenta dla zamówienia');

  const ship = parseLpShip(order.notes);
  let restaurantName = ship?.name || 'Restauracja';
  let restaurantEmail = ship?.email || null;

  if (order.restaurant_account_key) {
    const { data: profile } = await sb
      .from('profiles')
      .select('restaurant_name,email')
      .eq('account_key', order.restaurant_account_key)
      .maybeSingle();
    if (profile?.restaurant_name) restaurantName = ship?.name || profile.restaurant_name;
    if (profile?.email) restaurantEmail = ship?.email || profile.email;
  }

  const senderStreet = splitStreet(producer.address);
  const pickup = toFurgonetkaParty({
    name: producer.owner_name || producer.company_name,
    company: producer.company_name,
    email: producer.email,
    phone: producer.phone,
    street: senderStreet.street,
    city: producer.city,
    postcode: producer.postal_code,
  });

  const receiver = toFurgonetkaParty({
    name: restaurantName,
    company: restaurantName,
    email: restaurantEmail,
    phone: ship?.phone,
    street: [ship?.street, ship?.building_number].filter(Boolean).join(' ') || 'ul. Restauracyjna 1',
    city: ship?.city,
    postcode: ship?.post_code,
  });

  return { order, producer, pickup, receiver };
}

/**
 * Po udanej płatności Stripe — utwórz paczkę InPost Kurier przez Furgonetkę.
 */
async function createShipmentForPaidOrder(orderId) {
  if (!furgonetkaConfigured()) {
    return {
      ok: true,
      stub: true,
      message: 'Furgonetka nie skonfigurowana — ustaw FURGONETKA_* env.',
    };
  }

  const { order, pickup, receiver } = await loadOrderContext(orderId);
  if (String(order.payment_status || '').toLowerCase() !== 'paid') {
    throw new Error('Zamówienie nie jest opłacone');
  }
  if (order.broker_package_id) {
    return {
      ok: true,
      already: true,
      package_id: order.broker_package_id,
      broker: order.broker_name || 'furgonetka',
    };
  }

  const result = await createAndOrderInpostCourier({
    pickup,
    receiver,
    reference: `LP-${String(orderId).slice(0, 8)}`,
  });

  const sb = supabaseAdmin();
  const patch = {
    broker_package_id: String(result.package_id),
    broker_name: 'furgonetka',
    broker_label_ready: !!result.ordered,
    shipment_status: result.ordered ? 'shipped' : 'preparing',
    order_status: 'processing',
  };
  if (result.tracking) patch.delivery_tracking = String(result.tracking);

  const { error } = await sb.from('producer_orders').update(patch).eq('id', orderId);
  if (error) {
    // degradacja bez order_status
    await sb.from('producer_orders').update({
      broker_package_id: patch.broker_package_id,
      broker_name: 'furgonetka',
      shipment_status: patch.shipment_status,
    }).eq('id', orderId);
  }

  return {
    ok: true,
    stub: false,
    package_id: result.package_id,
    tracking: result.tracking,
    ordered: result.ordered,
    broker: 'furgonetka',
    prepaid_note: 'Koszt etykiety pobrany ze skarbonki prepaid Furgonetka.',
  };
}

async function getLabelPdfForOrder(orderId) {
  const sb = supabaseAdmin();
  const { data: order, error } = await sb
    .from('producer_orders')
    .select('id,broker_package_id,producer_id')
    .eq('id', orderId)
    .maybeSingle();
  if (error || !order) throw new Error(error?.message || 'Zamówienie nie istnieje');
  if (!order.broker_package_id) {
    throw new Error('Brak broker_package_id — najpierw utwórz przesyłkę po płatności.');
  }
  const pdf = await downloadLabelPdf(
    order.broker_package_id,
    (process.env.FURGONETKA_LABEL_PAGE || 'a6').toLowerCase(),
  );
  await sb.from('producer_orders').update({ broker_label_ready: true }).eq('id', orderId);
  return { pdf, packageId: order.broker_package_id, producerId: order.producer_id };
}

module.exports = {
  createShipmentForPaidOrder,
  getLabelPdfForOrder,
  loadOrderContext,
  furgonetkaConfigured,
};
