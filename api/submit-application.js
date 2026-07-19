// Vercel Edge Function entry point (Edge Runtime gives us a standard Web
// Request, matching the Cloudflare/Netlify entry points). All business
// logic lives in serverless/lib/ghl.js — this file only adapts it to
// Vercel's routing convention (files under /api map to /api/<name>).
import { handleApplicationSubmission, corsPreflightResponse } from '../serverless/lib/ghl.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
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
}
