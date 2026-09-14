'use strict';
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, 'home-layout-preview.html');
let html = fs.readFileSync(file, 'utf8');
html = html.replace('实际 WXML / WXSS · 本地示例数据', '首页地址、联系人与发布区 · 局部预览 · 本地示例数据');
html = html.replace('box-sizing:border-box;margin:0;border:0;background:transparent', 'box-sizing:border-box;margin:0;padding:0;border:0;background:transparent');
html = html.replace('wx-button[disabled]{opacity:.5}', '');
const setup = `
styles.homeFrame = 'html,body{background:#f1f6ff}.home-preview{padding:2.4vw 3.2vw 3.2vw;box-sizing:border-box}.publish-page input::placeholder,.publish-page textarea::placeholder{color:#a6afbd;font-size:3.333333vw;opacity:1}';
pages.forEach(page=>{
 const parsed=new DOMParser().parseFromString(page.html,'text/html');
 const publish=parsed.querySelector('.publish-page');
 const content=publish.querySelector('.pub-content');
 [...content.children].forEach(child=>{if(!child.matches('.pub-route-card,.pub-contact-card,.pub-settlement'))child.remove();});
 [...publish.children].forEach(child=>{if(!child.matches('.pub-content,.pub-submit-bar'))child.remove();});
 page.html='<wx-view class="home-preview">'+publish.outerHTML+'</wx-view>';
 page.styles.push('homeFrame');
});
`;
html = html.replace('let width=320;', setup + '\nlet width=375;');
const oldFit = "function fitTextareas(target){target.contentDocument.querySelectorAll('textarea[data-auto-height]').forEach(area=>{area.style.height='auto';area.style.height=Math.max(area.scrollHeight,50)+'px';});}";
const fit = "function fitTextareas(target){target.contentDocument.querySelectorAll('textarea[data-auto-height]').forEach(area=>{area.rows=1;const minimum=parseFloat(target.contentWindow.getComputedStyle(area).minHeight)||0;area.style.height='0px';area.style.height=Math.max(area.scrollHeight,minimum)+'px';});}";
if (!html.includes(oldFit)) throw Error('Preview textarea adapter changed');
html = html.replace(oldFit, fit);
html = html.replace('frame.onload=()=>fitTextareas(frame);', "frame.onload=()=>{fitTextareas(frame);frame.contentDocument.addEventListener('input',()=>fitTextareas(frame));};");
fs.writeFileSync(file, html);
console.log('Prepared the edited homepage sections for visual review.');
