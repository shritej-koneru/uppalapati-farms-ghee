/* ---------- Password-protecting an export ----------

   The owner downloads a spreadsheet of every order: names, phone numbers,
   addresses. That file is personal data, and it will end up in a Downloads
   folder, in a backup, or attached to an email to somebody else. "Only the
   owner can reach the download URL" does not help once the file has been saved.

   So the file is encrypted before it touches the disk.

   Why this runs in the browser rather than on the server:

   - The passphrase never leaves the owner's machine. The server has no copy and
     no way to recover it, so a server compromise cannot reveal it.
   - A Worker has a tight CPU budget, and PBKDF2 at a rate worth using would
     exceed it. The browser has no such limit.
   - The plaintext workbook is already in memory once the browser has fetched
     it, so encrypting it there adds no meaningful exposure.

   Why this is not an .xlsx that Excel itself prompts for: that requires writing
   an encrypted OLE2 compound file, which needs libraries a Worker cannot run
   and cannot be validated without Excel to hand. Shipping an unverifiable
   security control would be worse than an honest one. What comes out instead is
   a `.xlsx.enc` file that is unreadable without the passphrase, plus a decrypt
   panel on the admin page that turns it back into a normal workbook.

   Construction, in full:

     passphrase --PBKDF2--> wrapping key
     random 256-bit data key --AES-GCM(wrapping key)--> wrapped key
     workbook bytes --AES-GCM(data key)--> ciphertext

   Only the wrapped data key is stored, so the file is safe even if the
   passphrase is weak, and the data key can be thrown away as soon as the bytes
   are encrypted. */

export const SEAL_FORMAT = 'uppalapati-orders-sheet';
export const SEAL_VERSION = 1;

/* OWASP's current floor for PBKDF2-HMAC-SHA-256. The cost lands on the owner
   once per export and once per open, which is nothing, in exchange for a file
   that resists offline guessing on a stolen laptop. */
const KDF_ITERATIONS = 600_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

const encoder = new TextEncoder();

/* Chunked because spreading a large typed array into `String.fromCharCode` blows
   the argument limit, and the sheet grows with every order placed. */
function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveWrappingKey(password, salt) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/* Encrypts a workbook. Returns the text of the `.enc` file. */
export async function sealWorkbook(workbookBytes, password, meta = {}) {
  if (!password || password.length < 8) {
    throw new Error('Use a passphrase of at least 8 characters for the sheet.');
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const dataIv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const wrapIv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const wrappingKey = await deriveWrappingKey(password, salt);

  const dataKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: KEY_BITS }, true, [
    'encrypt',
    'decrypt',
  ]);
  const rawDataKey = await crypto.subtle.exportKey('raw', dataKey);
  const wrappedKey = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv }, wrappingKey, rawDataKey);

  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: dataIv }, dataKey, workbookBytes);

  return JSON.stringify({
    format: SEAL_FORMAT,
    version: SEAL_VERSION,
    cipher: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA-256',
    iterations: KDF_ITERATIONS,
    note: 'Open this at /admin on the shop website and enter the passphrase to decrypt.',
    sealedAt: new Date().toISOString(),
    reference: meta.reference ?? null,
    salt: toBase64(salt),
    dataIv: toBase64(dataIv),
    wrapIv: toBase64(wrapIv),
    wrappedKey: toBase64(new Uint8Array(wrappedKey)),
    data: toBase64(new Uint8Array(data)),
  });
}

/* Reverses `sealWorkbook`. Throws a clear error on a wrong passphrase rather
   than returning garbage — AES-GCM's authentication tag is what detects it. */
export async function unsealWorkbook(sealedText, password) {
  let envelope;
  try {
    envelope = JSON.parse(sealedText);
  } catch {
    throw new Error('That file is not a sealed order sheet.');
  }

  if (envelope?.format !== SEAL_FORMAT) {
    throw new Error('That file is not a sealed order sheet from this shop.');
  }
  if (envelope.version !== SEAL_VERSION || envelope.iterations !== KDF_ITERATIONS) {
    throw new Error('That sheet was sealed by a different version. Ask for a fresh export.');
  }

  const salt = fromBase64(envelope.salt);
  const wrappingKey = await deriveWrappingKey(password, salt);

  let rawDataKey;
  try {
    rawDataKey = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.wrapIv) },
      wrappingKey,
      fromBase64(envelope.wrappedKey),
    );
  } catch {
    /* GCM verified and rejected. Almost always the passphrase; the alternative
       is a file that has been altered, which this cannot tell apart and does not
       need to distinguish for the owner's purposes. */
    throw new Error('That passphrase does not open this sheet.');
  }

  const dataKey = await crypto.subtle.importKey('raw', rawDataKey, 'AES-GCM', false, ['decrypt']);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.dataIv) }, dataKey, fromBase64(envelope.data)),
    );
  } catch {
    throw new Error('That sheet is damaged and cannot be opened.');
  }
}
