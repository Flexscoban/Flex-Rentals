#!/usr/bin/env node
/* ==========================================================================
   ONE-OFF DIAGNOSTIC — NOT part of the live application-submission path.

   Lists every custom field already created in your GHL sub-account, using
   GHL's documented endpoint (same one referenced in GHL-FORM-INTEGRATION.md
   step 1):
     GET /locations/{locationId}/customFields

   Why this exists: the GHL UI can stop surfacing a field's ID directly, but
   the API always returns it. This script never touches serverless/lib/ghl.js
   or the live submission path — it only reads field metadata and prints it
   so the three new field IDs (Driver License Expiration Date, Desired
   Rental Start Date, Rental Length Preference) can be identified and pasted
   into CUSTOM_FIELD_IDS by hand, the same way every existing field ID in
   this repo was sourced. The private integration token is never printed.

   Required environment variables (same values already saved as your
   hosting platform's secrets):
     GHL_LOCATION_ID
     GHL_PRIVATE_INTEGRATION_TOKEN

   Run with:
     GHL_LOCATION_ID=... GHL_PRIVATE_INTEGRATION_TOKEN=... \
       node scripts/ghl-list-custom-fields.mjs
   ========================================================================== */

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

const LOCATION_ID = process.env.GHL_LOCATION_ID;
const TOKEN = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;

// Loose keyword match against the three field names we're looking for —
// informational highlighting only, never used to decide what gets wired in.
const TARGET_FIELDS = [
  { key: 'drivers_license_expiration', patterns: [/license/i, /expir/i] },
  { key: 'desired_rental_start_date', patterns: [/rental/i, /start/i] },
  { key: 'rental_length_preference', patterns: [/rental/i, /length/i] }
];

function fail(message) {
  console.error('\n✗ ' + message + '\n');
  process.exit(1);
}

if (!LOCATION_ID || !TOKEN) {
  fail(
    'Missing GHL_LOCATION_ID and/or GHL_PRIVATE_INTEGRATION_TOKEN.\n' +
      '  Set them in your shell before running this script, e.g.:\n' +
      '    export GHL_LOCATION_ID=...\n' +
      '    export GHL_PRIVATE_INTEGRATION_TOKEN=...\n' +
      '  Neither value is stored anywhere in this repo.'
  );
}

async function main() {
  console.log('=== GHL custom fields for location', LOCATION_ID, '===\n');

  let res;
  try {
    res = await fetch(GHL_API_BASE + '/locations/' + LOCATION_ID + '/customFields', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        Version: GHL_API_VERSION,
        Accept: 'application/json'
      }
    });
  } catch (err) {
    const cause = err && err.cause ? ' — cause: ' + (err.cause.message || err.cause) : '';
    fail('Network-level fetch failure: ' + err.message + cause);
  }

  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch (_err) {
    // leave as raw text
  }

  if (!res.ok) {
    console.error('Response body:', JSON.stringify(body, null, 2));
    fail('GET /locations/{locationId}/customFields failed with status ' + res.status);
  }

  const fields = Array.isArray(body) ? body : Array.isArray(body && body.customFields) ? body.customFields : null;
  if (!fields) {
    console.error('Response body:', JSON.stringify(body, null, 2));
    fail('Could not find a custom fields array in the response — see raw body above.');
  }

  console.log('Found ' + fields.length + ' custom field(s):\n');
  fields.forEach(function (field) {
    console.log('- ' + (field.name || '(unnamed)'));
    console.log('    id:       ' + field.id);
    if (field.fieldKey) console.log('    fieldKey: ' + field.fieldKey);
    if (field.dataType) console.log('    dataType: ' + field.dataType);
  });

  console.log('\n=== Likely matches for the three new fields ===');
  TARGET_FIELDS.forEach(function (target) {
    const matches = fields.filter(function (field) {
      const name = String(field.name || '');
      return target.patterns.every(function (pattern) {
        return pattern.test(name);
      });
    });
    console.log('\n' + target.key + ':');
    if (!matches.length) {
      console.log('  (no confident match found by name — check the full list above)');
    } else {
      matches.forEach(function (field) {
        console.log('  candidate: "' + field.name + '" → id: ' + field.id);
      });
    }
  });

  console.log(
    '\nCopy the correct id for each of the three fields above into\n' +
      'CUSTOM_FIELD_IDS in serverless/lib/ghl.js — same manual step as every\n' +
      'other field already mapped in this file.'
  );
}

main().catch((err) => {
  console.error('\n✗ Script threw an unexpected error:', err.message);
  process.exit(1);
});
