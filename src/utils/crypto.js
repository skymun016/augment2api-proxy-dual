// 加密相关工具函数

/**
 * 生成密码哈希
 * @param {string} password - 原始密码
 * @returns {Promise<string>} 哈希后的密码
 */
export async function generateHash(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 验证密码哈希
 * @param {string} password - 原始密码
 * @param {string} hash - 存储的哈希值
 * @returns {Promise<boolean>} 是否匹配
 */
export async function verifyHash(password, hash) {
  const passwordHash = await generateHash(password);
  return passwordHash === hash;
}

/**
 * 生成随机字符串
 * @param {number} length - 字符串长度
 * @returns {string} 随机字符串
 */
export function generateRandomString(length = 32) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 生成UUID
 * @returns {string} UUID字符串
 */
export function generateUUID() {
  return crypto.randomUUID();
}

/**
 * 简单的字符串加密（用于非敏感数据）
 * @param {string} text - 要加密的文本
 * @param {string} key - 加密密钥
 * @returns {string} 加密后的文本
 */
export function simpleEncrypt(text, key) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i) ^ key.charCodeAt(i % key.length);
    result += String.fromCharCode(charCode);
  }
  return btoa(result);
}

/**
 * 简单的字符串解密
 * @param {string} encryptedText - 加密的文本
 * @param {string} key - 解密密钥
 * @returns {string} 解密后的文本
 */
export function simpleDecrypt(encryptedText, key) {
  try {
    const decoded = atob(encryptedText);
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      const charCode = decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length);
      result += String.fromCharCode(charCode);
    }
    return result;
  } catch (error) {
    console.error('Decryption failed:', error);
    return '';
  }
}
