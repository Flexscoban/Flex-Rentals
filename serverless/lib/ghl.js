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
   Custom Field IDs — these are specific to YOUR GoHighLevel sub-account and
   cannot be known ahead of time. After creating the custom fields listed in
   GHL-FORM-INTEGRATION.md, copy each field's ID and paste it below. Until
   you do, submissions still work — any field left as "REPLACE_WITH_..." is
   simply skipped so it never crashes a live application.
   -------------------------------------------------------------------------- */
const CUSTOM_FIELD_IDS = {
  sms_consent: 'REPLACE_WITH_FIELD_ID_sms_consent',
  drivers_license_number: 'REPLACE_WITH_FIELD_ID_drivers_license_number',
  drivers_license_state: 'REPLACE_WITH_FIELD_ID_drivers_license_state',
  license_front_url: 'REPLACE_WITH_FIELD_ID_license_front_url',
  license_back_url: 'REPLACE_WITH_FIELD_ID_license_back_url',
  platforms: 'REPLACE_WITH_FIELD_ID_platforms',
  platform_screenshot_url: 'REPLACE_WITH_FIELD_ID_platform_screenshot_url',
  rental_option: 'REPLACE_WITH_FIELD_ID_rental_option',
  rental_notes: 'REPLACE_WITH_FIELD_ID_rental_notes',
  application_certification: 'REPLACE_WITH_FIELD_ID_application_certification'
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

async function uploadFileToGHL(env, file, label) {
  if (!isRealFile(file)) return null;
  try {
    const uploadForm = new FormData();
    uploadForm.append('file', file, file.name || label);
    uploadForm.append('locationId', env.GHL_LOCATION_ID);
    const res = await ghlFetch(env, '/medias/upload-file', {
      method: 'POST',
      body: uploadForm
    });
    if (!res.ok) {
      console.error('[GHL] media upload failed for ' + label + ':', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json();
    return (data && (data.url || data.fileUrl)) || null;
  } catch (err) {
    console.error('[GHL] media upload threw for ' + label + ':', err);
    return null;
  }
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

  // File uploads are best-effort: one flaky upload should not lose an
  // otherwise-complete application. A failed upload is recorded on the
  // contact as plain text so staff know to follow up for that document.
  const [licenseFrontUrl, licenseBackUrl, platformScreenshotUrl] = await Promise.all([
    uploadFileToGHL(env, files.license_front, 'license-front'),
    uploadFileToGHL(env, files.license_back, 'license-back'),
    uploadFileToGHL(env, files.platform_screenshot, 'platform-screenshot')
  ]);

  const customFields = buildCustomFields({
    sms_consent: fields.sms_consent ? 'Yes' : 'No',
    drivers_license_number: fields.drivers_license_number,
    drivers_license_state: fields.drivers_license_state,
    license_front_url: licenseFrontUrl || 'Upload failed — follow up with applicant',
    license_back_url: licenseBackUrl || 'Upload failed — follow up with applicant',
    platforms: fields.platforms,
    platform_screenshot_url: platformScreenshotUrl || 'Upload failed — follow up with applicant',
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
