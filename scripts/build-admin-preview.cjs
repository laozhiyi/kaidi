'use strict';
// The preview is built from the actual page scripts, WXML and WXSS. Its data
// adapter is local to the preview; production pages never import it.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { harness, mini } = require('./test-support/admin-console-harness.cjs');
const compiler = process.env.WCC_PATH || 'B:/school/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe';
const keys = ['home', 'orders', 'order', 'feedback', 'feedbackDetail', 'users', 'user', 'settings', 'service', 'pricing', 'rules', 'analytics', 'monitor', 'export', 'userExport'];
const routes = harness('index/home/admin_home.js').UI.ROUTES;
const sources = new Set();
function addTemplate(file) {
  if (sources.has(file)) return;
  sources.add(file);
  const source = fs.readFileSync(path.join(mini, file), 'utf8');
  for (const m of source.matchAll(/<(?:import|include|wxs)\b[^>]*\bsrc="([^"]+)"/g)) addTemplate(path.relative(mini, path.resolve(mini, path.dirname(file), m[1])).split(path.sep).join('/'));
}
for (const key of keys) addTemplate(routes[key].slice(1) + '.wxml');
addTemplate('projects/crun/cmpts/admin_nav/admin_nav.wxml');
const compiled = spawnSync(compiler, ['-d', ...[...sources].map(file => './' + file)], { cwd: mini, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, windowsHide: true, timeout: 30000 });
if (compiled.error || compiled.status) throw compiled.error || new Error(compiled.stderr);
if (process.argv.includes('--inspect')) {
  const context = vm.createContext({ window: {}, console });
  vm.runInContext(compiled.stdout, context);
  const h = harness('index/home/admin_home.js');
  const tree = context.$gwx('.' + routes.home + '.wxml')({ ...h.page.data, isAdmin: true, isSuperAdmin: true, admin: { name: '运营管理员' }, config: { enabled: true }, overview: { total: 8, todayOrders: 8, todayCompleted: 2, active: 6, users: 4, exceptions: 1, complaints: 2, overdue: 1 } }, {}, {});
  console.log(JSON.stringify({ compilerBytes: Buffer.byteLength(compiled.stdout), tree }, null, 2).slice(0, 18000));
  process.exit(0);
}
const previewDir = path.join(__dirname, 'preview');
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
if (!output) throw new Error('Specify --output=<absolute path to admin-console-preview.html>');
const moduleFiles = [...keys.map(key => routes[key].slice(1) + '.js'),
  'projects/crun/biz/admin_console_biz.js', 'projects/crun/biz/admin_settings_biz.js',
  'projects/crun/biz/admin_export_biz.js', 'projects/crun/cmpts/admin_nav/admin_nav.js'];
const factories = moduleFiles.map(file => JSON.stringify('/' + file) + ': function(module, exports, require, Page, Component, wx, getCurrentPages) {\n' + fs.readFileSync(path.join(mini, file), 'utf8') + '\n}').join(',\n');
const pages = Object.fromEntries(keys.map(key => [key, {
  route: routes[key], title: JSON.parse(fs.readFileSync(path.join(mini, routes[key].slice(1) + '.json'), 'utf8')).navigationBarTitleText || '管理后台'
}]));
function stylesheet(file, seen = new Set()) {
  if (seen.has(file)) return '';
  seen.add(file);
  return fs.readFileSync(file, 'utf8').replace(/@import\s+['"]([^'"]+)['"];?/g, (_, imported) => stylesheet(path.resolve(path.dirname(file), imported), seen));
}
function themeColors(declarations) {
  const textDark = { '#21304a': '#e5eaf4', '#fff': '#ffffff', '#ffffff': '#ffffff', '#2863db': '#8cb6ff', '#718099': '#a4b1c6' };
  return declarations.replace(/([\w-]+)\s*:\s*([^;{}]+)/g, (_, property, value) => property + ': ' + value.replace(/#[0-9a-f]{3,8}\b/gi, hex => {
    const normalized = hex.toLowerCase();
    const isText = property === 'color';
    let dark = isText ? textDark[normalized] : null;
    if (!dark) {
      let raw = normalized.slice(1);
      if (raw.length === 3) raw = [...raw].map(c => c + c).join('');
      const rgb = [0, 2, 4].map(i => parseInt(raw.slice(i, i + 2), 16));
      const brightness = Math.max(...rgb) / 255;
      if (isText) dark = brightness < .75 ? '#b3c3dd' : '#d4def0';
      else if (property.startsWith('border')) dark = brightness > .75 ? '#2a374c' : hex;
      else if (brightness > .88) dark = (rgb[0] - rgb[2] > 12) ? '#382d25' : (rgb[1] - rgb[0] > 5) ? '#18352e' : normalized === '#fff' || normalized === '#ffffff' ? '#192333' : '#121d2c';
      else dark = hex;
    }
    return 'light-dark(' + hex + ', ' + dark + ')';
  }).replace(/rgba\(([^)]+)\)/g, 'light-dark(rgba($1), rgba(0,0,0,.15))'));
}
function scopeCss(css, scope) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(-?[\d.]+)rpx\b/g, (_, n) => Number(n) / 2 + 'px');
  function parse(source) {
    let out = '', cursor = 0;
    while (cursor < source.length) {
      const open = source.indexOf('{', cursor);
      if (open < 0) break;
      let depth = 1, end = open + 1;
      while (end < source.length && depth) { if (source[end] === '{') depth++; if (source[end] === '}') depth--; end++; }
      const selector = source.slice(cursor, open).trim(), body = source.slice(open + 1, end - 1);
      if (selector.startsWith('@')) out += selector.replace('@media', '@container admin-preview') + ' {\n' + parse(body) + '}\n';
      else {
        const scoped = selector.split(',').map(part => scope + ' ' + part.trim().replace(/(^|[\s>+~])(view|text|button|input|textarea|page|image|picker|switch|scroll-view)(?=[\s>+~:.\[#]|$)/g, '$1[data-wx-tag="$2"]')).join(', ');
        out += scoped + ' {' + themeColors(body) + '}\n';
      }
      cursor = end;
    }
    return out;
  }
  return parse(css);
}
const scope = '#admin-console-live-preview';
const styles = keys.map(key => scopeCss(stylesheet(path.join(mini, routes[key].slice(1) + '.wxss')), scope + ' [data-page-key="' + key + '"]')).join('\n') + scopeCss(stylesheet(path.join(mini, 'projects/crun/cmpts/admin_nav/admin_nav.wxss')), scope);
const replacements = {
  '/*__STYLES__*/': styles,
  '/*__COMPILED__*/': compiled.stdout,
  '/*__MODULES__*/': 'const factories = {\n' + factories + '\n};\nconst previewPages = ' + JSON.stringify(pages) + ';',
  '/*__ADAPTER__*/': fs.readFileSync(path.join(previewDir, 'admin-console-data.js'), 'utf8'),
  '/*__RUNTIME__*/': fs.readFileSync(path.join(previewDir, 'admin-console-runtime.js'), 'utf8')
};
let html = fs.readFileSync(path.join(previewDir, 'admin-console.template.html'), 'utf8');
for (const [marker, replacement] of Object.entries(replacements)) {
  if (!html.includes(marker)) throw new Error('Missing template marker: ' + marker);
  html = html.replace(marker, () => replacement);
}
if (Buffer.byteLength(html) >= 1024 * 1024) throw new Error('Preview must remain under 1 MB');
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, html);
console.log(JSON.stringify({ output: path.resolve(output), pages: keys.length, bytes: Buffer.byteLength(html), compiledTemplates: sources.size }));
