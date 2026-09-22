'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { runMiniProgram } = require('./test-support/miniprogram-module.cjs');
const workspace = path.resolve(__dirname, '..');
const mini = path.join(workspace, 'miniprogram');
const read = file => fs.readFileSync(file, 'utf8');
const slash = file => file.split(path.sep).join('/');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
function localTarget(file, reference) {
  return reference.startsWith('/') ? path.join(mini, reference) : path.resolve(path.dirname(file), reference);
}
function audit() {
  const app = JSON.parse(read(path.join(mini, 'app.json')));
  const project = JSON.parse(read(path.join(workspace, 'project.config.json')));
  assert.equal(path.resolve(workspace, project.miniprogramRoot), mini, '开发者工具必须使用正确的小程序根目录');
  const pages = app.pages.concat((app.subPackages || app.subpackages || []).flatMap(pkg => pkg.pages.map(page => pkg.root + '/' + page)));
  const registered = new Set(pages);
  assert.equal(registered.size, pages.length, 'app.json 中不能重复注册页面');
  for (const route of pages) {
    for (const ext of ['js', 'json', 'wxml', 'wxss']) {
      assert.ok(fs.existsSync(path.join(mini, route + '.' + ext)), '页面文件缺失：' + route + '.' + ext);
    }
  }
  for (const tab of app.tabBar.list) assert.ok(registered.has(tab.pagePath), '未注册的 tabBar：' + tab.pagePath);
  const files = walk(mini);
  for (const file of files) {
    const relative = slash(path.relative(mini, file));
    if (file.endsWith('.json')) {
      const config = JSON.parse(read(file));
      for (const component of Object.values(config.usingComponents || {})) {
        if (/^(plugin|dynamicLib):/.test(component)) continue;
        let target = localTarget(file, component);
        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index');
        for (const ext of ['js', 'json', 'wxml']) assert.ok(fs.existsSync(target + '.' + ext), relative + ' 缺少组件：' + component + '.' + ext);
      }
    }
    if (/\.(wxml|wxss)$/.test(file)) {
      const regex = file.endsWith('.wxml')
        ? /<(?:import|include|wxs)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/g
        : /@import\s+["']([^"']+)["']/g;
      for (const match of read(file).matchAll(regex)) {
        if (!match[1].includes('{{')) assert.ok(fs.existsSync(localTarget(file, match[1])), relative + ' 缺少模板/样式：' + match[1]);
      }
    }
    if (file.endsWith('.js') && /\bPage\s*\(/.test(read(file))) {
      assert.ok(registered.has(relative.slice(0, -3)), 'Page 未注册：' + relative);
    }
    if (/\.(js|wxml)$/.test(file)) {
      // 校验静态导航，动态模板和业务字段由页面交互测试覆盖。
      const source = read(file);
      const urls = [...source.matchAll(/['"](\/projects\/crun\/pages\/[^'"?+\s]+)(?:\?[^'"]*)?['"]/g)].map(m => m[1]);
      if (file.endsWith('.wxml') && registered.has(relative.slice(0, -5))) {
        for (const match of source.matchAll(/data-url\s*=\s*['"]([^'"]+)['"]/g)) {
          if (/^\.{1,2}\//.test(match[1])) urls.push(match[1].split('?')[0]);
        }
      }
      for (const url of urls) {
        // Directory constants used to construct routes are not navigation targets.
        if (file.endsWith('.js') && url.endsWith('/')) continue;
        if (url.includes('{{') || /\.(png|jpg|jpeg|gif|webp|js|wxml)$/.test(url)) continue;
        const route = slash(path.relative(mini, localTarget(file, url)));
        assert.ok(registered.has(route), relative + ' 引用了未注册页面：' + url);
      }
    }
  }
  return { pages: pages.length, templates: files.filter(f => f.endsWith('.wxml')).length, files };
}
function smokeRender(code) {
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(code, context, { timeout: 5000 });
  const config = { campuses: ['东校区'], smallPrice: 1.5, maxActiveOrders: 3, deliveryMinutes: 60, urgentMinutes: 30 };
  const order = { _id: 'order', MAIL_ID: 'order-no', status: '待接单', MAIL_STATUS: 0, MAIL_PAYMENT_MODE: 'offline', MAIL_OBJ: { title: '快递代取', campus: '东校区', price: 1.5 }, MAIL_MEDIA: {}, MAIL_HISTORY: [] };
  const scenarios = [
    ['operations/operations', {}, '暂无消息'],
    ['operations/operations', { error: true }, '加载失败'],
    ['operations/operations', { list: [{ _id: 'n', title: '订单已接取', content: '请等待配送', read: false }] }, '订单已接取'],
    ['admin/index/home/admin_home', { loading: false, overview: { todayOrders: 1, rows: [] } }, '待办事项'],
    ['admin/operations/admin_operations', {}, '正在打开管理页面'],
    ['admin/orders/list/admin_order_list', { list: [order] }, '导出订单'],
    ['admin/orders/detail/admin_order_detail', { detail: { ...order, history: [], canProcess: true } }, '人工介入'],
    ['admin/orders/detail/admin_order_detail', { detail: null, notFound: true }, '订单不存在'],
    ['admin/feedback/list/admin_feedback_list', { loading: false, list: [] }, '暂无符合条件的反馈'],
    ['admin/feedback/detail/admin_feedback_detail', { detail: { _id: 'fb', FB_TITLE: '反馈内容', FB_CONTENT: '请协助处理', history: [] } }, '提交处理结果'],
    ['admin/user/list/admin_user_list', { list: [] }, '用户管理'],
    ['admin/user/detail/admin_user_detail', { user: { USER_STATUS: 0, USER_NAME: '小陈', USER_FORMS: [] } }, '审核通过'],
    ['admin/settings/index/admin_settings', {}, '业务与系统管理'],
    ['admin/settings/service/admin_service_settings', { config, isSuperAdmin: false }, '当前为只读模式'],
    ['admin/settings/pricing/admin_pricing_settings', { config, isSuperAdmin: false }, '当前为只读模式'],
    ['admin/settings/rules/admin_rules_settings', { config, isSuperAdmin: false }, '当前为只读模式'],
    ['admin/analytics/admin_analytics', { overview: { total: 0, rows: [] } }, '订单状态分布'],
    ['admin/monitor/admin_monitor', { isSuperAdmin: false }, '执行维护需要超级管理员权限'],
    ['about/index/about_index', { loading: false, about: [] }, '联系校区客服'],
    ['admin/tenants/admin_tenants', { loading: true }, '正在加载'],
    ['admin/tenants/admin_tenants', { school: {schoolId:'school_a',name:'学校 A',version:1}, campusLoading:true }, '正在加载地点'],
    ['admin/tenants/admin_tenants', { school: {schoolId:'school_a',name:'学校 A',version:1}, campusError:'地点读取失败' }, '重试地点加载'],
    ['admin/tenants/admin_tenants', { admins:[{_id:'admin',name:'校区管理员'}],adminError:'授权读取失败' }, '重试授权加载']
  ];
  for (const [pagePath, patch, expected] of scenarios) {
    const base = 'projects/crun/pages/' + pagePath;
    let page;
    runMiniProgram(path.join(mini, base + '.js'), { Page: p => { page = p; }, require: () => ({}) });
    const render = context.$gwx('./' + base + '.wxml');
    assert.equal(typeof render, 'function', base + ' 未生成渲染函数');
    const data = { ...page.data, isAdmin: true, isSuperAdmin: true, ...patch };
    const tree = render(data, {}, {});
    const content = JSON.stringify(tree);
    assert.ok(content.includes(expected), base + ' 渲染结果缺少：' + expected);
    if (patch.detail) assert.ok(!content.includes('点击记录查看详情并处理'), '详情模式不应仍展示列表');
    if (patch.config && patch.isSuperAdmin === false) assert.ok(!content.includes('保存设置'), '只读模式不应展示保存按钮');
  }
  const receiptFixtures = require('./test-support/order-receipt-fixtures.cjs'), receiptCases = receiptFixtures.scenarios();
  const nodeText = node => node == null ? '' : typeof node === 'object' ? (node.children || []).map(nodeText).join('') : String(node);
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(nodes)];
  const hasClass = (node, name) => String(node.attr && node.attr.class || '').split(/\s+/).includes(name);
  function buttons(node) {
    if (!node || typeof node !== 'object') return [];
    return (node.tag === 'wx-button' ? [node] : []).concat((node.children || []).flatMap(buttons));
  }
  for (const fixture of receiptCases) {
    const tree = context.$gwx('./' + fixture.base + '.wxml')(receiptFixtures.pageState(fixture), {}, {});
    const content = JSON.stringify(tree), controls = buttons(tree);
    const receiptButtons = controls.filter(button => nodeText(button) === '确认收货');
    assert.equal(receiptButtons.length, fixture.receiptExpected ? 1 : 0, fixture.title + ' 收货按钮可见性错误');
    if (fixture.receiptExpected) {
      assert.ok(!receiptButtons[0].attr.disabled, fixture.title + ' 收货入口应可点击查看状态');
      assert.equal(receiptButtons[0].attr[fixture.isList ? 'catchtap' : 'bindtap'], fixture.isList ? 'bindConfirmReceiptTap' : 'bindReceiptTap');
      assert.ok(content.includes(require('../miniprogram/projects/crun/biz/mail_ui_biz.js').receipt(fixture.mail).hint), fixture.title + ' 缺少收货状态说明');
    }
    if (fixture.editExpected) assert.ok(controls.some(button => nodeText(button) === '编辑订单'), '待接单详情仍应支持编辑订单');
    if (fixture.isList) assert.ok(!content.includes('线下结算'), '我的发布卡片应使用收货操作入口');
  }
  const mailCases = require('./test-support/mail-ui-fixtures.cjs').scenarios();
  for (const fixture of mailCases) {
    const base = 'projects/crun/pages/mail/' + fixture.page;
    let page;
    runMiniProgram(path.join(mini, base + '.js'), { Page: p => { page = p; }, require: () => ({}) });
    const render = context.$gwx('./' + base + '.wxml');
    const tree = render({ ...page.data, ...fixture.data }, {}, {}), elements = nodes(tree);
    const content = JSON.stringify(tree);
    assert.ok(content.includes(fixture.expected), fixture.name + ' 缺少预期状态：' + fixture.expected);
    if (fixture.progressExpected) {
      const expected = fixture.progressExpected, steps = elements.filter(node => hasClass(node, 'od-step'));
      assert.deepEqual(steps.map(node => nodeText(nodes(node).find(child => hasClass(child, 'od-step-label')))), expected.labels, fixture.name + ' 进度节点文案错误');
      assert.deepEqual(steps.map(node => hasClass(node, 'od-step-done')), expected.done, fixture.name + ' 错误点亮未发生的节点');
      assert.deepEqual(steps.map(node => hasClass(node, 'od-step-current')), expected.done.map((_, index) => index === expected.current), fixture.name + ' 当前节点错误');
      assert.deepEqual(steps.map(node => hasClass(node, 'od-step-connected')), expected.done.map((done, index) => index > 0 && done && expected.done[index - 1]), fixture.name + ' 不得连接未发生的步骤');
      for (const index of expected.unrecorded || []) assert.ok(nodeText(steps[index]).includes('未记录'), fixture.name + ' 缺少历史记录说明');
    }
    for (const [title, count] of Object.entries(fixture.sectionCounts || {})) {
      assert.equal(elements.filter(node => hasClass(node, 'od-section-title') && nodeText(node) === title).length, count, fixture.name + ' 内容区数量错误：' + title);
    }
    for (const value of fixture.present || []) assert.ok(content.includes(value), fixture.name + ' 缺少应展示的内容：' + value);
    for (const value of fixture.absent || []) assert.ok(!content.includes(value), fixture.name + ' 泄露/展示了不应出现的内容：' + value);
  }
  const reputationCases = require('./test-support/favorites-reputation-fixtures.cjs').scenarios();
  const packageFixtures = require('./test-support/package-pickup-fixtures.cjs');
  const packageCases = packageFixtures.scenarios();
  for (const fixture of packageCases) {
    const content = JSON.stringify(context.$gwx('./' + fixture.base + '.wxml')(packageFixtures.pageState(fixture), {}, {}));
    for (const value of [fixture.expected, ...(fixture.present || [])]) assert.ok(content.includes(value), fixture.title + ' 缺少：' + value);
    for (const value of fixture.absent || []) assert.ok(!content.includes(value), fixture.title + ' 不应展示：' + value);
  }
  for (const fixture of reputationCases) {
    const base = 'projects/crun/pages/' + fixture.page;
    let page;
    vm.runInNewContext(read(path.join(mini, base + '.js')), { Page: value => { page = value; }, require: () => ({}) });
    const render = context.$gwx('./' + base + '.wxml');
    const content = JSON.stringify(render({ ...page.data, ...fixture.data }, {}, {}));
    assert.ok(content.includes(fixture.expected), fixture.page + ' 渲染结果缺少：' + fixture.expected);
    for (const hidden of fixture.absent || []) assert.ok(!content.includes(hidden), fixture.page + ' 不应展示：' + hidden);
  }
  const adminLayouts = require('./test-support/admin-layout-fixtures.cjs');
  const adminCases = adminLayouts.scenarios();
  for (const fixture of adminCases) {
    const base = 'projects/crun/pages/admin/' + fixture.page;
    const render = context.$gwx('./' + base + '.wxml');
    const content = JSON.stringify(render(adminLayouts.pageState(fixture), {}, {}));
    assert.ok(content.includes(fixture.expected), fixture.title + ' 渲染结果缺少：' + fixture.expected);
  }
  const notificationLayouts = require('./test-support/notification-layout-fixtures.cjs');
  const notificationCases = notificationLayouts.scenarios();
  for (const fixture of notificationCases) {
    const render = context.$gwx('./' + fixture.base + '.wxml');
    const content = JSON.stringify(render(notificationLayouts.pageState(fixture), {}, {}));
    assert.ok(content.includes(fixture.expected), fixture.title + ' 渲染结果缺少：' + fixture.expected);
  }
  const loginLayouts = require('./test-support/wechat-login-layout-fixtures.cjs');
  const loginCases = loginLayouts.scenarios();
  for (const fixture of loginCases) {
    const data = loginLayouts.pageState(fixture);
    const tree = context.$gwx('./' + fixture.base + '.wxml')(data, {}, {});
    const content = JSON.stringify(tree), controls = buttons(tree), elements = nodes(tree);
    assert.ok(content.includes(fixture.expected), fixture.title + ' 缺少：' + fixture.expected);
    for (const value of fixture.absent || []) assert.ok(!content.includes(value), fixture.title + ' 不应展示：' + value);
    if (fixture.login) {
      const phone = controls.find(button => button.attr.bindgetphonenumber === 'bindWechatLogin');
      assert.equal(phone && phone.attr.openType, 'getPhoneNumber', fixture.title + ' 必须使用微信手机号授权');
      assert.equal(!!phone.attr.disabled, !!data.phoneAuthorizing);
      assert.ok(!elements.some(node => node.tag === 'wx-input'), '授权前不展示手填注册表');
      assert.equal(controls.some(button => button.attr.bindtap === 'bindManualRegistration'), !!fixture.manualEntry, '手填入口由服务端内测开关控制');
    }
    if (fixture.profile) {
      const inputs = elements.filter(node => node.tag === 'wx-input');
      const manual = data.manualRegistration === true;
      assert.ok(inputs.some(node => node.attr.bindinput === 'bindProfileNameInput' && node.attr.type === (manual || !data.canUseWechatNickname ? 'text' : 'nickname')), '昵称填写方式必须适配手动注册和微信能力');
      const phoneInput = inputs.find(node => node.attr.bindinput === 'bindProfileMobileInput');
      assert.equal(!!phoneInput, data.allowManualRegistration === true && !data.phoneVerified, '只有允许手填的未验证号码可编辑');
      if (phoneInput) assert.equal(phoneInput.attr.type, 'number');
      const avatar = controls.find(button => button.attr.openType === 'chooseAvatar' || button.attr.bindtap === 'bindChooseAvatar');
      assert.ok(avatar, '必须能够选择头像');
      assert.equal(avatar.attr.openType === 'chooseAvatar', !manual && data.canChooseWechatAvatar !== false, '微信头像不可用或手动模式时应支持普通图片选择');
      const phone = controls.find(button => button.attr.bindgetphonenumber === 'bindWechatPhone');
      if (data.canGetWechatPhone !== false && !phoneInput) assert.equal(phone && phone.attr.openType, 'getPhoneNumber');
      const save = controls.find(button => button.attr.bindtap === 'bindSubmitTap');
      assert.ok(save, '必须存在资料保存入口');
      assert.equal(!!save.attr.disabled, !!(data.saving || data.phoneAuthorizing));
    }
    if (fixture.route) {
      const card = elements.find(node => node.attr && node.attr.class === 'my-profile');
      assert.equal(card && card.attr['data-url'], fixture.route, fixture.title + ' 入口去向错误');
    }
  }
  const listCases = [
    [{ isTotalMenu: false, listHeight: '' }, '100vh', 0],
    [{ isTotalMenu: false, listHeight: '600rpx' }, '600rpx', 0],
    [{ isTotalMenu: true, showSearch: true }, 'calc(100vh - 110rpx)', 110],
    [{ isTotalMenu: true, showSearch: true, sortMenus: [{ label: '全部' }] }, 'calc(100vh - 190rpx)', 190],
    [{ isTotalMenu: true, showSearch: false }, 'calc(100vh - 50rpx)', 50],
    [{ isTotalMenu: true, showSearch: false, sortMenus: [{ label: '全部' }] }, 'calc(100vh - 80rpx)', 80]
  ];
  for (const [patch, height, top] of listCases) {
    const tree = context.$gwx('./cmpts/public/list/comm_list_cmpt.wxml')({ sortItems: [], sortMenus: [], ...patch }, {}, {});
    const elements = nodes(tree);
    const box = elements.find(node => node.attr && node.attr.class === 'box-list');
    assert.ok(box && box.attr.style.includes('height:' + height + ';'), '列表应保留正确高度');
    assert.ok(box.attr.style.includes('margin-top:' + top + 'rpx'), '列表应保留搜索栏占位');
    assert.equal(elements.filter(node => node.tag === 'wx-slot' && !node.attr.name).length, 1, '列表内容必须只有一个默认插槽');
  }
  console.log('WXML 渲染冒烟检查通过：' + (scenarios.length + receiptCases.length + mailCases.length + packageCases.length + reputationCases.length + adminCases.length + notificationCases.length + loginCases.length + listCases.length) + ' 个页面状态（含微信授权、强制补全资料、收货入口、公告未读、后台表单与隐私检查）。');
}
function compile(compiler, kind, files) {
  const extensions = kind === 'wxml' ? /\.(wxml|wxs)$/ : /\.wxss$/;
  const sources = files.filter(f => extensions.test(f)).map(f => './' + slash(path.relative(mini, f)));
  const args = (kind === 'wxml' ? ['-d'] : []).concat(sources);
  const result = spawnSync(compiler, args, { cwd: mini, encoding: 'utf8', maxBuffer: 40 * 1024 * 1024, windowsHide: true, timeout: 60000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, kind + ' 编译失败：' + result.stderr);
  assert.ok(result.stdout.length, kind + ' 编译器未输出任何结果');
  if (kind === 'wxml') {
    for (const route of ['projects/crun/pages/operations/operations.wxml', 'projects/crun/pages/admin/operations/admin_operations.wxml']) {
      assert.ok(result.stdout.includes(route), '编译产物中缺少：' + route);
    }
    smokeRender(result.stdout);
  }
  if (kind === 'wxss') require('./test-support/component-style-check.cjs').check(compiler, mini);
  return sources.length;
}
if (require.main === module) {
  try {
    const result = audit();
    console.log('页面检查通过：' + result.pages + ' 个页面，' + result.templates + ' 个 WXML 模板；文件、组件、导入和静态路由均有效。');
    for (const [flag, kind] of [['--wcc', 'wxml'], ['--wcsc', 'wxss']]) {
      const index = process.argv.indexOf(flag);
      if (index >= 0) {
        assert.ok(process.argv[index + 1], flag + ' 需要编译器路径');
        console.log(kind.toUpperCase() + ' 编译通过：' + compile(process.argv[index + 1], kind, result.files) + ' 个源文件。');
      }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { audit, compile };
