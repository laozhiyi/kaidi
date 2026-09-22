'use strict';
const store=require('./operation_store.js');
const AppError=require('../../../framework/core/app_error.js');
const MAX_ACTIVE=500;
const metadata=row=>({_id:row._id,NEWS_TITLE:row.NEWS_TITLE||'',NEWS_DESC:row.NEWS_DESC||'',NEWS_ORDER:row.NEWS_ORDER,NEWS_ADD_TIME:row.NEWS_ADD_TIME,NEWS_EDIT_TIME:row.NEWS_EDIT_TIME});
const manifestId=()=>store.scopeKey('crun','news-manifest');
function validate(entries){if(entries.length>MAX_ACTIVE || Buffer.byteLength(JSON.stringify(entries),'utf8')>600000)throw new AppError('当前校区有效公告过多，请先撤下旧公告后再发布');}
class NewsCatalog {
 async entries(){
  const db=store.database();
  const entries=[];let after='';
  for(;;){const page=await db.collection(store.collection('news')).where({_pid:'crun',NEWS_STATUS:1,...(after?{_id:db.command.gt(after)}:{})}).orderBy('_id','asc').limit(100).get();
   entries.push(...page.data.map(metadata));validate(entries);if(page.data.length<100)break;after=page.data[page.data.length-1]._id;}
  return entries;
 }
 async ensure(){
  const db=store.database(), id=manifestId(), old=await store.get(db,'news_manifest',id);
  if(old)return old;
  const entries=await this.entries();
  return store.transaction(async tx=>{const existing=await store.get(tx,'news_manifest',id);if(existing)return existing;
   const value={_pid:'crun',entries,version:store.key(Date.now(),Math.random()),updatedAt:Date.now()};
   await store.set(tx,'news_manifest',id,value);return value;});
 }
 async change(id, patch, {insert=false,remove=false}={}){
  await this.ensure();
  return store.transaction(async tx=>{
   const old=await store.get(tx,'news',id);if(!old&&!insert)throw new AppError('公告不存在');
   const next={...(old||{}),...patch,_pid:'crun',_id:id};
   if(next.NEWS_STATUS===1 && (!Array.isArray(next.NEWS_CONTENT)||!next.NEWS_CONTENT.length))throw new AppError('请先补全公告正文再发布');
   const key=manifestId(), manifest=await store.get(tx,'news_manifest',key);
   if(!manifest)throw new AppError('公告目录正在初始化，请重试');
   const entries=manifest.entries.filter(row=>row._id!==id);
   if(!remove&&next.NEWS_STATUS===1)entries.push(metadata(next));validate(entries);
   if(remove)await tx.collection(store.collection('news')).doc(id).remove();else await store.set(tx,'news',id,next);
   await store.set(tx,'news_manifest',key,{_pid:'crun',entries,version:store.key(manifest.version,id,Date.now(),Math.random()),updatedAt:Date.now()});
   return {id};
  });
 }
 async forUser(userId){
  const manifest=await this.ensure(), db=store.database(), key=store.scopeKey('crun',userId,'news-read-index');
  let cache=await store.get(db,'news_unread',key);
  if(!cache||cache.version!==manifest.version){
   const active=manifest.entries.map(x=>x._id), read=new Set();
   for(let offset=0;offset<active.length;offset+=100){
    const page=await db.collection(store.collection('news_read')).where({_pid:'crun',userId,newsId:db.command.in(active.slice(offset,offset+100))}).field({newsId:true}).limit(100).get();
    for(const row of page.data)read.add(row.newsId);
   }
   cache=await store.transaction(async tx=>{
    const latest=await store.get(tx,'news_unread',key);
    // Merge a read acknowledgement that committed after the indexed query.
    for(const id of latest&&latest.readIds||[])if(active.includes(id))read.add(id);
    const next={_pid:'crun',userId,version:manifest.version,readIds:[...read],updatedAt:Date.now()};
    await store.set(tx,'news_unread',key,next);return next;
   });
  }
  return {entries:manifest.entries,readIds:new Set(cache.readIds),version:manifest.version};
 }
 async acknowledge(tx,userId,id){
  const key=store.scopeKey('crun',userId,'news-read-index'),old=await store.get(tx,'news_unread',key);
  const manifest=await store.get(tx,'news_manifest',manifestId());
  const active=manifest ? new Set(manifest.entries.map(x=>x._id)) : null;
  const readIds=[...new Set([...(old&&old.readIds||[]),id])].filter(value=>!active||active.has(value));
  await store.set(tx,'news_unread',key,{_pid:'crun',userId,version:old&&old.version||'',readIds:readIds.slice(-MAX_ACTIVE),updatedAt:Date.now()});
 }
}
NewsCatalog.MAX_ACTIVE=MAX_ACTIVE;NewsCatalog.manifestId=manifestId;
module.exports=NewsCatalog;
