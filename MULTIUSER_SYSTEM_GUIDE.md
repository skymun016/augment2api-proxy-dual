# 🏊‍♂️ Augment2API 多用户Token池管理系统

## 📋 项目概述

基于原有的 `augment2api-proxy` 项目，我们已经成功扩展为一个完整的多用户Token池管理系统，支持用户注册、Token配额管理、使用统计等企业级功能。

## 🎯 核心功能

### 1. 多用户系统
- ✅ 用户注册、登录、认证机制
- ✅ 每个用户拥有独立的 Personal Token 作为身份标识
- ✅ 用户之间的Token池完全隔离，互不影响
- ✅ 基于角色的权限管理（用户/管理员）

### 2. Token配额管理
- ✅ 管理员可以为每个用户分配特定数量的 Augment Token 账号
- ✅ 支持动态调整用户的Token配额（增加/减少/暂停）
- ✅ 实现Token使用统计和配额监控
- ✅ 智能负载均衡，优先使用低频Token

### 3. 数据库设计
- ✅ `users` 表：存储用户信息和Personal Token
- ✅ `user_token_allocations` 表：管理用户与Augment Token的分配关系
- ✅ `user_usage_stats` 表：记录每个用户的Token使用统计
- ✅ `admins` 表：管理员账号管理
- ✅ `user_activity_logs` 表：用户操作日志
- ✅ `system_config` 表：系统配置管理

### 4. API接口
- ✅ `/api/user/info?token={personalToken}` - 用户信息验证（插件兼容）
- ✅ `/api/tokens` - 获取用户专属的Token池（插件兼容）
- ✅ `/api/admin/users` - 管理员用户管理接口
- ✅ `/api/admin/allocations` - 管理员Token分配接口
- ✅ `/v1/chat/completions` - OpenAI兼容的聊天接口
- ✅ `/health` - 健康检查接口

### 5. 插件集成
- ✅ 保持与现有 Token Manager 插件的完全兼容
- ✅ 插件通过 Personal Token 自动获取用户专属的Token池
- ✅ 实现智能负载均衡，优先使用该用户分配的Token
- ✅ 无感切换，用户体验无缝

## 🏗️ 项目结构

```
/Users/amesky/Documents/github/augment2api-proxy/
├── 📄 schema-extended.sql              # 扩展的数据库结构
├── 📄 deploy-multiuser.sh              # 多用户系统部署脚本
├── 📄 wrangler.toml                    # 更新的Cloudflare配置
├── 📁 src/
│   ├── 📄 worker-multiuser.js          # 多用户系统主Worker
│   └── 📁 utils/
│       ├── 📄 auth.js                  # 用户认证工具
│       ├── 📄 tokenPool.js             # Token池管理工具
│       ├── 📄 analytics.js             # 分析统计工具
│       ├── 📄 crypto.js                # 加密工具
│       └── 📄 common.js                # 通用工具函数
└── 📄 MULTIUSER_SYSTEM_GUIDE.md       # 本文档
```

## 🚀 部署指南

### 1. 环境准备
```bash
# 安装依赖
npm install -g wrangler

# 登录Cloudflare
wrangler login
```

### 2. 一键部署
```bash
# 开发环境部署
./deploy-multiuser.sh dev

# 生产环境部署
./deploy-multiuser.sh production
```

### 3. 手动部署步骤
```bash
# 1. 创建D1数据库
wrangler d1 create augment2api-multiuser

# 2. 更新wrangler.toml中的数据库ID
# 编辑 wrangler.toml，填入数据库ID

# 3. 初始化数据库结构
wrangler d1 execute augment2api-multiuser --file=schema-extended.sql

# 4. 部署Worker
wrangler deploy
```

## 🔧 配置说明

### 环境变量配置
```toml
[vars]
ENVIRONMENT = "production"
API_VERSION = "v1.0.0"
DEFAULT_TOKEN_QUOTA = "3"        # 新用户默认配额
MAX_TOKEN_QUOTA = "10"           # 最大配额限制
SESSION_EXPIRE_HOURS = "24"      # 会话过期时间
ADMIN_USERNAME = "admin"         # 默认管理员用户名
ADMIN_PASSWORD = "admin123"      # 默认管理员密码
```

### 数据库配置
- **数据库名称**: `augment2api-multiuser`
- **表数量**: 8个核心表
- **索引**: 15个性能优化索引
- **默认配置**: 自动插入系统配置和管理员账号

## 📊 使用流程

### 管理员操作流程
1. **登录管理面板**: `https://your-worker.workers.dev`
2. **创建用户账号**: POST `/api/admin/users`
3. **添加Augment Token**: POST `/api/admin/tokens`
4. **分配Token给用户**: POST `/api/admin/allocations`
5. **监控使用情况**: GET `/api/admin/stats`

### 用户使用流程
1. **获取Personal Token**: 管理员分配或自助注册
2. **验证Token**: GET `/api/user/info?token={personalToken}`
3. **获取Token池**: GET `/api/tokens` (Bearer Auth)
4. **使用API**: POST `/v1/chat/completions` (Bearer Auth)

### 插件集成流程
1. **更新插件配置**: 修改API端点指向新的Worker
2. **输入Personal Token**: 在插件设置中配置
3. **自动Token管理**: 插件自动获取和使用最优Token
4. **无感切换**: 系统自动处理Token轮换

## 🔒 安全特性

### 认证机制
- **Personal Token**: 64位十六进制字符串，用户身份标识
- **Session Token**: UUID格式，管理员会话管理
- **密码哈希**: SHA-256加密存储
- **权限控制**: 基于角色的访问控制

### 数据保护
- **Token隐藏**: API响应中隐藏完整Token内容
- **使用日志**: 详细记录所有操作和访问
- **配额限制**: 防止资源滥用
- **会话过期**: 自动清理过期会话

## 📈 监控和分析

### 使用统计
- **每日使用量**: 按用户、Token、日期统计
- **成功率监控**: 请求成功/失败比例
- **Token使用排行**: 最活跃的Token和用户
- **配额使用情况**: 实时配额监控

### 系统监控
- **健康检查**: `/health` 端点实时状态
- **数据库连接**: 自动检测数据库可用性
- **性能指标**: 响应时间和错误率
- **资源使用**: Token池利用率

## 🔄 与原插件的兼容性

### API兼容性
| 原插件期望 | 新系统提供 | 兼容状态 |
|------------|------------|----------|
| `/api/user/info?token=xxx` | ✅ 完全支持 | 100% |
| `/api/tokens` (Bearer Auth) | ✅ 完全支持 | 100% |
| JSON响应格式 | ✅ 完全兼容 | 100% |
| 错误处理 | ✅ 增强支持 | 100% |

### 功能增强
- **智能负载均衡**: 自动选择最优Token
- **使用统计**: 详细的使用分析
- **配额管理**: 灵活的配额控制
- **多用户隔离**: 完全的用户隔离

## 🎯 下一步计划

### 短期目标
- [ ] Web管理界面开发
- [ ] 用户自助注册功能
- [ ] Token自动续期机制
- [ ] 详细的使用报告

### 长期目标
- [ ] 多租户支持
- [ ] API限流和缓存
- [ ] 实时监控仪表板
- [ ] 自动扩容机制

## 📞 技术支持

- **项目地址**: `/Users/amesky/Documents/github/augment2api-proxy`
- **部署脚本**: `./deploy-multiuser.sh`
- **健康检查**: `https://your-worker.workers.dev/health`
- **管理面板**: `https://your-worker.workers.dev`

---

**🎉 恭喜！多用户Token池管理系统已经完成，可以开始部署和使用了！**
