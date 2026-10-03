import { currency } from './catalogue.js';
import { sealWorkbook, unsealWorkbook } from './seal.js';

const loginPanel = document.querySelector('[data-admin-login]');
const app = document.querySelector('[data-admin-app]');
const loginForm = document.querySelector('[data-login-form]');
const loginStatus = document.querySelector('[data-login-status]');
const ordersHost = document.querySelector('[data-admin-orders]');
const summary = document.querySelector('[data-admin-summary]');
const exportStatus = document.querySelector('[data-export-status]');
const openStatus = document.querySelector('[data-open-status]');

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
        <p class="admin-order__name">${escapeHtml(order.full_name)} · ${escapeHtml(order.mobile)}${order.email ? ` · ${escapeHtml(order.email)}` : ''}</p>
        <p class="admin-order__address">${escapeHtml(order.address)}, ${escapeHtml(order.city)}, ${escapeHtml(order.state)} ${escapeHtml(order.pincode)}</p>
        <p class="admin-order__items">${escapeHtml(order.item_summary)}</p>
        <p class="admin-order__meta">
          Placed ${escapeHtml(formatWhen(order.created_at))} · deliver by ${escapeHtml(order.delivery_date)}
          ${order.has_preorder ? ' · preorder' : ''}${order.flagged ? ' · <strong>check this one</strong>' : ''}
        </p>
      </article>`,
    )
    .join('');
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
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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

   The workbook is fetched as plain bytes, then encrypted here and only then
   written to disk. The plaintext exists in this tab's memory for the length of
   one click and never reaches the filesystem. */
document.querySelector('[data-export-button]').addEventListener('click', async () => {
  const button = document.querySelector('[data-export-button]');
  const passphrase = document.querySelector('#export-passphrase').value;
  const confirm = document.querySelector('#export-confirm').value;
  exportStatus.textContent = '';

  if (passphrase.length < 8) {
    exportStatus.textContent = 'Use a passphrase of at least 8 characters.';
    return;
  }
  if (passphrase !== confirm) {
    exportStatus.textContent = 'The two passphrases do not match.';
    return;
  }

  button.disabled = true;
  exportStatus.textContent = 'Building and encrypting the sheet…';
  try {
    const response = await fetch('/api/orders?format=xlsx', { credentials: 'same-origin' });
    if (response.status === 401) {
      showLogin();
      return;
    }
    if (!response.ok) throw new Error('export failed');

    const workbook = new Uint8Array(await response.arrayBuffer());
    const sealed = await sealWorkbook(workbook, passphrase, { reference: `orders-${todayStamp()}` });

    saveBlob([sealed], `uppalapati-orders-${todayStamp()}.xlsx.enc`, 'application/octet-stream');
    document.querySelector('#export-passphrase').value = '';
    document.querySelector('#export-confirm').value = '';
    exportStatus.textContent =
      'Saved. Keep the passphrase somewhere safe — without it the sheet cannot be opened.';
  } catch (error) {
    exportStatus.textContent = `Could not create the sheet: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});

/* ---------- Reopening a saved sheet ---------- */
document.querySelector('[data-open-button]').addEventListener('click', async () => {
  const button = document.querySelector('[data-open-button]');
  const fileInput = document.querySelector('#open-file');
  const passphrase = document.querySelector('#open-passphrase').value;
  openStatus.textContent = '';

  const file = fileInput.files?.[0];
  if (!file) {
    openStatus.textContent = 'Choose a sealed sheet first.';
    return;
  }
  if (!passphrase) {
    openStatus.textContent = 'Enter the passphrase for the sheet.';
    return;
  }

  button.disabled = true;
  openStatus.textContent = 'Decrypting…';
  try {
    const workbook = await unsealWorkbook(await file.text(), passphrase);
    saveBlob(
      workbook,
      `uppalapati-orders-${todayStamp()}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    openStatus.textContent =
      'Decrypted. This copy is not password-protected — delete it once you have what you need from it.';
  } catch (error) {
    openStatus.textContent = error.message;
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
