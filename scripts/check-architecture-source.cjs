'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const walk=folder=>fs.readdirSync(folder,{withFileTypes:true}).flatMap(entry=>
  entry.name==='node_modules'||entry.name.startsWith('.')?[]:entry.isDirectory()?walk(path.join(folder,entry.name)):[path.join(folder,entry.name)]);
const files=['cloudfunctions','miniprogram','scripts'].flatMap(folder=>walk(path.join(root,folder)));
const counts={javascript:0,esModules:0,json:0,relativeImports:0,cloudRoutes:0,networkUsed:false};
for(const file of files){
  if(!/\.(js|cjs|json)$/.test(file))continue;
  const source=fs.readFileSync(file,'utf8');
  if(/\.(js|cjs)$/.test(file)){
    if(/^\s*(?:import\s|export\s)/m.test(source)){
      const checked=spawnSync(process.execPath,['--check','--input-type=module'],{input:source,encoding:'utf8',windowsHide:true,timeout:10000});
      if(checked.error)throw checked.error;
      assert.equal(checked.status,0,path.relative(root,file)+': '+checked.stderr);counts.esModules++;
    }else new vm.Script(source,{filename:file});
    counts.javascript++;
    // Check literal relative imports without executing application code.
    const imports=[...source.matchAll(/\brequire\(\s*['"](\.[^'"\r\n]+)['"]\s*\)/g),...source.matchAll(/\bfrom\s*['"](\.[^'"\r\n]+)['"]/g)];
    for(const match of imports){
      const target=path.resolve(path.dirname(file),match[1]);
      const candidates=[target,target+'.js',target+'.cjs',target+'.json',path.join(target,'index.js')];
      assert.ok(candidates.some(candidate=>fs.existsSync(candidate)&&fs.statSync(candidate).isFile()),path.relative(root,file)+' has missing import '+match[1]);
      counts.relativeImports++;
    }
  }else if(file.endsWith('.json')){JSON.parse(source);counts.json++;}
}
const project=path.join(root,'cloudfunctions/mcloud/project/crun');
const routes=require(path.join(project,'public/route.js'));
for(const [route,target] of Object.entries(routes)){
  if(typeof target!=='string'||!target.includes('@'))continue;
  const [controller,actionWithFlags]=target.split('@'),action=actionWithFlags.split('#')[0];
  const file=path.join(project,'controller',controller+'.js');
  assert.ok(fs.existsSync(file),'Missing controller for '+route);
  const source=fs.readFileSync(file,'utf8');
  assert.ok(new RegExp('\\b'+action+'\\s*\\(').test(source),'Missing action for '+route);
  counts.cloudRoutes++;
}
const out=path.join(root,'.tmp/architecture-validation');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'source-check.json'),JSON.stringify(counts,null,2)+'\n');
console.log(JSON.stringify(counts,null,2));
