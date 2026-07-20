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

const MOCK_CONTACT_ID = 'contact_999';

function withMockedGhlFetch(run) {
  const calls = [];
  let capturedContactBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const method = (options && options.method) || 'GET';
    const isJsonBody = options && typeof options.body === 'string';
    const body = isJsonBody ? JSON.parse(options.body) : null;
    calls.push({ url: String(url), method, body });

    if (String(url).includes('/medias/upload-file')) {
      return new Response(JSON.stringify({ url: 'https://media.example.com/x' }), { status: 200 });
    }
    if (String(url).includes('/contacts/upsert')) {
      capturedContactBody = body;
      return new Response(JSON.stringify({ contact: { id: MOCK_CONTACT_ID } }), { status: 200 });
    }
    if (String(url).includes('/contacts/' + MOCK_CONTACT_ID) && method === 'PUT') {
      return new Response(JSON.stringify({ contact: { id: MOCK_CONTACT_ID } }), { status: 200 });
    }
    if (String(url).includes('/opportunities/')) {
      return new Response(JSON.stringify({ id: 'opp_111' }), { status: 200 });
    }
    throw new Error('Unexpected fetch to ' + url);
  };
  return run(() => capturedContactBody, calls).finally(() => {
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

test('drivers_license_number fallback PUT is sent to the right contact with the right field ID and value', async () => {
  await withMockedGhlFetch(async (_getCapturedContactBody, calls) => {
    const res = await handleApplicationSubmission(makeValidFormData(), BASE_ENV);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);

    const putCall = calls.find((c) => c.method === 'PUT' && c.url.includes('/contacts/'));
    assert.ok(putCall, 'a PUT /contacts/{contactId} call should have been made');
    assert.equal(putCall.url, 'https://services.leadconnectorhq.com/contacts/' + MOCK_CONTACT_ID);
    assert.deepEqual(putCall.body, {
      customFields: [{ id: DRIVERS_LICENSE_NUMBER_FIELD_ID, field_value: TEST_LICENSE_NUMBER }]
    });

    // The fallback PUT must run after the contact upsert (it needs the
    // contact id) and it must not replace or duplicate the contact upsert
    // or opportunity creation calls.
    const upsertIndex = calls.findIndex((c) => c.url.includes('/contacts/upsert'));
    const putIndex = calls.findIndex((c) => c.method === 'PUT' && c.url.includes('/contacts/'));
    assert.ok(upsertIndex !== -1 && putIndex > upsertIndex, 'PUT must happen after the upsert');
    assert.equal(calls.filter((c) => c.url.includes('/contacts/upsert')).length, 1);
    assert.equal(calls.filter((c) => c.url.includes('/opportunities/')).length, 1);
  });
});

test('drivers_license_number fallback PUT failure does not change the success response or block the opportunity', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const method = (options && options.method) || 'GET';
    calls.push({ url: String(url), method });
    if (String(url).includes('/medias/upload-file')) {
      return new Response(JSON.stringify({ url: 'https://media.example.com/x' }), { status: 200 });
    }
    if (String(url).includes('/contacts/upsert')) {
      return new Response(JSON.stringify({ contact: { id: MOCK_CONTACT_ID } }), { status: 200 });
    }
    if (String(url).includes('/contacts/' + MOCK_CONTACT_ID) && method === 'PUT') {
      return new Response('server error', { status: 500 });
    }
    if (String(url).includes('/opportunities/')) {
      return new Response(JSON.stringify({ id: 'opp_111' }), { status: 200 });
    }
    throw new Error('Unexpected fetch to ' + url);
  };

  try {
    const res = await handleApplicationSubmission(makeValidFormData(), BASE_ENV);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(calls.filter((c) => c.url.includes('/opportunities/')).length, 1, 'opportunity should still be created');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
