// Netlify Functions (v2, standard Web Request/Response) entry point.
// All business logic lives in serverless/lib/ghl.js so the same code also
// runs as a Vercel Edge Function and a Cloudflare Pages Function.
import { handleApplicationSubmission, corsPreflightResponse } from '../../serverless/lib/ghl.js';

export default async (request) => {
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

  return handleApplicationSubmission(formData, process.env);
};

// Exposes this function at /api/submit-application instead of the default
// /.netlify/functions/submit-application, so the frontend fetch() URL is
// identical across every hosting platform.
export const config = {
  path: '/api/submit-application'
};
