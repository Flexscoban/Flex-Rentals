# Deploying Flex Rentals to Cloudflare Pages

This walks through connecting this repo to Cloudflare Pages via the
dashboard, testing on the temporary `pages.dev` URL, and only then moving
the real domain over. No code changes are needed first — `js/script.js`
already posts to `/api/submit-application`, and
`functions/api/submit-application.js` already implements it (see
`GHL-FORM-INTEGRATION.md` for the GHL-side setup: custom fields, pipeline,
credentials).


## 1. Connect the GitHub repository

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com).
2. In the left sidebar, click **Workers & Pages**.
3. Click **Create** (top right) → select the **Pages** tab → **Connect to Git**.
4. If this is the first time connecting Cloudflare to your GitHub account,
   click **Connect GitHub**, authorize the Cloudflare Pages GitHub App, and
   grant it access to `Flexscoban/Flex-Rentals` (either "All repositories"
   or "Only select repositories" → choose `Flex-Rentals`).
5. Back in Cloudflare, select the repository: **Flexscoban/Flex-Rentals**.
6. Click **Begin setup**.


## 2. Select the production branch

1. On the "Set up builds and deployments" screen, find **Production branch**.
2. Change it from `main` to **`claude/flex-rentals-landing-page-jz1dof`**.
3. Leave "Enable automatic branch deployments" on if you want every other
   branch/PR to also get its own preview URL (optional, doesn't affect
   production).


## 3. Set the build command and output directory

This is a static site with no build step, so:

1. **Framework preset:** `None`.
2. **Build command:** leave **blank** (do not put anything here).
3. **Build output directory:** `/` (a single forward slash — this tells
   Cloudflare the site's files are at the repo root, not in a `dist` or
   `build` subfolder).
4. **Root directory (advanced):** leave as `/` (default).
5. Click **Save and Deploy**. Cloudflare will clone the repo, detect
   `functions/api/submit-application.js` automatically (any file under
   `/functions` is auto-wired as a Pages Function — no extra config), and
   deploy. This first deploy will *fail to actually work end-to-end* only in
   the sense that the GHL secrets aren't set yet — that's expected, do that
   next.


## 4. Add the four GHL secrets

1. Once the project exists, go to your project → **Settings** →
   **Environment variables**.
2. Under **Production**, click **Add variable** four times, once for each:
   - `GHL_LOCATION_ID`
   - `GHL_PRIVATE_INTEGRATION_TOKEN`
   - `GHL_PIPELINE_ID`
   - `GHL_APPLICATION_SUBMITTED_STAGE_ID`
3. For each one, paste the value, then click the **Encrypt** button next to
   it before saving (this is what makes it a secret — encrypted at rest,
   never shown again in the dashboard, not visible in build logs). Do this
   for all four, even the ones that aren't strictly sensitive — keeping all
   four consistent avoids mistakes.
4. If you also want the temporary preview URLs (any branch other than
   production) to work, repeat the same four under the **Preview**
   environment tab. Not required just to test production.
5. Click **Save**.
6. Go to the **Deployments** tab and **Retry deployment** (or push any new
   commit) so the new environment variables actually take effect — Pages
   only picks up env var changes on a fresh deployment, not retroactively.


## 5. Test the Pages Function on the temporary pages.dev URL

1. After the deploy finishes, open the project's **Deployments** tab and
   click the production deployment. Copy its URL — it looks like
   `https://flex-rentals.pages.dev` or
   `https://<hash>.flex-rentals.pages.dev`.
2. Open that URL and confirm the site looks right (dark theme, hero,
   nav, etc. — same as the repo's current design, nothing should look
   different from before).
3. Scroll to **Apply Now** and fill out the real 5-step form:
   - Step 1: name, phone, email, SMS consent checkbox.
   - Step 2: date of birth, license number/state, and upload two small test
     images for License Front/Back.
   - Step 3: check at least one platform, upload a test image for the
     platform screenshot.
   - Step 4: pick a rental option.
   - Step 5: check the certification box, click **Submit Application**.
4. The **Submit Application** button should visibly disable the instant you
   click it (this is the duplicate-submission guard).
5. **If everything is configured correctly:** the existing "Application
   Received" success screen appears — this only happens after the function
   returns `{ ok: true }`, meaning GHL actually confirmed the contact and
   opportunity were created.
6. **If something's misconfigured:** you'll see the in-form message
   *"Something went wrong submitting your application. Please try again, or
   call/text us at (404) 738-6601..."* and every field you filled in stays
   exactly as you left it — nothing is cleared. That's expected error
   behavior, not a bug; move to step 6 below to diagnose why.


## 6. Confirm contact creation, opportunity creation, file uploads, and error handling

**Check the function actually ran correctly:**
1. In the Cloudflare dashboard, go to your Pages project → **Deployments**
   → click the deployment → **Functions** tab (or use "Real-time Logs" /
   `wrangler pages deployment tail` if you prefer the CLI for just viewing
   logs — you're not deploying with it, just watching output).
2. Submit the test form again while logs are open. You should see either no
   errors (success) or a `console.error` line starting with `[GHL]`
   describing exactly what failed (bad token, wrong field ID, unreachable
   API, etc.) — the error text tells you which of the 4 secrets or which
   GHL setup step to revisit.

**Check the contact was created correctly:**
1. In your GHL sub-account, go to **Contacts**, search for the test
   name/email/phone you used.
2. Open the contact and confirm:
   - Tag **"Application Submitted"** is present.
   - Custom fields are populated (license number/state, rental option,
     notes, etc.) — assuming you've already filled in the real Field IDs in
     `serverless/lib/ghl.js` per `GHL-FORM-INTEGRATION.md` step 1. If you
     haven't yet, custom fields will simply be empty (not an error) — the
     core contact/tag/opportunity flow still works without them.

**Check file uploads:**
1. On that same contact, open the `License Front URL` / `License Back URL`
   / `Platform Screenshot URL` custom fields (once configured) and confirm
   each URL opens the actual test image you uploaded.
2. If a field instead says `"Upload failed — follow up with applicant"`,
   the contact/opportunity still succeeded (uploads are deliberately
   non-fatal) — check the function logs for the specific `[GHL] media
   upload failed for ...` line to see why (usually a missing `medias.write`
   scope on the private integration token).

**Check the opportunity:**
1. Go to **Opportunities → Flex Rentals Pipeline**.
2. Confirm a new opportunity exists, named `"<First> <Last> — Rental
   Application"`, sitting in the **Application Submitted** stage, linked to
   the contact above.

**Deliberately test the failure path** (so you know it behaves correctly
before real applicants use it):
1. Go to Settings → Environment variables, edit `GHL_PIPELINE_ID` and
   change one character (don't delete it — you want a *wrong* value, not a
   *missing* one, to test a realistic failure).
2. Retry the deployment so the change takes effect.
3. Submit the test form again on the `pages.dev` URL.
4. Confirm: the in-form error message appears with the (404) 738-6601
   phone number, and every field you filled in is still there (nothing got
   cleared or reset).
5. Put `GHL_PIPELINE_ID` back to the correct value and retry the deployment
   again before moving on.


## 7. Moving joinflexrentals.com (only after everything above passes)

**Do not do this yet** — this section is for reference once testing is
done. Moving the domain changes where real production traffic goes.

1. In the Pages project, go to **Custom domains** → **Set up a custom
   domain** → enter `joinflexrentals.com` (and `www.joinflexrentals.com` if
   you use that too).
2. Cloudflare will show you the DNS record(s) to add (if the domain's
   nameservers are already on Cloudflare, it can often add the record
   automatically with one click instead).
3. Wherever `joinflexrentals.com` is currently registered/hosted (per the
   `CNAME` file in this repo, that currently looks like GitHub Pages), you'd
   update its DNS to point at Cloudflare Pages instead, following whatever
   record Cloudflare shows you in the previous step.
4. DNS changes can take a few minutes up to ~48 hours to propagate.
   Cloudflare will show the domain as "Active" once it's verified, and
   issues SSL automatically after that.
5. Once `joinflexrentals.com` is serving from Cloudflare Pages and you've
   spot-checked it, you can remove the `CNAME` file from this repo (it was
   for GitHub Pages) and decommission the GitHub Pages deployment, if any.

Only proceed with this section when you're ready — everything before it is
fully testable on the temporary `pages.dev` URL first.
