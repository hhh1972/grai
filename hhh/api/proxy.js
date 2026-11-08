// 告诉 Vercel 使用 Edge Runtime，这样可以拥有极快的冷启动并兼容你的原代码
export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/proxy', ''); // 剔除 vercel 的目录前缀
  const search = url.search;
  
  const authHeader = request.headers.get('Authorization') || '';
  
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let targetUrl = '';
  let isGroq = false;

  if (authHeader.includes('gsk_')) {
    isGroq = true;
    let targetPath = path || '/';
    if (targetPath.startsWith('/v1/') && !targetPath.startsWith('/openai/')) {
      targetPath = '/openai' + targetPath;
    }
    targetUrl = 'https://api.groq.com' + targetPath + search;
  } else {
    targetUrl = 'https://generativelanguage.googleapis.com' + (path || '/') + search;
  }

  const newHeaders = new Headers(request.headers);
  newHeaders.delete('Host');
  newHeaders.delete('Origin');
  newHeaders.delete('Referer');
  
  // 在 Vercel Edge 中，这些追踪 IP 的 Header 被删除后，Groq 将只能看到 Vercel 服务器的美国 IP
  newHeaders.delete('x-forwarded-for');
  newHeaders.delete('x-real-ip');

  let requestBody = null;
  let isStream = false;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (isGroq && request.headers.get('content-type')?.includes('application/json')) {
      try {
        const bodyText = await request.text();
        const bodyJson = JSON.parse(bodyText);
        
        if (bodyJson.stream) isStream = true;
        delete bodyJson.stream_options;

        if (bodyJson.messages && Array.isArray(bodyJson.messages)) {
          bodyJson.messages = bodyJson.messages.map(msg => {
            if (msg.reasoning_content !== undefined) delete msg.reasoning_content;
            return msg;
          });
        }
        
        requestBody = JSON.stringify(bodyJson);
        newHeaders.set('Content-Type', 'application/json');
        newHeaders.delete('Content-Length');
      } catch (e) {
        requestBody = await request.text();
      }
    } else {
      requestBody = await request.arrayBuffer(); 
    }
  }

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body: requestBody
    });
    
    // 拦截并美化 Groq 报错
    if (!response.ok && isGroq) {
       const errorText = await response.text();
       const errorMessage = `⚠️ Groq 官方报错。\n\n状态码: ${response.status}\n详细原因: ${errorText}`;
       
       if (isStream) {
           const chunk = JSON.stringify({
              id: "error", object: "chat.completion.chunk", created: Date.now(), model: "error-diagnostics",
              choices: [{ delta: { content: errorMessage }, index: 0, finish_reason: "stop" }]
           });
           return new Response(`data: ${chunk}\n\n`, { status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' } });
       } else {
           return new Response(JSON.stringify({
              id: "error", object: "chat.completion", created: Date.now(), model: "error-diagnostics",
              choices: [{ message: { role: "assistant", content: errorMessage }, index: 0, finish_reason: "stop" }]
           }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
       }
    }

    const newResponse = new Response(response.body, response);
    for (const [key, value] of Object.entries(corsHeaders)) {
      newResponse.headers.set(key, value);
    }
    return newResponse;
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: `代理失败: ${e.message}` } }), { status: 502, headers: corsHeaders });
  }
}