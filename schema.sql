-- Cloudflare D1 数据库表结构

-- 创建 tokens 表
CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    tenant_url TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    remark TEXT DEFAULT '',
    usage_count INTEGER DEFAULT 0,
    last_used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_tokens_status ON tokens(status);
CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tokens(created_at);

-- 创建 sessions 表（用于管理员会话）
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_token TEXT NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- 创建 usage_logs 表（可选，用于统计）
CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id INTEGER,
    model TEXT,
    request_count INTEGER DEFAULT 1,
    date DATE DEFAULT (date('now')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (token_id) REFERENCES tokens(id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_usage_logs_date ON usage_logs(date);
CREATE INDEX IF NOT EXISTS idx_usage_logs_token_id ON usage_logs(token_id);

-- 插入示例数据（可选）
-- INSERT INTO tokens (token, tenant_url, remark) VALUES 
-- ('example-token-1', 'https://example1.augmentcode.com/', '示例Token 1'),
-- ('example-token-2', 'https://example2.augmentcode.com/', '示例Token 2');
