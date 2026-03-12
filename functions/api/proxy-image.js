// Cloudflare Pages Function: /api/proxy-image?url=<encoded_url>
// Dùng để fetch ảnh từ GitHub tránh CORS khi xuất Excel
// Hỗ trợ repo public (không cần token) và repo private (cần GITHUB_TOKEN trong env)

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
    return new Response('Thiếu tham số url', { status: 400, headers: CORS_HEADERS });
  }

  // Chỉ cho phép fetch từ GitHub
  if (!targetUrl.includes('github.com') && !targetUrl.includes('raw.githubusercontent.com')) {
    return new Response('Chỉ hỗ trợ URL từ GitHub', { status: 403, headers: CORS_HEADERS });
  }

  try {
    let fetchUrl = targetUrl;

    // Chuyển github.com/blob → raw.githubusercontent.com
    if (fetchUrl.includes('github.com') && fetchUrl.includes('/blob/')) {
      fetchUrl = fetchUrl
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');
    }

    const headers = {
      'Accept': 'image/*, */*',
      'User-Agent': 'SGC-CKN-App/1.0',
    };

    // Dùng GITHUB_TOKEN nếu có (set trong Cloudflare Pages > Settings > Variables)
    const token = env.GITHUB_TOKEN;
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    const resp = await fetch(fetchUrl, { headers });

    if (!resp.ok) {
      // Nếu raw URL thất bại, thử GitHub Contents API
      const match = fetchUrl.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)/);
      if (match && token) {
        const [, owner, repo, branch, filePath] = match;
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
        const apiResp = await fetch(apiUrl, {
          headers: {
            'Accept': 'application/vnd.github.v3.raw',
            'Authorization': `token ${token}`,
            'User-Agent': 'SGC-CKN-App/1.0',
          }
        });
        if (apiResp.ok) {
          const buffer = await apiResp.arrayBuffer();
          const lowerUrl = fetchUrl.toLowerCase();
          let contentType = 'image/jpeg';
          if (lowerUrl.endsWith('.png')) contentType = 'image/png';
          else if (lowerUrl.endsWith('.webp')) contentType = 'image/webp';
          return new Response(buffer, {
            status: 200,
            headers: { 'Content-Type': contentType, ...CORS_HEADERS, 'Cache-Control': 'public, max-age=3600' },
          });
        }
      }
      return new Response(`Lỗi fetch ảnh: ${resp.status}`, { status: resp.status, headers: CORS_HEADERS });
    }

    const buffer = await resp.arrayBuffer();
    const lowerUrl = fetchUrl.toLowerCase();
    let contentType = resp.headers.get('content-type') || 'image/jpeg';
    if (lowerUrl.endsWith('.png')) contentType = 'image/png';
    else if (lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg')) contentType = 'image/jpeg';
    else if (lowerUrl.endsWith('.webp')) contentType = 'image/webp';

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        ...CORS_HEADERS,
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': 'inline',
      },
    });
  } catch (err) {
    return new Response(`Lỗi server: ${err.message}`, { status: 500, headers: CORS_HEADERS });
  }
}
