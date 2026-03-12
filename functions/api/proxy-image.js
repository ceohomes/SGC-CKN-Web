// Cloudflare Pages Function: /api/proxy-image?url=<encoded_url>
// Tự động đọc GITHUB_TOKEN từ Cloudflare Pages Environment Variables
// Hỗ trợ cả repo public (không cần token) và repo private (cần GITHUB_TOKEN)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequest(context) {
  const { request, env } = context;

  // Xử lý CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Thiếu tham số url' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  // Chỉ cho phép fetch từ GitHub
  if (!targetUrl.includes('github.com') && !targetUrl.includes('raw.githubusercontent.com')) {
    return new Response(JSON.stringify({ error: 'Chỉ hỗ trợ URL từ GitHub' }), {
      status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }

  // Đọc GITHUB_TOKEN từ Cloudflare Pages env
  const token = env.GITHUB_TOKEN || env.github_token || '';

  try {
    // Chuẩn hoá URL về dạng raw
    let rawUrl = targetUrl;
    if (rawUrl.includes('github.com') && rawUrl.includes('/blob/')) {
      rawUrl = rawUrl
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
    }

    // --- Cách 1: Fetch thẳng raw URL (nhanh nhất, hoạt động với public repo) ---
    const rawHeaders = { 'User-Agent': 'SGC-CKN/1.0' };
    if (token) rawHeaders['Authorization'] = `token ${token}`;

    const rawResp = await fetch(rawUrl, { headers: rawHeaders });
    if (rawResp.ok) {
      const buffer = await rawResp.arrayBuffer();
      if (buffer.byteLength > 0) {
        return new Response(buffer, {
          status: 200,
          headers: {
            'Content-Type': getContentType(rawUrl),
            ...CORS_HEADERS,
            'Cache-Control': 'public, max-age=3600',
          },
        });
      }
    }

    // --- Cách 2: GitHub Contents API với Accept: application/vnd.github.v3.raw ---
    // Hỗ trợ file > 1MB và private repo
    const match = rawUrl.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)/);
    if (match) {
      const [, owner, repo, branch, filePath] = match;
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;

      const apiHeaders = {
        'Accept': 'application/vnd.github.v3.raw',
        'User-Agent': 'SGC-CKN/1.0',
      };
      if (token) apiHeaders['Authorization'] = `token ${token}`;

      const apiResp = await fetch(apiUrl, { headers: apiHeaders });
      if (apiResp.ok) {
        const buffer = await apiResp.arrayBuffer();
        if (buffer.byteLength > 0) {
          return new Response(buffer, {
            status: 200,
            headers: {
              'Content-Type': getContentType(rawUrl),
              ...CORS_HEADERS,
              'Cache-Control': 'public, max-age=3600',
            },
          });
        }
      }
    }

    return new Response(JSON.stringify({ error: 'Không thể tải ảnh từ GitHub', rawStatus: rawResp.status }), {
      status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    });
  }
}

function getContentType(url) {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}
