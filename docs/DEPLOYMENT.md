# 🚀 部署指南

## 部署方式对比

| 方式 | 难度 | 时间 | 推荐度 |
|------|------|------|--------|
| GitHub + Cloudflare Pages | ⭐ | 5分钟 | 🌟🌟🌟🌟🌟 |
| 本地 Wrangler CLI | ⭐⭐ | 10分钟 | 🌟🌟🌟🌟 |
| Fork + 自定义 | ⭐⭐⭐ | 15分钟 | 🌟🌟🌟 |

## 方法1: GitHub + Cloudflare Pages（推荐）

### 步骤1: Fork 仓库
1. 访问 [项目仓库](https://github.com/skymun016/augment2apicloudflare)
2. 点击右上角 "Fork" 按钮
3. 选择您的 GitHub 账户

### 步骤2: 连接 Cloudflare
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 "Workers & Pages"
3. 点击 "Create application"
4. 选择 "Pages" → "Connect to Git"
5. 授权 GitHub 并选择 fork 的仓库

### 步骤3: 配置构建
```
Framework preset: None
Build command: npm install
Build output directory: /
Root directory: /
```

### 步骤4: 设置环境变量
在 Cloudflare Pages 设置中添加：
```
UNIFIED_TOKEN=your-unified-token-here
ACCESS_PWD=your-admin-password
```

### 步骤5: 创建 D1 数据库
```bash
# 在本地或 Cloudflare 控制台创建
npx wrangler d1 create augment2api-db
```

### 步骤6: 绑定数据库
在 Pages 设置中绑定 D1 数据库：
- Variable name: `DB`
- D1 database: 选择创建的数据库

## 方法2: 本地 Wrangler CLI

### 前置要求
- Node.js 16+
- npm 或 yarn
- Cloudflare 账户

### 步骤1: 克隆仓库
```bash
git clone https://github.com/skymun016/augment2apicloudflare.git
cd augment2apicloudflare
```

### 步骤2: 安装依赖
```bash
npm install
```

### 步骤3: 登录 Cloudflare
```bash
npx wrangler login
```

### 步骤4: 创建 D1 数据库
```bash
npx wrangler d1 create augment2api-db
```

复制输出中的 `database_id` 到 `wrangler.toml`

### 步骤5: 初始化数据库
```bash
npx wrangler d1 execute augment2api-db --file=./schema.sql
```

### 步骤6: 配置环境变量
编辑 `wrangler.toml`:
```toml
[vars]
UNIFIED_TOKEN = "your-unified-token-here"
ACCESS_PWD = "your-admin-password"
```

### 步骤7: 部署
```bash
npx wrangler deploy
```

## 环境变量配置

### 必需变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `UNIFIED_TOKEN` | 客户端统一认证token | `sk-1234567890abcdef` |
| `ACCESS_PWD` | 管理界面密码 | `admin123456` |

### 可选变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `RATE_LIMIT` | 每分钟请求限制 | `100` |
| `SESSION_TIMEOUT` | 会话超时时间(小时) | `24` |

## 数据库配置

### D1 数据库创建
```bash
# 开发环境
npx wrangler d1 create augment2api-db

# 生产环境
npx wrangler d1 create augment2api-db-prod
```

### 表结构初始化
```bash
# 开发环境
npx wrangler d1 execute augment2api-db --file=./schema.sql

# 生产环境
npx wrangler d1 execute augment2api-db-prod --file=./schema.sql
```

## 自定义域名

### 步骤1: 添加域名到 Cloudflare
1. 在 Cloudflare 控制台添加域名
2. 更新 DNS 服务器

### 步骤2: 绑定到 Worker
1. 进入 Worker 设置
2. 点击 "Triggers" → "Custom Domains"
3. 添加您的域名

### 步骤3: 配置 SSL
Cloudflare 会自动配置 SSL 证书

## 多环境部署

### 配置文件
```toml
# 开发环境
[env.development]
name = "augment2api-dev"

# 测试环境
[env.staging]
name = "augment2api-staging"

# 生产环境
[env.production]
name = "augment2api-prod"
```

### 部署命令
```bash
# 开发环境
npx wrangler deploy --env development

# 测试环境
npx wrangler deploy --env staging

# 生产环境
npx wrangler deploy --env production
```

## 验证部署

### 健康检查
```bash
curl https://your-worker.workers.dev/v1/models
```

### 功能测试
```bash
# 运行测试脚本
npm test

# 或手动测试
node test.js
```

## 故障排除

### 常见错误

1. **数据库连接失败**
   ```
   Error: D1_ERROR: Database not found
   ```
   解决：检查 `wrangler.toml` 中的 `database_id`

2. **环境变量未设置**
   ```
   Error: UNIFIED_TOKEN is not defined
   ```
   解决：在 Cloudflare 控制台设置环境变量

3. **权限错误**
   ```
   Error: Unauthorized
   ```
   解决：重新登录 `npx wrangler login`

### 调试技巧

```bash
# 查看实时日志
npx wrangler tail

# 本地开发模式
npx wrangler dev

# 检查配置
npx wrangler whoami
```

## 性能优化

### 缓存策略
- 静态资源缓存：24小时
- API 响应缓存：5分钟
- 数据库查询优化

### 监控指标
- 请求延迟
- 错误率
- 数据库性能
- 内存使用

## 安全建议

### Token 安全
- 使用强随机 token
- 定期轮换密钥
- 不在代码中硬编码

### 访问控制
- 设置强管理密码
- 启用 IP 白名单（可选）
- 监控异常访问

### 数据保护
- 敏感数据加密
- 定期备份数据库
- 访问日志记录
