'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
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
    if (relative.startsWith('projects/crun/pages/') && file.endsWith('.js') && /\bPage\s*\(/.test(read(file))) {
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
    ['operations/operations', { tab: 'messages' }, '暂无消息'],
    ['operations/operations', { tab: 'messages', error: true }, '加载失败'],
    ['operations/operations', { tab: 'messages', list: [{ _id: 'n', title: '订单已接取', content: '请等待配送', read: false }] }, '订单已接取'],
    ['operations/operations', { tab: 'rider', config, user: { USER_RIDER_STATUS: 0 } }, '提交骑手申请'],
    ['operations/operations', { tab: 'rider', config, user: { USER_RIDER_STATUS: 2 } }, '申请已提交'],
    ['admin/operations/admin_operations', { tab: 'overview', overview: { waiting: 1 } }, '运营概况'],
    ['admin/operations/admin_operations', { tab: 'orders', list: [order] }, '导出订单'],
    ['admin/operations/admin_operations', { tab: 'orders', detail: order }, '订单详情'],
    ['admin/operations/admin_operations', { tab: 'riders', detail: { USER_NAME: '同学', USER_RIDER_CAMPUS: '东校区' } }, '审核通过'],
    ['admin/operations/admin_operations', { tab: 'feedback', detail: { FB_TITLE: '反馈内容', FB_CONTENT: '请协助处理' } }, '回复并处理完成'],
    ['admin/operations/admin_operations', { tab: 'config', config, isSuperAdmin: false }, '当前为只读模式'],
    ['about/index/about_index', { loading: false, about: [] }, '联系校区客服']
  ];
  for (const [pagePath, patch, expected] of scenarios) {
    const base = 'projects/crun/pages/' + pagePath;
    let page;
    vm.runInNewContext(read(path.join(mini, base + '.js')), { Page: p => { page = p; }, require: () => ({}) });
    const render = context.$gwx('./' + base + '.wxml');
    assert.equal(typeof render, 'function', base + ' 未生成渲染函数');
    const data = { ...page.data, isAdmin: true, isSuperAdmin: true, ...patch };
    const tree = render(data, {}, {});
    const content = JSON.stringify(tree);
    assert.ok(content.includes(expected), base + ' 渲染结果缺少：' + expected);
    if (patch.detail) assert.ok(!content.includes('点击记录查看详情并处理'), '详情模式不应仍展示列表');
    if (patch.tab === 'config') assert.ok(!content.includes('保存运营配置'), '只读模式不应展示保存按钮');
  }
  const mailCases = require('./test-support/mail-ui-fixtures.cjs').scenarios();
  for (const fixture of mailCases) {
    const base = 'projects/crun/pages/mail/' + fixture.page;
    let page;
    vm.runInNewContext(read(path.join(mini, base + '.js')), { Page: p => { page = p; }, require: () => ({}) });
    const render = context.$gwx('./' + base + '.wxml');
    const content = JSON.stringify(render({ ...page.data, ...fixture.data }, {}, {}));
    assert.ok(content.includes(fixture.expected), fixture.name + ' 缺少预期状态：' + fixture.expected);
    for (const value of fixture.absent || []) assert.ok(!content.includes(value), fixture.name + ' 泄露/展示了不应出现的内容：' + value);
  }
  console.log('WXML 渲染冒烟检查通过：' + (scenarios.length + mailCases.length) + ' 个页面状态（含发单、详情角色/状态与隐私检查）。');
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