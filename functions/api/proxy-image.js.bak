// Cloudflare Pages Function: /api/proxy-image?url=<encoded_url>
// Dùng để fetch ảnh từ GitHub tránh CORS khi xuất Excel

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response('Thiếu tham số url', { status: 400 });
  }

  // Chỉ cho phép fetch từ GitHub
  if (!targetUrl.includes('github.com') && !targetUrl.includes('raw.githubusercontent.com')) {
    return new Response('Chỉ hỗ trợ URL từ GitHub', { status: 403 });
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
      'Accept': 'application/vnd.github.v3.raw, image/*, */*',
    };

    // Dùng GITHUB_TOKEN nếu có (set trong Cloudflare Pages > Settings > Variables)
    const token = env.GITHUB_TOKEN;
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    const resp = await fetch(fetchUrl, { headers });
    if (!resp.ok) {
      return new Response(`Lỗi fetch ảnh: ${resp.status}`, { status: resp.status });
    }

    const buffer = await resp.arrayBuffer();
    const lowerUrl = targetUrl.toLowerCase();
    let contentType = resp.headers.get('content-type') || 'image/jpeg';
    if (lowerUrl.endsWith('.png')) contentType = 'image/png';
    else if (lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg')) contentType = 'image/jpeg';
    else if (lowerUrl.endsWith('.webp')) contentType = 'image/webp';

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': 'inline',
      },
    });
  } catch (err) {
    return new Response(`Lỗi server: ${err.message}`, { status: 500 });
  }
}
