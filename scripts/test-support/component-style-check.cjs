'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

// Components named by the device log. Include imported sheets in the compiler check.
const components = [
  'projects/crun/cmpts/deadline_picker/deadline_picker',
  'cmpts/public/img/img_upload_cmpt',
  'cmpts/public/rows/rows_cmpt',
  'projects/crun/cmpts/campus_selector/campus_selector',
  'cmpts/public/car_number/car_number_cmpt',
  'projects/crun/pages/mail/add/mail_add_embedded',
  'custom-tab-bar/index'
];

function diagnostics(compiler, mini) {
  return components.map(base => {
    const files = new Set();
    function include(file) {
      if (files.has(file)) return;
      files.add(file);
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/@import\s+["']([^"']+)["']/g)) {
        include(match[1].startsWith('/') ? path.join(mini, match[1]) : path.resolve(path.dirname(file), match[1]));
      }
    }
    include(path.join(mini, base + '.wxss'));
    const sources = [...files].map(file => './' + path.relative(mini, file).replaceAll('\\', '/'));
    const result = spawnSync(compiler, ['-js', '-pc', '1', ...sources], {
      cwd: mini, encoding: 'utf8', windowsHide: true, maxBuffer: 15 * 1024 * 1024, timeout: 30000
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, base + ' WXSS 编译失败：' + result.stderr);
    // WCSC's -pc format is name=escaped-JS pairs. '=' inside JavaScript is hex-escaped.
    const chunks = result.stdout.split('='), calls = [];
    assert.equal(chunks[0], 'version', '未知 WCSC 输出格式');
    for (let index = 0; index + 1 < chunks.length; index += 2) {
      if (!chunks[index + 1].startsWith('setCssToHead(')) continue;
      const code = vm.runInNewContext('"' + chunks[index + 1] + '"', {}, { timeout: 1000 });
      vm.runInNewContext(code, { setCssToHead(css, invalid, info) {
        calls.push({ invalid, path: info && info.path }); return () => {};
      } }, { timeout: 1000 });
    }
    const root = calls.find(call => call.path === sources[0]);
    assert.ok(root, base + ' 缺少组件样式编译结果');
    return { component: base, sourceFiles: files.size, invalid: root.invalid || null };
  });
}

function check(compiler, mini) {
  const results = diagnostics(compiler, mini);
  for (const result of results) assert.equal(result.invalid, null, result.component + ': ' + result.invalid);
  console.log('组件 WXSS 检查通过：' + results.length + ' 个日志涉及组件及其导入样式，无非法选择器。');
  return results;
}
module.exports = { components, diagnostics, check };
