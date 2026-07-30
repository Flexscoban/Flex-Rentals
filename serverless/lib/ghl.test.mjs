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

// Same three field IDs hardcoded in serverless/lib/ghl.js CUSTOM_FIELD_IDS
// — not imported (the module doesn't export them), kept in sync manually
// like DRIVERS_LICENSE_NUMBER_FIELD_ID above already was.
const DRIVERS_LICENSE_EXPIRATION_FIELD_ID = 'S9fPj83iMZonybReJRYY';
const DESIRED_RENTAL_START_DATE_FIELD_ID = 'WGvpVROHnbOl2QsoKNTt';
const RENTAL_LENGTH_PREFERENCE_FIELD_ID = 'XqsYciy7jWbL5xCfEBQT';
const TEST_LICENSE_EXPIRATION = '2030-01-01';
const TEST_RENTAL_START_DATE = '2026-08-01';
const TEST_RENTAL_LENGTH_PREFERENCE = 'Weekly Rental (Preferred)';
const TEST_PREFERRED_VEHICLE = 'Ford Fusion';

// Same three FILE_UPLOAD field IDs hardcoded in serverless/lib/ghl.js
// CUSTOM_FIELD_IDS — not imported (the module doesn't export them), kept
// in sync manually like DRIVERS_LICENSE_NUMBER_FIELD_ID above already was.
const LICENSE_FRONT_FIELD_ID = '3F9ozUT0CvHoXbGbZdtm';
const LICENSE_BACK_FIELD_ID = '9l9dAfs5Ok4bQaylg3HF';
const PLATFORM_SCREENSHOT_FIELD_ID = 'UQDBEgFi3TfogMuGK14P';

const MOCK_CONTACT_ID = 'contact_999';

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
    drivers_license_expiration: TEST_LICENSE_EXPIRATION,
    rental_option: 'Deposit Option',
    application_certification: 'on',
    desired_rental_start_date: TEST_RENTAL_START_DATE,
    rental_length_preference: TEST_RENTAL_LENGTH_PREFERENCE,
    preferred_vehicle: TEST_PREFERRED_VEHICLE
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

// Pulls the "<fieldId>_<uuid>" file entry back out of a customFields/upload
// multipart body, skipping the "id" and "maxFiles" fields alongside it.
function extractUploadFieldAndFile(formData) {
  for (const [key, value] of formData.entries()) {
    if (key === 'id' || key === 'maxFiles') continue;
    return { fieldId: key.split('_')[0], uuid: key.split('_')[1], file: value };
  }
  return { fieldId: null, uuid: null, file: null };
}

/**
 * A single configurable mock for every GHL call handleApplicationSubmission
 * makes: contact upsert, the drivers_license_number fallback PUT, the
 * customFields/upload + attach PUT pair for each of the three files, and
 * opportunity creation. `failUploadFieldIds` / `failAttachFieldIds` let a
 * test simulate one or more files failing at either stage;
 * `failLicenseFallbackPut` reproduces the pre-existing fallback-failure
 * test unchanged.
 */
function createMockFetch(opts = {}) {
  const { failUploadFieldIds = [], failAttachFieldIds = [], failLicenseFallbackPut = false } = opts;
  const calls = [];
  let capturedContactBody = null;

  const fetchImpl = async (url, options) => {
    const urlStr = String(url);
    const method = (options && options.method) || 'GET';
    const isJsonBody = options && typeof options.body === 'string';
    const jsonBody = isJsonBody ? JSON.parse(options.body) : null;
    const isFormDataBody = options && options.body instanceof FormData;
    calls.push({ url: urlStr, method, body: jsonBody, formData: isFormDataBody ? options.body : null });

    if (urlStr.includes('/contacts/upsert')) {
      capturedContactBody = jsonBody;
      return new Response(JSON.stringify({ contact: { id: MOCK_CONTACT_ID } }), { status: 200 });
    }

    if (urlStr.includes('/customFields/upload')) {
      const { fieldId, file } = extractUploadFieldAndFile(options.body);
      if (failUploadFieldIds.includes(fieldId)) {
        return new Response('upload error', { status: 500 });
      }
      return new Response(
        JSON.stringify({
          uploadedFiles: { [file.name]: 'https://files.example.com/' + fieldId },
          meta: [{ originalname: file.name, url: 'https://files.example.com/' + fieldId }]
        }),
        { status: 201 }
      );
    }

    if (urlStr.includes('/contacts/' + MOCK_CONTACT_ID) && method === 'PUT') {
      const fieldEntry = jsonBody && jsonBody.customFields && jsonBody.customFields[0];
      const fieldId = fieldEntry && fieldEntry.id;
      if (fieldId === DRIVERS_LICENSE_NUMBER_FIELD_ID) {
        return failLicenseFallbackPut
          ? new Response('server error', { status: 500 })
          : new Response(JSON.stringify({ contact: { id: MOCK_CONTACT_ID } }), { status: 200 });
      }
      if (failAttachFieldIds.includes(fieldId)) {
        return new Response('attach error', { status: 500 });
      }
      return new Response(JSON.stringify({ contact: { id: MOCK_CONTACT_ID } }), { status: 200 });
    }

    if (urlStr.includes('/opportunities/')) {
      return new Response(JSON.stringify({ id: 'opp_111' }), { status: 200 });
    }

    throw new Error('Unexpected fetch to ' + urlStr);
  };

  return { calls, getCapturedContactBody: () => capturedContactBody, fetchImpl };
}

async function withMockedGhlFetch(opts, run) {
  const mock = createMockFetch(opts);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fetchImpl;
  try {
    await run(mock);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('drivers_license_number reaches /contacts/upsert customFields with the correct field ID and value', async () => {
  await withMockedGhlFetch({}, async (mock) => {
    const res = await handleApplicationSubmission(makeValidFormData(), BASE_ENV);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);

    const contactBody = mock.getCapturedContactBody();
    assert.ok(contactBody, 'contact upsert should have been called');

    const licenseField = contactBody.customFields.find((f) => f.id === DRIVERS_LICENSE_NUMBER_FIELD_ID);
    assert.ok(licenseField, 'drivers_license_number custom field should be present in the payload');
    assert.deepEqual(licenseField, {
      id: DRIVERS_LICENSE_NUMBER_FIELD_ID,
      field_value: TEST_LICENSE_NUMBER
    });
  });
});

test('drivers_license_expiration, desired_rental_start_date, and rental_length_preference all reach /contacts/upsert customFields with the correct field IDs and values', async () => {
  await withMockedGhlFetch({}, async (mock) => {
    const res = await handleApplicationSubmission(makeValidFormData(), BASE_ENV);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);

    const contactBody = mock.getCapturedContactBody();
    assert.ok(contactBody, 'contact upsert should have been called');

    const expected = [
      [DRIVERS_LICENSE_EXPIRATION_FIELD_ID, TEST_LICENSE_EXPIRATION],
      [DESIRED_RENTAL_START_DATE_FIELD_ID, TEST_RENTAL_START_DATE],
      [RENTAL_LENGTH_PREFERENCE_FIELD_ID, TEST_RENTAL_LENGTH_PREFERENCE]
    ];
    expected.forEach(([fieldId, value]) => {
      const field = contactBody.customFields.find((f) => f.id === fieldId);
      assert.ok(field, 'custom field ' + fieldId + ' should be present in the payload');
      assert.deepEqual(field, { id: fieldId, field_value: value });
    });
  });
});

test('a blank drivers_license_expiration is rejected before reaching GHL (required field)', async () => {
  const res = await handleApplicationSubmission(makeValidFormData({ drivers_license_expiration: '' }), BASE_ENV);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.ok, false);
  assert.match(body.error, /drivers_license_expiration/);
});

test('a blank desired_rental_start_date is rejected before reaching GHL (required field)', async () => {
  const res = await handleApplicationSubmission(makeValidFormData({ desired_rental_start_date: '' }), BASE_ENV);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.ok, false);
  assert.match(body.error, /desired_rental_start_date/);
});

test('a blank rental_length_preference is rejected before reaching GHL (required field)', async () => {
  const res = await handleApplicationSubmission(makeValidFormData({ rental_length_preference: '' }), BASE_ENV);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.ok, false);
  assert.match(body.error, /rental_length_preference/);
});

test('a blank preferred_vehicle is rejected before reaching GHL (required field)', async () => {
  const res = await handleApplicationSubmission(makeValidFormData({ preferred_vehicle: '' }), BASE_ENV);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.ok, false);
  assert.match(body.error, /preferred_vehicle/);
});

// CUSTOM_FIELD_IDS.preferred_vehicle is intentionally blank until the real
// GHL custom-field ID is provided (see the comment above it in ghl.js) —
// buildCustomFields() already skips any field with a blank ID, the same
// contract every other not-yet-configured field (sms_consent,
// drivers_license_state, rental_notes, application_certification) relies
// on. This test locks in that a submitted preferred_vehicle value is
// currently omitted rather than silently mis-sent, and should be replaced
// with a "reaches customFields with the correct field ID" assertion (like
// the one above for drivers_license_expiration etc.) once the real ID is
// filled in.
test('preferred_vehicle is validated as required but not yet sent to GHL (field ID not configured)', async () => {
  await withMockedGhlFetch({}, async (mock) => {
    const res = await handleApplicationSubmission(makeValidFormData(), BASE_ENV);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);

    const contactBody = mock.getCapturedContactBody();
    assert.ok(contactBody, 'contact upsert should have been called');
    const values = contactBody.customFields.map((f) => f.field_value);
    assert.ok(
      !values.includes(TEST_PREFERRED_VEHICLE),
      'preferred_vehicle should not appear in customFields until CUSTOM_FIELD_IDS.preferred_vehicle is set'
    );
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
  await withMockedGhlFetch({}, async (mock) => {
    const res = await handleApplicationSubmission(makeValidFormData(), BASE_ENV);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);

    const putCall = mock.calls.find((c) => c.method === 'PUT' && c.url.includes('/contacts/'));
    assert.ok(putCall, 'a PUT /contacts/{contactId} call should have been made');
    assert.equal(putCall.url, 'https://services.leadconnectorhq.com/contacts/' + MOCK_CONTACT_ID);
    assert.deepEqual(putCall.body, {
      customFields: [{ id: DRIVERS_LICENSE_NUMBER_FIELD_ID, field_value: TEST_LICENSE_NUMBER }]
    });

    // The fallback PUT must run after the contact upsert (it needs the
    // contact id) and there must be exactly one upsert and one opportunity
    // call, no matter how many file-attach calls also happened.
    const upsertIndex = mock.calls.findIndex((c) => c.url.includes('/contacts/upsert'));
    const putIndex = mock.calls.findIndex((c) => c.method === 'PUT' && c.url.includes('/contacts/'));
    assert.ok(upsertIndex !== -1 && putIndex > upsertIndex, 'PUT must happen after the upsert');
    assert.equal(mock.calls.filter((c) => c.url.includes('/contacts/upsert')).length, 1);
    assert.equal(mock.calls.filter((c) => c.url.includes('/opportunities/')).length, 1);
  });
});

test('drivers_license_number fallback PUT failure does not change the success response or block the opportunity', async () => {
  await withMockedGhlFetch({ failLicenseFallbackPut: true }, async (mock) => {
    const res = await handleApplicationSubmission(makeValidFormData(), BASE_ENV);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(mock.calls.filter((c) => c.url.includes('/opportunities/')).length, 1, 'opportunity should still be created');
  });
});

test('all three files upload and attach successfully with the confirmed request/response shapes', async () => {
  await withMockedGhlFetch({}, async (mock) => {
    const res = await handleApplicationSubmission(makeValidFormData(), BASE_ENV);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);

    const uploadCalls = mock.calls.filter((c) => c.url.includes('/customFields/upload'));
    assert.equal(uploadCalls.length, 3, 'all three files should hit the upload endpoint');

    const expectedFieldIds = [LICENSE_FRONT_FIELD_ID, LICENSE_BACK_FIELD_ID, PLATFORM_SCREENSHOT_FIELD_ID];
    uploadCalls.forEach((call) => {
      assert.equal(call.formData.get('id'), MOCK_CONTACT_ID, 'upload must include id=<contactId>');
      assert.equal(call.formData.get('maxFiles'), '1', 'upload must include maxFiles="1"');
      const { fieldId } = extractUploadFieldAndFile(call.formData);
      assert.ok(expectedFieldIds.includes(fieldId), 'multipart key must be prefixed with a known field ID');
    });

    // One attach PUT per file, each with the confirmed uuid-keyed
    // field_value map shape (not a bare URL string), and the original
    // filename preserved end to end from makeValidFormData() above.
    const expectedFileNameByFieldId = {
      [LICENSE_FRONT_FIELD_ID]: 'front.jpg',
      [LICENSE_BACK_FIELD_ID]: 'back.jpg',
      [PLATFORM_SCREENSHOT_FIELD_ID]: 'shot.jpg'
    };
    expectedFieldIds.forEach((fieldId) => {
      const attachPut = mock.calls.find(
        (c) => c.method === 'PUT' && c.url.includes('/contacts/') && c.body && c.body.customFields[0].id === fieldId
      );
      assert.ok(attachPut, 'expected an attach PUT for field ' + fieldId);
      const fieldValue = attachPut.body.customFields[0].field_value;
      const uuidKeys = Object.keys(fieldValue);
      assert.equal(uuidKeys.length, 1);
      assert.deepEqual(fieldValue[uuidKeys[0]], {
        name: expectedFileNameByFieldId[fieldId],
        url: 'https://files.example.com/' + fieldId
      });
    });
  });
});

test('one file failing to upload does not block the other two files, the contact, or the opportunity', async () => {
  await withMockedGhlFetch({ failUploadFieldIds: [LICENSE_BACK_FIELD_ID] }, async (mock) => {
    const res = await handleApplicationSubmission(makeValidFormData(), BASE_ENV);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true, 'a single file failure must not change the success response');

    assert.equal(mock.calls.filter((c) => c.url.includes('/contacts/upsert')).length, 1, 'contact must still be created');
    assert.equal(mock.calls.filter((c) => c.url.includes('/opportunities/')).length, 1, 'opportunity must still be created');

    // license_back's upload failed, so it must never reach the attach PUT.
    const licenseBackAttach = mock.calls.find(
      (c) => c.method === 'PUT' && c.body && c.body.customFields && c.body.customFields[0].id === LICENSE_BACK_FIELD_ID
    );
    assert.equal(licenseBackAttach, undefined, 'license_back should not get an attach PUT after a failed upload');

    // The other two files must still succeed end to end.
    [LICENSE_FRONT_FIELD_ID, PLATFORM_SCREENSHOT_FIELD_ID].forEach((fieldId) => {
      const attachPut = mock.calls.find(
        (c) => c.method === 'PUT' && c.body && c.body.customFields && c.body.customFields[0].id === fieldId
      );
      assert.ok(attachPut, 'field ' + fieldId + ' should still have succeeded');
    });
  });
});

test('two files failing (one at upload, one at attach) still leaves the contact and opportunity created, and the third file intact', async () => {
  await withMockedGhlFetch(
    { failUploadFieldIds: [LICENSE_BACK_FIELD_ID], failAttachFieldIds: [PLATFORM_SCREENSHOT_FIELD_ID] },
    async (mock) => {
      const res = await handleApplicationSubmission(makeValidFormData(), BASE_ENV);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.equal(body.ok, true, 'two file failures must not change the success response');

      assert.equal(mock.calls.filter((c) => c.url.includes('/contacts/upsert')).length, 1, 'contact must still be created');
      assert.equal(mock.calls.filter((c) => c.url.includes('/opportunities/')).length, 1, 'opportunity must still be created');

      // license_back never got past the upload step.
      assert.equal(
        mock.calls.filter((c) => c.url.includes('/customFields/upload')).length,
        3,
        'all three uploads should still be attempted independently'
      );

      // platform_screenshot uploaded fine but its attach PUT failed — the
      // failure must be swallowed, not surfaced as an error response.
      const screenshotUploadCall = mock.calls.find((c) => {
        if (!c.url.includes('/customFields/upload')) return false;
        const { fieldId } = extractUploadFieldAndFile(c.formData);
        return fieldId === PLATFORM_SCREENSHOT_FIELD_ID;
      });
      assert.ok(screenshotUploadCall, 'platform_screenshot upload should have been attempted');

      // Only license_front should have a fully successful attach PUT.
      const frontAttach = mock.calls.find(
        (c) => c.method === 'PUT' && c.body && c.body.customFields && c.body.customFields[0].id === LICENSE_FRONT_FIELD_ID
      );
      assert.ok(frontAttach, 'license_front should still have succeeded');
    }
  );
});
