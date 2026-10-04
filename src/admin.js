import { currency } from './catalogue.js';

const loginPanel = document.querySelector('[data-admin-login]');
const app = document.querySelector('[data-admin-app]');
const loginForm = document.querySelector('[data-login-form]');
const loginStatus = document.querySelector('[data-login-status]');
const ordersHost = document.querySelector('[data-admin-orders]');
const summary = document.querySelector('[data-admin-summary]');
const exportStatus = document.querySelector('[data-export-status]');

/* Every call is same-origin and credentials are sent by default, so the session
   cookie rides along without being read by JavaScript — it is HttpOnly. There is
   no token in localStorage for a leaked script to steal. */

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function saveBlob(bytes, filename, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  /* Revoked on the next turn rather than immediately: Safari has been seen to
     cancel an in-flight download if the object URL disappears in the same tick
     as the click. */
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function renderOrders(orders) {
  if (orders.length === 0) {
    ordersHost.innerHTML = '<p class="admin-empty">No orders yet.</p>';
    return;
  }

  const flagged = orders.filter((order) => order.flagged).length;
  const value = orders.reduce((sum, order) => sum + order.total, 0);

  summary.textContent =
    `${orders.length} order${orders.length === 1 ? '' : 's'} recorded · ` +
    `${currency.format(value)} in total` +
    (flagged ? ` · ${flagged} flagged for review` : '');

  ordersHost.innerHTML = orders
    .map(
      (order) => `<article class="admin-order${order.flagged ? ' admin-order--flagged' : ''}">
        <header>
          <h3>${order.reference}</h3>
          <span class="admin-order__total">${currency.format(order.total)}</span>
        </header>
        <p class="admin-order__when">Placed ${escapeHtml(formatWhen(order.created_at))}</p>
        <p class="admin-order__name">${escapeHtml(order.full_name)}</p>
        <p class="admin-order__contact">WhatsApp ${escapeHtml(formatMobile(order.mobile))}${order.email ? ` · ${escapeHtml(order.email)}` : ''}</p>
        <p class="admin-order__address">${escapeHtml(order.address)}, ${escapeHtml(order.city)}, ${escapeHtml(order.state)} ${escapeHtml(order.pincode)}</p>
        <p class="admin-order__items">${escapeHtml(order.item_summary)}</p>
        <p class="admin-order__meta">
          Deliver by ${escapeHtml(order.delivery_date)}${order.has_preorder ? ' · preorder' : ''}${order.flagged ? ' · <strong>check this one</strong>' : ''}
        </p>
      </article>`,
    )
    .join('');
}

/* The number as the farm reads it back out, which is also what wa.me wants
   once the country code is put in front. Anything that is not the ten digits
   validation guarantees is passed through rather than mangled. */
function formatMobile(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== 10) return String(value ?? '');
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/* Order data is customer-supplied text rendered into the page. `textContent`
   would be safer but cannot build the card; escaping means a name containing
   "<" is shown rather than parsed. */
function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

function formatWhen(iso) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return `${parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })} IST`;
}

async function loadOrders() {
  const { response, body } = await api('/api/orders');
  if (response.status === 401) {
    showLogin();
    return;
  }
  if (!response.ok || !body?.ok) {
    ordersHost.innerHTML = '<p class="admin-empty">Could not load the order book. Try again shortly.</p>';
    return;
  }
  renderOrders(body.orders);
}

function showLogin() {
  loginPanel.hidden = false;
  app.hidden = true;
  document.querySelector('#passphrase')?.focus();
}

function showApp() {
  loginPanel.hidden = true;
  app.hidden = false;
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = document.querySelector('[data-login-submit]');
  const passphrase = document.querySelector('#passphrase').value;
  loginStatus.textContent = '';
  submit.disabled = true;
  try {
    const { response, body } = await api('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    if (!response.ok) {
      loginStatus.textContent = body?.error || 'Could not sign in.';
      return;
    }
    document.querySelector('#passphrase').value = '';
    showApp();
    await loadOrders();
  } catch {
    loginStatus.textContent = 'Could not reach the shop. Check your connection and try again.';
  } finally {
    submit.disabled = false;
  }
});

document.querySelector('[data-admin-signout]').addEventListener('click', async () => {
  await api('/api/session', { method: 'DELETE' });
  showLogin();
});

/* ---------- Export ----------

   The sheet is built by the server from the same order book this page is
   showing, and the request only succeeds while the owner session is valid, so
   it is written straight to disk as an ordinary .xlsx. Nothing is encrypted
   here: the passphrase on this page is the only thing standing between a
   stranger and these orders, and it never reaches the export. */
document.querySelector('[data-export-button]').addEventListener('click', async () => {
  const button = document.querySelector('[data-export-button]');
  exportStatus.textContent = '';
  button.disabled = true;
  exportStatus.textContent = 'Building the sheet…';
  try {
    const response = await fetch('/api/orders?format=xlsx', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (response.status === 401) {
      showLogin();
      return;
    }
    if (!response.ok) throw new Error('the shop did not return a sheet');

    const workbook = new Uint8Array(await response.arrayBuffer());
    saveBlob(
      workbook,
      `uppalapati-orders-${todayStamp()}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    exportStatus.textContent = 'Saved. Open it in Excel, Google Sheets or Numbers.';
  } catch (error) {
    exportStatus.textContent = `Could not create the sheet: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

/* On load, ask whether the session cookie is still good before showing a login
   form to somebody who is already signed in. */
(async () => {
  const { body } = await api('/api/session');
  if (body?.signedIn) {
    showApp();
    await loadOrders();
  } else {
    showLogin();
  }
})();
