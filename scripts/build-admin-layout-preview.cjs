'use strict';
// Render real WCC templates and repository WXSS in a phone-sized iframe.
// This uses local fixtures; it never calls the cloud or modifies account data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { mini } = require('./test-support/admin-console-harness.cjs');
const { runMiniProgram } = require('./test-support/miniprogram-module.cjs');
const fixtureOption = process.argv.find(arg => arg.startsWith('--fixtures='))?.slice(11);
const fixtures = fixtureOption ? require(path.resolve(fixtureOption)) : require('./test-support/admin-layout-fixtures.cjs');
const compiler = process.env.WCC_PATH || 'B:/school/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec/wcc.exe';
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
if (!output) throw Error('Specify --output=<absolute path to admin-layout-preview.html>');
const cases = fixtures.scenarios(), sources = new Set(), components = {}, styles = {}, definitions = {};
const slash = value => value.split(path.sep).join('/');
const resolve = (from, to) => slash(path.relative(mini, to.startsWith('/') ? path.join(mini, to) : path.resolve(mini, path.dirname(from), to)));
const read = file => fs.readFileSync(path.join(mini, file), 'utf8');
function addTemplate(file) {
  if (sources.has(file)) return;
  sources.add(file);
  for (const match of read(file).matchAll(/<(?:include|import|wxs)\b[^>]*\bsrc=["']([^"']+)["']/g)) addTemplate(resolve(file, match[1]));
}
function addPage(base) {
  if (components[base]) return;
  addTemplate(base + '.wxml');
  const config = JSON.parse(read(base + '.json'));
  components[base] = Object.fromEntries(Object.entries(config.usingComponents || {}).map(([key, target]) => {
    let child = resolve(base + '.json', target);
    if (fs.existsSync(path.join(mini, child)) && fs.statSync(path.join(mini, child)).isDirectory()) child += '/index';
    return [key, child];
  }));
  for (const child of Object.values(components[base])) addPage(child);
}
const baseFor = fixture => fixture.base || 'projects/crun/pages/admin/' + fixture.page;
for (const fixture of cases) {
  addPage(baseFor(fixture));
  for (const extra of fixture.extras || []) addPage(baseFor(extra));
}
const compiled = spawnSync(compiler, ['-d', ...[...sources].map(file => './' + file)], { cwd: mini, encoding: 'utf8', windowsHide: true, maxBuffer: 30 * 1024 * 1024, timeout: 30000 });
if (compiled.error || compiled.status) throw compiled.error || Error(compiled.stderr);
const context = vm.createContext({ window: {}, console });
vm.runInContext(compiled.stdout, context);
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const rpx = source => source.replace(/(-?[\d.]+)rpx\b/g, (_, value) => Number(value) / 7.5 + 'vw');
function css(file, seen = new Set()) {
  if (seen.has(file)) return '';
  seen.add(file);
  return read(file).replace(/@import\s+["']([^"']+)["'];?/g, (_, target) => css(resolve(file, target), seen));
}
// Keep declarations, media queries, colors, spacing and grid rules unchanged.
// Only map native WXML tags to corresponding HTML/custom elements.
function browserCss(source) {
  return rpx(source).replace(/(^|[\s,>+~])(?:page|view|text|scroll-view|button|image|picker|form|switch)(?=[\s,.#:\[>+~{]|$)/gm, match => match.replace(/(page|view|text|scroll-view|button|image|picker|form|switch)$/, name => name === 'page' ? 'body' : 'wx-' + name));
}
styles.global = browserCss(css('app.wxss'));
for (const base of Object.keys(components)) styles[base] = browserCss(css(base + '.wxss'));
function componentState(base, attrs) {
  if (!definitions[base]) {
    let definition;
    runMiniProgram(path.join(mini, base + '.js'), { Component: value => { definition = value; }, require: () => ({}) });
    const properties = Object.fromEntries(Object.entries(definition.properties || {}).map(([key, value]) => [key, value.value]));
    definitions[base] = { ...properties, ...definition.data };
  }
  const data = { ...definitions[base], ...attrs };
  return fixtures.componentState ? fixtures.componentState(base, attrs, data) : data;
}
function treeHtml(node, base, used) {
  if (node == null) return '';
  if (typeof node !== 'object') return escape(node);
  const name = (node.tag || '').replace(/^wx-/, ''), attrs = node.attr || {};
  const children = () => (node.children || []).map(child => treeHtml(child, base, used)).join('');
  if (!name || name === 'virtual' || name === 'block') return children();
  const child = components[base][name];
  if (child) {
    used.add(child);
    const tree = context.$gwx('./' + child + '.wxml')(componentState(child, attrs), {}, {});
    return '<wx-component class="' + escape(attrs.class || '') + '">' + treeHtml(tree, child, used) + '</wx-component>';
  }
  let htmlAttrs = '';
  for (const [key, value] of Object.entries(attrs)) {
    if (['class', 'id', 'placeholder', 'maxlength'].includes(key)) htmlAttrs += ' ' + key + '="' + escape(value) + '"';
    if (key === 'style') htmlAttrs += ' style="' + escape(rpx(String(value))) + '"';
  }
  if (attrs.disabled) htmlAttrs += ' disabled';
  if (name === 'scroll-view') htmlAttrs += ' data-scroll="' + (attrs['scroll-x'] ? 'x' : 'y') + '"';
  if (name === 'input') return '<input' + htmlAttrs + ' type="' + (attrs.password ? 'password' : 'text') + '" value="' + escape(attrs.value) + '" />';
  if (name === 'textarea') return '<textarea' + htmlAttrs + (attrs['auto-height'] ? ' data-auto-height="true"' : '') + '>' + escape(attrs.value) + '</textarea>';
  if (name === 'switch') return '<wx-switch' + htmlAttrs + '><input type="checkbox"' + (attrs.checked ? ' checked' : '') + ' /></wx-switch>';
  if (name === 'image') return '<wx-image' + htmlAttrs + '>' + (String(attrs.src || '').startsWith('data:image/') ? '<img src="' + escape(attrs.src) + '" />' : '') + '</wx-image>';
  return '<wx-' + name + htmlAttrs + '>' + children() + '</wx-' + name + '>';
}
const pages = cases.map(fixture => {
  const base = baseFor(fixture), data = fixtures.pageState(fixture), used = new Set([base]);
  const tree = context.$gwx('./' + base + '.wxml')(data, {}, {});
  if (!JSON.stringify(tree).includes(fixture.expected)) throw Error(fixture.title + ': missing ' + fixture.expected);
  let html = treeHtml(tree, base, used);
  for (const extra of fixture.extras || []) {
    const extraBase = baseFor(extra); used.add(extraBase);
    html += treeHtml(context.$gwx('./' + extraBase + '.wxml')(fixtures.pageState(extra), {}, {}), extraBase, used);
  }
  return { id: fixture.id, title: fixture.title, html, styles: [...used] };
});
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>后台窄屏布局检查</title>
<style>body{margin:0;background:#e9edf3;color:#21304a;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}header{padding:14px 22px;background:white;border-bottom:1px solid #dfe5ef}header strong{display:block;font-size:18px}main{max-width:1100px;margin:20px auto;display:flex;gap:24px;align-items:flex-start;padding:0 16px}aside{width:290px;flex-shrink:0}label{display:block;margin:0 0 6px}select,button{font:inherit;border:1px solid #d5deec;border-radius:8px;padding:9px 12px;background:white;color:inherit;max-width:100%}select{width:100%;margin-bottom:16px}button{cursor:pointer}.widths{display:flex;gap:6px;margin:0 0 16px}.widths button{padding:8px}.widths button[aria-pressed=true]{color:white;background:#2863db}.device{background:#f3f5f9;border:1px solid #d7dfec;border-radius:12px;overflow:hidden;box-shadow:0 10px 35px #20375915;flex-shrink:0}.titlebar{text-align:center;font-weight:600;padding:11px;background:#f3f5f9}iframe{display:block;border:0;width:100%;height:780px}#report{white-space:pre-wrap;font-size:12px;max-height:430px;overflow:auto;margin-top:18px}.note{font-size:12px;color:#677993;margin-top:16px}#check-frame{position:absolute;left:-2000px;top:0;visibility:hidden;height:780px}@media(max-width:700px){main{flex-direction:column;align-items:center}aside{width:100%}}</style>
<header><strong>后台窄屏布局检查</strong><span>实际 WXML / WXSS · 本地示例数据</span></header><main><aside><label for="page">查看页面</label><select id="page">${pages.map(page => '<option value="' + page.id + '">' + escape(page.title) + '</option>').join('')}</select><label>手机宽度</label><div class="widths">${[320,360,375,414].map(width => '<button data-width="' + width + '" aria-pressed="' + (width === 320) + '">' + width + 'px</button>').join('')}</div><button id="check">检查全部页面与宽度</button><div id="report" role="status">准备就绪：${pages.length} 个页面状态。</div><p class="note">预览使用页面样式按手机宽度换算 rpx；表单可输入示例文本。输入框原生渲染仍需在微信真机核对。</p></aside><section class="device" style="width:320px"><div class="titlebar" id="title"></div><iframe id="preview" title="手机页面预览"></iframe></section></main><iframe id="check-frame" title="布局检查"></iframe>
<script>const pages=${json(pages)}, styles=${json(styles)};
const reset='html,body{margin:0;padding:0;min-height:100%;scrollbar-width:none}::-webkit-scrollbar{width:0;height:0}wx-view,wx-page,wx-scroll-view,wx-form,wx-component,wx-picker{display:block}wx-text{display:inline}wx-button{display:block;position:relative;margin:0 auto;padding:0 14px;text-align:center;background:#f8f8f8;color:#000;font-size:18px;line-height:2.55555556;border-radius:5px;box-sizing:border-box;cursor:default}input,textarea{font:inherit;box-sizing:border-box;margin:0;border:0;background:transparent;outline:0;color:inherit}input{display:block;height:1.4rem}textarea{display:block;width:300px;height:150px;resize:none}wx-image{display:inline-block;width:320px;height:240px;overflow:hidden}wx-image img{display:block;width:100%;height:100%;object-fit:cover}wx-scroll-view[data-scroll=x]{overflow-x:auto;overflow-y:hidden}wx-scroll-view[data-scroll=y]{overflow-y:auto;overflow-x:hidden}wx-switch{display:inline-block;flex-shrink:0}wx-switch input{appearance:auto;display:block;height:22px;width:36px;accent-color:#2863db}wx-button[disabled]{opacity:.5}';
let width=320; const picker=document.getElementById('page'), frame=document.getElementById('preview'), checkFrame=document.getElementById('check-frame'), report=document.getElementById('report');
function doc(page){return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+reset+styles.global+page.styles.map(key=>styles[key]).join('')+'</style><body>'+page.html+'</body></html>';}
function show(){const page=pages.find(page=>page.id===picker.value);document.querySelector('.device').style.width=width+'px';document.getElementById('title').textContent=page.title;frame.srcdoc=doc(page);document.querySelectorAll('[data-width]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.width==width));}
function fitTextareas(target){target.contentDocument.querySelectorAll('textarea[data-auto-height]').forEach(area=>{area.style.height='auto';area.style.height=Math.max(area.scrollHeight,50)+'px';});}
frame.onload=()=>fitTextareas(frame); picker.onchange=show;document.querySelectorAll('[data-width]').forEach(button=>button.onclick=()=>{width=Number(button.dataset.width);show();});
async function ready(page,w){checkFrame.style.width=w+'px';await new Promise(resolve=>{checkFrame.onload=resolve;checkFrame.srcdoc=doc(page);});await checkFrame.contentDocument.fonts.ready;fitTextareas(checkFrame);await new Promise(resolve=>requestAnimationFrame(resolve));}
function inspect(page,w){const d=checkFrame.contentDocument,win=checkFrame.contentWindow,issues=[];
if(d.documentElement.scrollWidth>w+1)issues.push('页面横向溢出 '+d.documentElement.scrollWidth+'px');
for(const element of d.querySelectorAll('input:not([type=checkbox])')){const style=win.getComputedStyle(element);if(parseFloat(style.paddingTop)||parseFloat(style.paddingBottom))issues.push('输入框存在纵向 padding: '+element.className);}
if(page.id==='home')for(const grid of d.querySelectorAll('.ac-grid,.ac-stat-grid')){const first=grid.children[0].getBoundingClientRect(),second=grid.children[1].getBoundingClientRect();if(Math.abs(first.top-second.top)>1||second.left<=first.left)issues.push('工作台未保持两列');}
for(const element of d.querySelectorAll('.ac-input-unit')){const input=element.querySelector('input'),unit=element.querySelector('wx-text');if(input&&unit){const a=input.getBoundingClientRect(),b=unit.getBoundingClientRect();if(Math.abs(a.top+a.height/2-b.top-b.height/2)>2)issues.push('数值与单位中心未对齐');}}
if(issues.length){const overflow=[...d.body.querySelectorAll('*')].filter(e=>{const rect=e.getBoundingClientRect();return rect.right>w+1&&!e.closest('wx-scroll-view[data-scroll=x]');}).slice(0,4).map(e=>e.className||e.tagName);if(overflow.length)issues.push('位置：'+overflow.join(' / '));}
return issues;}
document.getElementById('check').onclick=async function(){this.disabled=true;const failures=[];let count=0;for(const w of [320,360,375,414])for(const page of pages){report.textContent='检查中 '+(++count)+' / '+(pages.length*4)+'：'+w+'px '+page.title;await ready(page,w);const issues=inspect(page,w);if(issues.length)failures.push(w+'px '+page.title+'：'+issues.join('；'));}report.textContent='检查完成：'+count+' 个布局状态，'+failures.length+' 项需处理。'+(failures.length?'\\n\\n'+failures.join('\\n'):'\\n无页面横向溢出；工作台保持两列；数字输入框与单位居中对齐。');this.disabled=false;};show();
</script></html>`;
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, html.replaceAll('后台窄屏布局检查', escape(fixtures.previewTitle || '后台窄屏布局检查'))
  .replace('无页面横向溢出；工作台保持两列；数字输入框与单位居中对齐。', fixtures.previewSummary || '无页面横向溢出；工作台保持两列；数字输入框与单位居中对齐。'));
console.log(JSON.stringify({ output: path.resolve(output), states: pages.length, templates: sources.size, bytes: Buffer.byteLength(html) }));
