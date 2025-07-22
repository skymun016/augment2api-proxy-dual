# 🚀 Cloudflare部署指南

## ⚠️ 当前问题解决

如果您看到 **Error 1101** 错误，这是因为D1数据库未配置。

## 📋 快速修复步骤

### 1. 创建D1数据库
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 `Workers & Pages` → `D1 SQL Database`
3. 点击 `Create database`
4. 数据库名称：`augment2api-multiuser`
5. 点击 `Create`

### 2. 绑定数据库到Worker
1. 进入您的Worker：`augment-proxy-dual-v2`
2. 点击 `Settings` → `Variables`
3. 找到 `D1 database bindings` 部分
4. 点击 `Add binding`
5. 填写：
   - **Variable name**: `DB`
   - **D1 database**: 选择 `augment2api-multiuser`
6. 点击 `Save and deploy`

### 3. 初始化数据库结构
1. 回到D1数据库页面
2. 点击 `augment2api-multiuser` 数据库
3. 进入 `Console` 标签页
4. 复制粘贴以下SQL并点击 `Execute`：

```sql
-- 创建tokens表
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  tenant_url TEXT NOT NULL,
  status TEXT DEFAULT 'active',
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
  status TEXT DEFAULT 'active',
  token_quota INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME
);

-- 创建管理员表
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT,
  role TEXT DEFAULT 'admin',
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME
);

-- 创建用户Token分配表
CREATE TABLE IF NOT EXISTS user_token_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  allocated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active',
  priority INTEGER DEFAULT 1,
  UNIQUE(user_id, token_id)
);

-- 创建会话表
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_token TEXT NOT NULL UNIQUE,
  user_type TEXT DEFAULT 'admin',
  user_id INTEGER,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建使用统计表
CREATE TABLE IF NOT EXISTS user_usage_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_id INTEGER NOT NULL,
  date DATE DEFAULT (date('now')),
  request_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, token_id, date)
);

-- 创建活动日志表
CREATE TABLE IF NOT EXISTS user_activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建系统配置表
CREATE TABLE IF NOT EXISTS system_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key TEXT NOT NULL UNIQUE,
  config_value TEXT NOT NULL,
  description TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 插入默认管理员（用户名：admin，密码：admin123）
INSERT OR IGNORE INTO admins (username, password_hash, email, role) 
VALUES ('admin', 'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f', 'admin@example.com', 'super_admin');

-- 插入默认系统配置
INSERT OR IGNORE INTO system_config (config_key, config_value, description) VALUES 
('default_token_quota', '3', '新用户默认Token配额'),
('max_token_quota', '10', '单用户最大Token配额'),
('token_rotation_enabled', 'true', '是否启用Token轮换'),
('usage_stats_retention_days', '90', '使用统计保留天数');
```

### 4. 验证部署
访问您的Worker URL，应该能看到多用户管理系统仪表板！

## 🧪 测试API

```bash
# 健康检查
curl https://augment-proxy-dual-v2.amexiaowu.workers.dev/health

# 管理员登录
curl -X POST https://augment-proxy-dual-v2.amexiaowu.workers.dev/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
```

## 🎯 完成后的功能

- ✅ 多用户Token池管理
- ✅ 管理员登录：admin/admin123  
- ✅ 用户注册和Token分配
- ✅ 智能负载均衡
- ✅ 使用统计和监控
- ✅ 与Token Manager插件100%兼容

## 💡 为什么需要手动配置？

Cloudflare的安全机制要求：
1. D1数据库必须手动创建
2. Worker绑定必须明确授权
3. 这确保了数据安全和访问控制

完成这些步骤后，您就有了一个完整的企业级多用户Token池管理系统！
