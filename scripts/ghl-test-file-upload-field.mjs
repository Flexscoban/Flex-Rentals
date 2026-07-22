#!/usr/bin/env node
/* ==========================================================================
   ONE-OFF DIAGNOSTIC — NOT part of the live application-submission path.

   Tests HighLevel's DOCUMENTED file-upload-to-custom-field flow, not a
   guess: https://marketplace.gohighlevel.com/docs/ghl/locations/upload-file-custom-fields/
     - POST /locations/{locationId}/customFields/upload
     - multipart/form-data, one field per file, keyed "<custom_field_id>_<uuid>"
       (custom_field_id = the GHL custom field's ID, uuid = a fresh random id
       you generate to identify this particular file)

   What's NOT fully nailed down by public docs, and what this script exists
   to empirically settle:
     - Whether that upload call alone attaches the file to a contact, or
       whether a separate PUT /contacts/{id} is still required afterward
       with a uuid-keyed map as field_value (contact-level FILE_UPLOAD
       values are documented as a map keyed by uuid containing file
       metadata + the download URL).
     - Two more required form fields GHL's API itself surfaced via a 422
       ("id must be a string", "maxFiles must be a string") that no public
       doc snippet mentions. Best available reading, corroborated by the
       sibling /forms/upload-to-custom-fields endpoint's documented
       per-contact association: id = the target record's id (contactId),
       maxFiles = file count in this request as a string. Sent below and
       verified by what the endpoint actually returns next.
   The script does NOT guess blindly: it inspects the upload response,
   and only attempts a follow-up PUT if the response doesn't already look
   like a fully-updated contact with this field populated. That follow-up
   attempt is clearly labeled as best-effort/unconfirmed in its own log
   section, separate from the documented upload call.

   This script never touches serverless/lib/ghl.js or the live
   application-submission path, and never writes to a real applicant
   contact — it only creates/uses a disposable, clearly-labeled test
   contact. The private integration token is never printed.

   Steps:
     1. GET the target custom field's own metadata from GHL (best-effort,
        non-fatal if the exact path is off — informational only).
     2. Resolve a test contact — GHL_TEST_CONTACT_ID if you set one,
        otherwise a throwaway contact this script creates itself.
     3. Generate a fresh uuid and a tiny 1x1 test PNG in memory.
     4. POST the documented upload endpoint with ONE multipart field:
        key "<custom_field_id>_<uuid>", value = the test PNG.
     5. Inspect the response. If it doesn't already look like our field is
        populated on the contact, attempt ONE best-effort follow-up
        PUT /contacts/{id} with a uuid-keyed map as field_value, clearly
        flagged as unconfirmed.
     6. Re-fetch the contact and print exactly how GHL now represents the
        field, so you have a full picture before checking the UI.

   Required environment variables (same values already saved as Cloudflare
   Pages secrets — pull them from wherever you stored them originally;
   Cloudflare will not show you a saved secret's value again):
     GHL_LOCATION_ID
     GHL_PRIVATE_INTEGRATION_TOKEN

   Optional:
     GHL_TEST_CONTACT_ID  — reuse an existing disposable test contact
                             instead of creating a new one.
     GHL_TEST_FIELD_ID    — which custom field to test against. Defaults
                             to the Driver License Front field
                             (license_front_url) already recorded in
                             serverless/lib/ghl.js.
     GHL_TEST_IMAGE_PATH  — absolute path to a real local image to upload
                             instead of the synthetic 1x1 test pixel (the
                             pixel proved the plumbing works but renders
                             blank in any preview — use this to confirm
                             an actual visible image). Supported
                             extensions: .jpg/.jpeg, .png, .webp. The
                             original filename is preserved and sent to
                             GHL as-is.

   Run with exactly (swap in a real image path):
     GHL_LOCATION_ID=... GHL_PRIVATE_INTEGRATION_TOKEN=... \
       GHL_TEST_IMAGE_PATH="/absolute/path/to/test-image.jpg" \
       npm run ghl:test-file-upload-field
   (equivalent to: node scripts/ghl-test-file-upload-field.mjs)
   ========================================================================== */

import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { basename, extname } from 'node:path';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

// Same three FILE_UPLOAD field IDs already recorded in
// serverless/lib/ghl.js CUSTOM_FIELD_IDS — not imported from that file on
// purpose, so this script has zero coupling to the live path.
const FILE_UPLOAD_FIELD_IDS = {
  license_front_url: '3F9ozUT0CvHoXbGbZdtm', // "Driver License Front"
  license_back_url: '9l9dAfs5Ok4bQaylg3HF', // "Driver License Back"
  platform_screenshot_url: 'UQDBEgFi3TfogMuGK14P' // "Platform Screenshot"
};

const LOCATION_ID = process.env.GHL_LOCATION_ID;
const TOKEN = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
const TEST_CONTACT_ID = process.env.GHL_TEST_CONTACT_ID || null;
const FIELD_ID = process.env.GHL_TEST_FIELD_ID || FILE_UPLOAD_FIELD_IDS.license_front_url;
const TEST_IMAGE_PATH = process.env.GHL_TEST_IMAGE_PATH || null;

const MIME_TYPES_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

function fail(message) {
  console.error('\n✗ ' + message + '\n');
  process.exit(1);
}

if (!LOCATION_ID || !TOKEN) {
  fail(
    'Missing GHL_LOCATION_ID and/or GHL_PRIVATE_INTEGRATION_TOKEN.\n' +
      '  These are the same values already saved as Cloudflare Pages secrets —\n' +
      '  set them in your shell before running this script, e.g.:\n' +
      '    export GHL_LOCATION_ID=...\n' +
      '    export GHL_PRIVATE_INTEGRATION_TOKEN=...\n' +
      '  Neither value is stored anywhere in this repo.'
  );
}

function redactedHeaders(headers) {
  const copy = Object.assign({}, headers);
  if (copy.Authorization) copy.Authorization = 'Bearer ***REDACTED***';
  return copy;
}

// Logs a JSON-safe description of a fetch call — for multipart bodies we
// log field names/filenames/sizes, never raw binary.
async function ghl(path, options = {}, describedBody = undefined) {
  const headers = Object.assign(
    { Authorization: 'Bearer ' + TOKEN, Version: GHL_API_VERSION, Accept: 'application/json' },
    options.headers || {}
  );
  const url = GHL_API_BASE + path;
  const logRequest = { url, method: options.method || 'GET', headers: redactedHeaders(headers) };
  if (describedBody !== undefined) {
    logRequest.body = describedBody;
  } else if (typeof options.body === 'string') {
    logRequest.body = JSON.parse(options.body);
  }
  console.log('\n→ REQUEST', JSON.stringify(logRequest, null, 2));

  // Node's fetch throws a bare "fetch failed" on network-level failures
  // (reset connections, transient drops mid-upload, etc.) and buries the
  // actual reason in err.cause. Larger multipart bodies (a real photo vs.
  // a 68-byte test pixel) take measurably longer to send, which is enough
  // window for a transient drop — so retry this class of failure once
  // before giving up, and always surface the real cause either way.
  const MAX_ATTEMPTS = 2;
  let res;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      res = await fetch(url, Object.assign({}, options, { headers }));
      break;
    } catch (err) {
      const cause = err && err.cause ? ' — cause: ' + (err.cause.message || err.cause) : '';
      console.error('✗ Network-level fetch failure (attempt ' + attempt + '/' + MAX_ATTEMPTS + '): ' + err.message + cause);
      if (attempt === MAX_ATTEMPTS) throw err;
      console.log('  Retrying once...');
    }
  }
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch (_err) {
    // leave as raw text
  }
  console.log('← RESPONSE status=' + res.status, JSON.stringify(body, null, 2));
  return { ok: res.ok, status: res.status, body };
}

function tinyPngFile(name) {
  // Smallest possible valid PNG: a single transparent pixel. Bytes are a
  // well-known minimal PNG literal, not generated from any real asset.
  // Proves the upload plumbing works but renders blank in any preview —
  // set GHL_TEST_IMAGE_PATH to test with something actually visible.
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const bytes = Buffer.from(base64, 'base64');
  return new File([bytes], name, { type: 'image/png' });
}

// Resolves the file to upload: a real local image if GHL_TEST_IMAGE_PATH
// is set (original filename preserved, MIME type derived from extension),
// otherwise the synthetic 1x1 test pixel.
function resolveTestFile() {
  if (!TEST_IMAGE_PATH) {
    console.log('No GHL_TEST_IMAGE_PATH set — using the synthetic 1x1 test pixel (will render blank).');
    const name = 'flex-rentals-test-pixel.png';
    return { file: tinyPngFile(name), fileName: name };
  }

  if (!existsSync(TEST_IMAGE_PATH)) {
    fail('GHL_TEST_IMAGE_PATH does not point to a file that exists: ' + TEST_IMAGE_PATH);
  }

  const ext = extname(TEST_IMAGE_PATH).toLowerCase();
  const mimeType = MIME_TYPES_BY_EXTENSION[ext];
  if (!mimeType) {
    fail(
      'Unsupported file extension "' +
        ext +
        '" for GHL_TEST_IMAGE_PATH. Supported: ' +
        Object.keys(MIME_TYPES_BY_EXTENSION).join(', ')
    );
  }

  const fileName = basename(TEST_IMAGE_PATH);
  const bytes = readFileSync(TEST_IMAGE_PATH);
  console.log('Using real local image:', TEST_IMAGE_PATH, '(' + bytes.length + ' bytes, ' + mimeType + ')');
  return { file: new File([bytes], fileName, { type: mimeType }), fileName };
}

// Best-effort scan of the upload response for anything that looks like a
// hosted URL, so a follow-up PUT (if needed) can reference the real file
// instead of a placeholder. Returns null if nothing url-shaped is found —
// the follow-up step logs that plainly rather than pretending otherwise.
function findUrlInResponse(body) {
  if (!body || typeof body !== 'object') return null;
  const seen = new Set();
  const stack = [body];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) continue;
    seen.add(node);
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && /^https?:\/\//.test(value) && /url/i.test(key)) return value;
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return null;
}

function fieldLooksPopulated(contactLike, fieldId) {
  const fields = contactLike && Array.isArray(contactLike.customFields) ? contactLike.customFields : null;
  if (!fields) return false;
  const match = fields.find((f) => f.id === fieldId);
  return Boolean(match && match.field_value && (typeof match.field_value !== 'object' || Object.keys(match.field_value).length));
}

async function main() {
  console.log('=== HighLevel documented FILE_UPLOAD custom field test ===');
  console.log('Target field ID:', FIELD_ID, '(Driver License Front, unless overridden)');

  // Step 1 — field metadata, straight from GHL, best-effort/non-fatal.
  console.log('\n--- Step 1: fetch custom field metadata (informational, non-fatal) ---');
  await ghl('/locations/' + LOCATION_ID + '/customFields/' + FIELD_ID, { method: 'GET' });

  // Step 2 — resolve a safe test contact.
  console.log('\n--- Step 2: resolve test contact ---');
  let contactId = TEST_CONTACT_ID;
  if (contactId) {
    console.log('Using existing test contact from GHL_TEST_CONTACT_ID:', contactId);
    const got = await ghl('/contacts/' + contactId, { method: 'GET' });
    if (!got.ok) fail('Could not fetch GHL_TEST_CONTACT_ID=' + contactId + ' — double check the ID.');
  } else {
    console.log('No GHL_TEST_CONTACT_ID set — creating a throwaway test contact.');
    const created = await ghl('/contacts/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId: LOCATION_ID,
        firstName: 'FLEX-TEST',
        lastName: 'DO-NOT-CONTACT (safe to delete)',
        email: 'flex-rentals-file-upload-test+' + Date.now() + '@example.com',
        tags: ['internal-test', 'file-upload-format-check'],
        source: 'Internal Test Script (scripts/ghl-test-file-upload-field.mjs)'
      })
    });
    if (!created.ok) fail('Failed to create a test contact — see response above.');
    contactId = (created.body && created.body.contact && created.body.contact.id) || (created.body && created.body.id);
    if (!contactId) fail('Contact create call succeeded but returned no contact id — see response above.');
    console.log(
      '\n⚠ Created test contact ' +
        contactId +
        ' — find it in GHL and DELETE it once you\'re done verifying (tagged "internal-test").'
    );
  }

  // Step 3 — a fresh uuid + the test image (real file if GHL_TEST_IMAGE_PATH
  // is set, otherwise the synthetic pixel), per the documented
  // "<custom_field_id>_<uuid>" multipart key convention.
  console.log('\n--- Step 3: prepare test file ---');
  const uuid = randomUUID();
  const multipartKey = FIELD_ID + '_' + uuid;
  const { file, fileName } = resolveTestFile();
  console.log('uuid:', uuid);
  console.log('multipart field key:', multipartKey);

  // Step 4 — the documented upload endpoint. A prior run against this same
  // endpoint returned 422 { "id must be a string", "maxFiles must be a
  // string" } — i.e. GHL's own validator, not a guess, telling us two form
  // fields are missing beyond the file itself. Neither is spelled out in
  // any public doc snippet we could find, but the sibling
  // /forms/upload-to-custom-fields endpoint is documented elsewhere as
  // associating uploaded files with a specific contact, which is the most
  // coherent reading of a bare "id" field on a per-record upload call (the
  // custom field's own id is already embedded in the multipart key
  // prefix, so a second "id" field would be redundant if it meant the
  // same thing). Testing that reading directly:
  //   id       = the target record's id (our test contactId)
  //   maxFiles = count of files in this request, as a string
  // Flagged clearly below as an inference from the 422, confirmed or
  // refuted by whatever this call returns next.
  console.log('\n--- Step 4: POST /locations/{locationId}/customFields/upload ---');
  console.log(
    'Inference from prior 422 (id + maxFiles required, not found in public docs): sending id=<contactId>, maxFiles="1".'
  );
  const uploadForm = new FormData();
  uploadForm.append('id', contactId);
  uploadForm.append('maxFiles', '1');
  uploadForm.append(multipartKey, file);
  const uploadResult = await ghl(
    '/locations/' + LOCATION_ID + '/customFields/upload',
    { method: 'POST', body: uploadForm },
    {
      fields: { id: contactId, maxFiles: '1' },
      multipart: [{ fieldName: multipartKey, filename: fileName, contentType: file.type, sizeBytes: file.size }]
    }
  );
  if (!uploadResult.ok) {
    fail('Upload call failed — see response above. Nothing further to test until this succeeds.');
  }

  // Step 5 — decide, from the response itself, whether a follow-up PUT is
  // needed. Never blindly assume either way.
  console.log('\n--- Step 5: determine whether a separate PUT /contacts/{id} is required ---');
  const uploadLooksLikeContact = fieldLooksPopulated(uploadResult.body, FIELD_ID);
  let putAttempted = false;
  let putResult = null;

  if (uploadLooksLikeContact) {
    console.log(
      '✓ The upload response already looks like a contact object with field ' +
        FIELD_ID +
        ' populated. Skipping the follow-up PUT — it does not appear necessary.'
    );
  } else {
    console.log(
      '↷ The upload response does NOT look like a fully-populated contact for this field.\n' +
        '  Attempting ONE best-effort follow-up PUT with a uuid-keyed map as field_value.\n' +
        '  This shape is our best reading of the docs, NOT independently confirmed —\n' +
        '  treat this section of the log as the speculative part of the test.'
    );
    const discoveredUrl = findUrlInResponse(uploadResult.body);
    console.log('URL discovered in upload response:', discoveredUrl || '(none found)');
    const candidateFieldValue = {
      [uuid]: Object.assign({ name: fileName }, discoveredUrl ? { url: discoveredUrl } : {})
    };
    putAttempted = true;
    putResult = await ghl('/contacts/' + contactId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customFields: [{ id: FIELD_ID, field_value: candidateFieldValue }] })
    });
  }

  // Step 6 — re-fetch the contact and show exactly what GHL reports now.
  console.log('\n--- Step 6: re-fetch contact and inspect the field ---');
  const refetched = await ghl('/contacts/' + contactId, { method: 'GET' });
  const contact = refetched.body && refetched.body.contact;
  const echoedField =
    contact && Array.isArray(contact.customFields) ? contact.customFields.find((f) => f.id === FIELD_ID) : null;
  console.log('\nField as GHL now reports it:', JSON.stringify(echoedField, null, 2) || '(not present)');

  console.log('\n=== SUMMARY ===');
  console.log('Contact ID tested:              ', contactId);
  console.log('Upload endpoint HTTP status:    ', uploadResult.status, uploadResult.ok ? '(ok)' : '(FAILED)');
  console.log(
    'Separate PUT required:          ',
    uploadLooksLikeContact ? 'NO — upload call alone populated the field' : 'YES (attempted, unconfirmed shape — see Step 5 log)'
  );
  if (putAttempted && putResult) {
    console.log('Follow-up PUT HTTP status:      ', putResult.status, putResult.ok ? '(ok)' : '(FAILED)');
  }
  console.log('Field present on final re-GET:  ', echoedField ? 'yes' : 'no');
  console.log(
    '\nNext step: open contact ' +
      contactId +
      ' in the GHL desktop dashboard AND the LeadConnector mobile app and confirm\n' +
      'the test image actually renders on the field before telling me to wire this into the live form.'
  );
}

main().catch((err) => {
  console.error('\n✗ Script threw an unexpected error:', err.message);
  let cause = err.cause;
  while (cause) {
    console.error('  caused by:', cause.message || cause);
    cause = cause.cause;
  }
  process.exit(1);
});
