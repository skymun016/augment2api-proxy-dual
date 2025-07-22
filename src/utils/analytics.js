// 分析统计相关工具函数

/**
 * 记录用户活动日志
 * @param {Object} db - 数据库连接
 * @param {number} userId - 用户ID
 * @param {string} action - 操作类型
 * @param {Object} details - 详细信息
 */
export async function logUserActivity(db, userId, action, details = {}) {
  try {
    await db.prepare(`
      INSERT INTO user_activity_logs (user_id, action, details, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      userId,
      action,
      JSON.stringify(details),
      details.ip || null,
      details.userAgent || null
    ).run();
  } catch (error) {
    console.error('Error logging user activity:', error);
  }
}

/**
 * 获取用户使用统计
 * @param {Object} db - 数据库连接
 * @param {number} userId - 用户ID
 * @param {number} days - 统计天数
 * @returns {Object} 使用统计
 */
export async function getUserUsageStats(db, userId, days = 30) {
  try {
    // 获取总体统计
    const totalStats = await db.prepare(`
      SELECT 
        SUM(request_count) as total_requests,
        SUM(success_count) as total_success,
        SUM(error_count) as total_errors,
        SUM(total_tokens_used) as total_tokens,
        COUNT(DISTINCT token_id) as unique_tokens_used,
        COUNT(DISTINCT date) as active_days
      FROM user_usage_stats
      WHERE user_id = ? AND date >= date('now', '-${days} days')
    `).bind(userId).first();
    
    // 获取每日统计
    const dailyStats = await db.prepare(`
      SELECT 
        date,
        SUM(request_count) as requests,
        SUM(success_count) as success,
        SUM(error_count) as errors,
        SUM(total_tokens_used) as tokens_used
      FROM user_usage_stats
      WHERE user_id = ? AND date >= date('now', '-${days} days')
      GROUP BY date
      ORDER BY date DESC
    `).bind(userId).all();
    
    // 获取Token使用分布
    const tokenStats = await db.prepare(`
      SELECT 
        t.token,
        t.tenant_url,
        SUM(uus.request_count) as requests,
        SUM(uus.success_count) as success,
        SUM(uus.error_count) as errors,
        MAX(uus.date) as last_used
      FROM user_usage_stats uus
      JOIN tokens t ON uus.token_id = t.id
      WHERE uus.user_id = ? AND uus.date >= date('now', '-${days} days')
      GROUP BY t.id
      ORDER BY requests DESC
    `).bind(userId).all();
    
    return {
      total: totalStats,
      daily: dailyStats.results || [],
      tokens: tokenStats.results || []
    };
    
  } catch (error) {
    console.error('Error getting user usage stats:', error);
    return null;
  }
}

/**
 * 获取系统整体统计
 * @param {Object} db - 数据库连接
 * @param {number} days - 统计天数
 * @returns {Object} 系统统计
 */
export async function getSystemStats(db, days = 30) {
  try {
    // 用户统计
    const userStats = await db.prepare(`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN created_at >= date('now', '-${days} days') THEN 1 ELSE 0 END) as new_users
      FROM users
    `).first();
    
    // Token统计
    const tokenStats = await db.prepare(`
      SELECT 
        COUNT(*) as total_tokens,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_tokens,
        SUM(usage_count) as total_usage,
        AVG(usage_count) as avg_usage
      FROM tokens
    `).first();
    
    // 使用统计
    const usageStats = await db.prepare(`
      SELECT 
        SUM(request_count) as total_requests,
        SUM(success_count) as total_success,
        SUM(error_count) as total_errors,
        SUM(total_tokens_used) as total_tokens_consumed,
        COUNT(DISTINCT user_id) as active_users,
        COUNT(DISTINCT token_id) as used_tokens
      FROM user_usage_stats
      WHERE date >= date('now', '-${days} days')
    `).first();
    
    // 每日趋势
    const dailyTrend = await db.prepare(`
      SELECT 
        date,
        SUM(request_count) as requests,
        SUM(success_count) as success,
        SUM(error_count) as errors,
        COUNT(DISTINCT user_id) as active_users
      FROM user_usage_stats
      WHERE date >= date('now', '-${days} days')
      GROUP BY date
      ORDER BY date DESC
    `).all();
    
    // 热门Token
    const topTokens = await db.prepare(`
      SELECT 
        t.token,
        t.tenant_url,
        SUM(uus.request_count) as total_requests,
        COUNT(DISTINCT uus.user_id) as unique_users
      FROM user_usage_stats uus
      JOIN tokens t ON uus.token_id = t.id
      WHERE uus.date >= date('now', '-${days} days')
      GROUP BY t.id
      ORDER BY total_requests DESC
      LIMIT 10
    `).all();
    
    // 活跃用户
    const topUsers = await db.prepare(`
      SELECT 
        u.username,
        u.email,
        SUM(uus.request_count) as total_requests,
        COUNT(DISTINCT uus.token_id) as tokens_used
      FROM user_usage_stats uus
      JOIN users u ON uus.user_id = u.id
      WHERE uus.date >= date('now', '-${days} days')
      GROUP BY u.id
      ORDER BY total_requests DESC
      LIMIT 10
    `).all();
    
    return {
      users: userStats,
      tokens: tokenStats,
      usage: usageStats,
      trends: {
        daily: dailyTrend.results || []
      },
      top: {
        tokens: topTokens.results || [],
        users: topUsers.results || []
      }
    };
    
  } catch (error) {
    console.error('Error getting system stats:', error);
    return null;
  }
}

/**
 * 获取Token使用排行
 * @param {Object} db - 数据库连接
 * @param {number} limit - 返回数量限制
 * @param {number} days - 统计天数
 * @returns {Array} Token排行列表
 */
export async function getTokenUsageRanking(db, limit = 10, days = 30) {
  try {
    const ranking = await db.prepare(`
      SELECT 
        t.id,
        t.token,
        t.tenant_url,
        t.status,
        SUM(uus.request_count) as total_requests,
        SUM(uus.success_count) as total_success,
        SUM(uus.error_count) as total_errors,
        COUNT(DISTINCT uus.user_id) as unique_users,
        MAX(uus.date) as last_used,
        ROUND(AVG(uus.request_count), 2) as avg_daily_requests
      FROM tokens t
      LEFT JOIN user_usage_stats uus ON t.id = uus.token_id 
        AND uus.date >= date('now', '-${days} days')
      GROUP BY t.id
      ORDER BY total_requests DESC NULLS LAST
      LIMIT ?
    `).bind(limit).all();
    
    return ranking.results || [];
    
  } catch (error) {
    console.error('Error getting token usage ranking:', error);
    return [];
  }
}

/**
 * 获取用户活跃度排行
 * @param {Object} db - 数据库连接
 * @param {number} limit - 返回数量限制
 * @param {number} days - 统计天数
 * @returns {Array} 用户排行列表
 */
export async function getUserActivityRanking(db, limit = 10, days = 30) {
  try {
    const ranking = await db.prepare(`
      SELECT 
        u.id,
        u.username,
        u.email,
        u.token_quota,
        u.status,
        SUM(uus.request_count) as total_requests,
        SUM(uus.success_count) as total_success,
        SUM(uus.error_count) as total_errors,
        COUNT(DISTINCT uus.token_id) as tokens_used,
        COUNT(DISTINCT uus.date) as active_days,
        MAX(uus.date) as last_active
      FROM users u
      LEFT JOIN user_usage_stats uus ON u.id = uus.user_id 
        AND uus.date >= date('now', '-${days} days')
      GROUP BY u.id
      ORDER BY total_requests DESC NULLS LAST
      LIMIT ?
    `).bind(limit).all();
    
    return ranking.results || [];
    
  } catch (error) {
    console.error('Error getting user activity ranking:', error);
    return [];
  }
}

/**
 * 生成使用报告
 * @param {Object} db - 数据库连接
 * @param {string} type - 报告类型 ('daily', 'weekly', 'monthly')
 * @param {string} date - 报告日期
 * @returns {Object} 使用报告
 */
export async function generateUsageReport(db, type = 'daily', date = null) {
  try {
    const reportDate = date || new Date().toISOString().split('T')[0];
    let dateFilter = '';
    let groupBy = '';
    
    switch (type) {
      case 'daily':
        dateFilter = `date = '${reportDate}'`;
        groupBy = 'date';
        break;
      case 'weekly':
        dateFilter = `date >= date('${reportDate}', 'weekday 0', '-6 days') AND date <= '${reportDate}'`;
        groupBy = "strftime('%Y-W%W', date)";
        break;
      case 'monthly':
        dateFilter = `strftime('%Y-%m', date) = strftime('%Y-%m', '${reportDate}')`;
        groupBy = "strftime('%Y-%m', date)";
        break;
    }
    
    const report = await db.prepare(`
      SELECT 
        ${groupBy} as period,
        COUNT(DISTINCT user_id) as active_users,
        COUNT(DISTINCT token_id) as used_tokens,
        SUM(request_count) as total_requests,
        SUM(success_count) as total_success,
        SUM(error_count) as total_errors,
        SUM(total_tokens_used) as total_tokens_consumed,
        ROUND(AVG(request_count), 2) as avg_requests_per_user,
        ROUND(SUM(success_count) * 100.0 / SUM(request_count), 2) as success_rate
      FROM user_usage_stats
      WHERE ${dateFilter}
      GROUP BY ${groupBy}
      ORDER BY period DESC
    `).all();
    
    return {
      type,
      date: reportDate,
      data: report.results || []
    };
    
  } catch (error) {
    console.error('Error generating usage report:', error);
    return null;
  }
}

/**
 * 清理过期的统计数据
 * @param {Object} db - 数据库连接
 * @param {number} retentionDays - 保留天数
 * @returns {number} 清理的记录数
 */
export async function cleanupOldStats(db, retentionDays = 90) {
  try {
    // 清理过期的使用统计
    const usageResult = await db.prepare(`
      DELETE FROM user_usage_stats 
      WHERE date < date('now', '-${retentionDays} days')
    `).run();
    
    // 清理过期的活动日志
    const activityResult = await db.prepare(`
      DELETE FROM user_activity_logs 
      WHERE created_at < datetime('now', '-${retentionDays} days')
    `).run();
    
    // 清理过期的会话
    const sessionResult = await db.prepare(`
      DELETE FROM sessions 
      WHERE expires_at < datetime('now')
    `).run();
    
    const totalCleaned = (usageResult.changes || 0) + 
                        (activityResult.changes || 0) + 
                        (sessionResult.changes || 0);
    
    console.log(`Cleaned up ${totalCleaned} old records`);
    return totalCleaned;
    
  } catch (error) {
    console.error('Error cleaning up old stats:', error);
    return 0;
  }
}
