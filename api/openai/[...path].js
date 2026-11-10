export const config = {
  runtime: 'edge',
  regions: ['iad1'],
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, OpenAI-Organization, OpenAI-Project',
  'Access-Control-Max-Age': '86400',
};

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  const url = new URL(request.url);
  // 兼容 /openai/... 和 rewrite 后的 /api/openai/...
  const path = url.pathname.replace(/^\/(api\/)?openai/, '');
  const target = `https://api.openai.com${path}${url.search}`;

  const headers = new Headers();
  for (const name of ['authorization', 'content-type', 'openai-organization', 'openai-project']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const resp = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    });

    const outHeaders = new Headers(CORS);
    const contentType = resp.headers.get('content-type');
    if (contentType) outHeaders.set('content-type', contentType);
    if (contentType && contentType.includes('text/event-stream')) {
      outHeaders.set('cache-control', 'no-cache');
    }

    return new Response(resp.body, { status: resp.status, headers: outHeaders });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'proxy failed', details: e.message }),
      { status: 500, headers: { ...CORS, 'content-type': 'application/json' } }
    );
  }
}
