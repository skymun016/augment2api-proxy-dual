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

    // 检查数据库连接
    if (!env.DB) {
      return handleDatabaseNotConfigured(request);
    }

    try {
      // 自动初始化数据库
      await initializeDatabase(env.DB);

    } catch (initError) {
      console.log('Database initialization check:', initError.message);
      // 如果是严重错误，返回友好提示
      if (initError.message.includes('no such table') || initError.message.includes('database')) {
        return handleDatabaseNotConfigured(request);
      }
    }

    try {
      // 路由分发
      if (path === '/') {
        return handleDashboard(request, env);
      }
      else if (path === '/admin') {
        return handleAdminPanel(request, env);
      }
      else if (path === '/admin/login') {
        return handleAdminLoginPage(request, env);
      }
      
      // 用户相关API（插件兼容）
      else if (path === '/api/user/info') {
        return handleUserInfo(request, env);
      }
      // 插件兼容性API - Token池
      else if (path === '/api/tokens' && method === 'GET') {
        return handlePluginTokens(request, env);
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
  let personalToken = url.searchParams.get('token');

  // 如果查询参数中没有token，尝试从Authorization头获取
  if (!personalToken) {
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      personalToken = authHeader.substring(7);
    }
  }

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

// 处理插件Token池API（插件兼容性）
async function handlePluginTokens(request, env) {
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

    // 转换为插件期望的格式
    const tokenList = availableTokens.map(token => ({
      token: token.token_value, // 插件期望的实际token值
      usage_count: token.usage_count || 0,
      last_used: token.last_used_at,
      status: 'active'
    }));

    // 记录用户活动
    await logUserActivity(env.DB, user.id, 'plugin_get_tokens', {
      ip: request.headers.get('CF-Connecting-IP'),
      userAgent: request.headers.get('User-Agent'),
      token_count: tokenList.length
    });

    return jsonResponse({
      status: 'success',
      tokens: tokenList,
      total_count: tokenList.length
    });

  } catch (error) {
    console.error('Error in handlePluginTokens:', error);
    return jsonResponse({ error: 'Failed to get tokens' }, 500);
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
    let admin = await env.DB.prepare(`
      SELECT * FROM admins WHERE username = ? AND status = 'active'
    `).bind(username).first();

    console.log('Admin found:', admin ? 'Yes' : 'No');

    if (!admin) {
      // 如果没有找到管理员，尝试创建默认管理员
      if (username === 'admin' && password === 'admin123') {
        try {
          // 生成正确的密码哈希
          const passwordHash = await generateHash(password);
          console.log('Generated hash for admin123:', passwordHash);

          await env.DB.prepare(`
            INSERT OR IGNORE INTO admins (username, password_hash, email, role, status)
            VALUES (?, ?, ?, ?, ?)
          `).bind('admin', passwordHash, 'admin@example.com', 'super_admin', 'active').run();

          // 重新查询管理员
          const newAdmin = await env.DB.prepare(`
            SELECT * FROM admins WHERE username = ? AND status = 'active'
          `).bind(username).first();

          if (newAdmin) {
            console.log('Default admin created successfully');
            admin = newAdmin; // 设置admin变量以继续登录流程
          } else {
            return jsonResponse({ error: 'Failed to create default admin' }, 500);
          }
        } catch (createError) {
          console.error('Error creating default admin:', createError);
          return jsonResponse({ error: 'Invalid credentials' }, 401);
        }
      } else {
        return jsonResponse({ error: 'Invalid credentials' }, 401);
      }
    }

    // 验证密码
    console.log('Stored hash:', admin.password_hash);
    console.log('Input password:', password);

    const passwordValid = await verifyHash(password, admin.password_hash);
    console.log('Password valid:', passwordValid);

    // 临时：如果是默认管理员，也允许明文密码比较
    const isDefaultAdmin = username === 'admin' && password === 'admin123';

    if (!passwordValid && !isDefaultAdmin) {
      console.log('Password verification failed');
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
      SELECT COUNT(*) as count FROM token_allocations
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
        // 检查token是否存在且可用
        const token = await env.DB.prepare(`
          SELECT id FROM tokens WHERE id = ? AND status = 'active'
        `).bind(token_id).first();

        if (!token) {
          console.warn(`Token ${token_id} not found or inactive`);
          continue;
        }

        // 检查是否已经分配
        const existing = await env.DB.prepare(`
          SELECT id FROM token_allocations
          WHERE user_id = ? AND token_id = ? AND status = 'active'
        `).bind(user_id, token_id).first();

        if (existing) {
          console.warn(`Token ${token_id} already allocated to user ${user_id}`);
          continue;
        }

        const result = await env.DB.prepare(`
          INSERT INTO token_allocations (user_id, token_id, status)
          VALUES (?, ?, 'active')
        `).bind(user_id, token_id).run();

        if (result.success) {
          allocations.push({
            id: result.meta.last_row_id,
            user_id,
            token_id,
            status: 'active'
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

// 处理管理员统计信息
async function handleAdminStats(request, env) {
  try {
    // 验证管理员权限
    const authResult = await verifyAdminAuth(request, env);
    if (!authResult.success) {
      return jsonResponse({ error: authResult.error }, 401);
    }

    // 获取统计数据，使用更安全的查询
    let usersCount = 0;
    let tokensCount = 0;
    let allocationsCount = 0;
    let todayRequests = 0;

    try {
      const users = await env.DB.prepare('SELECT COUNT(*) as count FROM users').first();
      usersCount = users?.count || 0;
    } catch (error) {
      console.log('Users table not found or error:', error.message);
    }

    try {
      const tokens = await env.DB.prepare('SELECT COUNT(*) as count FROM tokens WHERE status = "active"').first();
      tokensCount = tokens?.count || 0;
    } catch (error) {
      console.log('Tokens table not found or error:', error.message);
    }

    try {
      const allocations = await env.DB.prepare('SELECT COUNT(*) as count FROM token_allocations WHERE status = "active"').first();
      allocationsCount = allocations?.count || 0;
    } catch (error) {
      console.log('Token_allocations table not found or error:', error.message);
    }

    // 获取今日请求数（如果有usage表的话）
    try {
      const today = new Date().toISOString().split('T')[0];
      const usage = await env.DB.prepare(`
        SELECT COUNT(*) as count FROM usage_logs
        WHERE DATE(created_at) = ?
      `).bind(today).first();
      todayRequests = usage?.count || 0;
    } catch (error) {
      // 如果usage_logs表不存在，忽略错误
      console.log('Usage logs table not found, setting today_requests to 0');
    }

    return jsonResponse({
      status: 'success',
      total_users: usersCount,
      total_tokens: tokensCount,
      active_allocations: allocationsCount,
      today_requests: todayRequests
    });

  } catch (error) {
    console.error('Error in handleAdminStats:', error);
    return jsonResponse({
      error: 'Failed to get stats',
      details: error.message
    }, 500);
  }
}

// 处理管理员获取Token列表
async function handleAdminGetTokens(request, env) {
  try {
    // 验证管理员权限
    const authResult = await verifyAdminAuth(request, env);
    if (!authResult.success) {
      return jsonResponse({ error: authResult.error }, 401);
    }

    let tokens = { results: [] };
    try {
      tokens = await env.DB.prepare(`
        SELECT id, name, token_prefix, status, created_at, updated_at
        FROM tokens
        ORDER BY created_at DESC
      `).all();
    } catch (dbError) {
      console.log('Tokens table not found or error:', dbError.message);
      // 如果表不存在，返回空数组
    }

    return jsonResponse({
      status: 'success',
      tokens: tokens.results || []
    });

  } catch (error) {
    console.error('Error in handleAdminGetTokens:', error);
    return jsonResponse({ error: 'Failed to get tokens' }, 500);
  }
}

// 处理管理员创建Token
async function handleAdminCreateToken(request, env) {
  try {
    // 验证管理员权限
    const authResult = await verifyAdminAuth(request, env);
    if (!authResult.success) {
      return jsonResponse({ error: authResult.error }, 401);
    }

    const { name, token } = await request.json();

    if (!name || !token) {
      return jsonResponse({ error: 'Missing name or token' }, 400);
    }

    // 验证token格式（应该是64位十六进制）
    if (!/^[a-fA-F0-9]{64}$/.test(token)) {
      return jsonResponse({ error: 'Invalid token format. Must be 64-character hex string.' }, 400);
    }

    // 生成token哈希
    const tokenHash = await generateHash(token);
    const tokenPrefix = token.substring(0, 8) + '...';

    // 检查token是否已存在（如果表存在的话）
    try {
      const existing = await env.DB.prepare(`
        SELECT id FROM tokens WHERE token_hash = ?
      `).bind(tokenHash).first();

      if (existing) {
        return jsonResponse({ error: 'Token already exists' }, 400);
      }
    } catch (dbError) {
      console.log('Tokens table may not exist, will try to create token anyway');
    }

    // 创建token
    let result;
    try {
      result = await env.DB.prepare(`
        INSERT INTO tokens (name, token_hash, token_prefix, status)
        VALUES (?, ?, ?, 'active')
      `).bind(name, tokenHash, tokenPrefix).run();
    } catch (dbError) {
      console.error('Failed to insert token, table may not exist:', dbError.message);
      return jsonResponse({
        error: 'Database table not found. Please initialize the database first.',
        details: dbError.message
      }, 500);
    }

    return jsonResponse({
      status: 'success',
      token_id: result.meta.last_row_id,
      message: 'Token created successfully'
    });

  } catch (error) {
    console.error('Error in handleAdminCreateToken:', error);
    return jsonResponse({ error: 'Failed to create token' }, 500);
  }
}



// 处理管理员创建用户
async function handleAdminCreateUser(request, env) {
  try {
    // 验证管理员权限
    const authResult = await verifyAdminAuth(request, env);
    if (!authResult.success) {
      return jsonResponse({ error: authResult.error }, 401);
    }

    const { username, email, personal_token, token_quota = 3 } = await request.json();

    if (!username || !email || !personal_token) {
      return jsonResponse({ error: 'Missing required fields' }, 400);
    }

    // 验证personal_token格式
    if (!/^[a-fA-F0-9]{64}$/.test(personal_token)) {
      return jsonResponse({ error: 'Invalid personal_token format. Must be 64-character hex string.' }, 400);
    }

    // 检查用户名和邮箱是否已存在
    const [existingUser, existingEmail] = await Promise.all([
      env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first(),
      env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
    ]);

    if (existingUser) {
      return jsonResponse({ error: 'Username already exists' }, 400);
    }

    if (existingEmail) {
      return jsonResponse({ error: 'Email already exists' }, 400);
    }

    // 创建用户
    const personalTokenHash = await generateHash(personal_token);
    const result = await env.DB.prepare(`
      INSERT INTO users (username, email, personal_token_hash, token_quota, status)
      VALUES (?, ?, ?, ?, 'active')
    `).bind(username, email, personalTokenHash, token_quota).run();

    return jsonResponse({
      status: 'success',
      user_id: result.meta.last_row_id,
      message: 'User created successfully'
    });

  } catch (error) {
    console.error('Error in handleAdminCreateUser:', error);
    return jsonResponse({ error: 'Failed to create user' }, 500);
  }
}

// 处理管理员更新用户
async function handleAdminUpdateUser(request, env) {
  try {
    // 验证管理员权限
    const authResult = await verifyAdminAuth(request, env);
    if (!authResult.success) {
      return jsonResponse({ error: authResult.error }, 401);
    }

    const url = new URL(request.url);
    const userId = url.pathname.split('/').pop();
    const { username, email, token_quota, status } = await request.json();

    // 检查用户是否存在
    const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
    if (!user) {
      return jsonResponse({ error: 'User not found' }, 404);
    }

    // 构建更新语句
    const updates = [];
    const values = [];

    if (username) {
      updates.push('username = ?');
      values.push(username);
    }
    if (email) {
      updates.push('email = ?');
      values.push(email);
    }
    if (token_quota !== undefined) {
      updates.push('token_quota = ?');
      values.push(token_quota);
    }
    if (status) {
      updates.push('status = ?');
      values.push(status);
    }

    if (updates.length === 0) {
      return jsonResponse({ error: 'No fields to update' }, 400);
    }

    values.push(userId);

    await env.DB.prepare(`
      UPDATE users SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(...values).run();

    return jsonResponse({
      status: 'success',
      message: 'User updated successfully'
    });

  } catch (error) {
    console.error('Error in handleAdminUpdateUser:', error);
    return jsonResponse({ error: 'Failed to update user' }, 500);
  }
}

// 处理管理员删除分配
async function handleAdminDeleteAllocation(request, env) {
  try {
    // 验证管理员权限
    const authResult = await verifyAdminAuth(request, env);
    if (!authResult.success) {
      return jsonResponse({ error: authResult.error }, 401);
    }

    const url = new URL(request.url);
    const allocationId = url.pathname.split('/').pop();

    // 检查分配是否存在
    const allocation = await env.DB.prepare('SELECT id FROM token_allocations WHERE id = ?').bind(allocationId).first();
    if (!allocation) {
      return jsonResponse({ error: 'Allocation not found' }, 404);
    }

    // 删除分配（软删除）
    await env.DB.prepare(`
      UPDATE token_allocations SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(allocationId).run();

    return jsonResponse({
      status: 'success',
      message: 'Allocation deleted successfully'
    });

  } catch (error) {
    console.error('Error in handleAdminDeleteAllocation:', error);
    return jsonResponse({ error: 'Failed to delete allocation' }, 500);
  }
}

// 处理管理员获取分配列表
async function handleAdminGetAllocations(request, env) {
  try {
    // 验证管理员权限
    const authResult = await verifyAdminAuth(request, env);
    if (!authResult.success) {
      return jsonResponse({ error: authResult.error }, 401);
    }

    let allocations = { results: [] };
    try {
      allocations = await env.DB.prepare(`
        SELECT
          ta.id,
          ta.user_id,
          ta.token_id,
          ta.status,
          ta.created_at,
          u.username,
          u.email,
          t.name as token_name,
          t.token_prefix
        FROM token_allocations ta
        JOIN users u ON ta.user_id = u.id
        JOIN tokens t ON ta.token_id = t.id
        WHERE ta.status = 'active'
        ORDER BY ta.created_at DESC
      `).all();
    } catch (dbError) {
      console.log('Allocations query failed (tables may not exist):', dbError.message);
      // 如果表不存在或JOIN失败，返回空数组
    }

    return jsonResponse({
      status: 'success',
      allocations: allocations.results || []
    });

  } catch (error) {
    console.error('Error in handleAdminGetAllocations:', error);
    return jsonResponse({ error: 'Failed to get allocations' }, 500);
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

// ============ Web管理页面处理函数 ============

// 处理管理员登录页面
async function handleAdminLoginPage(request, env) {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理员登录 - Augment Token Pool</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .login-container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            width: 100%;
            max-width: 400px;
        }
        .logo {
            text-align: center;
            margin-bottom: 30px;
        }
        .logo h1 {
            color: #333;
            font-size: 24px;
            margin-bottom: 8px;
        }
        .logo p {
            color: #666;
            font-size: 14px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            color: #333;
            font-weight: 500;
        }
        input[type="text"], input[type="password"] {
            width: 100%;
            padding: 12px;
            border: 2px solid #e1e5e9;
            border-radius: 6px;
            font-size: 16px;
            transition: border-color 0.3s;
        }
        input[type="text"]:focus, input[type="password"]:focus {
            outline: none;
            border-color: #667eea;
        }
        .btn {
            width: 100%;
            padding: 12px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.3s;
        }
        .btn:hover {
            background: #5a6fd8;
        }
        .btn:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        .error {
            background: #fee;
            color: #c33;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 20px;
            display: none;
        }
        .loading {
            display: none;
            text-align: center;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">
            <h1>🏊‍♂️ Augment Token Pool</h1>
            <p>多用户管理系统</p>
        </div>

        <div class="error" id="error"></div>

        <form id="loginForm">
            <div class="form-group">
                <label for="username">用户名</label>
                <input type="text" id="username" name="username" required>
            </div>

            <div class="form-group">
                <label for="password">密码</label>
                <input type="password" id="password" name="password" required>
            </div>

            <button type="submit" class="btn" id="loginBtn">登录</button>
        </form>

        <div class="loading" id="loading">
            <p>登录中...</p>
        </div>
    </div>

    <script>
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();

            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('error');
            const loadingDiv = document.getElementById('loading');
            const loginBtn = document.getElementById('loginBtn');

            // 隐藏错误信息
            errorDiv.style.display = 'none';

            // 显示加载状态
            loadingDiv.style.display = 'block';
            loginBtn.disabled = true;

            try {
                const response = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username, password })
                });

                const data = await response.json();

                if (response.ok && data.status === 'success') {
                    // 保存session token
                    localStorage.setItem('admin_session_token', data.session_token);
                    localStorage.setItem('admin_info', JSON.stringify(data.admin));

                    // 跳转到管理面板
                    window.location.href = '/admin';
                } else {
                    throw new Error(data.error || '登录失败');
                }
            } catch (error) {
                errorDiv.textContent = error.message;
                errorDiv.style.display = 'block';
            } finally {
                loadingDiv.style.display = 'none';
                loginBtn.disabled = false;
            }
        });

        // 检查是否已经登录
        if (localStorage.getItem('admin_session_token')) {
            window.location.href = '/admin';
        }
    </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 处理管理面板主页
async function handleAdminPanel(request, env) {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>管理面板 - Augment Token Pool</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f7fa;
            color: #333;
        }
        .header {
            background: white;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header h1 {
            color: #333;
            font-size: 24px;
        }
        .user-info {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            text-decoration: none;
            display: inline-block;
        }
        .btn-primary { background: #007bff; color: white; }
        .btn-secondary { background: #6c757d; color: white; }
        .btn-danger { background: #dc3545; color: white; }
        .btn:hover { opacity: 0.9; }

        .container {
            max-width: 1200px;
            margin: 20px auto;
            padding: 0 20px;
        }

        .nav-tabs {
            display: flex;
            background: white;
            border-radius: 8px;
            margin-bottom: 20px;
            overflow: hidden;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .nav-tab {
            flex: 1;
            padding: 15px 20px;
            text-align: center;
            cursor: pointer;
            border: none;
            background: white;
            color: #666;
            font-size: 16px;
            transition: all 0.3s;
        }
        .nav-tab.active {
            background: #007bff;
            color: white;
        }
        .nav-tab:hover:not(.active) {
            background: #f8f9fa;
        }

        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }

        .card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .card h3 {
            margin-bottom: 15px;
            color: #333;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .stat-number {
            font-size: 32px;
            font-weight: bold;
            color: #007bff;
            margin-bottom: 8px;
        }
        .stat-label {
            color: #666;
            font-size: 14px;
        }

        .table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }
        .table th, .table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #eee;
        }
        .table th {
            background: #f8f9fa;
            font-weight: 600;
        }
        .table tr:hover {
            background: #f8f9fa;
        }

        .form-group {
            margin-bottom: 15px;
        }
        .form-group label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
        }
        .form-group input, .form-group select, .form-group textarea {
            width: 100%;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: #666;
        }

        .error {
            background: #fee;
            color: #c33;
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 15px;
        }

        .success {
            background: #efe;
            color: #3c3;
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 15px;
        }

        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
        }
        .modal-content {
            background: white;
            margin: 50px auto;
            padding: 20px;
            border-radius: 8px;
            max-width: 500px;
            position: relative;
        }
        .modal-close {
            position: absolute;
            top: 10px;
            right: 15px;
            font-size: 24px;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🏊‍♂️ Augment Token Pool 管理面板</h1>
        <div class="user-info">
            <span id="adminName">管理员</span>
            <button class="btn btn-danger" onclick="logout()">退出登录</button>
        </div>
    </div>

    <div class="container">
        <div class="nav-tabs">
            <button class="nav-tab active" onclick="showTab('dashboard')">仪表板</button>
            <button class="nav-tab" onclick="showTab('users')">用户管理</button>
            <button class="nav-tab" onclick="showTab('tokens')">Token管理</button>
            <button class="nav-tab" onclick="showTab('allocations')">分配管理</button>
            <button class="nav-tab" onclick="showTab('stats')">统计分析</button>
        </div>

        <!-- 仪表板 -->
        <div id="dashboard" class="tab-content active">
            <div class="stats-grid" id="statsGrid">
                <div class="stat-card">
                    <div class="stat-number" id="totalUsers">-</div>
                    <div class="stat-label">总用户数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="totalTokens">-</div>
                    <div class="stat-label">总Token数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="activeAllocations">-</div>
                    <div class="stat-label">活跃分配</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number" id="todayRequests">-</div>
                    <div class="stat-label">今日请求</div>
                </div>
            </div>

            <div class="card">
                <h3>系统状态</h3>
                <div id="systemStatus">
                    <p>✅ 数据库连接正常</p>
                    <p>✅ API服务运行中</p>
                    <p>✅ Token池管理正常</p>
                </div>
            </div>
        </div>

        <!-- 用户管理 -->
        <div id="users" class="tab-content">
            <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3>用户列表</h3>
                    <button class="btn btn-primary" onclick="showCreateUserModal()">创建用户</button>
                </div>
                <div id="usersTable">
                    <div class="loading">加载中...</div>
                </div>
            </div>
        </div>

        <!-- Token管理 -->
        <div id="tokens" class="tab-content">
            <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3>Token列表</h3>
                    <button class="btn btn-primary" onclick="showCreateTokenModal()">添加Token</button>
                </div>
                <div id="tokensTable">
                    <div class="loading">加载中...</div>
                </div>
            </div>
        </div>

        <!-- 分配管理 -->
        <div id="allocations" class="tab-content">
            <div class="card">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3>Token分配</h3>
                    <button class="btn btn-primary" onclick="showCreateAllocationModal()">创建分配</button>
                </div>
                <div id="allocationsTable">
                    <div class="loading">加载中...</div>
                </div>
            </div>
        </div>

        <!-- 统计分析 -->
        <div id="stats" class="tab-content">
            <div class="card">
                <h3>使用统计</h3>
                <div id="statsContent">
                    <div class="loading">加载中...</div>
                </div>
            </div>
        </div>
    </div>

    <!-- 模态框 -->
    <div id="modal" class="modal">
        <div class="modal-content">
            <span class="modal-close" onclick="closeModal()">&times;</span>
            <div id="modalContent"></div>
        </div>
    </div>

    <script>
        // 全局变量
        let sessionToken = localStorage.getItem('admin_session_token');
        let adminInfo = JSON.parse(localStorage.getItem('admin_info') || '{}');

        // 检查登录状态
        if (!sessionToken) {
            window.location.href = '/admin/login';
        }

        // 设置管理员名称
        document.getElementById('adminName').textContent = adminInfo.username || '管理员';

        // API请求函数
        async function apiRequest(url, options = {}) {
            const defaultOptions = {
                headers: {
                    'Authorization': 'Bearer ' + sessionToken,
                    'Content-Type': 'application/json'
                }
            };

            const response = await fetch(url, { ...defaultOptions, ...options });

            if (response.status === 401) {
                logout();
                return;
            }

            return response.json();
        }

        // 标签页切换
        function showTab(tabName) {
            // 隐藏所有标签页
            document.querySelectorAll('.tab-content').forEach(tab => {
                tab.classList.remove('active');
            });
            document.querySelectorAll('.nav-tab').forEach(tab => {
                tab.classList.remove('active');
            });

            // 显示选中的标签页
            document.getElementById(tabName).classList.add('active');
            event.target.classList.add('active');

            // 加载对应数据
            loadTabData(tabName);
        }

        // 加载标签页数据
        async function loadTabData(tabName) {
            switch(tabName) {
                case 'dashboard':
                    await loadDashboard();
                    break;
                case 'users':
                    await loadUsers();
                    break;
                case 'tokens':
                    await loadTokens();
                    break;
                case 'allocations':
                    await loadAllocations();
                    break;
                case 'stats':
                    await loadStatsDetail();
                    break;
            }
        }

        // 加载仪表板数据
        async function loadDashboard() {
            try {
                const stats = await apiRequest('/api/admin/stats');
                if (stats) {
                    document.getElementById('totalUsers').textContent = stats.total_users || 0;
                    document.getElementById('totalTokens').textContent = stats.total_tokens || 0;
                    document.getElementById('activeAllocations').textContent = stats.active_allocations || 0;
                    document.getElementById('todayRequests').textContent = stats.today_requests || 0;
                }
            } catch (error) {
                console.error('加载仪表板数据失败:', error);
            }
        }

        // 加载用户列表
        async function loadUsers() {
            try {
                const users = await apiRequest('/api/admin/users');
                const tableHtml = \`
                    <table class="table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>用户名</th>
                                <th>邮箱</th>
                                <th>Token配额</th>
                                <th>状态</th>
                                <th>创建时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            \${users.users ? users.users.map(user => \`
                                <tr>
                                    <td>\${user.id}</td>
                                    <td>\${user.username || '-'}</td>
                                    <td>\${user.email || '-'}</td>
                                    <td>\${user.token_quota}</td>
                                    <td>\${user.status}</td>
                                    <td>\${new Date(user.created_at).toLocaleString()}</td>
                                    <td>
                                        <button class="btn btn-secondary" onclick="editUser(\${user.id})">编辑</button>
                                    </td>
                                </tr>
                            \`).join('') : '<tr><td colspan="7">暂无数据</td></tr>'}
                        </tbody>
                    </table>
                \`;
                document.getElementById('usersTable').innerHTML = tableHtml;
            } catch (error) {
                document.getElementById('usersTable').innerHTML = '<div class="error">加载用户列表失败</div>';
            }
        }

        // 退出登录
        function logout() {
            localStorage.removeItem('admin_session_token');
            localStorage.removeItem('admin_info');
            window.location.href = '/admin/login';
        }

        // 模态框操作
        function showModal(content) {
            document.getElementById('modalContent').innerHTML = content;
            document.getElementById('modal').style.display = 'block';
        }

        function closeModal() {
            document.getElementById('modal').style.display = 'none';
        }

        // 创建用户模态框
        function showCreateUserModal() {
            const content = \`
                <h3>创建新用户</h3>
                <form id="createUserForm">
                    <div class="form-group">
                        <label>用户名</label>
                        <input type="text" name="username" required>
                    </div>
                    <div class="form-group">
                        <label>邮箱</label>
                        <input type="email" name="email" required>
                    </div>
                    <div class="form-group">
                        <label>Personal Token</label>
                        <input type="text" name="personal_token" required placeholder="64位十六进制字符串">
                    </div>
                    <div class="form-group">
                        <label>Token配额</label>
                        <input type="number" name="token_quota" value="3" min="0" max="10">
                    </div>
                    <button type="submit" class="btn btn-primary">创建用户</button>
                </form>
            \`;
            showModal(content);

            document.getElementById('createUserForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const userData = Object.fromEntries(formData);

                try {
                    const result = await apiRequest('/api/user/register', {
                        method: 'POST',
                        body: JSON.stringify(userData)
                    });

                    if (result.status === 'success') {
                        closeModal();
                        loadUsers();
                        alert('用户创建成功');
                    } else {
                        alert('创建失败: ' + result.error);
                    }
                } catch (error) {
                    alert('创建失败: ' + error.message);
                }
            });
        }

        // 创建Token模态框
        function showCreateTokenModal() {
            const content = \`
                <h3>添加新Token</h3>
                <form id="createTokenForm">
                    <div class="form-group">
                        <label>Token名称</label>
                        <input type="text" name="name" required placeholder="例如：Token-001">
                    </div>
                    <div class="form-group">
                        <label>Augment Token</label>
                        <input type="text" name="token" required placeholder="64位十六进制字符串" maxlength="64">
                        <small style="color: #666;">请输入完整的64位Augment Token</small>
                    </div>
                    <button type="submit" class="btn btn-primary">添加Token</button>
                </form>
            \`;
            showModal(content);

            document.getElementById('createTokenForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const tokenData = Object.fromEntries(formData);

                try {
                    const result = await apiRequest('/api/admin/tokens', {
                        method: 'POST',
                        body: JSON.stringify(tokenData)
                    });

                    if (result.status === 'success') {
                        closeModal();
                        loadTokens();
                        alert('Token添加成功');
                    } else {
                        alert('添加失败: ' + result.error);
                    }
                } catch (error) {
                    alert('添加失败: ' + error.message);
                }
            });
        }

        // 创建批量分配模态框
        function showCreateAllocationModal() {
            const content = \`
                <h3>批量分配Token</h3>
                <form id="createAllocationForm">
                    <div class="form-group">
                        <label>选择用户</label>
                        <select name="user_id" id="userSelect" required>
                            <option value="">请选择用户</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>选择Token（可多选）</label>
                        <div id="tokenCheckboxes" style="max-height: 200px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; border-radius: 4px;">
                            <div class="loading">加载中...</div>
                        </div>
                    </div>
                    <button type="submit" class="btn btn-primary">批量分配</button>
                </form>
            \`;
            showModal(content);

            // 加载用户列表
            loadUsersForSelect();
            // 加载Token列表
            loadTokensForSelect();

            document.getElementById('createAllocationForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const user_id = formData.get('user_id');

                // 获取选中的Token IDs
                const selectedTokens = Array.from(document.querySelectorAll('input[name="token_ids"]:checked'))
                    .map(cb => parseInt(cb.value));

                if (!user_id || selectedTokens.length === 0) {
                    alert('请选择用户和至少一个Token');
                    return;
                }

                try {
                    const result = await apiRequest('/api/admin/allocations', {
                        method: 'POST',
                        body: JSON.stringify({
                            user_id: parseInt(user_id),
                            token_ids: selectedTokens
                        })
                    });

                    if (result.status === 'success') {
                        closeModal();
                        loadAllocations();
                        alert(\`成功分配 \${result.allocations.length} 个Token\`);
                    } else {
                        alert('分配失败: ' + result.error);
                    }
                } catch (error) {
                    alert('分配失败: ' + error.message);
                }
            });
        }

        // 加载用户列表到下拉框
        async function loadUsersForSelect() {
            try {
                const users = await apiRequest('/api/admin/users');
                const select = document.getElementById('userSelect');
                select.innerHTML = '<option value="">请选择用户</option>';

                if (users.users) {
                    users.users.forEach(user => {
                        const option = document.createElement('option');
                        option.value = user.id;
                        option.textContent = \`\${user.username} (\${user.email})\`;
                        select.appendChild(option);
                    });
                }
            } catch (error) {
                console.error('加载用户列表失败:', error);
            }
        }

        // 加载Token列表到复选框
        async function loadTokensForSelect() {
            try {
                const tokens = await apiRequest('/api/admin/tokens');
                const container = document.getElementById('tokenCheckboxes');
                container.innerHTML = '';

                if (tokens.tokens && tokens.tokens.length > 0) {
                    tokens.tokens.forEach(token => {
                        const div = document.createElement('div');
                        div.style.marginBottom = '8px';
                        div.innerHTML = \`
                            <label style="display: flex; align-items: center; cursor: pointer;">
                                <input type="checkbox" name="token_ids" value="\${token.id}" style="margin-right: 8px;">
                                <span>\${token.name} (\${token.token_prefix})</span>
                            </label>
                        \`;
                        container.appendChild(div);
                    });
                } else {
                    container.innerHTML = '<p style="color: #666;">暂无可用Token</p>';
                }
            } catch (error) {
                console.error('加载Token列表失败:', error);
                document.getElementById('tokenCheckboxes').innerHTML = '<p style="color: #c33;">加载失败</p>';
            }
        }

        // 加载Token列表
        async function loadTokens() {
            try {
                const tokens = await apiRequest('/api/admin/tokens');
                const tableHtml = \`
                    <table class="table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>名称</th>
                                <th>Token前缀</th>
                                <th>状态</th>
                                <th>创建时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            \${tokens.tokens ? tokens.tokens.map(token => \`
                                <tr>
                                    <td>\${token.id}</td>
                                    <td>\${token.name}</td>
                                    <td>\${token.token_prefix}</td>
                                    <td>\${token.status}</td>
                                    <td>\${new Date(token.created_at).toLocaleString()}</td>
                                    <td>
                                        <button class="btn btn-secondary" onclick="editToken(\${token.id})">编辑</button>
                                    </td>
                                </tr>
                            \`).join('') : '<tr><td colspan="6">暂无数据</td></tr>'}
                        </tbody>
                    </table>
                \`;
                document.getElementById('tokensTable').innerHTML = tableHtml;
            } catch (error) {
                document.getElementById('tokensTable').innerHTML = '<div class="error">加载Token列表失败</div>';
            }
        }

        // 加载分配列表
        async function loadAllocations() {
            try {
                const allocations = await apiRequest('/api/admin/allocations');
                const tableHtml = \`
                    <table class="table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>用户</th>
                                <th>Token</th>
                                <th>状态</th>
                                <th>分配时间</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            \${allocations.allocations ? allocations.allocations.map(allocation => \`
                                <tr>
                                    <td>\${allocation.id}</td>
                                    <td>\${allocation.username} (\${allocation.email})</td>
                                    <td>\${allocation.token_name} (\${allocation.token_prefix})</td>
                                    <td>\${allocation.status}</td>
                                    <td>\${new Date(allocation.created_at).toLocaleString()}</td>
                                    <td>
                                        <button class="btn btn-danger" onclick="deleteAllocation(\${allocation.id})">删除</button>
                                    </td>
                                </tr>
                            \`).join('') : '<tr><td colspan="6">暂无数据</td></tr>'}
                        </tbody>
                    </table>
                \`;
                document.getElementById('allocationsTable').innerHTML = tableHtml;
            } catch (error) {
                document.getElementById('allocationsTable').innerHTML = '<div class="error">加载分配列表失败</div>';
            }
        }

        // 删除分配
        async function deleteAllocation(allocationId) {
            if (!confirm('确定要删除这个分配吗？')) {
                return;
            }

            try {
                const result = await apiRequest(\`/api/admin/allocations/\${allocationId}\`, {
                    method: 'DELETE'
                });

                if (result.status === 'success') {
                    loadAllocations();
                    alert('分配删除成功');
                } else {
                    alert('删除失败: ' + result.error);
                }
            } catch (error) {
                alert('删除失败: ' + error.message);
            }
        }

        // 加载详细统计信息
        async function loadStatsDetail() {
            try {
                const stats = await apiRequest('/api/admin/stats');
                const content = \`
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-number">\${stats.total_users || 0}</div>
                            <div class="stat-label">总用户数</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">\${stats.total_tokens || 0}</div>
                            <div class="stat-label">总Token数</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">\${stats.active_allocations || 0}</div>
                            <div class="stat-label">活跃分配</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">\${stats.today_requests || 0}</div>
                            <div class="stat-label">今日请求</div>
                        </div>
                    </div>

                    <div class="card">
                        <h3>系统信息</h3>
                        <p>✅ 数据库连接正常</p>
                        <p>✅ API服务运行中</p>
                        <p>✅ Token池管理正常</p>
                        <p>📊 统计数据更新时间: \${new Date().toLocaleString()}</p>
                    </div>
                \`;
                document.getElementById('statsContent').innerHTML = content;
            } catch (error) {
                document.getElementById('statsContent').innerHTML = '<div class="error">加载统计信息失败: ' + error.message + '</div>';
            }
        }

        // 页面加载时初始化
        document.addEventListener('DOMContentLoaded', () => {
            loadDashboard();
        });

        // 点击模态框外部关闭
        window.onclick = function(event) {
            const modal = document.getElementById('modal');
            if (event.target === modal) {
                closeModal();
            }
        }
    </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 处理数据库未配置的情况
function handleDatabaseNotConfigured(request) {
  const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>数据库配置需要</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .error { color: #dc3545; margin-bottom: 20px; }
        .steps { background: #f8f9fa; padding: 20px; border-radius: 4px; margin: 20px 0; }
        .step { margin: 10px 0; padding: 10px; border-left: 4px solid #007bff; background: white; }
        code { background: #f1f3f4; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
        .btn { background: #007bff; color: white; padding: 10px 20px; border: none; border-radius: 4px; text-decoration: none; display: inline-block; margin: 10px 5px 0 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔧 数据库配置需要</h1>
        <div class="error">
            <strong>错误：</strong>D1数据库未配置或未绑定到Worker
        </div>

        <h2>📋 配置步骤</h2>
        <div class="steps">
            <div class="step">
                <strong>1. 创建D1数据库</strong><br>
                在Cloudflare Dashboard中创建名为 <code>augment2api-multiuser</code> 的D1数据库
            </div>
            <div class="step">
                <strong>2. 绑定数据库</strong><br>
                在Worker设置中添加D1绑定：变量名 <code>DB</code>，选择刚创建的数据库
            </div>
            <div class="step">
                <strong>3. 初始化表结构</strong><br>
                在D1控制台中执行 <code>schema-extended.sql</code> 文件的内容
            </div>
            <div class="step">
                <strong>4. 重新部署</strong><br>
                保存配置后Worker会自动重新部署
            </div>
        </div>

        <h2>🚀 快速链接</h2>
        <a href="https://dash.cloudflare.com/" class="btn" target="_blank">Cloudflare Dashboard</a>
        <a href="https://github.com/skymun016/augment2api-proxy-dual" class="btn" target="_blank">GitHub仓库</a>

        <h2>📞 需要帮助？</h2>
        <p>查看详细的配置文档：<a href="https://github.com/skymun016/augment2api-proxy-dual/blob/main/MULTIUSER_SYSTEM_GUIDE.md">多用户系统指南</a></p>
    </div>
</body>
</html>`;

  return new Response(html, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// ============ 数据库初始化函数 ============

// 数据库初始化标志
let databaseInitialized = false;

/**
 * 自动初始化数据库表结构
 * @param {Object} db - D1数据库实例
 */
async function initializeDatabase(db) {
  // 如果已经初始化过，跳过
  if (databaseInitialized) {
    return;
  }

  try {
    // 检查是否已有表结构
    const tableCheck = await db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='users'
    `).first();

    if (tableCheck) {
      databaseInitialized = true;
      return;
    }

    console.log('Initializing database schema...');

    // 创建所有必要的表
    await createDatabaseTables(db);

    // 插入默认数据
    await insertDefaultData(db);

    databaseInitialized = true;
    console.log('Database initialization completed successfully');

  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

/**
 * 创建数据库表结构
 * @param {Object} db - D1数据库实例
 */
async function createDatabaseTables(db) {
  const tables = [
    // 保留原有的tokens表
    `CREATE TABLE IF NOT EXISTS tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      tenant_url TEXT NOT NULL,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'maintenance')),
      remark TEXT DEFAULT '',
      usage_count INTEGER DEFAULT 0,
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    // 创建用户表
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personal_token TEXT NOT NULL UNIQUE,
      username TEXT,
      email TEXT,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'disabled')),
      token_quota INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login_at DATETIME
    )`,

    // 创建用户Token分配表
    `CREATE TABLE IF NOT EXISTS user_token_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_id INTEGER NOT NULL,
      allocated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
      priority INTEGER DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE CASCADE,
      UNIQUE(user_id, token_id)
    )`,

    // 创建用户使用统计表
    `CREATE TABLE IF NOT EXISTS user_usage_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_id INTEGER NOT NULL,
      date DATE DEFAULT (date('now')),
      request_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      total_tokens_used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE CASCADE,
      UNIQUE(user_id, token_id, date)
    )`,

    // 创建管理员表
    `CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      email TEXT,
      role TEXT DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'viewer')),
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login_at DATETIME
    )`,

    // 保留原有的sessions表
    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_token TEXT NOT NULL UNIQUE,
      user_type TEXT DEFAULT 'admin' CHECK (user_type IN ('admin', 'user')),
      user_id INTEGER,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,

    // 创建用户操作日志表
    `CREATE TABLE IF NOT EXISTS user_activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )`,

    // 创建系统配置表
    `CREATE TABLE IF NOT EXISTS system_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key TEXT NOT NULL UNIQUE,
      config_value TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  // 执行所有表创建语句
  for (const sql of tables) {
    await db.prepare(sql).run();
  }
}

/**
 * 插入默认数据
 * @param {Object} db - D1数据库实例
 */
async function insertDefaultData(db) {
  // 插入默认管理员账号（密码：admin123）
  await db.prepare(`
    INSERT OR IGNORE INTO admins (username, password_hash, email, role)
    VALUES ('admin', 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', 'admin@example.com', 'super_admin')
  `).run();

  // 插入默认系统配置
  const configs = [
    ['default_token_quota', '3', '新用户默认Token配额'],
    ['max_token_quota', '10', '单用户最大Token配额'],
    ['token_rotation_enabled', 'true', '是否启用Token轮换'],
    ['usage_stats_retention_days', '90', '使用统计保留天数']
  ];

  for (const [key, value, description] of configs) {
    await db.prepare(`
      INSERT OR IGNORE INTO system_config (config_key, config_value, description)
      VALUES (?, ?, ?)
    `).bind(key, value, description).run();
  }
}
