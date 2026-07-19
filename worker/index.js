// Standalone Cloudflare Worker entry point — use this if the static site
// stays on GitHub Pages (or anywhere else) and only the application-submit
// API runs on Cloudflare Workers, on its own *.workers.dev (or custom)
// domain. If instead the whole site is deployed to Cloudflare Pages, use
// functions/api/submit-application.js in that directory and delete/ignore
// this file — no need for both.
//
// All business logic lives in serverless/lib/ghl.js, shared with the
// Netlify/Vercel/Cloudflare Pages entry points.
import { handleApplicationSubmission, corsPreflightResponse } from '../serverless/lib/ghl.js';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return corsPreflightResponse();

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let formData;
    try {
      formData = await request.formData();
    } catch (err) {
      console.error('[GHL] failed to parse multipart form data:', err);
      return new Response(JSON.stringify({ ok: false, error: 'Invalid submission format.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return handleApplicationSubmission(formData, env);
  }
};
