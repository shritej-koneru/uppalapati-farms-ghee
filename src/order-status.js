/* ---------- Order status ----------

   Where an order has got to, in the owner's own words.

   Shared rather than written twice for the same reason `pricing.js` is: the
   dropdown in the order table and the check on the server have to agree, or the
   owner picks a status that is silently refused, or worse, one is accepted that
   was never offered. The Worker imports this file the same way it imports
   `pricing.js`.

   Listed in the order the work actually happens rather than alphabetically, so
   the dropdown can be read as the next step to take. `canceled` is the odd one
   out: it is not a stage to move through but a way out, so it sits at the end
   and is styled apart from the rest.

   An order arrives as `pending`. Nobody has confirmed anything at that point —
   the customer pressed a button, and the owner has not yet replied. */

export const ORDER_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'on-the-way', label: 'On the way' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' },
];

/* Applied by the database default as well as by saveOrder, so a row is never
   left without one even if it were written by something other than this code. */
export const DEFAULT_STATUS = 'pending';

/* The list is the gate, not the dropdown: a status can arrive from anywhere, so
   the server checks it against this and refuses anything else. */
export function isOrderStatus(value) {
  return ORDER_STATUSES.some((status) => status.value === value);
}

/* Used for the sheet and for the summary counts. An unrecognised value is shown
   as itself rather than guessed at — the owner's record of what was sold is
   worth more than a tidy-looking column that quietly files a row under the
   wrong heading. */
export function statusLabel(value) {
  const found = ORDER_STATUSES.find((status) => status.value === value);
  return found ? found.label : String(value ?? '');
}