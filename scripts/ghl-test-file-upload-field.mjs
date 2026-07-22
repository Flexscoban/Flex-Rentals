#!/usr/bin/env node
/* ==========================================================================
   ONE-OFF DIAGNOSTIC — NOT part of the live application-submission path.

   Answers a single question: what field_value shape does GHL's API expect
   when writing to a FILE_UPLOAD-type custom field via PUT /contacts/{id}?

   This script never touches serverless/lib/ghl.js, never touches a real
   applicant contact, and never logs the private integration token.

   What it does, in order:
     1. Looks up the target custom field's own metadata from GHL (dataType,
        name, etc.) so we have GHL's own description of the field on record.
     2. Resolves a test contact — either the one you point it at via
        GHL_TEST_CONTACT_ID, or (if you don't set that) a throwaway contact
        this script creates itself, obviously labeled as a test.
     3. Resolves a test image URL — either GHL_TEST_IMAGE_URL if you set
        one, or a tiny 1x1 PNG this script uploads to GHL's Media Library
        to get a real hosted URL.
     4. Sends ONE PUT /contacts/{contactId} with ONE custom field in the
        body: { customFields: [{ id: <fieldId>, field_value: <format> }] }.
        Default format is a plain URL string — the same shape every other
        custom field in ghl.js already uses successfully. Set
        GHL_TEST_FIELD_VALUE_FORMAT=array to try the alternate
        [{ url: <url> }] shape instead, if the string format doesn't stick.
     5. Re-fetches the contact and prints back whatever GHL now reports for
        that field, so you have a first read before you go check the UI.

   Required environment variables (same values you already set as
   Cloudflare Pages secrets — pull them from wherever you stored them
   originally, e.g. your GHL Private Integration token page / password
   manager; Cloudflare will not show you the saved value again):
     GHL_LOCATION_ID
     GHL_PRIVATE_INTEGRATION_TOKEN

   Optional:
     GHL_TEST_CONTACT_ID          — reuse an existing test contact instead
                                     of creating a new one.
     GHL_TEST_IMAGE_URL           — reuse an existing hosted image instead
                                     of uploading a throwaway one.
     GHL_TEST_FIELD_ID            — which custom field to write to.
                                     Defaults to license_front_url's ID.
     GHL_TEST_FIELD_VALUE_FORMAT  — "string" (default) or "array".

   Run with:
     GHL_LOCATION_ID=... GHL_PRIVATE_INTEGRATION_TOKEN=... \
       node scripts/ghl-test-file-upload-field.mjs
   (or: npm run ghl:test-file-upload-field)
   ========================================================================== */

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

// Same three FILE_UPLOAD field IDs already recorded in
// serverless/lib/ghl.js CUSTOM_FIELD_IDS — not read from that file on
// purpose, so this script has zero import-time coupling to the live path.
const FILE_UPLOAD_FIELD_IDS = {
  license_front_url: '3F9ozUT0CvHoXbGbZdtm',
  license_back_url: '9l9dAfs5Ok4bQaylg3HF',
  platform_screenshot_url: 'UQDBEgFi3TfogMuGK14P'
};

const LOCATION_ID = process.env.GHL_LOCATION_ID;
const TOKEN = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
const TEST_CONTACT_ID = process.env.GHL_TEST_CONTACT_ID || null;
const TEST_IMAGE_URL = process.env.GHL_TEST_IMAGE_URL || null;
const FIELD_ID = process.env.GHL_TEST_FIELD_ID || FILE_UPLOAD_FIELD_IDS.license_front_url;
const VALUE_FORMAT = process.env.GHL_TEST_FIELD_VALUE_FORMAT === 'array' ? 'array' : 'string';

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

async function ghl(path, options = {}) {
  const headers = Object.assign(
    { Authorization: 'Bearer ' + TOKEN, Version: GHL_API_VERSION },
    options.headers || {}
  );
  const url = GHL_API_BASE + path;
  const logRequest = { url, method: options.method || 'GET', headers: redactedHeaders(headers) };
  if (typeof options.body === 'string') logRequest.body = JSON.parse(options.body);
  console.log('\n→ REQUEST', JSON.stringify(logRequest, null, 2));

  const res = await fetch(url, Object.assign({}, options, { headers }));
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

function tinyPngFile() {
  // Smallest possible valid PNG: a single transparent pixel. Bytes are a
  // well-known minimal PNG literal, not generated from any real asset.
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const bytes = Buffer.from(base64, 'base64');
  return new File([bytes], 'flex-rentals-test-pixel.png', { type: 'image/png' });
}

async function main() {
  console.log('=== GHL FILE_UPLOAD custom field format test ===');
  console.log('Target field ID:', FIELD_ID);
  console.log('field_value format under test:', VALUE_FORMAT);

  // Step 1 — field metadata, straight from GHL, for the record.
  console.log('\n--- Step 1: fetch custom field metadata ---');
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

  // Step 3 — resolve a test image URL.
  console.log('\n--- Step 3: resolve test image URL ---');
  let imageUrl = TEST_IMAGE_URL;
  if (imageUrl) {
    console.log('Using existing image URL from GHL_TEST_IMAGE_URL:', imageUrl);
  } else {
    console.log('No GHL_TEST_IMAGE_URL set — uploading a throwaway 1x1 test PNG to GHL Media Library.');
    const uploadForm = new FormData();
    uploadForm.append('file', tinyPngFile());
    uploadForm.append('locationId', LOCATION_ID);
    const uploaded = await ghl('/medias/upload-file', { method: 'POST', body: uploadForm });
    if (!uploaded.ok) fail('Media upload failed — see response above.');
    imageUrl = (uploaded.body && (uploaded.body.url || uploaded.body.fileUrl)) || null;
    if (!imageUrl) fail('Media upload succeeded but returned no url — see response above.');
    console.log('Uploaded test image URL:', imageUrl);
  }

  // Step 4 — the actual test: one PUT, one custom field.
  console.log('\n--- Step 4: PUT the FILE_UPLOAD custom field ---');
  const fieldValue = VALUE_FORMAT === 'array' ? [{ url: imageUrl }] : imageUrl;
  const putResult = await ghl('/contacts/' + contactId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customFields: [{ id: FIELD_ID, field_value: fieldValue }] })
  });

  // Step 5 — read the contact back and see what GHL reports for this field.
  console.log('\n--- Step 5: re-fetch contact and inspect the field ---');
  const refetched = await ghl('/contacts/' + contactId, { method: 'GET' });
  const contact = refetched.body && refetched.body.contact;
  const echoedField =
    contact && Array.isArray(contact.customFields)
      ? contact.customFields.find((f) => f.id === FIELD_ID)
      : null;
  console.log('\nField as GHL now reports it:', JSON.stringify(echoedField, null, 2) || '(not present)');

  console.log('\n=== SUMMARY ===');
  console.log('Contact ID tested:      ', contactId);
  console.log('PUT HTTP status:        ', putResult.status, putResult.ok ? '(ok)' : '(FAILED)');
  console.log('Field present on re-GET:', echoedField ? 'yes' : 'no');
  console.log(
    '\nNext step: open this contact in the GHL desktop dashboard AND the LeadConnector\n' +
      'mobile app and confirm the test image actually renders on the ' +
      Object.keys(FILE_UPLOAD_FIELD_IDS).find((k) => FILE_UPLOAD_FIELD_IDS[k] === FIELD_ID) +
      ' field before we wire this into the live application form.'
  );
}

main().catch((err) => {
  console.error('\n✗ Script threw an unexpected error:', err.message);
  process.exit(1);
});
