// Token池管理相关工具函数

/**
 * 获取用户可用的Token列表
 * @param {Object} db - 数据库连接
 * @param {number} userId - 用户ID
 * @returns {Array} Token列表
 */
export async function getAvailableTokensForUser(db, userId) {
  try {
    const tokens = await db.prepare(`
      SELECT t.*, uta.priority, uta.allocated_at
      FROM tokens t
      JOIN user_token_allocations uta ON t.id = uta.token_id
      WHERE uta.user_id = ? 
        AND uta.status = 'active'
        AND t.status = 'active'
      ORDER BY uta.priority ASC, t.usage_count ASC, uta.allocated_at ASC
    `).bind(userId).all();
    
    return tokens.results || [];
  } catch (error) {
    console.error('Error getting available tokens for user:', error);
    return [];
  }
}

/**
 * 为用户选择最优Token
 * @param {Object} db - 数据库连接
 * @param {number} userId - 用户ID
 * @returns {Object|null} 最优Token或null
 */
export async function selectOptimalToken(db, userId) {
  const availableTokens = await getAvailableTokensForUser(db, userId);
  
  if (availableTokens.length === 0) {
    return null;
  }
  
  // 选择策略：
  // 1. 优先级最高（数字最小）
  // 2. 使用次数最少
  // 3. 最早分配的
  return availableTokens[0];
}

/**
 * 更新Token使用统计
 * @param {Object} db - 数据库连接
 * @param {number} userId - 用户ID
 * @param {number} tokenId - Token ID
 * @param {Object} stats - 使用统计
 */
export async function updateTokenUsage(db, userId, tokenId, stats = {}) {
  const {
    requestCount = 1,
    successCount = 1,
    errorCount = 0,
    tokensUsed = 0
  } = stats;
  
  try {
    // 更新Token的总使用次数
    await db.prepare(`
      UPDATE tokens 
      SET usage_count = usage_count + ?, 
          last_used_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).bind(requestCount, tokenId).run();
    
    // 更新或插入用户使用统计
    await db.prepare(`
      INSERT INTO user_usage_stats (user_id, token_id, date, request_count, success_count, error_count, total_tokens_used)
      VALUES (?, ?, date('now'), ?, ?, ?, ?)
      ON CONFLICT(user_id, token_id, date) DO UPDATE SET
        request_count = request_count + excluded.request_count,
        success_count = success_count + excluded.success_count,
        error_count = error_count + excluded.error_count,
        total_tokens_used = total_tokens_used + excluded.total_tokens_used,
        updated_at = CURRENT_TIMESTAMP
    `).bind(userId, tokenId, requestCount, successCount, errorCount, tokensUsed).run();
    
  } catch (error) {
    console.error('Error updating token usage:', error);
  }
}

/**
 * 检查用户Token配额
 * @param {Object} db - 数据库连接
 * @param {number} userId - 用户ID
 * @returns {Object} 配额信息
 */
export async function checkUserTokenQuota(db, userId) {
  try {
    const result = await db.prepare(`
      SELECT 
        u.token_quota,
        COUNT(uta.token_id) as allocated_count
      FROM users u
      LEFT JOIN user_token_allocations uta ON u.id = uta.user_id AND uta.status = 'active'
      WHERE u.id = ?
      GROUP BY u.id
    `).bind(userId).first();
    
    if (!result) {
      return { quota: 0, allocated: 0, available: 0 };
    }
    
    return {
      quota: result.token_quota,
      allocated: result.allocated_count,
      available: result.token_quota - result.allocated_count
    };
    
  } catch (error) {
    console.error('Error checking user token quota:', error);
    return { quota: 0, allocated: 0, available: 0 };
  }
}

/**
 * 获取Token池统计信息
 * @param {Object} db - 数据库连接
 * @returns {Object} 统计信息
 */
export async function getTokenPoolStats(db) {
  try {
    const stats = await db.prepare(`
      SELECT 
        COUNT(*) as total_tokens,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_tokens,
        SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) as disabled_tokens,
        SUM(usage_count) as total_usage,
        AVG(usage_count) as avg_usage
      FROM tokens
    `).first();
    
    const userStats = await db.prepare(`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_users,
        SUM(token_quota) as total_quota,
        AVG(token_quota) as avg_quota
      FROM users
    `).first();
    
    const allocationStats = await db.prepare(`
      SELECT 
        COUNT(*) as total_allocations,
        COUNT(DISTINCT user_id) as users_with_allocations,
        COUNT(DISTINCT token_id) as allocated_tokens
      FROM user_token_allocations
      WHERE status = 'active'
    `).first();
    
    return {
      tokens: stats,
      users: userStats,
      allocations: allocationStats
    };
    
  } catch (error) {
    console.error('Error getting token pool stats:', error);
    return null;
  }
}

/**
 * 自动分配Token给用户
 * @param {Object} db - 数据库连接
 * @param {number} userId - 用户ID
 * @param {number} count - 要分配的数量
 * @returns {Array} 分配的Token列表
 */
export async function autoAllocateTokensToUser(db, userId, count = 1) {
  try {
    // 检查用户配额
    const quotaInfo = await checkUserTokenQuota(db, userId);
    if (quotaInfo.available < count) {
      throw new Error(`Insufficient quota. Available: ${quotaInfo.available}, Requested: ${count}`);
    }
    
    // 获取可分配的Token（未分配给该用户的活跃Token）
    const availableTokens = await db.prepare(`
      SELECT t.* FROM tokens t
      WHERE t.status = 'active'
        AND t.id NOT IN (
          SELECT uta.token_id FROM user_token_allocations uta 
          WHERE uta.user_id = ? AND uta.status = 'active'
        )
      ORDER BY t.usage_count ASC, t.created_at ASC
      LIMIT ?
    `).bind(userId, count).all();
    
    if (availableTokens.results.length < count) {
      throw new Error(`Not enough available tokens. Available: ${availableTokens.results.length}, Requested: ${count}`);
    }
    
    // 批量分配Token
    const allocatedTokens = [];
    for (const token of availableTokens.results) {
      const result = await db.prepare(`
        INSERT INTO user_token_allocations (user_id, token_id, priority)
        VALUES (?, ?, 1)
      `).bind(userId, token.id).run();
      
      if (result.success) {
        allocatedTokens.push({
          allocation_id: result.meta.last_row_id,
          token_id: token.id,
          token: token.token,
          tenant_url: token.tenant_url
        });
      }
    }
    
    return allocatedTokens;
    
  } catch (error) {
    console.error('Error auto-allocating tokens:', error);
    throw error;
  }
}

/**
 * 回收用户的Token分配
 * @param {Object} db - 数据库连接
 * @param {number} userId - 用户ID
 * @param {Array} tokenIds - 要回收的Token ID列表
 * @returns {number} 回收的数量
 */
export async function revokeUserTokens(db, userId, tokenIds) {
  try {
    let revokedCount = 0;
    
    for (const tokenId of tokenIds) {
      const result = await db.prepare(`
        UPDATE user_token_allocations 
        SET status = 'revoked'
        WHERE user_id = ? AND token_id = ? AND status = 'active'
      `).bind(userId, tokenId).run();
      
      if (result.changes > 0) {
        revokedCount++;
      }
    }
    
    return revokedCount;
    
  } catch (error) {
    console.error('Error revoking user tokens:', error);
    return 0;
  }
}

/**
 * 获取Token的详细使用情况
 * @param {Object} db - 数据库连接
 * @param {number} tokenId - Token ID
 * @param {number} days - 查询天数
 * @returns {Array} 使用情况列表
 */
export async function getTokenUsageDetails(db, tokenId, days = 30) {
  try {
    const usage = await db.prepare(`
      SELECT 
        uus.date,
        u.username,
        uus.request_count,
        uus.success_count,
        uus.error_count,
        uus.total_tokens_used
      FROM user_usage_stats uus
      JOIN users u ON uus.user_id = u.id
      WHERE uus.token_id = ? 
        AND uus.date >= date('now', '-${days} days')
      ORDER BY uus.date DESC, u.username
    `).bind(tokenId).all();
    
    return usage.results || [];
    
  } catch (error) {
    console.error('Error getting token usage details:', error);
    return [];
  }
}
