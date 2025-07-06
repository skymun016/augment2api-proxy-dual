// Augment2API - 简化的认证重定向服务
// 将统一配置重定向到真实的 Augment 服务

// 硬编码的真实 Augment 服务信息
const REAL_AUGMENT_CONFIG = {
  tenant_url: 'https://d13.api.augmentcode.com/',
  token: '669739f66b29200c7c6746d9fb7f165c4000067c413123f3df4a19970d76b44b'
};

// 获取配置（从环境变量）
function getConfig(env) {
  return {
    UNIFIED_TOKEN: env.UNIFIED_TOKEN || 'your-unified-token-here'
  };
}

// 主处理函数
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 记录请求用于调试
    console.log(`${method} ${path}`);
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        const clonedRequest = request.clone();
        const body = await clonedRequest.text();
        console.log(`Body:`, body);
      } catch (e) {
        console.log(`Body: [Unable to read]`);
      }
    }

    // 处理 CORS 预检请求
    if (method === 'OPTIONS') {
      return handleCORS();
    }

    try {
      // 简化的路由分发
      if (path === '/') {
        return handleInfoPage();
      } else if (path === '/api/auth' || path === '/auth') {
        return handleAuth(request, env);
      } else if (path === '/api/redirect' || path === '/redirect') {
        return handleRedirect(request, env);
      } else {
        return jsonResponse({ 
          error: 'Endpoint not found',
          available_endpoints: ['/api/auth', '/auth', '/api/redirect', '/redirect'],
          usage: 'POST /api/auth with {"tenant_url": "https://augment.amexiaowu.workers.dev", "token": "your-unified-token-here"}'
        }, 404);
      }
    } catch (error) {
      console.error('Error:', error);
      return jsonResponse({ 
        error: 'Internal Server Error', 
        message: error.message 
      }, 500);
    }
  }
};

// CORS 处理
function handleCORS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-request-id, x-request-session-id, x-api-version',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// 信息页面
function handleInfoPage() {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Augment2API 认证重定向服务</title>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .endpoint { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .method { color: #007cba; font-weight: bold; }
        code { background: #e8e8e8; padding: 2px 5px; border-radius: 3px; }
    </style>
</head>
<body>
    <h1>🚀 Augment2API 认证重定向服务</h1>
    
    <p>这是一个简化的认证重定向服务，将统一配置重定向到真实的 Augment 服务。</p>
    
    <h2>📋 使用方法</h2>
    
    <div class="endpoint">
        <h3><span class="method">POST</span> /api/auth</h3>
        <p><strong>功能</strong>：认证并获取真实连接信息</p>
        <p><strong>请求体</strong>：</p>
        <pre><code>{
  "tenant_url": "https://augment.amexiaowu.workers.dev",
  "token": "your-unified-token-here"
}</code></pre>
        <p><strong>响应</strong>：</p>
        <pre><code>{
  "success": true,
  "redirect": true,
  "tenant_url": "https://d13.api.augmentcode.com/",
  "token": "669739f66b29200c7c6746d9fb7f165c4000067c413123f3df4a19970d76b44b"
}</code></pre>
    </div>

    <div class="endpoint">
        <h3><span class="method">GET</span> /api/redirect</h3>
        <p><strong>功能</strong>：使用 Bearer token 获取重定向信息</p>
        <p><strong>请求头</strong>：<code>Authorization: Bearer your-unified-token-here</code></p>
    </div>

    <h2>🎯 VSCode/IntelliJ 插件配置</h2>
    <p>在插件中配置：</p>
    <ul>
        <li><strong>tenant_url</strong>: <code>https://augment.amexiaowu.workers.dev</code></li>
        <li><strong>token</strong>: <code>your-unified-token-here</code></li>
    </ul>
    
    <p>插件将自动获取真实的连接信息并重定向到真实的 Augment 服务。</p>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 核心认证重定向处理
async function handleAuth(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({
      message: 'Authentication endpoint',
      usage: 'POST with {"tenant_url": "https://augment.amexiaowu.workers.dev", "token": "your-unified-token-here"}',
      real_config: REAL_AUGMENT_CONFIG
    });
  }

  try {
    const { tenant_url, token } = await request.json();
    const config = getConfig(env);

    console.log('Auth request:', { tenant_url, token: token?.substring(0, 10) + '...' });

    // 验证统一配置
    if (tenant_url === 'https://augment.amexiaowu.workers.dev' && token === config.UNIFIED_TOKEN) {
      console.log('Auth successful, returning real config');

      // 返回硬编码的真实连接信息
      return jsonResponse({
        success: true,
        redirect: true,
        tenant_url: REAL_AUGMENT_CONFIG.tenant_url,
        token: REAL_AUGMENT_CONFIG.token,
        user: {
          id: 'augment-user',
          email: 'user@augmentcode.com',
          name: 'Augment User'
        }
      });
    } else {
      console.log('Auth failed: invalid credentials');
      return jsonResponse({
        success: false,
        error: 'Invalid tenant_url or token',
        expected: {
          tenant_url: 'https://augment.amexiaowu.workers.dev',
          token: config.UNIFIED_TOKEN
        }
      }, 401);
    }
  } catch (error) {
    console.error('Auth error:', error);
    return jsonResponse({
      success: false,
      error: 'Invalid request format'
    }, 400);
  }
}

// 简化的重定向处理（兼容不同的客户端）
async function handleRedirect(request, env) {
  const authHeader = request.headers.get('Authorization');
  const config = getConfig(env);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ 
      error: 'Authorization header required',
      usage: 'Authorization: Bearer your-unified-token-here'
    }, 401);
  }

  const token = authHeader.slice(7);
  console.log('Redirect request with token:', token?.substring(0, 10) + '...');

  if (token !== config.UNIFIED_TOKEN) {
    return jsonResponse({ 
      error: 'Invalid token',
      expected: config.UNIFIED_TOKEN
    }, 401);
  }

  console.log('Redirect successful, returning real config');

  return jsonResponse({
    redirect_to: {
      tenant_url: REAL_AUGMENT_CONFIG.tenant_url,
      token: REAL_AUGMENT_CONFIG.token
    },
    user: {
      id: 'augment-user',
      email: 'user@augmentcode.com',
      name: 'Augment User'
    }
  });
}

// JSON 响应辅助函数
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-request-id, x-request-session-id, x-api-version'
    }
  });
}
