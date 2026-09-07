const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),mini=path.join(root,'miniprogram'),backend=path.join(root,'cloudfunctions/mcloud');
const read=p=>fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'');
const pages=['projects/crun/pages/mail/add/mail_add','projects/crun/pages/mail/detail/mail_detail','projects/crun/pages/mail/my_detail/mail_my_detail','projects/crun/pages/order/index/order_index','projects/crun/pages/operations/operations','projects/crun/pages/admin/operations/admin_operations','projects/crun/pages/feedback/index/feedback_index','projects/crun/pages/feedback/my_list/feedback_my_list','projects/crun/pages/feedback/detail/feedback_detail'];
test('operational pages are registered, syntactically valid, and template handlers exist',()=>{
 const app=JSON.parse(read(path.join(mini,'app.json')));
 for(const relative of pages){assert.ok(app.pages.includes(relative),relative);for(const ext of ['js','json','wxml','wxss'])assert.ok(fs.existsSync(path.join(mini,relative+'.'+ext)),relative+'.'+ext);
  const source=read(path.join(mini,relative+'.js'));new vm.Script(source);let page;vm.runInNewContext(source,{Page:p=>page=p,require:()=>({}),console});
  const template=read(path.join(mini,relative+'.wxml'));for(const m of template.matchAll(/(?:bind|catch):?[\w-]+\s*=\s*["']([\w]+)["']/g))assert.equal(typeof page[m[1]],'function',relative+': '+m[1]);
 }
});
test('all backend and frontend CommonJS files compile and relative module references resolve',()=>{
 const esm=new Set(['cmpts/public/poster/poster_cmpt.js','cmpts/public/poster/wxa-plugin-canvas/poster/poster.js','lib/tools/base64_lib.js']);
 function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git'].includes(entry.name))continue;const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(file.endsWith('.js')){const source=read(file),relative=path.relative(mini,file).split(path.sep).join('/');if(!esm.has(relative))new vm.Script(source,{filename:file});for(const m of source.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)){const target=path.resolve(path.dirname(file),m[1]);assert.ok(fs.existsSync(target)||fs.existsSync(target+'.js'),file+' -> '+m[1]);}}}}
 walk(mini);walk(backend);
});
test('operation routes resolve to real controller methods and unsafe payment UI is absent',()=>{
 const routes=require(path.join(backend,'project/crun/public/route.js'));
 for(const [route,target] of Object.entries(routes)){if(!/operations|^mail\/|^feedback\/|^admin\/feedback/.test(route))continue;const [file,method]=target.split('@');const source=read(path.join(backend,'project/crun/controller',file+'.js'));assert.match(source,new RegExp('\\b'+method.split('#')[0]+'\\s*\\('),route);}
 for(const relative of ['projects/crun/pages/order/index/order_index.js','projects/crun/pages/mail/add/mail_add.js']){const source=read(path.join(mini,relative));assert.ok(!source.includes('requestPayment'));assert.ok(!source.includes("callCloudSumbit('mail/accept'"));}
 const payment=read(path.join(backend,'project/crun/controller/pay_controller.js'));assert.match(payment,/async createPay\(\)\s*\{\s*this.AppError/);assert.match(payment,/async refund\(\)\s*\{\s*this.AppError/);
});
