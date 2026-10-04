import { currency } from './catalogue.js';
import { ORDER_STATUSES, isOrderStatus, statusLabel } from './order-status.js';

const loginPanel = document.querySelector('[data-admin-login]');
const app = document.querySelector('[data-admin-app]');
const loginForm = document.querySelector('[data-login-form]');
const loginStatus = document.querySelector('[data-login-status]');
const ordersHost = document.querySelector('[data-admin-orders]');
const summary = document.querySelector('[data-admin-summary]');
const exportStatus = document.querySelector('[data-export-status]');
const statusMessage = document.querySelector('[data-status-message]');

/* The loaded order book, kept so a status change can correct the counts in the
   summary without refetching. Refetching would rebuild the table and close any
   row the owner has open, and would yank the dropdown out from under the pointer
   they are still using. */
let orders = [];

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

/* ---------- The status picker ----------

   A real <select> of the five statuses, wrapped in a <label> so it is named for
   a screen reader without needing an id per row. `data-status` on the wrapper is
   what the colour rules key off; it is written from the server's value, and
   rewritten only once the server has confirmed the change, so a picker never
   wears the colour of a status that was refused.

   The confirmed value is kept in `data-status-saved` because a save that fails
   has to put the dropdown back where it was. Without it the picker would sit
   there showing the owner's choice as though it had been saved, which is the one
   failure this control cannot be allowed to have. */
function statusPicker(order) {
  const current = isOrderStatus(order.status) ? order.status : ORDER_STATUSES[0].value;

  const options = ORDER_STATUSES.map(
    (status) =>
      `<option value="${status.value}"${status.value === current ? ' selected' : ''}>${escapeHtml(status.label)}</option>`,
  ).join('');

  return `<label class="admin-status" data-status="${current}">
      <span class="sr-only">Status for ${escapeHtml(order.reference)}</span>
      <select data-status-for="${escapeHtml(order.reference)}" data-status-saved="${current}">${options}</select>
    </label>`;
}

/* One delegated listener, like the expand toggle, because the table is rebuilt
   wholesale whenever the orders reload. */
async function onStatusChange(event) {
  const select = event.target.closest('[data-status-for]');
  if (!select) return;

  const reference = select.dataset.statusFor;
  const previous = select.dataset.statusSaved;
  const chosen = select.value;

  if (chosen === previous) return;

  select.disabled = true;
  statusMessage.textContent = '';

  try {
    const { response, body } = await api('/api/orders', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference, status: chosen }),
    });

    /* Both ways this can end badly have to put the picker back. A dead session
       shows the login form, because the owner has to sign in again before
       anything else on this page will work. */
    if (response.status === 401) {
      select.value = previous;
      showLogin();
      return;
    }
    if (!response.ok || !body?.ok) {
      select.value = previous;
      statusMessage.textContent = body?.error || `Could not set ${reference} to that status.`;
      return;
    }

    /* The server's answer, not the selection: that is what was stored. */
    const stored = body.status;
    select.value = stored;
    select.dataset.statusSaved = stored;
    select.closest('.admin-status').dataset.status = stored;

    const order = orders.find((row) => row.reference === reference);
    if (order) order.status = stored;

    renderSummary();

    statusMessage.textContent = `${reference} is now ${statusLabel(stored)}.`;
  } catch {
    select.value = previous;
    statusMessage.textContent = 'Could not reach the shop. That status was not saved.';
  } finally {
    select.disabled = false;
  }
}

/* Counted from the order book rather than kept in a variable, so the counts
   cannot fall out of step with the rows.

   "Still to deliver" is the number the owner actually wants: every order that is
   neither completed nor canceled, so it counts the ones already contacted and
   already on the road as well as the ones untouched. */
const CLOSED_STATUSES = new Set(['completed', 'canceled']);

function renderSummary() {
  const flagged = orders.filter((order) => order.flagged).length;
  const value = orders.reduce((sum, order) => sum + order.total, 0);
  const open = orders.filter((order) => !CLOSED_STATUSES.has(order.status)).length;

  summary.textContent =
    `${orders.length} order${orders.length === 1 ? '' : 's'} recorded · ` +
    `${currency.format(value)} in total` +
    (open ? ` · ${open} still to deliver` : '') +
    (flagged ? ` · ${flagged} flagged for review` : '');
}

/* ---------- The order table ----------

   A row per order, scannable without scrolling. Two things are clickable and
   they do different jobs, so they are styled differently and labelled as such:

   - the customer's name expands the row underneath, for the address, the priced
     line items and anything else too wide for a column;
   - the phone number opens WhatsApp with their order already written out,
     because "tell them their reference" is the first thing that happens next.

   The number is the link out of the page and the name stays put, which is also
   why the number is the one styled in the monospaced face: the two are never
   mistakable for each other.

   Both are real links and buttons, so they work by keyboard and announce
   themselves; neither is a click handler bolted onto a <td>. */
function renderOrders(list) {
  orders = list;

  if (orders.length === 0) {
    /* Said here too, not just in the table, or the line above the table keeps
       whatever it last said — which on a first load is nothing at all. */
    summary.textContent = 'No orders recorded yet.';
    ordersHost.innerHTML = '<p class="admin-empty">No orders yet.</p>';
    return;
  }

  renderSummary();

  const rows = orders
    .map((order) => {
      const detailId = `detail-${order.reference}`;
      return `<tr class="admin-row${order.flagged ? ' admin-row--flagged' : ''}">
          <td class="admin-cell admin-cell--status">${statusPicker(order)}</td>
          <td class="admin-cell admin-cell--ref">
            <span class="admin-ref">${escapeHtml(order.reference)}</span>
            ${order.has_preorder ? '<span class="admin-tag">preorder</span>' : ''}
            ${order.flagged ? '<span class="admin-tag admin-tag--warn">check</span>' : ''}
          </td>
          <td class="admin-cell admin-cell--when">${escapeHtml(formatWhen(order.created_at))}</td>
          <td class="admin-cell">
            <button class="admin-expand" type="button" aria-expanded="false" aria-controls="${detailId}"
                    data-expand="${escapeHtml(order.reference)}">
              <span class="admin-expand__name">${escapeHtml(order.full_name)}</span>
              <span class="admin-expand__chevron" aria-hidden="true"></span>
            </button>
          </td>
          <td class="admin-cell">
            <a class="admin-number" href="${escapeHtml(whatsappOrderLink(order))}" target="_blank" rel="noopener"
               title="Message ${escapeHtml(order.full_name)} on WhatsApp about ${escapeHtml(order.reference)}">${escapeHtml(formatMobile(order.mobile))}</a>
          </td>
          <td class="admin-cell admin-cell--items">${escapeHtml(order.item_summary)}</td>
          <td class="admin-cell admin-cell--total">${currency.format(order.total)}</td>
        </tr>
        <tr class="admin-detail-row" id="${detailId}" data-detail="${escapeHtml(order.reference)}" hidden>
          <td colspan="7">${detailPanel(order)}</td>
        </tr>`;
    })
    .join('');

  ordersHost.innerHTML = `<div class="admin-table-wrap">
      <table class="admin-table">
        <caption class="sr-only">Orders received, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Status <span class="admin-th-hint">where it stands</span></th>
            <th scope="col">Reference</th>
            <th scope="col">Placed (IST)</th>
            <th scope="col">Customer <span class="admin-th-hint">click to expand</span></th>
            <th scope="col">WhatsApp <span class="admin-th-hint">click to message</span></th>
            <th scope="col">Items</th>
            <th scope="col" class="admin-cell--total">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="admin-legend">
      Set the <strong>status</strong> of each order as you work through it. Click a
      <strong>number</strong> to message that customer on WhatsApp with their order already written out.
      Click a <strong>name</strong> to open the full details.
    </p>`;
}

/* One delegated listener rather than a closure per row: the table is rebuilt
   wholesale on every load, so listeners on rows would have to be reattached
   every time. Toggling `hidden` is left to the browser, which also moves focus
   nowhere, so a keyboard user stays on the button they pressed. */
function onTableClick(event) {
  const button = event.target.closest('[data-expand]');
  if (!button) return;
  /* Found by walking the row rather than by querying on the reference, which
     would mean escaping a value into a selector for no benefit: the detail row
     is always the next sibling of the row the button sits in. */
  const panel = button.closest('tr')?.nextElementSibling;
  if (!panel?.matches('[data-detail]')) return;
  const open = panel.hidden;
  panel.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
}

/* Everything that does not fit in a column: the full address as the customer
   typed it, the priced line items, their email, and links that repeat the two
   actions from the row above, so nothing important hides behind a click. */
function detailPanel(order) {
  const lines = orderLines(order);
  const items = lines.length
    ? lines
        .map(
          (line) => `<li>
            <span class="admin-detail__qty">${escapeHtml(line.quantity)} ×</span>
            <span class="admin-detail__name">${escapeHtml(line.name)} <span class="admin-detail__size">(${escapeHtml(line.size)})</span></span>
            <span class="admin-detail__price">${currency.format(line.lineTotal)}</span>
          </li>`,
        )
        .join('')
    : `<li class="admin-detail__fallback">${escapeHtml(order.item_summary)}</li>`;

  return `<div class="admin-detail">
      <dl class="admin-detail__grid">
        <div><dt>Deliver by</dt><dd>${escapeHtml(order.delivery_date)}</dd></div>
        <div><dt>Total</dt><dd>${currency.format(order.total)}</dd></div>
        <div><dt>Placed</dt><dd>${escapeHtml(formatWhen(order.created_at))}</dd></div>
        <div><dt>Email</dt><dd>${order.email ? escapeHtml(order.email) : '<span class="admin-detail__none">not given</span>'}</dd></div>
      </dl>
      <h4>Items</h4>
      <ul class="admin-detail__items">${items}</ul>
      <h4>Delivery address</h4>
      <p class="admin-detail__address">${escapeHtml(order.address)}<br />${escapeHtml(order.city)}, ${escapeHtml(order.state)} ${escapeHtml(order.pincode)}</p>
      <div class="admin-detail__actions">
        <a class="checkout-button admin-detail__wa" href="${escapeHtml(whatsappOrderLink(order))}" target="_blank" rel="noopener">Message on WhatsApp <span aria-hidden="true">↗</span></a>
        <a class="admin-detail__call" href="tel:+91${escapeHtml(String(order.mobile).replace(/\D/g, ''))}">Call ${escapeHtml(formatMobile(order.mobile))}</a>
      </div>
    </div>`;
}

/* The priced lines are stored as JSON so the sheet stays readable without
   unpicking them. A row written by an older build, or one that failed to
   parse, falls back to the flat summary rather than rendering nothing. */
function orderLines(order) {
  if (typeof order.items !== 'string' || order.items === '') return [];
  try {
    const parsed = JSON.parse(order.items);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* wa.me wants the number with no +, spaces or dashes, and the message as a
   query parameter. The text is written for the customer to read: their
   reference first, because that is what they would quote if they called. */
function whatsappOrderLink(order) {
  const number = `91${String(order.mobile).replace(/\D/g, '')}`;
  const lines = orderLines(order);
  const items = lines.length
    ? lines
        .map(
          (line) =>
            `${line.quantity} × ${line.name} (${line.size}) — ${currency.format(line.lineTotal)}`,
        )
        .join('\n')
    : order.item_summary;

  const text = [
    `Hello ${order.full_name},`,
    '',
    'Thank you for your order with Uppalapati Farms.',
    '',
    `Reference: ${order.reference}`,
    `Placed: ${formatWhen(order.created_at)}`,
    `Deliver by: ${order.delivery_date}`,
    '',
    items,
    '',
    `Total: ${currency.format(order.total)}`,
    '',
    'Nothing has been charged yet. We will confirm your delivery slot and payment with you shortly.',
  ].join('\n');

  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
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
  /* h23 rather than a bare hour12:false, which renders midnight as "24" in some
     locales. Matches the 24-hour "Placed (IST)" column in the sheet. */
  return `${parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
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

/* Attached once here rather than inside renderOrders, which rebuilds the whole
   table on every load and would otherwise stack a listener per refresh. */
ordersHost.addEventListener('click', onTableClick);
ordersHost.addEventListener('change', onStatusChange);

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
