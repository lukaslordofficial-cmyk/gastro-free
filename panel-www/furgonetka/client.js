/**
 * Klient REST API Furgonetka.pl
 * Docs: https://furgonetka.pl/api/rest/packages-instruction
 *
 * Auth (kolejność):
 * 1) FURGONETKA_ACCESS_TOKEN (+ opcjonalnie FURGONETKA_REFRESH_TOKEN)
 * 2) password grant: CLIENT_ID/SECRET + USERNAME/PASSWORD
 *
 * Środki za etykietę schodzą z prepaid (skarbonki) przy PUT /order-commands.
 */

const API = (process.env.FURGONETKA_API_URL || 'https://api.furgonetka.pl').replace(/\/$/, '');
const ACCEPT_V1 = 'application/vnd.furgonetka.v1+json';
const ACCEPT_V2 = 'application/vnd.furgonetka.v2+json';

let cachedToken = {
  access: (process.env.FURGONETKA_ACCESS_TOKEN || '').trim() || null,
  refresh: (process.env.FURGONETKA_REFRESH_TOKEN || '').trim() || null,
  expiresAt: 0,
};

function basicAuthHeader() {
  const id = (process.env.FURGONETKA_CLIENT_ID || '').trim();
  const secret = (process.env.FURGONETKA_CLIENT_SECRET || '').trim();
  if (!id || !secret) {
    throw new Error('Brak FURGONETKA_CLIENT_ID / FURGONETKA_CLIENT_SECRET');
  }
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

function furgonetkaConfigured() {
  if ((process.env.FURGONETKA_ACCESS_TOKEN || '').trim()) return true;
  return Boolean(
    (process.env.FURGONETKA_CLIENT_ID || '').trim()
    && (process.env.FURGONETKA_CLIENT_SECRET || '').trim()
    && (process.env.FURGONETKA_USERNAME || '').trim()
    && (process.env.FURGONETKA_PASSWORD || '').trim(),
  );
}

async function fetchTokenPassword() {
  const body = new URLSearchParams({
    grant_type: 'password',
    scope: 'api',
    username: (process.env.FURGONETKA_USERNAME || '').trim(),
    password: (process.env.FURGONETKA_PASSWORD || '').trim(),
  });
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.message || `OAuth ${res.status}`);
  }
  cachedToken = {
    access: data.access_token,
    refresh: data.refresh_token || cachedToken.refresh,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000,
  };
  return cachedToken.access;
}

async function fetchTokenRefresh() {
  if (!cachedToken.refresh) throw new Error('Brak refresh_token');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: cachedToken.refresh,
  });
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    cachedToken.refresh = null;
    throw new Error(data.error_description || data.message || `Refresh ${res.status}`);
  }
  cachedToken = {
    access: data.access_token,
    refresh: data.refresh_token || cachedToken.refresh,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000,
  };
  return cachedToken.access;
}

async function getAccessToken() {
  if (cachedToken.access && (cachedToken.expiresAt === 0 || Date.now() < cachedToken.expiresAt)) {
    return cachedToken.access;
  }
  if (cachedToken.refresh) {
    try {
      return await fetchTokenRefresh();
    } catch {
      /* fall through */
    }
  }
  if ((process.env.FURGONETKA_USERNAME || '').trim()) {
    return fetchTokenPassword();
  }
  if (cachedToken.access) return cachedToken.access;
  throw new Error('Brak tokena Furgonetka — ustaw FURGONETKA_ACCESS_TOKEN lub USERNAME/PASSWORD');
}

async function apiRequest(path, {
  method = 'GET',
  body = undefined,
  accept = ACCEPT_V1,
  raw = false,
  query = undefined,
} = {}) {
  const token = await getAccessToken();
  let url = `${API}${path}`;
  if (query) {
    const qs = new URLSearchParams(query);
    url += `?${qs.toString()}`;
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: accept,
  };
  if (body !== undefined) {
    headers['Content-Type'] = accept.includes('v2') ? ACCEPT_V2 : ACCEPT_V1;
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (raw) {
    if (res.status === 204) return { status: 204, buffer: null, contentType: null };
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      const msg = buf.toString('utf8').slice(0, 400);
      throw new Error(`Furgonetka ${res.status}: ${msg}`);
    }
    return {
      status: res.status,
      buffer: buf,
      contentType: res.headers.get('content-type'),
    };
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.error_description || JSON.stringify(data).slice(0, 300);
    throw new Error(`Furgonetka ${res.status}: ${msg}`);
  }
  return data;
}

async function resolveInpostServiceId() {
  const forced = (process.env.FURGONETKA_INPOST_SERVICE_ID || '').trim();
  if (forced) return Number(forced) || forced;

  const data = await apiRequest('/account/services', { accept: ACCEPT_V1 });
  const services = data?.services || [];
  const inpost = services.find(
    (s) => String(s.service || '').toLowerCase() === 'inpost' && s.owner === 'furgonetka',
  ) || services.find((s) => String(s.service || '').toLowerCase() === 'inpost');
  if (!inpost?.id) {
    throw new Error(
      'Brak usługi InPost na koncie Furgonetka. Włącz InPost Kurier w panelu brokera '
      + 'lub ustaw FURGONETKA_INPOST_SERVICE_ID.',
    );
  }
  return inpost.id;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Tworzy + zamawia przesyłkę InPost Kurier (koszt z prepaid / skarbonki).
 * @returns {{ package_id: string, tracking?: string, ordered: boolean }}
 */
async function createAndOrderInpostCourier({
  pickup,
  receiver,
  reference,
  parcel = { height: 20, width: 30, depth: 40, weight: 2, quantity: 1, type: 'package' },
}) {
  const serviceId = await resolveInpostServiceId();
  const payload = {
    pickup,
    receiver,
    service_id: serviceId,
    parcels: [parcel],
    user_reference_number: String(reference || '').slice(0, 40),
    additional_services: {},
  };

  // Walidacja (opcjonalna — 204 = OK)
  try {
    await apiRequest('/packages/validate', {
      method: 'POST',
      body: payload,
      accept: ACCEPT_V2,
    });
  } catch (e) {
    // validate może zwrócić 400 z errors — przepuszczamy dalej przy create
    if (!String(e.message).includes('400')) throw e;
  }

  const created = await apiRequest('/packages', {
    method: 'POST',
    body: payload,
    accept: ACCEPT_V2,
  });
  const packageId = String(created.package_id || created.id || '');
  if (!packageId) throw new Error('Furgonetka nie zwróciła package_id');

  const cmdUuid = crypto.randomUUID();
  await apiRequest(`/order-commands/${cmdUuid}`, {
    method: 'PUT',
    body: {
      packages: [{ id: packageId }],
      label: {
        file_format: 'pdf',
        page_format: (process.env.FURGONETKA_LABEL_PAGE || 'a6').toLowerCase(),
      },
    },
    accept: ACCEPT_V1,
  });

  let ordered = false;
  let tracking;
  for (let i = 0; i < 12; i += 1) {
    await sleep(1500);
    const status = await apiRequest(`/order-commands/${cmdUuid}`, { accept: ACCEPT_V1 });
    const st = String(status?.status || '');
    if (st === 'successful' || st === 'partial_success') {
      ordered = true;
      break;
    }
    if (st === 'error') {
      const err = (status.errors || [])[0];
      throw new Error(err?.details || err?.message || 'Furgonetka order-commands error');
    }
  }

  try {
    const details = await apiRequest(`/packages/${packageId}`, { accept: ACCEPT_V2 });
    tracking = details?.tracking_number
      || details?.parcels?.[0]?.tracking_number
      || undefined;
  } catch {
    /* ignore */
  }

  return { package_id: packageId, tracking, ordered, service_id: serviceId };
}

async function downloadLabelPdf(packageId, pageFormat = 'a6') {
  const result = await apiRequest(`/packages/${packageId}/label`, {
    raw: true,
    query: { 'label[page_format]': pageFormat },
    accept: 'application/pdf',
  });
  if (result.status === 204 || !result.buffer) {
    throw new Error('Etykieta jeszcze niedostępna (204) — spróbuj za chwilę.');
  }
  return result.buffer;
}

module.exports = {
  furgonetkaConfigured,
  getAccessToken,
  resolveInpostServiceId,
  createAndOrderInpostCourier,
  downloadLabelPdf,
  apiRequest,
};
