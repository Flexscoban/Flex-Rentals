// Cloudflare Pages Function entry point. A file at functions/api/<name>.js
// is automatically routed to /api/<name> by Cloudflare Pages. All business
// logic lives in serverless/lib/ghl.js — this file only adapts it to
// Cloudflare's onRequest* handler convention and env binding.
import { handleApplicationSubmission, corsPreflightResponse } from '../../serverless/lib/ghl.js';

export async function onRequestPost(context) {
  let formData;
  try {
    formData = await context.request.formData();
  } catch (err) {
    console.error('[GHL] failed to parse multipart form data:', err);
    return new Response(JSON.stringify({ ok: false, error: 'Invalid submission format.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return handleApplicationSubmission(formData, context.env);
}

export async function onRequestOptions() {
  return corsPreflightResponse();
}
