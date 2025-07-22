-- 扩展的多用户Token池管理数据库结构
-- 基于原有 schema.sql 进行扩展

-- 保留原有的 tokens 表（存储所有可用的 Augment Token）
CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    tenant_url TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'maintenance')),
    remark TEXT DEFAULT '',
    usage_count INTEGER DEFAULT 0,
    last_used_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建用户表
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    personal_token TEXT NOT NULL UNIQUE,
    username TEXT,
    email TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'disabled')),
    token_quota INTEGER DEFAULT 0,  -- 分配的Token数量配额
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME
);

-- 创建用户Token分配表（多对多关系）
CREATE TABLE IF NOT EXISTS user_token_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_id INTEGER NOT NULL,
    allocated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
    priority INTEGER DEFAULT 1,  -- 优先级，数字越小优先级越高
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE CASCADE,
    UNIQUE(user_id, token_id)
);

-- 创建用户使用统计表
CREATE TABLE IF NOT EXISTS user_usage_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_id INTEGER NOT NULL,
    date DATE DEFAULT (date('now')),
    request_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    total_tokens_used INTEGER DEFAULT 0,  -- 消耗的Token数量
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (token_id) REFERENCES tokens(id) ON DELETE CASCADE,
    UNIQUE(user_id, token_id, date)
);

-- 创建管理员表
CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'viewer')),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME
);

-- 保留原有的 sessions 表（用于管理员会话）
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_token TEXT NOT NULL UNIQUE,
    user_type TEXT DEFAULT 'admin' CHECK (user_type IN ('admin', 'user')),
    user_id INTEGER,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建用户操作日志表
CREATE TABLE IF NOT EXISTS user_activity_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,  -- 'login', 'token_request', 'api_call', etc.
    details TEXT,  -- JSON格式的详细信息
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 创建系统配置表
CREATE TABLE IF NOT EXISTS system_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key TEXT NOT NULL UNIQUE,
    config_value TEXT NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_tokens_status ON tokens(status);
CREATE INDEX IF NOT EXISTS idx_tokens_usage_count ON tokens(usage_count);

CREATE INDEX IF NOT EXISTS idx_users_personal_token ON users(personal_token);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

CREATE INDEX IF NOT EXISTS idx_allocations_user_id ON user_token_allocations(user_id);
CREATE INDEX IF NOT EXISTS idx_allocations_token_id ON user_token_allocations(token_id);
CREATE INDEX IF NOT EXISTS idx_allocations_status ON user_token_allocations(status);
CREATE INDEX IF NOT EXISTS idx_allocations_priority ON user_token_allocations(priority);

CREATE INDEX IF NOT EXISTS idx_usage_stats_user_id ON user_usage_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_stats_date ON user_usage_stats(date);
CREATE INDEX IF NOT EXISTS idx_usage_stats_user_date ON user_usage_stats(user_id, date);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON user_activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON user_activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON user_activity_logs(created_at);

-- 插入默认系统配置
INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES 
('default_token_quota', '3', '新用户默认Token配额'),
('max_token_quota', '10', '单用户最大Token配额'),
('token_rotation_enabled', 'true', '是否启用Token轮换'),
('usage_stats_retention_days', '90', '使用统计保留天数');

-- 插入默认管理员账号（密码需要在应用中设置）
INSERT OR IGNORE INTO admins (username, password_hash, email, role) VALUES 
('admin', '', 'admin@example.com', 'super_admin');
