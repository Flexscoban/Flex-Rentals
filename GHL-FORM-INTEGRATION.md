# Flex Rentals — Application Form → GoHighLevel Integration

The five-step application form on `index.html` (`#applyForm`) submits directly
to your Flex Rentals GoHighLevel sub-account. The browser never talks to GHL
directly — it POSTs `multipart/form-data` (including the uploaded files) to a
serverless function, and that function holds your private GHL credentials and
does the actual work: upload files, upsert the contact, tag it, and create the
opportunity.

The form's UI, validation, styling, and success screen are unchanged. This
document only covers wiring the backend.

```
Browser (index.html)
   │  FormData POST  →  /api/submit-application
   ▼
Serverless function (serverless/lib/ghl.js)
   │  Bearer token, server-side only
   ▼
GoHighLevel API (services.leadconnectorhq.com)
   → uploads 3 files to Media Library
   → upserts the contact + custom fields + "Application Submitted" tag
   → creates an opportunity in the Flex Rentals Pipeline
```

One function body (`serverless/lib/ghl.js`) is shared by three thin,
platform-specific entry points — deploy whichever one matches where you're
hosting the site:

| Platform | Entry point | Routes to |
|---|---|---|
| Netlify | `netlify/functions/submit-application.js` | `/api/submit-application` |
| Vercel | `api/submit-application.js` (Edge Function) | `/api/submit-application` |
| Cloudflare Pages | `functions/api/submit-application.js` | `/api/submit-application` |

The frontend always calls `/api/submit-application`, so you never need to
change `js/script.js` no matter which platform you pick.


## 1. Create the custom fields in GHL

In your Flex Rentals GHL sub-account: **Settings → Custom Fields → Contact →
Add Field**. Create these 10 fields (any type shown works; "Text" is the
safe default if you're not sure):

| Field name to create | Suggested type | Stores |
|---|---|---|
| `SMS Consent` | Text or Yes/No | "Yes" / "No" |
| `Driver's License Number` | Text | license number |
| `Driver's License State` | Text | 2-letter state code |
| `License Front URL` | Text | hosted URL of the uploaded photo |
| `License Back URL` | Text | hosted URL of the uploaded photo |
| `Gig Platforms` | Text or Multiple Options | Uber, Lyft, etc. |
| `Platform Screenshot URL` | Text | hosted URL of the uploaded screenshot |
| `Rental Option` | Text | "Deposit Option" / "No Deposit Option" |
| `Rental Notes` | Large Text | free-form notes |
| `Application Certification` | Text or Yes/No | "Yes" / "No" |

After creating each field, open it and copy its **Field ID** (GHL shows this
in the field's settings, or in the URL when you click into it — it looks like
`a1B2c3D4e5F6g7H8i9J0`). You can also list every custom field and its ID with:

```
GET https://services.leadconnectorhq.com/locations/{locationId}/customFields
Authorization: Bearer {your private integration token}
Version: 2021-07-28
```

Paste each ID into `serverless/lib/ghl.js`, near the top, replacing the
matching `REPLACE_WITH_FIELD_ID_...` placeholder:

```js
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
```

Field IDs are specific to your sub-account, not secrets — it's fine that
they live in this server-side file. Any field left as `REPLACE_WITH_...` is
simply skipped (not sent to GHL) rather than crashing a live submission, so
you can fill these in gradually and redeploy.

`first_name`, `last_name`, `email`, `phone`, and `date_of_birth` are **not**
custom fields — they map to GHL's built-in contact fields directly, no setup
needed.


## 2. Create the pipeline and stage

**Opportunities → Pipelines → Add Pipeline** (or reuse an existing one),
named e.g. **"Flex Rentals Pipeline"**, with a stage named e.g.
**"Application Submitted"** as its first stage.


## 3. Get your four credential values

| Env var | Where to find it |
|---|---|
| `GHL_LOCATION_ID` | Settings → Business Profile (also called "Location ID" — it's in the URL of your sub-account, e.g. `.../location/XXXXXXXXXXXXXXXXXXXX/...`) |
| `GHL_PRIVATE_INTEGRATION_TOKEN` | Settings → Private Integrations → Create Private Integration. Grant it: `contacts.write`, `contacts.readonly`, `opportunities.write`, `opportunities.readonly`, and `medias.write` (or the closest "Media Library" write scope your GHL version shows). Copy the token — GHL only shows it once. |
| `GHL_PIPELINE_ID` | Open the pipeline in GHL; the ID is in the URL, or call `GET /opportunities/pipelines?locationId={locationId}` and read `pipelines[].id`. |
| `GHL_APPLICATION_SUBMITTED_STAGE_ID` | Same pipelines response — each pipeline includes a `stages[]` array; find the "Application Submitted" stage and copy its `id`. |

**Never** put these four values in `index.html`, `js/script.js`, or anywhere
else that ships to the browser or gets committed to source control — they
only ever go into your hosting platform's environment variable settings
(step 4).


## 4. Add the environment variables

Pick the platform you're deploying to:

**Netlify** — Site configuration → Environment variables → Add a variable
(add all four, scope: "All scopes" / "Functions"). Or via CLI:
```
netlify env:set GHL_LOCATION_ID "..."
netlify env:set GHL_PRIVATE_INTEGRATION_TOKEN "..."
netlify env:set GHL_PIPELINE_ID "..."
netlify env:set GHL_APPLICATION_SUBMITTED_STAGE_ID "..."
```

**Vercel** — Project → Settings → Environment Variables (add all four to
Production, and Preview if you want staging deploys to work too). Or via CLI:
```
vercel env add GHL_LOCATION_ID
vercel env add GHL_PRIVATE_INTEGRATION_TOKEN
vercel env add GHL_PIPELINE_ID
vercel env add GHL_APPLICATION_SUBMITTED_STAGE_ID
```

**Cloudflare Pages** — Workers & Pages → your project → Settings →
Environment variables. Add `GHL_PRIVATE_INTEGRATION_TOKEN` as an
**encrypted/secret** variable specifically (the others can be plain). Or via
Wrangler CLI:
```
wrangler pages secret put GHL_PRIVATE_INTEGRATION_TOKEN
```

For local testing, each platform's CLI supports a local `.env` file
(`.env`/`.env.local`, already excluded via `.gitignore` in this repo) — don't
commit it.


## 5. Deploy the function

Pick one:

**Netlify**
1. Connect this repo in the Netlify dashboard, or run `netlify deploy` from
   the repo root (Netlify CLI auto-detects `netlify.toml`).
2. `netlify.toml` already points Netlify at `netlify/functions` and this
   site's root as the publish directory — no further config needed.
3. The function is reachable at `/api/submit-application` (configured via
   the `config.path` export in `netlify/functions/submit-application.js`).

**Vercel**
1. Import this repo in the Vercel dashboard, or run `vercel deploy` from the
   repo root. Vercel auto-detects `api/submit-application.js` as an Edge
   Function (via its `export const config = { runtime: 'edge' }`) and the
   rest of the repo as a static site.
2. No extra routing config needed — files under `/api` map to `/api/<name>`
   automatically.

**Cloudflare Pages**
1. Connect this repo as a Cloudflare Pages project (Framework preset:
   "None" / static), build output directory: `/` (repo root).
2. Cloudflare auto-detects `functions/api/submit-application.js` as a Pages
   Function and routes it to `/api/submit-application`.

You only need to deploy to **one** of these — pick whichever you already use
for hosting, or whichever the team prefers. The other two entry-point files
can simply stay unused in the repo.


## 6. Test a submission

1. Open the deployed site and fill out the application form completely,
   including uploading two license photos and a platform screenshot.
2. Submit. The button should disable immediately and re-enable only if
   something goes wrong.
3. **Success case:** the existing "Application Received" success screen
   appears — this only happens after the serverless function returns
   `{ ok: true }`, i.e. after GHL actually confirmed the contact/opportunity
   were created.
4. **Failure case (to test deliberately):** temporarily rename one required
   env var (e.g. add a typo to `GHL_PIPELINE_ID`) and redeploy, then submit
   again. You should see the in-form message: *"Something went wrong
   submitting your application. Please try again, or call/text us at
   (404) 738-6601 and we'll finish it with you."* — and every field you
   filled in should still be there. Put the env var back afterward.
5. Check your function logs (Netlify: Functions tab; Vercel: Deployments →
   Functions → Logs; Cloudflare: Pages project → Functions → real-time
   logs / `wrangler pages deployment tail`) — any GHL API error is logged
   there with the response status and body, which is the fastest way to
   debug a misconfigured field ID or scope.


## 7. Confirm the contact and opportunity were created

1. In GHL, go to **Contacts** and search by the email or phone you tested
   with. Open the contact and confirm:
   - The **"Application Submitted"** tag is present.
   - The custom fields you configured in step 1 are populated (license
     number/state, rental option, notes, etc.), including the three
     `..._url` fields pointing at the uploaded photos — open one to confirm
     it's actually your test photo.
2. Go to **Opportunities → Flex Rentals Pipeline** and confirm a new
   opportunity exists in the **Application Submitted** stage, linked to that
   same contact.


## Notes and known limits

- **File size:** hosting platforms cap request body size for serverless
  functions (roughly 4.5 MB on Vercel, ~6 MB on Netlify Functions;
  Cloudflare Pages Functions allow more). Three photos from a phone camera
  can occasionally exceed that. If applicants start hitting failures here,
  either raise the limit (Cloudflare) or ask them to choose a smaller/more
  compressed image.
- **File upload is best-effort:** if uploading one of the three photos to
  GHL's Media Library fails but everything else succeeds, the application
  still goes through — the affected field is set to `"Upload failed — follow
  up with applicant"` instead of a URL so staff know to request that document
  again. This is intentional: a single flaky upload shouldn't lose an
  otherwise-complete application.
- **Opportunity creation is also best-effort:** if the contact was created
  successfully but the opportunity call fails, the applicant still sees the
  success screen (their information is safely in GHL as a contact) — the
  failure is logged server-side (`contact_created_opportunity_failed`) so
  staff can add the opportunity manually.
- The GHL API version header used is `2021-07-28`
  (`services.leadconnectorhq.com`, the current LeadConnector/API v2 base).
  If GoHighLevel later requires a newer version header, update
  `GHL_API_VERSION` at the top of `serverless/lib/ghl.js`.
