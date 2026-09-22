'use strict';
// Local validation only. This tool never connects to a cloud environment.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceRoot=path.join(root,'cloudfunctions/mcloud');
const sourceFiles=(folder,relative='')=>fs.readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
  if(['node_modules','.git'].includes(entry.name))return [];
  const file=path.join(relative,entry.name);
  return entry.isDirectory()?sourceFiles(path.join(folder,entry.name),file):/\.(js|json)$/.test(entry.name)?[file.replaceAll('\\','/')]:[];
});
const manifest=read(path.join(root,'deployment/database-indexes.json'));
assert.equal(manifest.status,'candidate_not_applied');
const names=new Set();
const expanded=manifest.indexes.map(index=>{
  assert.ok(/^bx_[a-z_]+$/.test(index.collection));
  assert.ok(!names.has(index.collection+'/'+index.name),'Duplicate index');names.add(index.collection+'/'+index.name);
  assert.ok(manifest.prefixes[index.scope],'Missing scope prefix');
  const fields=[...manifest.prefixes[index.scope],...index.fields];
  assert.equal(new Set(fields.map(field=>field[0])).size,fields.length,'Repeated field');
  for(const [field,direction] of fields){assert.ok(/^[\w.]+$/.test(field));assert.ok(['asc','desc'].includes(direction));}
  if(['bx_user','bx_identity_unique'].includes(index.collection))assert.equal(index.scope,'school');
  return {...index,fields,unique:false};
});
for(const name of ['server-only','order-feed'])assert.deepEqual(read(path.join(root,'deployment/database-rules',name+'.json')),{read:false,write:false});
assert.deepEqual(read(path.join(root,'cloudfunctions/mcloud/config.json')).triggers,[],'API must have no scheduled trigger');
const out=path.join(root,'.tmp/architecture-validation');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'indexes-expanded.json'),JSON.stringify({status:manifest.status,indexes:expanded},null,2)+'\n');
const directory=process.argv[2];
const result={candidateIndexes:expanded.length,clientRules:'deny',apiTriggers:0,artifacts:[],networkUsed:false};
if(directory){
  const batch=path.resolve(directory),deployment=read(path.join(batch,'DEPLOYMENT_MANIFEST.json'));
  assert.equal(deployment.uploaded,false);assert.ok(deployment.requiredEnvironment.includes('CLOUD_ENV_ID'));
  const specs={ordersWorker:['order_worker.js','orders-minute',[]],notificationsWorker:['notification_worker.js','notifications-minute',['subscribeMessage.send']],tenantMigrator:['migration_worker.js',null,[]]};
  assert.deepEqual(deployment.outputs.map(item=>item.name).sort(),Object.keys(specs).sort());
  for(const output of deployment.outputs){
    const folder=path.join(batch,output.name),source=read(path.join(folder,'SOURCE_MANIFEST.json'));
    assert.equal(path.resolve(output.path),folder);assert.equal(source.kind,output.name);
    assert.equal(source.sourceEntry,specs[output.name][0]);
    assert.equal(fs.existsSync(path.join(folder,'node_modules')),false);
    assert.deepEqual(Object.keys(source.files).sort(),sourceFiles(sourceRoot).sort(),'Incomplete source snapshot');
    for(const [file,expected] of Object.entries(source.files)){
      const target=path.resolve(folder,file),relative=path.relative(folder,target);
      assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Manifest path escapes artifact');
      assert.equal(hash(target),expected,'Changed artifact: '+output.name+'/'+file);
      if(file!=='config.json')assert.equal(hash(target),hash(path.join(sourceRoot,file==='index.js'?source.sourceEntry:file)),'Source changed after build: '+file);
    }
    for(const file of ['index.js','config.json','package.json','package-lock.json'])assert.ok(source.files[file],file+' missing from manifest');
    assert.equal(hash(path.join(folder,'index.js')),hash(path.join(root,'cloudfunctions/mcloud',specs[output.name][0])));
    assert.equal(hash(path.join(folder,'package-lock.json')),hash(path.join(root,'cloudfunctions/mcloud/package-lock.json')));
    const config=read(path.join(folder,'config.json')),trigger=specs[output.name][1];
    assert.deepEqual(config.triggers,trigger?[{name:trigger,type:'timer',config:'0 * * * * * *'}]:[]);
    assert.deepEqual(config.permissions.openapi,specs[output.name][2]);
    assert.equal(Object.keys(source.files).length,output.files);
    result.artifacts.push({name:output.name,verifiedFiles:output.files,trigger});
  }
}
fs.writeFileSync(path.join(out,'deployment-check.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
