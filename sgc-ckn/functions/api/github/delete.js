// Cloudflare Pages Function: POST /api/github/delete
// Xóa file trên GitHub repo

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
    return new Response(JSON.stringify({ error: 'Chưa cấu hình GITHUB_TOKEN / GITHUB_USERNAME' }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const { fileUrl } = body;
    if (!fileUrl) {
      return new Response(JSON.stringify({ error: 'Thiếu fileUrl' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    // Trích path từ raw URL
    const cleanUrl = decodeURIComponent(fileUrl.split('?')[0]);
    const rawMatch = cleanUrl.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)/);
    if (!rawMatch) {
      return new Response(JSON.stringify({ ok: true, skipped: 'URL không phải raw GitHub' }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    const filePath = rawMatch[1];
    const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/${filePath}`;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'SGC-CKN/1.0',
    };

    // Lấy SHA
    const getRes = await fetch(`${apiUrl}?t=${Date.now()}`, { headers });
    if (!getRes.ok) {
      return new Response(JSON.stringify({ ok: true, skipped: 'File không tồn tại trên GitHub' }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
    const fileData = await getRes.json();

    const delRes = await fetch(apiUrl, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `[SGC-CKN] Xóa file: ${filePath.split('/').pop()}`,
        sha: fileData.sha,
      }),
    });

    if (delRes.ok) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    const err = await delRes.json().catch(() => ({}));
    return new Response(JSON.stringify({ error: err.message || 'Delete failed', status: delRes.status }), {
      status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}
