// 用户认证相关工具函数

/**
 * 根据Personal Token获取用户信息
 * @param {Object} db - 数据库连接
 * @param {string} personalToken - 用户的Personal Token
 * @returns {Object|null} 用户信息或null
 */
export async function getUserByPersonalToken(db, personalToken) {
  try {
    const user = await db.prepare(`
      SELECT * FROM users 
      WHERE personal_token = ? AND status = 'active'
    `).bind(personalToken).first();
    
    return user;
  } catch (error) {
    console.error('Error getting user by personal token:', error);
    return null;
  }
}

/**
 * 验证Personal Token是否有效
 * @param {Object} db - 数据库连接
 * @param {string} personalToken - 要验证的Token
 * @returns {boolean} 是否有效
 */
export async function validatePersonalToken(db, personalToken) {
  const user = await getUserByPersonalToken(db, personalToken);
  return user !== null;
}

/**
 * 验证管理员会话
 * @param {Request} request - HTTP请求对象
 * @param {Object} env - 环境变量
 * @returns {Object} 验证结果
 */
export async function verifyAdminAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { success: false, error: 'Missing authorization header' };
  }
  
  const sessionToken = authHeader.substring(7);
  
  try {
    const session = await env.DB.prepare(`
      SELECT s.*, a.username, a.role 
      FROM sessions s
      JOIN admins a ON s.user_id = a.id
      WHERE s.session_token = ? 
        AND s.user_type = 'admin' 
        AND s.expires_at > datetime('now')
        AND a.status = 'active'
    `).bind(sessionToken).first();
    
    if (!session) {
      return { success: false, error: 'Invalid or expired session' };
    }
    
    return { 
      success: true, 
      admin: {
        id: session.user_id,
        username: session.username,
        role: session.role
      }
    };
    
  } catch (error) {
    console.error('Error verifying admin auth:', error);
    return { success: false, error: 'Authentication failed' };
  }
}

/**
 * 验证用户会话
 * @param {Request} request - HTTP请求对象
 * @param {Object} env - 环境变量
 * @returns {Object} 验证结果
 */
export async function verifyUserAuth(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { success: false, error: 'Missing authorization header' };
  }
  
  const token = authHeader.substring(7);
  
  // 首先尝试作为Personal Token验证
  const user = await getUserByPersonalToken(env.DB, token);
  if (user) {
    return { 
      success: true, 
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        token_quota: user.token_quota,
        status: user.status
      }
    };
  }
  
  // 然后尝试作为会话Token验证
  try {
    const session = await env.DB.prepare(`
      SELECT s.*, u.username, u.email, u.token_quota, u.status
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.session_token = ? 
        AND s.user_type = 'user' 
        AND s.expires_at > datetime('now')
        AND u.status = 'active'
    `).bind(token).first();
    
    if (!session) {
      return { success: false, error: 'Invalid or expired token' };
    }
    
    return { 
      success: true, 
      user: {
        id: session.user_id,
        username: session.username,
        email: session.email,
        token_quota: session.token_quota,
        status: session.status
      }
    };
    
  } catch (error) {
    console.error('Error verifying user auth:', error);
    return { success: false, error: 'Authentication failed' };
  }
}

/**
 * 生成随机Personal Token
 * @returns {string} 新的Personal Token
 */
export function generatePersonalToken() {
  // 生成64位随机十六进制字符串
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 检查用户权限
 * @param {Object} user - 用户对象
 * @param {string} action - 要执行的操作
 * @returns {boolean} 是否有权限
 */
export function checkUserPermission(user, action) {
  if (user.status !== 'active') {
    return false;
  }
  
  switch (action) {
    case 'get_tokens':
    case 'use_tokens':
    case 'view_usage':
      return true;
    case 'modify_profile':
      return user.status === 'active';
    default:
      return false;
  }
}

/**
 * 检查管理员权限
 * @param {Object} admin - 管理员对象
 * @param {string} action - 要执行的操作
 * @returns {boolean} 是否有权限
 */
export function checkAdminPermission(admin, action) {
  const { role } = admin;
  
  switch (action) {
    case 'view_users':
    case 'view_tokens':
    case 'view_stats':
      return ['super_admin', 'admin', 'viewer'].includes(role);
    
    case 'create_user':
    case 'update_user':
    case 'create_token':
    case 'update_token':
    case 'create_allocation':
    case 'delete_allocation':
      return ['super_admin', 'admin'].includes(role);
    
    case 'delete_user':
    case 'delete_token':
    case 'manage_admins':
    case 'system_config':
      return role === 'super_admin';
    
    default:
      return false;
  }
}
