'use strict';
// Produce fresh deployment snapshots. No installation, upload or deployment.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),source=path.join(root,'cloudfunctions/mcloud');
const base=path.join(root,'.tmp/deploy');fs.mkdirSync(base,{recursive:true});
const batch=fs.mkdtempSync(path.join(base,'architecture-'));
const specs=[
 {name:'ordersWorker',entry:'order_worker.js',trigger:'orders-minute',openapi:[],timeout:60,memory:256},
 {name:'notificationsWorker',entry:'notification_worker.js',trigger:'notifications-minute',openapi:['subscribeMessage.send'],timeout:60,memory:256},
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
 const out=path.join(batch,spec.name);fs.mkdirSync(out);
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
fs.writeFileSync(path.join(batch,'DEPLOYMENT_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
