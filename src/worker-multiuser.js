// Augment2API - 多用户Token池管理系统
// 支持用户注册、Token分配、使用统计等完整功能

import { generateHash, verifyHash } from './utils/crypto.js';
import { validatePersonalToken, getUserByPersonalToken, verifyAdminAuth } from './utils/auth.js';
import { getAvailableTokensForUser, selectOptimalToken, updateTokenUsage } from './utils/tokenPool.js';
import { logUserActivity, getUserUsageStats } from './utils/analytics.js';
import { jsonResponse, handleCORS, createApiResponse } from './utils/common.js';

// 系统配置
const SYSTEM_CONFIG = {
  DEFAULT_TOKEN_QUOTA: 3,
  MAX_TOKEN_QUOTA: 10,
  SESSION_EXPIRE_HOURS: 24,
  RATE_LIMIT_PER_HOUR: 1000
};

// 主处理函数
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 记录请求日志
    console.log(`[${new Date().toISOString()}] ${method} ${path}`);

    // CORS 处理
    if (method === 'OPTIONS') {
      return handleCORS();
    }

    try {
      // 路由分发
      if (path === '/') {
        return handleDashboard(request, env);
      }
      
      // 用户相关API（插件兼容）
      else if (path === '/api/user/info') {
        return handleUserInfo(request, env);
      }
      else if (path === '/api/tokens' && method === 'GET') {
        return handleGetUserTokens(request, env);
      }
      
      // 用户管理API
      else if (path === '/api/user/register' && method === 'POST') {
        return handleUserRegister(request, env);
      }
      else if (path === '/api/user/login' && method === 'POST') {
        return handleUserLogin(request, env);
      }
      else if (path === '/api/user/profile' && method === 'GET') {
        return handleUserProfile(request, env);
      }
      else if (path === '/api/user/usage' && method === 'GET') {
        return handleUserUsage(request, env);
      }
      
      // 管理员API
      else if (path === '/api/admin/login' && method === 'POST') {
        return handleAdminLogin(request, env);
      }
      else if (path === '/api/admin/users' && method === 'GET') {
        return handleAdminGetUsers(request, env);
      }
      else if (path === '/api/admin/users' && method === 'POST') {
        return handleAdminCreateUser(request, env);
      }
      else if (path.startsWith('/api/admin/users/') && method === 'PUT') {
        return handleAdminUpdateUser(request, env);
      }
      else if (path === '/api/admin/tokens' && method === 'GET') {
        return handleAdminGetTokens(request, env);
      }
      else if (path === '/api/admin/tokens' && method === 'POST') {
        return handleAdminCreateToken(request, env);
      }
      else if (path === '/api/admin/allocations' && method === 'GET') {
        return handleAdminGetAllocations(request, env);
      }
      else if (path === '/api/admin/allocations' && method === 'POST') {
        return handleAdminCreateAllocation(request, env);
      }
      else if (path.startsWith('/api/admin/allocations/') && method === 'DELETE') {
        return handleAdminDeleteAllocation(request, env);
      }
      else if (path === '/api/admin/stats' && method === 'GET') {
        return handleAdminStats(request, env);
      }
      
      // OpenAI兼容API
      else if (path === '/v1/models') {
        return handleModels(request, env);
      }
      else if (path === '/v1/chat/completions') {
        return handleChatCompletion(request, env);
      }
      
      // 健康检查
      else if (path === '/health') {
        return handleHealthCheck(request, env);
      }
      
      else {
        return jsonResponse({ error: 'Not Found' }, 404);
      }
      
    } catch (error) {
      console.error('Request processing error:', error);
      return jsonResponse({
        error: 'Internal Server Error',
        message: error.message
      }, 500);
    }
  }
};

// ============ 用户相关处理函数 ============

// 处理用户信息查询（插件兼容）
async function handleUserInfo(request, env) {
  const url = new URL(request.url);
  const personalToken = url.searchParams.get('token');
  
  if (!personalToken) {
    return jsonResponse({ error: 'Missing personal token' }, 400);
  }
  
  try {
    const user = await getUserByPersonalToken(env.DB, personalToken);
    if (!user) {
      return jsonResponse({ error: 'Invalid personal token' }, 401);
    }
    
    // 记录用户活动
    await logUserActivity(env.DB, user.id, 'api_user_info', {
      ip: request.headers.get('CF-Connecting-IP'),
      userAgent: request.headers.get('User-Agent')
    });
    
    return jsonResponse({
      status: 'success',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        token_quota: user.token_quota,
        status: user.status,
        created_at: user.created_at
      }
    });
    
  } catch (error) {
    console.error('Error in handleUserInfo:', error);
    return jsonResponse({ error: 'Failed to get user info' }, 500);
  }
}

// 处理获取用户Token池（插件兼容）
async function handleGetUserTokens(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid authorization header' }, 401);
  }
  
  const personalToken = authHeader.substring(7);
  
  try {
    const user = await getUserByPersonalToken(env.DB, personalToken);
    if (!user) {
      return jsonResponse({ error: 'Invalid personal token' }, 401);
    }
    
    // 获取用户可用的Token列表
    const availableTokens = await getAvailableTokensForUser(env.DB, user.id);
    
    // 记录用户活动
    await logUserActivity(env.DB, user.id, 'api_get_tokens', {
      tokenCount: availableTokens.length,
      ip: request.headers.get('CF-Connecting-IP')
    });
    
    // 格式化Token信息（隐藏完整Token，只显示部分）
    const tokenList = availableTokens.map(token => ({
      id: token.id,
      token: token.token.substring(0, 8) + '...' + token.token.slice(-8),
      tenant_url: token.tenant_url,
      usage_count: token.usage_count,
      priority: token.priority,
      status: token.status,
      last_used_at: token.last_used_at
    }));
    
    return jsonResponse({
      status: 'success',
      tokens: tokenList,
      total_count: tokenList.length,
      user_quota: user.token_quota
    });
    
  } catch (error) {
    console.error('Error in handleGetUserTokens:', error);
    return jsonResponse({ error: 'Failed to get user tokens' }, 500);
  }
}

// 处理用户注册
async function handleUserRegister(request, env) {
  try {
    const { username, email, personal_token } = await request.json();
    
    if (!username || !email || !personal_token) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }
    
    // 检查Personal Token是否已存在
    const existingUser = await getUserByPersonalToken(env.DB, personal_token);
    if (existingUser) {
      return jsonResponse({ error: 'Personal token already exists' }, 409);
    }
    
    // 创建新用户
    const result = await env.DB.prepare(`
      INSERT INTO users (personal_token, username, email, token_quota)
      VALUES (?, ?, ?, ?)
    `).bind(personal_token, username, email, SYSTEM_CONFIG.DEFAULT_TOKEN_QUOTA).run();
    
    if (!result.success) {
      throw new Error('Failed to create user');
    }
    
    return jsonResponse({
      status: 'success',
      message: 'User registered successfully',
      user_id: result.meta.last_row_id
    });
    
  } catch (error) {
    console.error('Error in handleUserRegister:', error);
    return jsonResponse({ error: 'Registration failed' }, 500);
  }
}

// ============ 管理员相关处理函数 ============

// 处理管理员登录
async function handleAdminLogin(request, env) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return jsonResponse({ error: 'Missing username or password' }, 400);
    }

    // 查询管理员
    const admin = await env.DB.prepare(`
      SELECT * FROM admins WHERE username = ? AND status = 'active'
    `).bind(username).first();

    if (!admin || !await verifyHash(password, admin.password_hash)) {
      return jsonResponse({ error: 'Invalid credentials' }, 401);
    }

    // 生成会话Token
    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SYSTEM_CONFIG.SESSION_EXPIRE_HOURS * 60 * 60 * 1000);

    await env.DB.prepare(`
      INSERT INTO sessions (session_token, user_type, user_id, expires_at)
      VALUES (?, 'admin', ?, ?)
    `).bind(sessionToken, admin.id, expiresAt.toISOString()).run();

    // 更新最后登录时间
    await env.DB.prepare(`
      UPDATE admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(admin.id).run();

    return jsonResponse({
      status: 'success',
      session_token: sessionToken,
      expires_at: expiresAt.toISOString(),
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role
      }
    });

  } catch (error) {
    console.error('Error in handleAdminLogin:', error);
    return jsonResponse({ error: 'Login failed' }, 500);
  }
}

// 处理管理员获取用户列表
async function handleAdminGetUsers(request, env) {
  const authResult = await verifyAdminAuth(request, env);
  if (!authResult.success) {
    return jsonResponse({ error: authResult.error }, 401);
  }

  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    // 获取用户列表
    const users = await env.DB.prepare(`
      SELECT u.*,
             COUNT(uta.token_id) as allocated_tokens,
             COALESCE(SUM(uus.request_count), 0) as total_requests
      FROM users u
      LEFT JOIN user_token_allocations uta ON u.id = uta.user_id AND uta.status = 'active'
      LEFT JOIN user_usage_stats uus ON u.id = uus.user_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all();

    // 获取总数
    const totalResult = await env.DB.prepare(`
      SELECT COUNT(*) as total FROM users
    `).first();

    return jsonResponse({
      status: 'success',
      users: users.results,
      pagination: {
        page,
        limit,
        total: totalResult.total,
        pages: Math.ceil(totalResult.total / limit)
      }
    });

  } catch (error) {
    console.error('Error in handleAdminGetUsers:', error);
    return jsonResponse({ error: 'Failed to get users' }, 500);
  }
}

// 处理管理员创建Token分配
async function handleAdminCreateAllocation(request, env) {
  const authResult = await verifyAdminAuth(request, env);
  if (!authResult.success) {
    return jsonResponse({ error: authResult.error }, 401);
  }

  try {
    const { user_id, token_ids, priority = 1 } = await request.json();

    if (!user_id || !token_ids || !Array.isArray(token_ids)) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    // 检查用户是否存在
    const user = await env.DB.prepare(`
      SELECT * FROM users WHERE id = ?
    `).bind(user_id).first();

    if (!user) {
      return jsonResponse({ error: 'User not found' }, 404);
    }

    // 检查用户当前分配的Token数量
    const currentAllocations = await env.DB.prepare(`
      SELECT COUNT(*) as count FROM user_token_allocations
      WHERE user_id = ? AND status = 'active'
    `).bind(user_id).first();

    if (currentAllocations.count + token_ids.length > user.token_quota) {
      return jsonResponse({
        error: `Allocation would exceed user quota (${user.token_quota})`
      }, 400);
    }

    // 批量创建分配
    const allocations = [];
    for (const token_id of token_ids) {
      try {
        const result = await env.DB.prepare(`
          INSERT INTO user_token_allocations (user_id, token_id, priority)
          VALUES (?, ?, ?)
        `).bind(user_id, token_id, priority).run();

        if (result.success) {
          allocations.push({
            id: result.meta.last_row_id,
            user_id,
            token_id,
            priority
          });
        }
      } catch (e) {
        console.warn(`Failed to allocate token ${token_id} to user ${user_id}:`, e.message);
      }
    }

    return jsonResponse({
      status: 'success',
      message: `Successfully allocated ${allocations.length} tokens`,
      allocations
    });

  } catch (error) {
    console.error('Error in handleAdminCreateAllocation:', error);
    return jsonResponse({ error: 'Failed to create allocation' }, 500);
  }
}

// ============ OpenAI兼容API处理函数 ============

// 处理模型列表
async function handleModels(request, env) {
  return jsonResponse({
    object: "list",
    data: [
      {
        id: "augment-code",
        object: "model",
        created: 1677610602,
        owned_by: "augment",
        permission: [],
        root: "augment-code",
        parent: null
      }
    ]
  });
}

// 处理聊天完成请求
async function handleChatCompletion(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing authorization header' }, 401);
  }

  const personalToken = authHeader.substring(7);

  try {
    const user = await getUserByPersonalToken(env.DB, personalToken);
    if (!user) {
      return jsonResponse({ error: 'Invalid personal token' }, 401);
    }

    // 获取用户的最优Token
    const optimalToken = await selectOptimalToken(env.DB, user.id);
    if (!optimalToken) {
      return jsonResponse({ error: 'No available tokens' }, 503);
    }

    // 转发请求到Augment API
    const requestBody = await request.json();
    const augmentResponse = await forwardToAugment(optimalToken, requestBody, env);

    // 更新使用统计
    await updateTokenUsage(env.DB, user.id, optimalToken.id, {
      requestCount: 1,
      successCount: augmentResponse.ok ? 1 : 0,
      errorCount: augmentResponse.ok ? 0 : 1
    });

    // 记录用户活动
    await logUserActivity(env.DB, user.id, 'chat_completion', {
      tokenId: optimalToken.id,
      model: requestBody.model,
      success: augmentResponse.ok
    });

    return augmentResponse;

  } catch (error) {
    console.error('Error in handleChatCompletion:', error);
    return jsonResponse({ error: 'Chat completion failed' }, 500);
  }
}

// ============ 辅助函数 ============

// 转发请求到Augment API
async function forwardToAugment(token, requestBody, env) {
  try {
    const response = await fetch('https://api.augmentcode.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.token}`,
        'X-Tenant-URL': token.tenant_url
      },
      body: JSON.stringify(requestBody)
    });

    const responseData = await response.text();

    return new Response(responseData, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('Error forwarding to Augment:', error);
    return jsonResponse({ error: 'Failed to forward request' }, 502);
  }
}

// 处理健康检查
async function handleHealthCheck(request, env) {
  try {
    // 检查数据库连接
    const dbCheck = await env.DB.prepare('SELECT 1').first();

    // 获取基本统计
    const stats = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE status = 'active') as active_users,
        (SELECT COUNT(*) FROM tokens WHERE status = 'active') as active_tokens,
        (SELECT COUNT(*) FROM user_token_allocations WHERE status = 'active') as active_allocations
    `).first();

    return jsonResponse({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbCheck ? 'connected' : 'disconnected',
      stats: stats || {}
    });

  } catch (error) {
    console.error('Health check failed:', error);
    return jsonResponse({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    }, 503);
  }
}

// 处理仪表板页面
async function handleDashboard(request, env) {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Augment Token Pool - 多用户管理系统</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header h1 { color: #333; margin-bottom: 10px; }
        .header p { color: #666; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }
        .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .card h3 { color: #333; margin-bottom: 15px; }
        .stat { display: flex; justify-content: space-between; margin-bottom: 10px; }
        .stat-label { color: #666; }
        .stat-value { font-weight: bold; color: #007bff; }
        .btn { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; text-decoration: none; display: inline-block; }
        .btn:hover { background: #0056b3; }
        .btn-secondary { background: #6c757d; }
        .btn-secondary:hover { background: #545b62; }
        .api-endpoint { background: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace; margin: 5px 0; }
        .status-active { color: #28a745; }
        .status-inactive { color: #dc3545; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏊‍♂️ Augment Token Pool</h1>
            <p>多用户Token池管理系统 - 智能负载均衡 | 配额管理 | 使用统计</p>
        </div>

        <div class="grid">
            <div class="card">
                <h3>📊 系统状态</h3>
                <div class="stat">
                    <span class="stat-label">服务状态</span>
                    <span class="stat-value status-active">● 运行中</span>
                </div>
                <div class="stat">
                    <span class="stat-label">API版本</span>
                    <span class="stat-value">v1.0.0</span>
                </div>
                <div class="stat">
                    <span class="stat-label">部署时间</span>
                    <span class="stat-value">${new Date().toLocaleString('zh-CN')}</span>
                </div>
            </div>

            <div class="card">
                <h3>🔑 API端点</h3>
                <div class="api-endpoint">GET /api/user/info?token={personalToken}</div>
                <div class="api-endpoint">GET /api/tokens (Bearer Auth)</div>
                <div class="api-endpoint">POST /v1/chat/completions</div>
                <div class="api-endpoint">GET /health</div>
            </div>

            <div class="card">
                <h3>👥 用户管理</h3>
                <p style="margin-bottom: 15px;">管理用户账号、Token配额和权限设置</p>
                <a href="/admin/users" class="btn">用户管理</a>
                <a href="/admin/tokens" class="btn btn-secondary">Token管理</a>
            </div>

            <div class="card">
                <h3>📈 使用统计</h3>
                <p style="margin-bottom: 15px;">查看详细的使用统计和性能分析</p>
                <a href="/admin/stats" class="btn">查看统计</a>
                <a href="/admin/reports" class="btn btn-secondary">生成报告</a>
            </div>
        </div>

        <div class="card" style="margin-top: 20px;">
            <h3>🚀 快速开始</h3>
            <ol style="padding-left: 20px; line-height: 1.6;">
                <li>管理员登录并创建用户账号</li>
                <li>为用户分配Augment Token配额</li>
                <li>用户使用Personal Token访问API</li>
                <li>系统自动进行负载均衡和使用统计</li>
            </ol>
        </div>
    </div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
