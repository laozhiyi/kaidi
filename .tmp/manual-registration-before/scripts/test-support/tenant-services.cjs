'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {memory}=require('./tenant-memory.cjs');
const tenant=require('../../cloudfunctions/mcloud/framework/tenancy/tenant_context.js');
const {wrap}=require('../../cloudfunctions/mcloud/framework/tenancy/tenant_database.js');
const AppError=require('../../cloudfunctions/mcloud/framework/core/app_error.js');
const root=path.resolve(__dirname,'../../cloudfunctions/mcloud');
const serverConfig=require(path.join(root,'config/config.js'));
const defaults=require('../../cloudfunctions/mcloud/project/crun/service/tenant_defaults.js');
const A={schoolId:'school_a',campusId:'east',schoolName:'学校 A',campusName:'东校区',campus:{locations:defaults.locations}};
const B={...A,campusId:'west',campusName:'西校区'};
const C={...A,schoolId:'school_b',schoolName:'学校 B'};
function fixture(options = {}){
  // Existing tenancy regressions exercise strict mode; login tests also run
  // the user-requested temporary credentials-only mode with the same services.
  serverConfig.ADMIN_LOGIN_CREDENTIALS_ONLY=options.credentialsOnly===true;
  const raw=memory(),db=wrap(raw.db),cache=new Map();let nextId=0;
  const cloud={database:()=>db,getWXContext:()=>({OPENID:'poster'}),logger:()=>({error(){},info(){},warn(){}}),openapi:{subscribeMessage:{send:async()=>({errCode:0})}}};
  class Base {constructor(){this._timestamp=Date.now();}getProjectId(){return 'crun';}AppError(message,code){throw new AppError(message,code);}async insertLog(){}async initSetup(){}}
  function where(value){
    if(typeof value==='string')return {_id:value};
    return Object.fromEntries(Object.entries(value||{}).map(([key,val])=>{
      if(key==='and'||key==='or')return ['$'+key,(Array.isArray(val)?val:[val]).map(where)];
      if(Array.isArray(val)){const ops={'<':'lt','>':'gt','<=':'lte','>=':'gte','<>':'neq',in:'in'};if(ops[val[0]])return [key,db.command[ops[val[0]]](val[1])];}
      return [key,val];
    }));
  }
  const fields=value=>!value||value==='*'?null:Object.fromEntries(value.split(',').map(x=>[x.trim(),true]));
  function model(name){
    const query=(w,f,o)=>{let q=db.collection('bx_'+name).where(where(w));if(fields(f))q=q.field(fields(f));for(const [key,dir] of Object.entries(o||{}))q=q.orderBy(key,dir);return q;};
    return {async getOne(w,f){return (await query(w,f).limit(1).get()).data[0]||null;},async getAll(w,f,o,n=100){return (await query(w,f,o).limit(n).get()).data;},async count(w){return (await query(w).count()).total;},async insert(data){const id='model-'+(++nextId);await db.collection('bx_'+name).doc(id).set({data});return id;},async edit(w,data){return query(w).update({data});},async getList(w,f,o,page=1,size=20){const q=query(w,f,o),total=(await q.count()).total;return {list:(await q.skip((page-1)*size).limit(size).get()).data,total,page,size,count:Math.ceil(total/size)};},async inc(){},TYPE:{SYS:1}};
  }
  function load(relative){
    const file=path.resolve(root,relative),key=path.relative(root,file).replaceAll('\\','/');
    if(cache.has(file))return cache.get(file).exports;
    if(key==='framework/tenancy/tenant_context.js')return tenant;
    if(key==='framework/cloud/cloud_base.js')return {getCloud:()=>cloud};
    if(key==='config/config.js')return serverConfig;
    if(key==='framework/core/app_error.js')return AppError;
    if(/(?:base_project_service|base_project_admin_service|base_service)\.js$/.test(key))return Base;
    if(/\/model\//.test(key)&&key.endsWith('_model.js'))return model(path.basename(key,'_model.js'));
    if(key==='framework/utils/cloud_util.js'||key==='framework/utils/export_util.js')return {};
    const module={exports:{}};cache.set(file,module);
    vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,Buffer,Date,process,global:{PID:'crun'},setTimeout,clearTimeout,console:options.console || {log(){},info(){},warn(){},error(){}},require(name){
      if(['crypto','async_hooks','path'].includes(name))return require(name);
      if(name.startsWith('.'))return load(path.relative(root,path.resolve(path.dirname(file),name)));
      if(name.startsWith('project/'))return load(name);
      throw Error('Unexpected tenant service dependency: '+name);
    }},{filename:file});return module.exports;
  }
  const service=name=>load('project/crun/service/'+name+'.js');
  const store=service('operation_store');
  async function put(scope,name,id,row){return tenant.run(scope,()=>store.set(db,name,id,{_pid:'crun',...row}));}
  async function setup(){
    const Tenant=service('tenant_service');
    for(const scope of [A,B,C]){
      raw.table('bx_school').set(scope.schoolId,{_id:scope.schoolId,_pid:'crun',schoolId:scope.schoolId,name:scope.schoolName,enabled:true,version:1});
      const id=Tenant.campusKey(scope.schoolId,scope.campusId);
      raw.table('bx_campus').set(id,{_id:id,_pid:'crun',schoolId:scope.schoolId,campusId:scope.campusId,name:scope.campusName,locations:defaults.locations,enabled:true,version:1});
      await put(scope,'operation_config',tenant.run(scope,()=>store.scopeKey('crun','config')),{value:{...service('operation_config_service').DEFAULTS,enabled:true,openHour:0,closeHour:24,campuses:[scope.campusName]}});
    }
    for(const scope of [A,C])for(const [i,user] of ['poster','rider','rider2'].entries())await put(scope,'user',tenant.run(scope,()=>store.schoolKey('crun','user',user)),{USER_MINI_OPENID:user,USER_NAME:user,USER_STATUS:1,USER_MOBILE:'1380000000'+i,USER_MOBILE_VERIFIED:true,USER_PROFILE_COMPLETE:true,USER_PIC:'cloud://fixture/avatar',USER_FORMS:[{mark:'sex',val:'男'},{mark:'college',val:'计算机学院'},{mark:'sub',val:'软件工程'},{mark:'campus',val:scope.campusName}]});
    raw.table('bx_admin').set('platform',{_id:'platform',_pid:'crun',ADMIN_STATUS:1,ADMIN_TYPE:1,ADMIN_PLATFORM:true,ADMIN_SCOPES:[]});
  }
  const forms=(scope=A)=>Object.entries({title:'取件',campus:scope.campusName,poster:'张同学',tel:'13800000000',address1:'二期 · 中通',address2:'一期 1栋101',addressPhase:'一期',code:'123',small:1,medium:0,large:0,img:[],urgent:false}).map(([mark,val])=>({mark,val}));
  return {...raw,raw,db,cloud,load,service,store,put,setup,forms,tenant,A,B,C,table:name=>raw.table('bx_'+name),platform:()=>raw.table('bx_admin').get('platform')};
}
module.exports={fixture,A,B,C,tenant};
