// Run with: node --test serverless/lib
// (or `npm test`, see package.json)
//
// Uses Node's built-in test runner and assert module only — no extra
// dependencies. All GHL network calls are mocked; nothing here ever makes
// a real request or logs a real applicant's data. TEST_LICENSE_NUMBER is a
// fixed literal placeholder value, never real license data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApplicationSubmission } from './ghl.js';

const BASE_ENV = {
  GHL_LOCATION_ID: 'loc_123',
  GHL_PRIVATE_INTEGRATION_TOKEN: 'token_abc',
  GHL_PIPELINE_ID: 'pipeline_1',
  GHL_APPLICATION_SUBMITTED_STAGE_ID: 'stage_1'
};

const DRIVERS_LICENSE_NUMBER_FIELD_ID = 'bqKmhj6NrbgyVei7YEvS';
const TEST_LICENSE_NUMBER = 'TEST123';

function makeValidFormData(overrides = {}) {
  const fd = new FormData();
  const defaults = {
    first_name: 'Jane',
    last_name: 'Doe',
    phone: '4045551234',
    email: 'jane@example.com',
    date_of_birth: '1990-01-01',
    drivers_license_number: TEST_LICENSE_NUMBER,
    drivers_license_state: 'GA',
    rental_option: 'Deposit Option',
    application_certification: 'on'
  };
  const fields = Object.assign({}, defaults, overrides);
  Object.keys(fields).forEach((k) => {
    if (fields[k] !== undefined) fd.append(k, fields[k]);
  });
  fd.append('platforms', 'Uber');
  fd.append('license_front', new File(['x'], 'front.jpg', { type: 'image/jpeg' }));
  fd.append('license_back', new File(['x'], 'back.jpg', { type: 'image/jpeg' }));
  fd.append('platform_screenshot', new File(['x'], 'shot.jpg', { type: 'image/jpeg' }));
  return fd;
}

function withMockedGhlFetch(run) {
  let capturedContactBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/medias/upload-file')) {
      return new Response(JSON.stringify({ url: 'https://media.example.com/x' }), { status: 200 });
    }
    if (String(url).includes('/contacts/upsert')) {
      capturedContactBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ contact: { id: 'contact_999' } }), { status: 200 });
    }
    if (String(url).includes('/opportunities/')) {
      return new Response(JSON.stringify({ id: 'opp_111' }), { status: 200 });
    }
    throw new Error('Unexpected fetch to ' + url);
  };
  return run(() => capturedContactBody).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

test('drivers_license_number reaches /contacts/upsert customFields with the correct field ID and value', async () => {
  await withMockedGhlFetch(async (getCapturedContactBody) => {
    const res = await handleApplicationSubmission(makeValidFormData(), BASE_ENV);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);

    const contactBody = getCapturedContactBody();
    assert.ok(contactBody, 'contact upsert should have been called');

    const licenseField = contactBody.customFields.find((f) => f.id === DRIVERS_LICENSE_NUMBER_FIELD_ID);
    assert.ok(licenseField, 'drivers_license_number custom field should be present in the payload');
    assert.deepEqual(licenseField, {
      id: DRIVERS_LICENSE_NUMBER_FIELD_ID,
      field_value: TEST_LICENSE_NUMBER
    });
  });
});

test('a blank drivers_license_number is rejected before reaching GHL (required field)', async () => {
  const res = await handleApplicationSubmission(makeValidFormData({ drivers_license_number: '' }), BASE_ENV);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.ok, false);
  assert.match(body.error, /drivers_license_number/);
});
