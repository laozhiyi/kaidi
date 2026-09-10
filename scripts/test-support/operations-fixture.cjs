const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun/service');
function fixture() {
 const tables = new Map();
 const table = name => { if(!tables.has(name))tables.set(name,new Map());return tables.get(name); };
 const clone = x => x == null ? x : structuredClone(x);
 const field = (row, key) => key.split('.').reduce((v,k)=>v && v[k],row);
 function matches(row, where) {
  if(typeof where==='string')return row._id===where;
  return Object.entries(where || {}).every(([k,v])=>{
   if(k==='and')return matches(row,v);
   if(k==='or')return v.some(part=>matches(row,part));
   const val=field(row,k); if(Array.isArray(v)){const [op,x]=v;return op==='in'?x.includes(val):op==='<'?val<x:op==='>'?val>x:op==='lte'?val<=x:op==='<>'?val!==x:op==='like'?new RegExp(x).test(val):false;}
   return val===v;
  });
 }
 const command={lt:v=>['<',v],lte:v=>['lte',v],neq:v=>['<>',v],in:v=>['in',v]};
 function collection(name) {
  let where={},sort=[],skip=0,limit=100;name=name.replace(/^bx_/,'');
  const api={where(v){where=v;return api;},field(){return api;},orderBy(k,d){sort.push([k,d]);return api;},skip(v){skip=v;return api;},limit(v){limit=v;return api;},
   async count(){return {total:[...table(name).values()].filter(r=>matches(r,where)).length};},
   async get(){let rows=[...table(name).values()].filter(r=>matches(r,where));rows.sort((a,b)=>{for(const [k,d] of sort){if(field(a,k)!==field(b,k))return (field(a,k)<field(b,k)?-1:1)*(d==='asc'?1:-1);}return 0;});return {data:clone(rows.slice(skip,skip+limit))};},
   doc(id){return {async get(){return {data:clone(table(name).get(id)||null)};},async set({data}){table(name).set(id,{...clone(data),_id:id});},async remove(){table(name).delete(id);}}}
  };return api;
 }
 const db={collection,command};let tail=Promise.resolve();
 const store={key:(...parts)=>crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32),collection:n=>'bx_'+n,database:()=>db,
  get:async(_,n,id)=>clone(table(n).get(id)||null),set:async(_,n,id,row)=>{table(n).set(id,{...clone(row),_id:id});},
  transaction(fn){const job=tail.then(async()=>{const snapshot=clone(tables);try{return await fn(db);}catch(e){tables.clear();for(const [k,v] of snapshot)tables.set(k,v);throw e;}});tail=job.catch(()=>{});return job;},limit:async()=>{}};
 class Base {constructor(){this._timestamp=Date.now();}getProjectId(){return 'crun';}AppError(message){throw new Error(message);}async insertLog(){}}
 function model(name){return {
  async getOne(w){return clone([...table(name).values()].find(x=>x._pid==='crun'&&matches(x,w))||null);},
  async getAll(w,f,o,n=100){return (await collection(name).where({_pid:'crun',...w}).limit(n).get()).data;},
  async getList(w,f,o,page=1,size=20){let q=collection(name).where(w);for(const [k,d] of Object.entries(o))q.orderBy(k,d);const total=(await q.count()).total;return {list:(await q.skip((page-1)*size).limit(size).get()).data,page,size,total,count:Math.ceil(total/size)};},
  async edit(w,data){for(const [id,row] of table(name))if(matches(row,w))table(name).set(id,{...row,...clone(data)});},
  async count(w){return [...table(name).values()].filter(x=>matches(x,w)).length;},async inc(){}};}
 let sendError=null,sends=0;
 const cloud={getTempFileURL:async({fileList})=>({fileList:fileList.map(x=>({fileID:x.fileID,tempFileURL:'https://signed.invalid/'+encodeURIComponent(x.fileID)}))}),openapi:{subscribeMessage:{send:async()=>{sends++;if(sendError)throw sendError;return {errCode:0};}}}};
 const cache={};function load(name){if(cache[name])return cache[name];const file=path.join(root,name);const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,Date,Buffer,process,console,require(request){
   if(request.includes('base_project') || request.endsWith('/base_service.js'))return Base;
   if(request.endsWith('/app_error.js'))return Error;
   if(request.endsWith('operation_store.js'))return store;
   if(request.endsWith('cloud_base.js'))return {getCloud:()=>cloud};
   if(request.endsWith('/user_model.js'))return model('user');
   if(request.endsWith('/mail_model.js'))return model('mail');
   if(request.endsWith('/admin_model.js'))return model('admin');
   if(request.endsWith('/log_model.js'))return {TYPE:{SYS:1}};
   if(request.endsWith('password_util.js'))return require(path.resolve(root,'../../../framework/utils/password_util.js'));
   if(request.endsWith('/data_util.js'))return {dbForms2Obj:forms=>Object.fromEntries(forms.map(x=>[x.mark,x.val]))};
   if(request.endsWith('/time_util.js'))return {time:Date.now,timestamp2Time:String};
   if(request.endsWith('/util.js'))return {};
   if(request==='crypto')return crypto;
   if(request.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(file),request)));
   throw new Error('Unexpected dependency '+request);
  }},{filename:file});cache[name]=module.exports;return module.exports;
 }
 function user(id,extra={}){table('user').set(id,{_id:id,_pid:'crun',USER_MINI_OPENID:id,USER_STATUS:1,USER_NAME:id,USER_MOBILE:'13800000000',...extra});}
 user('poster');user('rider');user('rider2');user('other');table('admin').set('admin',{_id:'admin',_pid:'crun',ADMIN_STATUS:1,ADMIN_TYPE:1});
 const Config=load('operation_config_service.js');const config={...Config.DEFAULTS,enabled:true,openHour:0,closeHour:24};table('operation_config').set(store.key('crun','config'),{value:config});
 const forms=()=>Object.entries({title:'快递代取',code:'123-456',address1:'菜鸟一期',address2:'宿舍101',poster:'小王',tel:'13800000000',campus:'育才校区',small:1,medium:0,large:0,img:[],urgent:false}).map(([mark,val])=>({mark,val}));
 const req=(value='default')=>'request_'+value.padEnd(16,'_');
 const Mail=load('mail_service.js'),service=new Mail();
 const publish=async(extra={},actor='poster')=>(await service.insertMail(actor,{forms:forms(),requestId:req('publish'),...extra}))._id;
 return {store,table,load,user,config,forms,req,service,publish,setSendError:e=>sendError=e,get sends(){return sends;}};
}
module.exports={fixture};
