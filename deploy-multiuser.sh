#!/bin/bash

# Augment2API 多用户Token池管理系统部署脚本
# 使用方法: ./deploy-multiuser.sh [environment]
# 环境选项: dev, staging, production

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查依赖
check_dependencies() {
    log_info "检查部署依赖..."
    
    if ! command -v wrangler &> /dev/null; then
        log_error "Wrangler CLI 未安装，请运行: npm install -g wrangler"
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        log_error "Node.js 未安装，请先安装 Node.js"
        exit 1
    fi
    
    log_success "依赖检查完成"
}

# 环境配置
setup_environment() {
    local env=${1:-dev}
    
    log_info "设置部署环境: $env"
    
    case $env in
        dev|development)
            ENVIRONMENT="development"
            WORKER_NAME="augment2api-proxy-multiuser-dev"
            ;;
        staging)
            ENVIRONMENT="staging"
            WORKER_NAME="augment2api-proxy-multiuser-staging"
            ;;
        prod|production)
            ENVIRONMENT="production"
            WORKER_NAME="augment2api-proxy-multiuser"
            ;;
        *)
            log_error "无效的环境: $env (支持: dev, staging, production)"
            exit 1
            ;;
    esac
    
    export ENVIRONMENT
    export WORKER_NAME
    
    log_success "环境设置完成: $ENVIRONMENT"
}

# 创建数据库
create_database() {
    log_info "创建 D1 数据库..."
    
    # 检查数据库是否已存在
    if wrangler d1 list | grep -q "augment2api-multiuser"; then
        log_warning "数据库 augment2api-multiuser 已存在"
        DB_ID=$(wrangler d1 list | grep "augment2api-multiuser" | awk '{print $2}')
    else
        log_info "创建新的 D1 数据库..."
        DB_OUTPUT=$(wrangler d1 create augment2api-multiuser)
        DB_ID=$(echo "$DB_OUTPUT" | grep -o '[a-f0-9-]\{36\}')
        
        if [ -z "$DB_ID" ]; then
            log_error "无法获取数据库 ID"
            exit 1
        fi
        
        log_success "数据库创建成功，ID: $DB_ID"
    fi
    
    # 更新 wrangler.toml 中的数据库 ID
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/database_id = \".*\"/database_id = \"$DB_ID\"/" wrangler.toml
    else
        # Linux
        sed -i "s/database_id = \".*\"/database_id = \"$DB_ID\"/" wrangler.toml
    fi
    
    log_success "数据库配置更新完成"
}

# 初始化数据库结构
init_database_schema() {
    log_info "初始化数据库结构..."
    
    if [ ! -f "schema-extended.sql" ]; then
        log_error "数据库结构文件 schema-extended.sql 不存在"
        exit 1
    fi
    
    # 执行数据库初始化
    wrangler d1 execute augment2api-multiuser --file=schema-extended.sql
    
    log_success "数据库结构初始化完成"
}

# 设置管理员账号
setup_admin_account() {
    log_info "设置管理员账号..."
    
    # 生成管理员密码哈希
    ADMIN_PASSWORD_HASH=$(node -e "
        const crypto = require('crypto');
        const password = process.env.ADMIN_PASSWORD || 'admin123';
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        console.log(hash);
    ")
    
    # 更新管理员密码
    wrangler d1 execute augment2api-multiuser --command="
        UPDATE admins 
        SET password_hash = '$ADMIN_PASSWORD_HASH' 
        WHERE username = 'admin'
    "
    
    log_success "管理员账号设置完成"
}

# 部署 Worker
deploy_worker() {
    log_info "部署 Cloudflare Worker..."
    
    # 检查必要文件
    if [ ! -f "src/worker-multiuser.js" ]; then
        log_error "Worker 文件 src/worker-multiuser.js 不存在"
        exit 1
    fi
    
    # 部署到指定环境
    if [ "$ENVIRONMENT" = "production" ]; then
        wrangler deploy --env production
    elif [ "$ENVIRONMENT" = "staging" ]; then
        wrangler deploy --env staging
    else
        wrangler deploy
    fi
    
    log_success "Worker 部署完成"
}

# 验证部署
verify_deployment() {
    log_info "验证部署状态..."
    
    # 获取 Worker URL
    WORKER_URL=$(wrangler whoami 2>/dev/null | grep "Account ID" | awk '{print $3}')
    if [ -n "$WORKER_URL" ]; then
        WORKER_URL="https://$WORKER_NAME.workers.dev"
    else
        WORKER_URL="https://$WORKER_NAME.workers.dev"
    fi
    
    log_info "Worker URL: $WORKER_URL"
    
    # 健康检查
    log_info "执行健康检查..."
    
    if curl -s "$WORKER_URL/health" | grep -q "healthy"; then
        log_success "健康检查通过"
    else
        log_warning "健康检查失败，请检查部署状态"
    fi
    
    # 显示管理面板链接
    log_info "管理面板: $WORKER_URL"
    log_info "API文档: $WORKER_URL/docs"
}

# 显示部署信息
show_deployment_info() {
    log_success "🎉 部署完成！"
    echo ""
    echo "📋 部署信息:"
    echo "   环境: $ENVIRONMENT"
    echo "   Worker: $WORKER_NAME"
    echo "   数据库: augment2api-multiuser ($DB_ID)"
    echo ""
    echo "🔗 访问链接:"
    echo "   管理面板: https://$WORKER_NAME.workers.dev"
    echo "   健康检查: https://$WORKER_NAME.workers.dev/health"
    echo "   API端点: https://$WORKER_NAME.workers.dev/api"
    echo ""
    echo "👤 默认管理员账号:"
    echo "   用户名: admin"
    echo "   密码: ${ADMIN_PASSWORD:-admin123}"
    echo ""
    echo "📚 下一步:"
    echo "   1. 访问管理面板创建用户"
    echo "   2. 添加 Augment Token 到系统"
    echo "   3. 为用户分配 Token 配额"
    echo "   4. 更新插件配置指向新的 API 端点"
}

# 主函数
main() {
    local environment=${1:-dev}
    
    echo "🚀 Augment2API 多用户Token池管理系统部署"
    echo "================================================"
    
    check_dependencies
    setup_environment "$environment"
    create_database
    init_database_schema
    setup_admin_account
    deploy_worker
    verify_deployment
    show_deployment_info
    
    log_success "部署流程完成！"
}

# 错误处理
trap 'log_error "部署过程中发生错误，请检查日志"; exit 1' ERR

# 执行主函数
main "$@"
