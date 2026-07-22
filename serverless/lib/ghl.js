/* ==========================================================================
   FLEX RENTALS — GoHighLevel application-submission core logic.

   Platform-agnostic on purpose: only standard Web APIs are used (fetch,
   FormData, Response), so this same file runs unmodified as a Cloudflare
   Worker, a Vercel Edge Function, or a Netlify Function (Node 18+ runtime).
   Each platform gets a thin entry point that just calls
   handleApplicationSubmission(request, env) — see:
     netlify/functions/submit-application.js
     api/submit-application.js
     functions/api/submit-application.js

   Required env vars (set on the hosting platform, never in this repo):
     GHL_LOCATION_ID
     GHL_PRIVATE_INTEGRATION_TOKEN
     GHL_PIPELINE_ID
     GHL_APPLICATION_SUBMITTED_STAGE_ID

   See GHL-FORM-INTEGRATION.md at the project root for full setup steps.
   ========================================================================== */

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

/* --------------------------------------------------------------------------
   Custom Field IDs — these are specific to YOUR GoHighLevel sub-account.
   A blank value means that field hasn't been created in GHL yet. Any
   field left blank is simply skipped so it never crashes a live
   application.

   license_front_url / license_back_url / platform_screenshot_url are
   FILE_UPLOAD-type custom fields in GHL, populated by
   attachFileUploadCustomField() below via GHL's documented file-upload
   flow (POST /locations/{locationId}/customFields/upload, followed by a
   PUT /contacts/{contactId} with a uuid-keyed field_value map) —
   verified against a real test contact and a real image, visible in the
   GHL dashboard, before being wired in here.
   -------------------------------------------------------------------------- */
const CUSTOM_FIELD_IDS = {
  sms_consent: '',
  drivers_license_number: 'bqKmhj6NrbgyVei7YEvS',
  drivers_license_state: '',
  license_front_url: '3F9ozUT0CvHoXbGbZdtm',
  license_back_url: '9l9dAfs5Ok4bQaylg3HF',
  platforms: 'owq1poGaxvV1pxKn54Ig',
  platform_screenshot_url: 'UQDBEgFi3TfogMuGK14P',
  rental_option: 'w5ykHpRM2xVtyoVF79mj',
  rental_notes: '',
  application_certification: ''
};

const REQUIRED_TEXT_FIELDS = [
  'first_name',
  'last_name',
  'phone',
  'email',
  'date_of_birth',
  'drivers_license_number',
  'drivers_license_state',
  'rental_option'
];
const REQUIRED_FILES = ['license_front', 'license_back', 'platform_screenshot'];

const SUPPORT_LINE = '(404) 738-6601';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function errorResponse(status, message) {
  return jsonResponse(status, { ok: false, error: message });
}

async function ghlFetch(env, path, options) {
  const headers = Object.assign(
    {
      Authorization: 'Bearer ' + env.GHL_PRIVATE_INTEGRATION_TOKEN,
      Version: GHL_API_VERSION
    },
    (options && options.headers) || {}
  );
  return fetch(GHL_API_BASE + path, Object.assign({}, options, { headers: headers }));
}

function isRealFile(value) {
  return value && typeof value !== 'string' && typeof value.size === 'number' && value.size > 0;
}

/**
 * Uploads one file to a FILE_UPLOAD custom field and attaches it to a
 * contact, using GHL's documented flow confirmed against a real test
 * contact:
 *   1. POST /locations/{locationId}/customFields/upload — multipart,
 *      with `id` (the contact id) and `maxFiles` fields alongside the
 *      file itself, keyed "<fieldId>_<uuid>".
 *   2. PUT /contacts/{contactId} with the returned url in a uuid-keyed
 *      field_value map — GHL's upload response does not attach the file
 *      to the contact by itself.
 * Never throws: every failure mode is caught, logged as a field id +
 * HTTP status only (never the file's URL, name, or contents, and never
 * the token), and reported back as `false` so a bad file can never take
 * down contact/opportunity creation or the other two files.
 */
async function attachFileUploadCustomField(env, contactId, fieldId, file) {
  if (!isRealFile(file) || !fieldId) return false;

  const uuid = crypto.randomUUID();
  const uploadForm = new FormData();
  uploadForm.append('id', contactId);
  uploadForm.append('maxFiles', '1');
  uploadForm.append(fieldId + '_' + uuid, file, file.name || 'upload');

  let uploadRes;
  try {
    uploadRes = await ghlFetch(env, '/locations/' + env.GHL_LOCATION_ID + '/customFields/upload', {
      method: 'POST',
      body: uploadForm
    });
  } catch (err) {
    console.error('[GHL] file upload request threw for field ' + fieldId + ':', err.message);
    return false;
  }
  if (!uploadRes.ok) {
    console.error('[GHL] file upload failed for field ' + fieldId + ' with status', uploadRes.status);
    return false;
  }

  const uploadData = await uploadRes.json().catch(() => null);
  const meta = uploadData && Array.isArray(uploadData.meta) ? uploadData.meta[0] : null;
  const uploadedUrl = meta && meta.url;
  if (!uploadedUrl) {
    console.error('[GHL] file upload for field ' + fieldId + ' returned no url');
    return false;
  }
  const fileName = meta.originalname || file.name || 'upload';

  let attachRes;
  try {
    attachRes = await ghlFetch(env, '/contacts/' + contactId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customFields: [{ id: fieldId, field_value: { [uuid]: { name: fileName, url: uploadedUrl } } }]
      })
    });
  } catch (err) {
    console.error('[GHL] file attach PUT request threw for field ' + fieldId + ':', err.message);
    return false;
  }
  if (!attachRes.ok) {
    console.error('[GHL] file attach PUT failed for field ' + fieldId + ' with status', attachRes.status);
    return false;
  }
  return true;
}

function buildCustomFields(values) {
  const fields = [];
  Object.keys(values).forEach(function (key) {
    const fieldId = CUSTOM_FIELD_IDS[key];
    if (!fieldId || fieldId.indexOf('REPLACE_WITH_') === 0) return;
    fields.push({ id: fieldId, field_value: values[key] });
  });
  return fields;
}

function normalizePhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.charAt(0) === '1') return '+' + digits;
  return raw;
}

function readFields(formData) {
  const boolish = function (v) {
    return v === 'on' || v === 'true' || v === '1';
  };
  return {
    first_name: String(formData.get('first_name') || '').trim(),
    last_name: String(formData.get('last_name') || '').trim(),
    phone: String(formData.get('phone') || '').trim(),
    email: String(formData.get('email') || '').trim(),
    sms_consent: boolish(formData.get('sms_consent')),
    date_of_birth: String(formData.get('date_of_birth') || '').trim(),
    drivers_license_number: String(formData.get('drivers_license_number') || '').trim(),
    drivers_license_state: String(formData.get('drivers_license_state') || '').trim(),
    platforms: formData.getAll('platforms').map(String).filter(Boolean),
    rental_option: String(formData.get('rental_option') || '').trim(),
    rental_notes: String(formData.get('rental_notes') || '').trim(),
    application_certification: boolish(formData.get('application_certification'))
  };
}

function readFiles(formData) {
  const files = {
    license_front: formData.get('license_front'),
    license_back: formData.get('license_back'),
    platform_screenshot: formData.get('platform_screenshot')
  };
  Object.keys(files).forEach(function (key) {
    if (!isRealFile(files[key])) files[key] = null;
  });
  return files;
}

function validate(fields, files) {
  const missing = [];
  REQUIRED_TEXT_FIELDS.forEach(function (key) {
    if (!fields[key]) missing.push(key);
  });
  if (!fields.platforms.length) missing.push('platforms');
  if (!fields.application_certification) missing.push('application_certification');
  REQUIRED_FILES.forEach(function (key) {
    if (!files[key]) missing.push(key);
  });
  return missing;
}

/**
 * Handles one application submission end to end. `formData` must be a
 * standard Web API FormData (from request.formData()). `env` must expose
 * GHL_LOCATION_ID, GHL_PRIVATE_INTEGRATION_TOKEN, GHL_PIPELINE_ID and
 * GHL_APPLICATION_SUBMITTED_STAGE_ID. Returns a standard Response.
 */
export async function handleApplicationSubmission(formData, env) {
  if (
    !env.GHL_LOCATION_ID ||
    !env.GHL_PRIVATE_INTEGRATION_TOKEN ||
    !env.GHL_PIPELINE_ID ||
    !env.GHL_APPLICATION_SUBMITTED_STAGE_ID
  ) {
    console.error('[GHL] missing one or more required environment variables');
    return errorResponse(500, 'Server is not configured yet. Please call/text ' + SUPPORT_LINE + '.');
  }

  let fields, files;
  try {
    fields = readFields(formData);
    files = readFiles(formData);
  } catch (err) {
    console.error('[GHL] failed to read submitted form data:', err);
    return errorResponse(400, 'We could not read your submission. Please try again.');
  }

  const missing = validate(fields, files);
  if (missing.length) {
    return errorResponse(400, 'Missing or invalid fields: ' + missing.join(', '));
  }

  // license_front_url / license_back_url / platform_screenshot_url are
  // FILE_UPLOAD fields and need a contact id to attach to, so they're
  // handled separately by attachFileUploadCustomField() below, after the
  // contact exists — not included in this initial upsert payload.
  const customFields = buildCustomFields({
    sms_consent: fields.sms_consent ? 'Yes' : 'No',
    drivers_license_number: fields.drivers_license_number,
    drivers_license_state: fields.drivers_license_state,
    platforms: fields.platforms,
    rental_option: fields.rental_option,
    rental_notes: fields.rental_notes,
    application_certification: fields.application_certification ? 'Yes' : 'No'
  });

  const contactBody = {
    locationId: env.GHL_LOCATION_ID,
    firstName: fields.first_name,
    lastName: fields.last_name,
    email: fields.email,
    phone: normalizePhone(fields.phone),
    dateOfBirth: fields.date_of_birth,
    tags: ['Application Submitted'],
    source: 'Website Application Form',
    customFields: customFields
  };

  let contactRes;
  try {
    contactRes = await ghlFetch(env, '/contacts/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contactBody)
    });
  } catch (err) {
    console.error('[GHL] contact upsert request threw:', err);
    return errorResponse(502, 'We could not reach our CRM. Please try again or call/text ' + SUPPORT_LINE + '.');
  }

  if (!contactRes.ok) {
    console.error('[GHL] contact upsert failed:', contactRes.status, await contactRes.text().catch(() => ''));
    return errorResponse(502, 'We could not reach our CRM. Please try again or call/text ' + SUPPORT_LINE + '.');
  }

  const contactData = await contactRes.json().catch(() => null);
  const contactId =
    (contactData && contactData.contact && contactData.contact.id) ||
    (contactData && contactData.id) ||
    null;

  if (!contactId) {
    console.error('[GHL] contact upsert response missing an id:', contactData);
    return errorResponse(502, 'We could not reach our CRM. Please try again or call/text ' + SUPPORT_LINE + '.');
  }

  // Narrowly-scoped fallback: GHL has been observed silently dropping
  // drivers_license_number from the initial /contacts/upsert call even
  // though sibling custom fields (platforms, rental_option) in the same
  // request persist correctly. Immediately re-send just this one field on
  // its own PUT as a safety net. Best-effort and non-fatal — the contact
  // (and, below, the opportunity) already exist by this point, so a
  // failure here must never change the response the applicant sees, and
  // must never log the actual license number value.
  if (fields.drivers_license_number && CUSTOM_FIELD_IDS.drivers_license_number) {
    try {
      const licenseFallbackRes = await ghlFetch(env, '/contacts/' + contactId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customFields: [
            { id: CUSTOM_FIELD_IDS.drivers_license_number, field_value: fields.drivers_license_number }
          ]
        })
      });
      if (!licenseFallbackRes.ok) {
        // Status only — never the response body, which could echo the
        // submitted value back.
        console.error('[GHL] drivers_license_number fallback PUT failed with status', licenseFallbackRes.status);
      }
    } catch (err) {
      console.error('[GHL] drivers_license_number fallback PUT request threw:', err.message);
    }
  }

  // Attach the three applicant documents independently. Each call already
  // catches its own failures internally and resolves to false rather than
  // throwing (see attachFileUploadCustomField) — the try/catch here is a
  // second layer so nothing about this step can ever reach the applicant
  // or block contact/opportunity creation, no matter what goes wrong.
  try {
    await attachFileUploadCustomField(env, contactId, CUSTOM_FIELD_IDS.license_front_url, files.license_front);
  } catch (err) {
    console.error('[GHL] license_front attach threw:', err.message);
  }
  try {
    await attachFileUploadCustomField(env, contactId, CUSTOM_FIELD_IDS.license_back_url, files.license_back);
  } catch (err) {
    console.error('[GHL] license_back attach threw:', err.message);
  }
  try {
    await attachFileUploadCustomField(env, contactId, CUSTOM_FIELD_IDS.platform_screenshot_url, files.platform_screenshot);
  } catch (err) {
    console.error('[GHL] platform_screenshot attach threw:', err.message);
  }

  const opportunityBody = {
    locationId: env.GHL_LOCATION_ID,
    pipelineId: env.GHL_PIPELINE_ID,
    pipelineStageId: env.GHL_APPLICATION_SUBMITTED_STAGE_ID,
    contactId: contactId,
    name: (fields.first_name + ' ' + fields.last_name).trim() + ' — Rental Application',
    status: 'open'
  };

  let opportunityRes;
  try {
    opportunityRes = await ghlFetch(env, '/opportunities/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opportunityBody)
    });
  } catch (err) {
    console.error('[GHL] opportunity creation request threw:', err);
    // The contact already exists in GHL at this point. Don't make the
    // applicant re-submit over a step that's purely internal bookkeeping —
    // staff can add the opportunity manually from the logged error.
    return jsonResponse(200, { ok: true, warning: 'contact_created_opportunity_failed' });
  }

  if (!opportunityRes.ok) {
    console.error(
      '[GHL] opportunity creation failed:',
      opportunityRes.status,
      await opportunityRes.text().catch(() => '')
    );
    return jsonResponse(200, { ok: true, warning: 'contact_created_opportunity_failed' });
  }

  return jsonResponse(200, { ok: true });
}

export function corsPreflightResponse() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  });
}
