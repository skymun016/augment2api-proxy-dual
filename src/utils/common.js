// 通用工具函数

/**
 * 创建JSON响应
 * @param {Object} data - 响应数据
 * @param {number} status - HTTP状态码
 * @param {Object} headers - 额外的响应头
 * @returns {Response} HTTP响应对象
 */
export function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      ...headers
    }
  });
}

/**
 * 处理CORS预检请求
 * @returns {Response} CORS响应
 */
export function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    }
  });
}

/**
 * 验证邮箱格式
 * @param {string} email - 邮箱地址
 * @returns {boolean} 是否有效
 */
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * 验证Personal Token格式
 * @param {string} token - Personal Token
 * @returns {boolean} 是否有效
 */
export function isValidPersonalToken(token) {
  // Personal Token应该是64位十六进制字符串
  const tokenRegex = /^[a-f0-9]{64}$/i;
  return tokenRegex.test(token);
}

/**
 * 验证Augment Token格式
 * @param {string} token - Augment Token
 * @returns {boolean} 是否有效
 */
export function isValidAugmentToken(token) {
  // Augment Token通常以特定前缀开始
  return token && token.length > 20 && (
    token.startsWith('augment_') || 
    token.startsWith('ak-') ||
    token.startsWith('sk-')
  );
}

/**
 * 分页参数解析
 * @param {URL} url - 请求URL
 * @returns {Object} 分页参数
 */
export function parsePaginationParams(url) {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20')));
  const offset = (page - 1) * limit;
  
  return { page, limit, offset };
}

/**
 * 创建分页响应
 * @param {Array} data - 数据数组
 * @param {number} total - 总数
 * @param {Object} params - 分页参数
 * @returns {Object} 分页响应对象
 */
export function createPaginatedResponse(data, total, params) {
  const { page, limit } = params;
  const totalPages = Math.ceil(total / limit);
  
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      pages: totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    }
  };
}

/**
 * 格式化日期时间
 * @param {Date|string} date - 日期对象或字符串
 * @returns {string} 格式化的日期时间
 */
export function formatDateTime(date) {
  if (!date) return null;
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  
  return d.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * 安全地解析JSON
 * @param {string} jsonString - JSON字符串
 * @param {*} defaultValue - 默认值
 * @returns {*} 解析结果或默认值
 */
export function safeJsonParse(jsonString, defaultValue = null) {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn('JSON parse failed:', error.message);
    return defaultValue;
  }
}

/**
 * 延迟执行
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise} Promise对象
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 重试执行函数
 * @param {Function} fn - 要执行的函数
 * @param {number} maxRetries - 最大重试次数
 * @param {number} delayMs - 重试间隔
 * @returns {Promise} 执行结果
 */
export async function retry(fn, maxRetries = 3, delayMs = 1000) {
  let lastError;
  
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < maxRetries) {
        await delay(delayMs * Math.pow(2, i)); // 指数退避
      }
    }
  }
  
  throw lastError;
}

/**
 * 限制字符串长度
 * @param {string} str - 原字符串
 * @param {number} maxLength - 最大长度
 * @param {string} suffix - 后缀
 * @returns {string} 截断后的字符串
 */
export function truncateString(str, maxLength = 100, suffix = '...') {
  if (!str || str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * 掩码敏感信息
 * @param {string} str - 原字符串
 * @param {number} visibleStart - 开始可见字符数
 * @param {number} visibleEnd - 结束可见字符数
 * @param {string} mask - 掩码字符
 * @returns {string} 掩码后的字符串
 */
export function maskSensitiveData(str, visibleStart = 4, visibleEnd = 4, mask = '*') {
  if (!str || str.length <= visibleStart + visibleEnd) {
    return str;
  }
  
  const start = str.substring(0, visibleStart);
  const end = str.substring(str.length - visibleEnd);
  const middle = mask.repeat(Math.max(3, str.length - visibleStart - visibleEnd));
  
  return start + middle + end;
}

/**
 * 验证请求频率限制
 * @param {string} key - 限制键
 * @param {number} limit - 限制次数
 * @param {number} windowMs - 时间窗口（毫秒）
 * @param {Map} cache - 缓存对象
 * @returns {Object} 限制结果
 */
export function checkRateLimit(key, limit, windowMs, cache = new Map()) {
  const now = Date.now();
  const windowStart = now - windowMs;
  
  // 获取或创建记录
  let record = cache.get(key) || { requests: [], resetTime: now + windowMs };
  
  // 清理过期请求
  record.requests = record.requests.filter(time => time > windowStart);
  
  // 检查是否超限
  if (record.requests.length >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: record.resetTime,
      retryAfter: Math.ceil((record.resetTime - now) / 1000)
    };
  }
  
  // 记录新请求
  record.requests.push(now);
  cache.set(key, record);
  
  return {
    allowed: true,
    remaining: limit - record.requests.length,
    resetTime: record.resetTime,
    retryAfter: 0
  };
}

/**
 * 生成API响应的标准格式
 * @param {boolean} success - 是否成功
 * @param {*} data - 响应数据
 * @param {string} message - 响应消息
 * @param {Object} meta - 元数据
 * @returns {Object} 标准响应格式
 */
export function createApiResponse(success, data = null, message = '', meta = {}) {
  const response = {
    success,
    timestamp: new Date().toISOString(),
    ...meta
  };
  
  if (success) {
    response.data = data;
    if (message) response.message = message;
  } else {
    response.error = message || 'An error occurred';
    if (data) response.details = data;
  }
  
  return response;
}

/**
 * 清理和验证输入数据
 * @param {Object} data - 输入数据
 * @param {Object} schema - 验证模式
 * @returns {Object} 清理后的数据和验证结果
 */
export function validateAndCleanInput(data, schema) {
  const cleaned = {};
  const errors = [];
  
  for (const [key, rules] of Object.entries(schema)) {
    const value = data[key];
    
    // 检查必填字段
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push(`${key} is required`);
      continue;
    }
    
    // 跳过可选的空值
    if (!rules.required && (value === undefined || value === null || value === '')) {
      continue;
    }
    
    // 类型验证
    if (rules.type && typeof value !== rules.type) {
      errors.push(`${key} must be of type ${rules.type}`);
      continue;
    }
    
    // 长度验证
    if (rules.minLength && value.length < rules.minLength) {
      errors.push(`${key} must be at least ${rules.minLength} characters long`);
      continue;
    }
    
    if (rules.maxLength && value.length > rules.maxLength) {
      errors.push(`${key} must be no more than ${rules.maxLength} characters long`);
      continue;
    }
    
    // 正则验证
    if (rules.pattern && !rules.pattern.test(value)) {
      errors.push(`${key} format is invalid`);
      continue;
    }
    
    // 自定义验证
    if (rules.validator && !rules.validator(value)) {
      errors.push(`${key} validation failed`);
      continue;
    }
    
    // 数据清理
    let cleanedValue = value;
    if (rules.trim && typeof value === 'string') {
      cleanedValue = value.trim();
    }
    
    cleaned[key] = cleanedValue;
  }
  
  return {
    data: cleaned,
    errors,
    isValid: errors.length === 0
  };
}
