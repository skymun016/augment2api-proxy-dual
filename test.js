// Cloudflare Workers 本地测试脚本

// 测试配置
const TEST_CONFIG = {
  BASE_URL: 'http://localhost:8787', // Wrangler dev 默认地址
  UNIFIED_TOKEN: 'your-unified-token-here',
  ACCESS_PWD: 'admin-password-123'
};

// 测试用例
const tests = [
  {
    name: '管理界面访问',
    method: 'GET',
    path: '/',
    expectedStatus: 200,
    expectedContentType: 'text/html'
  },
  {
    name: '管理员登录',
    method: 'POST',
    path: '/api/login',
    body: { password: TEST_CONFIG.ACCESS_PWD },
    expectedStatus: 200,
    expectedBody: { success: true }
  },
  {
    name: '模型列表接口',
    method: 'GET',
    path: '/v1/models',
    headers: { 'Authorization': `Bearer ${TEST_CONFIG.UNIFIED_TOKEN}` },
    expectedStatus: 200,
    expectedBody: { object: 'list' }
  },
  {
    name: '聊天接口认证测试',
    method: 'POST',
    path: '/v1/chat/completions',
    headers: { 'Authorization': `Bearer ${TEST_CONFIG.UNIFIED_TOKEN}` },
    body: {
      model: 'claude-3.7-chat',
      messages: [{ role: 'user', content: 'test' }]
    },
    expectedStatus: [200, 503], // 503 表示无可用token，这是正常的
  },
  {
    name: '无效Token测试',
    method: 'POST',
    path: '/v1/chat/completions',
    headers: { 'Authorization': 'Bearer invalid-token' },
    body: {
      model: 'claude-3.7-chat',
      messages: [{ role: 'user', content: 'test' }]
    },
    expectedStatus: 401
  }
];

// 执行测试
async function runTests() {
  console.log('🧪 开始测试 Cloudflare Workers...\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      console.log(`📋 测试: ${test.name}`);
      
      const options = {
        method: test.method,
        headers: {
          'Content-Type': 'application/json',
          ...test.headers
        }
      };
      
      if (test.body) {
        options.body = JSON.stringify(test.body);
      }
      
      const response = await fetch(`${TEST_CONFIG.BASE_URL}${test.path}`, options);
      
      // 检查状态码
      const expectedStatuses = Array.isArray(test.expectedStatus) 
        ? test.expectedStatus 
        : [test.expectedStatus];
      
      if (!expectedStatuses.includes(response.status)) {
        throw new Error(`状态码不匹配: 期望 ${test.expectedStatus}, 实际 ${response.status}`);
      }
      
      // 检查内容类型
      if (test.expectedContentType) {
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes(test.expectedContentType)) {
          throw new Error(`内容类型不匹配: 期望 ${test.expectedContentType}, 实际 ${contentType}`);
        }
      }
      
      // 检查响应体
      if (test.expectedBody) {
        const responseBody = await response.json();
        for (const key in test.expectedBody) {
          if (responseBody[key] !== test.expectedBody[key]) {
            throw new Error(`响应体不匹配: ${key} 期望 ${test.expectedBody[key]}, 实际 ${responseBody[key]}`);
          }
        }
      }
      
      console.log(`✅ 通过 (${response.status})\n`);
      passed++;
      
    } catch (error) {
      console.log(`❌ 失败: ${error.message}\n`);
      failed++;
    }
  }
  
  // 输出测试结果
  console.log('📊 测试结果:');
  console.log(`✅ 通过: ${passed}`);
  console.log(`❌ 失败: ${failed}`);
  console.log(`📈 成功率: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 所有测试通过！');
  } else {
    console.log('\n⚠️  部分测试失败，请检查配置');
  }
}

// 检查环境
async function checkEnvironment() {
  console.log('🔍 检查测试环境...\n');
  
  try {
    const response = await fetch(TEST_CONFIG.BASE_URL);
    if (response.status === 200) {
      console.log('✅ Wrangler dev 服务正在运行');
    } else {
      console.log('⚠️  Wrangler dev 服务状态异常');
    }
  } catch (error) {
    console.log('❌ 无法连接到 Wrangler dev 服务');
    console.log('请先运行: wrangler dev');
    process.exit(1);
  }
  
  console.log(`📍 测试地址: ${TEST_CONFIG.BASE_URL}`);
  console.log(`🔑 统一Token: ${TEST_CONFIG.UNIFIED_TOKEN}`);
  console.log(`🔐 管理密码: ${TEST_CONFIG.ACCESS_PWD}\n`);
}

// 主函数
async function main() {
  console.log('🌐 Augment2Api Cloudflare Workers 测试工具\n');
  
  await checkEnvironment();
  await runTests();
}

// 运行测试
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runTests, checkEnvironment };
} else {
  main().catch(console.error);
}
