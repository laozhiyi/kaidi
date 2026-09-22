'use strict';
// Offline WXML/WXSS verification using compilers bundled with WeChat DevTools.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),mini=path.join(root,'miniprogram');
const arg=process.argv.indexOf('--tools');
const install=arg>=0?process.argv[arg+1]:process.env.WECHAT_DEVTOOLS;
if(!install)throw Error('Pass --tools <WeChat DevTools install directory> or set WECHAT_DEVTOOLS.');
const bin=path.join(install,'resources/app.asar.unpacked/node_modules/wcc-exec');
const out=path.join(root,'.tmp/architecture-validation');fs.mkdirSync(out,{recursive:true});
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.name==='node_modules'||entry.name.startsWith('.')?[]:entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);
const files=walk(mini),summary=[];
for(const [name,ext,flags] of [['wcc','wxml',[]],['wcsc','wxss',['-js']]]){
  const sources=files.filter(file=>file.endsWith('.'+ext) || ext==='wxml' && file.endsWith('.wxs')).map(file=>'./'+path.relative(mini,file).replaceAll('\\','/'));
  const target=path.join(out,ext+'-compiled.js');
  const result=spawnSync(path.join(bin,name+'.exe'),[...flags,'-o',target,...sources],{cwd:mini,encoding:'utf8',maxBuffer:50*1024*1024,timeout:60000,windowsHide:true});
  fs.writeFileSync(path.join(out,name+'.log'),String(result.stdout||'')+String(result.stderr||'')+(result.error?String(result.error):''));
  summary.push({compiler:name,sourceFiles:sources.length,status:result.status,output:target,outputBytes:fs.existsSync(target)?fs.statSync(target).size:0});
  if(result.error||result.status!==0){console.error((result.stderr||result.stdout||String(result.error)).slice(0,6000));process.exitCode=1;}
}
fs.writeFileSync(path.join(out,'compile-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
