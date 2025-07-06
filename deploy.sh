#!/bin/bash

# Augment2Api Cloudflare 一键部署脚本

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 日志函数
log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# 显示横幅
show_banner() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║              Augment2Api Cloudflare 一键部署                 ║"
    echo "║                无服务器 • 全球分布 • 零维护                   ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# 检查依赖
check_dependencies() {
    log_step "检查依赖..."
    
    # 检查 Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装，请先安装 Node.js"
        log_info "访问 https://nodejs.org/ 下载安装"
        exit 1
    fi
    
    # 检查 npm
    if ! command -v npm &> /dev/null; then
        log_error "npm 未安装"
        exit 1
    fi
    
    log_info "依赖检查通过"
}

# 安装项目依赖
install_dependencies() {
    log_step "安装项目依赖..."
    npm install
    log_info "依赖安装完成"
}

# 登录 Cloudflare
login_cloudflare() {
    log_step "登录 Cloudflare..."
    
    if ! npx wrangler whoami &> /dev/null; then
        log_info "请在浏览器中完成 Cloudflare 登录..."
        npx wrangler login
    else
        log_info "已登录 Cloudflare"
    fi
}

# 创建 D1 数据库
create_database() {
    log_step "创建 D1 数据库..."
    
    # 创建数据库
    DB_OUTPUT=$(npx wrangler d1 create augment2api-db 2>/dev/null || echo "exists")
    
    if [[ "$DB_OUTPUT" == "exists" ]]; then
        log_warn "数据库可能已存在，继续..."
    else
        # 提取数据库 ID
        DB_ID=$(echo "$DB_OUTPUT" | grep -o 'database_id = "[^"]*"' | cut -d'"' -f2)
        log_info "数据库创建成功，ID: $DB_ID"
        
        # 更新 wrangler.toml
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/database_id = \"your-database-id\"/database_id = \"$DB_ID\"/" wrangler.toml
        else
            sed -i "s/database_id = \"your-database-id\"/database_id = \"$DB_ID\"/" wrangler.toml
        fi
    fi
}

# 初始化数据库表结构
init_database() {
    log_step "初始化数据库表结构..."
    
    # 执行 SQL 脚本
    npx wrangler d1 execute augment2api-db --file=./schema.sql
    log_info "数据库表结构初始化完成"
}

# 配置环境变量
configure_environment() {
    log_step "配置环境变量..."
    
    # 生成随机密码
    UNIFIED_TOKEN=$(openssl rand -base64 32 2>/dev/null || date +%s | sha256sum | base64 | head -c 32)
    ACCESS_PWD=$(openssl rand -base64 16 2>/dev/null || date +%s | sha256sum | base64 | head -c 16)
    
    # 获取用户输入
    read -p "请输入您的域名 (例如: api.example.com，留空使用 workers.dev): " DOMAIN
    
    # 更新 wrangler.toml
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/UNIFIED_TOKEN = \"your-unified-token-here\"/UNIFIED_TOKEN = \"$UNIFIED_TOKEN\"/" wrangler.toml
        sed -i '' "s/ACCESS_PWD = \"admin-password-123\"/ACCESS_PWD = \"$ACCESS_PWD\"/" wrangler.toml
    else
        sed -i "s/UNIFIED_TOKEN = \"your-unified-token-here\"/UNIFIED_TOKEN = \"$UNIFIED_TOKEN\"/" wrangler.toml
        sed -i "s/ACCESS_PWD = \"admin-password-123\"/ACCESS_PWD = \"$ACCESS_PWD\"/" wrangler.toml
    fi
    
    # 保存配置信息
    cat > .env.local << EOF
# Augment2Api Cloudflare 部署配置
# 生成时间: $(date)

UNIFIED_TOKEN=$UNIFIED_TOKEN
ACCESS_PWD=$ACCESS_PWD
DOMAIN=$DOMAIN
EOF
    
    log_info "环境变量配置完成"
}

# 部署 Worker
deploy_worker() {
    log_step "部署 Cloudflare Worker..."
    
    # 部署到生产环境
    npx wrangler deploy
    
    log_info "Worker 部署完成"
}

# 测试部署
test_deployment() {
    log_step "测试部署..."
    
    if [[ -n "$DOMAIN" ]]; then
        TEST_URL="https://$DOMAIN"
    else
        # 获取 workers.dev 域名
        WORKER_NAME=$(grep '^name = ' wrangler.toml | cut -d'"' -f2)
        ACCOUNT_ID=$(npx wrangler whoami | grep -o 'Account ID: [^,]*' | cut -d' ' -f3 || echo "")
        if [[ -n "$ACCOUNT_ID" ]]; then
            TEST_URL="https://$WORKER_NAME.$ACCOUNT_ID.workers.dev"
        else
            TEST_URL="https://$WORKER_NAME.workers.dev"
        fi
    fi
    
    log_info "测试 URL: $TEST_URL"
    
    # 测试模型列表接口
    echo "测试模型列表接口..."
    curl -s -X GET "$TEST_URL/v1/models" \
        -H "Authorization: Bearer $UNIFIED_TOKEN" | head -c 200 || echo "请求失败"
    
    log_info "测试完成"
}

# 显示部署信息
show_deployment_info() {
    local test_url=$1
    
    echo ""
    echo -e "${GREEN}🎉 Cloudflare 部署完成！${NC}"
    echo ""
    echo -e "${BLUE}📋 服务信息:${NC}"
    echo "  - 服务地址: $test_url"
    echo "  - 管理界面: $test_url/"
    echo "  - API端点: $test_url/v1/chat/completions"
    echo "  - 模型列表: $test_url/v1/models"
    echo ""
    echo -e "${BLUE}🔑 重要配置:${NC}"
    echo "  - 管理密码: $ACCESS_PWD"
    echo "  - 统一Token: $UNIFIED_TOKEN"
    echo ""
    echo -e "${BLUE}📖 使用说明:${NC}"
    echo "  1. 访问 $test_url/ 进入管理界面"
    echo "  2. 使用管理密码登录"
    echo "  3. 添加真实的 Augment token"
    echo "  4. 客户端使用统一Token连接"
    echo ""
    echo -e "${BLUE}🔧 管理命令:${NC}"
    echo "  - 查看日志: npx wrangler tail"
    echo "  - 重新部署: npx wrangler deploy"
    echo "  - 数据库操作: npx wrangler d1 execute augment2api-db --command 'SELECT * FROM tokens'"
    echo ""
    echo -e "${YELLOW}⚠️  请妥善保存配置信息到 .env.local 文件！${NC}"
}

# 主函数
main() {
    show_banner
    
    check_dependencies
    install_dependencies
    login_cloudflare
    create_database
    init_database
    configure_environment
    deploy_worker
    
    # 确定测试 URL
    if [[ -n "$DOMAIN" ]]; then
        TEST_URL="https://$DOMAIN"
    else
        WORKER_NAME=$(grep '^name = ' wrangler.toml | cut -d'"' -f2)
        TEST_URL="https://$WORKER_NAME.workers.dev"
    fi
    
    test_deployment
    show_deployment_info "$TEST_URL"
}

# 运行主函数
main "$@"
