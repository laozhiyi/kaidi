'use strict';
// Produce fresh deployment snapshots. No installation, upload or deployment.
//
// 定时任务已经在 mcloud 内部执行（config.json 里声明了 orders-minute /
// notifications-minute 两个触发器，事件由 mcloud/index.js 转给 timer_entry.js），
// 所以日常只需要在开发者工具里「上传并部署」mcloud 一个函数。
//
// 默认输出到 .tmp/deploy/architecture-<hash>/，只做校验用。
// 只有在确实要把定时任务拆成独立函数时才加 --out cloudfunctions，
// 生成 ordersWorker / notificationsWorker / tenantMigrator 三个可右键上传的目录。
// 拆分版触发器带 worker- 前缀，不会和 mcloud 的同名触发器双跑。
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),source=path.join(root,'cloudfunctions/mcloud');
const argv=process.argv.slice(2);
const outIndex=argv.findIndex(item=>item==='--out'||item.startsWith('--out='));
const outArg=outIndex<0?'':(argv[outIndex]==='--out'?argv[outIndex+1]||'':argv[outIndex].replace(/^--out=/,''));
const outRoot=outArg?path.resolve(root,outArg):'';
if(outRoot&&!outRoot.startsWith(root+path.sep))throw new Error('--out 必须是项目内的目录');
const base=path.join(root,'.tmp/deploy');fs.mkdirSync(base,{recursive:true});
const batch=outRoot||fs.mkdtempSync(path.join(base,'architecture-'));
const specs=[
 {name:'ordersWorker',entry:'order_worker.js',trigger:'worker-orders-minute',openapi:[],timeout:60,memory:256},
 {name:'notificationsWorker',entry:'notification_worker.js',trigger:'worker-notifications-minute',openapi:['subscribeMessage.send'],timeout:60,memory:256},
 {name:'tenantMigrator',entry:'migration_worker.js',openapi:[],timeout:60,memory:512}
];
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk=(dir,relative='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
 if(['node_modules','.git'].includes(entry.name))return [];
 const rel=path.join(relative,entry.name);
 return entry.isDirectory()?walk(path.join(dir,entry.name),rel):/\.(js|json)$/.test(entry.name)?[rel]:[];
});
const files=walk(source).filter(file=>!['index.js','config.json'].includes(file));
const outputs=[];
for(const spec of specs){
 const out=path.join(batch,spec.name);
 // 直接输出到云函数根目录时先清空上一次的副本，避免残留已删除的文件。
 if(outRoot){fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});}else fs.mkdirSync(out);
 for(const file of files){const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(source,file),target);}
 fs.copyFileSync(path.join(source,spec.entry),path.join(out,'index.js'));
 const config={permissions:{openapi:spec.openapi},triggers:spec.trigger?[{name:spec.trigger,type:'timer',config:'0 * * * * * *'}]:[]};
 fs.writeFileSync(path.join(out,'config.json'),JSON.stringify(config,null,2)+'\n');
 const outputFiles=walk(out).sort();
 const manifest={kind:spec.name,sourceEntry:spec.entry,files:Object.fromEntries(outputFiles.map(file=>[file.replaceAll('\\','/'),hash(path.join(out,file))]))};
 fs.writeFileSync(path.join(out,'SOURCE_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
 outputs.push({name:spec.name,path:out,files:outputFiles.length,timeoutSeconds:spec.timeout,memoryMB:spec.memory});
}
const manifest={generatedAt:new Date().toISOString(),minimumNode:'16.13',requiredEnvironment:['CLOUD_ENV_ID'],outputs,uploaded:false};
fs.writeFileSync(path.join(outRoot?base:batch,'DEPLOYMENT_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
if(outRoot)console.error('已生成到 cloudfunctions/，请回到开发者工具右键每个目录「上传并部署：云端安装依赖」。');
console.log(JSON.stringify(manifest,null,2));
