#!/usr/bin/env node
/**
 * 微信支付与订单发布 - 文档索引
 * 
 * 使用本索引快速找到所需的文档和代码
 */

const docs = {
  // ============ 快速导航 ============
  quick: {
    title: "🚀 快速开始",
    description: "如果你只有 5 分钟",
    files: [
      {
        name: "README_PAYMENT.md",
        description: "总目录，包含所有文档导航",
        readingTime: "5 分钟",
        bestFor: ["所有人"]
      },
      {
        name: "PAYMENT_QUICK_START.md",
        description: "快速启动指南，包含 3 步验证",
        readingTime: "10 分钟",
        bestFor: ["开发者", "测试", "管理"]
      }
    ]
  },

  // ============ 详细文档 ============
  detailed: {
    title: "📚 详细文档",
    description: "深入理解系统实现",
    files: [
      {
        name: "PAYMENT_ARCHITECTURE.md",
        description: "系统架构、流程图、数据结构",
        readingTime: "15-20 分钟",
        bestFor: ["后端开发", "架构师", "系统设计"],
        topics: [
          "系统架构图",
          "支付流程时序图",
          "数据库表结构",
          "错误处理流程",
          "并发安全分析",
          "监控指标"
        ]
      },
      {
        name: "PAYMENT_PUBLISH_ANALYSIS.md",
        description: "完整的功能分析，包含代码解析",
        readingTime: "30-40 分钟",
        bestFor: ["代码审查", "全面评估", "深度学习"],
        topics: [
          "支付模块架构",
          "支付流程详解",
          "订单发布流程",
          "异常场景处理",
          "关键代码路径",
          "当前限制"
        ]
      },
      {
        name: "PAYMENT_TEST_SUMMARY.md",
        description: "测试结果和部署检查清单",
        readingTime: "20-30 分钟",
        bestFor: ["QA", "部署经理", "项目经理"],
        topics: [
          "检查清单",
          "业务流程验证",
          "安全性验证",
          "性能考量",
          "部署清单",
          "已知限制"
        ]
      }
    ]
  },

  // ============ 测试 ============
  testing: {
    title: "🧪 测试",
    description: "自动化测试用例",
    files: [
      {
        name: "scripts/tests/wechat-payment.test.js",
        description: "现有的支付测试（支付结果查询、状态转换）",
        testCount: 4,
        bestFor: ["验证支付查询逻辑"],
        command: "npm test -- ../../scripts/tests/wechat-payment.test.js"
      },
      {
        name: "scripts/tests/payment-publish-flow.test.js",
        description: "新增的完整流程测试（支付+发布）",
        testCount: 9,
        bestFor: ["验证完整业务流程"],
        command: "npm test -- ../../scripts/tests/payment-publish-flow.test.js",
        tests: [
          "支付模块已正确启用",
          "支付配置包含必要的字段",
          "支付准备流程返回正确的结构",
          "支付结果查询能正确处理支付成功状态",
          "并发支付场景下订单发布仅执行一次",
          "支付失败情况下订单不发布",
          "支付订单号应该保持唯一",
          "支付模式为非微信时不应该调用微信支付",
          "金额和费用计算正确"
        ]
      }
    ]
  },

  // ============ 源代码 ============
  source: {
    title: "💻 源代码",
    description: "关键实现文件",
    files: [
      {
        name: "cloudfunctions/mcloud/project/crun/service/payment_service.js",
        description: "支付业务逻辑核心",
        lines: 297,
        keyMethods: [
          "enabled() - 检查支付是否启用",
          "prepare(userId, id) - 支付准备",
          "status(userId, id) - 获取支付状态",
          "reconcile(outTradeNo) - 支付查询&发布",
          "refund(payment, row) - 自动退款",
          "sweep() - 后台扫描",
          "callback(event) - 回调处理"
        ]
      },
      {
        name: "cloudfunctions/mcloud/project/crun/config/pay_config.js",
        description: "支付配置文件",
        lines: 20,
        configs: [
          "appid - 微信 App ID",
          "mchid - 商户号",
          "key - APIv3 密钥",
          "notifyUrl - 回调地址",
          "callbackFunction - 回调函数"
        ]
      },
      {
        name: "cloudfunctions/mcloud/project/crun/service/mail_service.js",
        description: "订单管理（包含发布逻辑）",
        lines: 492,
        relatedMethods: [
          "_record(tx, mail, ...) - 记录订单事件（支付成功时调用）",
          "_quota(tx, userId, role, ...) - 管理发布配额"
        ]
      }
    ]
  },

  // ============ 快速参考 ============
  reference: {
    title: "📖 快速参考",
    description: "关键概念和命令",
    concepts: {
      "订单状态": {
        "-1": "待支付（编辑中）",
        "0": "等待接单（已发布）← 支付成功自动转换到这里",
        "1": "已接单",
        "4": "已取件",
        "2": "待确认",
        "9": "已完成",
        "99": "已取消"
      },
      "支付状态": {
        "0": "未支付",
        "1": "已支付",
        "2": "已退款"
      },
      "支付记录状态": {
        "pending": "等待支付",
        "paid": "已支付",
        "refunded": "已退款",
        "complete": "已完成",
        "closed": "已关闭"
      }
    },
    commands: {
      "进入云函数": "cd cloudfunctions/mcloud",
      "安装依赖": "npm.cmd ci --ignore-scripts --no-audit --no-fund",
      "运行支付测试": "npm test -- ../../scripts/tests/wechat-payment.test.js",
      "运行新增测试": "npm test -- ../../scripts/tests/payment-publish-flow.test.js",
      "查看配置": "cat project/crun/config/pay_config.js"
    }
  },

  // ============ 常见问题 ============
  faq: {
    title: "❓ 常见问题",
    description: "快速答案",
    questions: [
      {
        q: "系统能实现微信支付并发布订单吗？",
        a: "✅ 可以。支付成功后会自动发布订单（状态转换：-1 → 0），对骑手可见。"
      },
      {
        q: "支付完成后多久发布订单？",
        a: "即时发布。reconcile() 验证成功后立即更新订单状态并发送通知。"
      },
      {
        q: "支付失败的订单会怎样？",
        a: "订单保持待支付状态，用户可重新支付。系统会自动重试查询。"
      },
      {
        q: "已支付的订单被取消，费用怎么处理？",
        a: "系统自动触发退款，费用退回到原支付账户。"
      },
      {
        q: "并发支付同一订单会发生什么？",
        a: "事务机制保证只发布一次，幂等性设计确保多次查询无害。"
      },
      {
        q: "支付金额与订单金额不一致怎么办？",
        a: "系统验证失败，抛出 PAYMENT_MISMATCH 错误，订单不发布。"
      },
      {
        q: "我应该读哪个文档？",
        a: "查看 README_PAYMENT.md 中的'按角色查看指南'找到适合你的文档。"
      }
    ]
  }
};

// ============ 打印索引 ============
function printIndex() {
  console.log("\n" + "=".repeat(70));
  console.log("   微信支付与订单发布 - 文档索引");
  console.log("=".repeat(70) + "\n");

  // 快速导航
  console.log(`\n${docs.quick.title} ${docs.quick.description}`);
  console.log("-".repeat(70));
  docs.quick.files.forEach(f => {
    console.log(`
  📄 ${f.name}
     ${f.description}
     ⏱️  ${f.readingTime} | 👥 ${f.bestFor.join(", ")}`);
  });

  // 详细文档
  console.log(`\n\n${docs.detailed.title} ${docs.detailed.description}`);
  console.log("-".repeat(70));
  docs.detailed.files.forEach(f => {
    console.log(`
  📚 ${f.name}
     ${f.description}
     ⏱️  ${f.readingTime} | 👥 ${f.bestFor.join(", ")}
     Topics: ${f.topics.join(", ")}`);
  });

  // 测试
  console.log(`\n\n${docs.testing.title} ${docs.testing.description}`);
  console.log("-".repeat(70));
  docs.testing.files.forEach(f => {
    console.log(`
  🧪 ${f.name}
     ${f.description}
     Tests: ${f.testCount} | Best for: ${f.bestFor[0]}
     Run: ${f.command}`);
  });

  // 源代码
  console.log(`\n\n${docs.source.title} ${docs.source.description}`);
  console.log("-".repeat(70));
  docs.source.files.forEach(f => {
    console.log(`
  💻 ${f.name}
     ${f.description}
     Lines: ${f.lines}`);
    if (f.keyMethods) {
      console.log(`     Methods: ${f.keyMethods.slice(0, 3).map(m => m.split(" ")[0]).join(", ")}...`);
    }
    if (f.relatedMethods) {
      console.log(`     Related: ${f.relatedMethods.slice(0, 2).map(m => m.split(" ")[0]).join(", ")}...`);
    }
  });

  // 快速参考
  console.log(`\n\n${docs.reference.title} ${docs.reference.description}`);
  console.log("-".repeat(70));
  console.log("\n  📋 订单状态：");
  Object.entries(docs.reference.concepts["订单状态"]).forEach(([k, v]) => {
    console.log(`     ${k}: ${v}`);
  });

  console.log("\n  💾 支付状态：");
  Object.entries(docs.reference.concepts["支付状态"]).forEach(([k, v]) => {
    console.log(`     ${k}: ${v}`);
  });

  console.log("\n  🔧 常用命令：");
  Object.entries(docs.reference.commands).forEach(([k, v]) => {
    console.log(`     ${k}: ${v}`);
  });

  // 常见问题
  console.log(`\n\n${docs.faq.title} ${docs.faq.description}`);
  console.log("-".repeat(70));
  docs.faq.questions.slice(0, 5).forEach((item, i) => {
    console.log(`
  Q${i + 1}: ${item.q}
  A: ${item.a}`);
  });
  console.log(`\n  ... 还有 ${docs.faq.questions.length - 5} 个问题，见相关文档\n`);

  // 页脚
  console.log("\n" + "=".repeat(70));
  console.log("  🚀 快速开始：打开 README_PAYMENT.md");
  console.log("  📚 查看所有文档：查看 README_PAYMENT.md 的文档导航");
  console.log("=".repeat(70) + "\n");
}

// 如果直接运行此文件
if (require.main === module) {
  printIndex();
}

module.exports = docs;
