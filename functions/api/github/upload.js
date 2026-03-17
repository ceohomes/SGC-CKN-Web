// Cloudflare Pages Function: POST /api/github/upload
// Upload file ảnh/PDF lên GitHub repo

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  const token    = env.GITHUB_TOKEN    || env.github_token    || '';
  const username = env.GITHUB_USERNAME || env.github_username || '';
  const repo     = env.GITHUB_REPO     || env.github_repo     || 'construction-reports';

  if (!token || !username) {
    return new Response(JSON.stringify({ error: 'Chưa cấu hình GITHUB_TOKEN / GITHUB_USERNAME trên Cloudflare' }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const { fileName, base64Data } = body;
    if (!fileName || !base64Data) {
      return new Response(JSON.stringify({ error: 'Thiếu fileName hoặc base64Data' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    const timestamp = Date.now();
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const path = `SGC-CKN/${timestamp}_${safeFileName}`;
    const content = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;

    const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/${path}`;
    const ghRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'SGC-CKN/1.0',
      },
      body: JSON.stringify({
        message: `Upload ${safeFileName} via SGC-CKN`,
        content,
      }),
    });

    if (ghRes.ok) {
      const rawUrl = `https://raw.githubusercontent.com/${username}/${repo}/main/${path}`;
      return new Response(JSON.stringify({ fileUrl: rawUrl }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    const err = await ghRes.json().catch(() => ({}));
    return new Response(JSON.stringify({ error: err.message || 'GitHub upload failed', status: ghRes.status }), {
      status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}
