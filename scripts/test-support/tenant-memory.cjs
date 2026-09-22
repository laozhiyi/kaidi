'use strict';
const clone = value => value == null ? value : structuredClone(value);
const field = (row,key) => key.split('.').reduce((v,k)=>v && v[k],row);
function matches(row, condition) {
 return Object.entries(condition || {}).every(([key,value]) => {
  if(key==='$and')return value.every(x=>matches(row,x));
  if(key==='$or')return value.some(x=>matches(row,x));
  const actual=field(row,key);
  if(value && typeof value==='object' && !Array.isArray(value))return Object.entries(value).every(([op,want])=>({$gt:()=>actual>want,$gte:()=>actual>=want,$lt:()=>actual<want,$lte:()=>actual<=want,$ne:()=>actual!==want,$in:()=>want.includes(actual),$exists:()=>want ? actual!==undefined : actual===undefined}[op] || (()=>false))());
  return actual===value;
 });
}
function memory() {
 const tables=new Map(), calls=[]; let tail=Promise.resolve();
 const table=name=>{if(!tables.has(name))tables.set(name,new Map());return tables.get(name);};
 const command={and:x=>({$and:x}),or:x=>({$or:x}),gt:x=>({$gt:x}),gte:x=>({$gte:x}),lt:x=>({$lt:x}),lte:x=>({$lte:x}),neq:x=>({$ne:x}),in:x=>({$in:x}),exists:x=>({$exists:x})};
 command.aggregate={eq:x=>({$eq:x}),pipeline:()=>({stages:[],match(x){this.stages.push({$match:x});return this;},done(){return this.stages;}})};
 function collection(name, state={where:{},sort:[],skip:0,limit:100}) {
  const query=()=>{let rows=[...table(name).values()].filter(x=>matches(x,state.where)); rows.sort((a,b)=>{for(const [key,dir] of state.sort){if(field(a,key)!==field(b,key))return (field(a,key)<field(b,key)?-1:1)*(dir==='asc'?1:-1);}return 0;});return rows;};
  const next=patch=>collection(name,{...state,...patch});
  return {
   where:where=>next({where:command.and([state.where,where])}),orderBy:(key,dir)=>next({sort:[...state.sort,[key,dir]]}),skip:skip=>next({skip}),limit:limit=>next({limit}),field:fields=>next({fields}),
   async get(){calls.push({name,method:'get',...state});let rows=query().slice(state.skip,state.skip+state.limit);if(state.fields)rows=rows.map(row=>Object.fromEntries(Object.entries(row).filter(([k])=>k==='_id'||state.fields[k])));return {data:clone(rows)};},
   async count(){calls.push({name,method:'count',...state});return {total:query().length};},
   async update({data}){const rows=query();for(const row of rows)table(name).set(row._id,{...row,...clone(data)});return {stats:{updated:rows.length}};},
   async remove(){const rows=query();for(const row of rows)table(name).delete(row._id);return {stats:{removed:rows.length}};},
   async add({data}){const items=Array.isArray(data)?data:[data];for(const item of items){const id=item._id||'row-'+table(name).size;table(name).set(id,{...clone(item),_id:id});}return {};},
   doc(id){return {async get(){calls.push({name,method:'doc.get',id});return {data:clone(table(name).get(id)||null)};},async set({data}){table(name).set(id,{...clone(data),_id:id});return {stats:{updated:1}};},async update({data}){table(name).set(id,{...table(name).get(id),...clone(data)});return {stats:{updated:1}};},async remove(){table(name).delete(id);return {stats:{removed:1}};}};},
   aggregate(){const pipeline=[];const aggregate={match(value){pipeline.push({$match:value});return aggregate;},lookup(value){pipeline.push({$lookup:value});return aggregate;},sort(value){pipeline.push({$sort:value});return aggregate;},limit(value){pipeline.push({$limit:value});return aggregate;},group(value){pipeline.push({$group:value});return aggregate;},unionWith(){throw Error('unsafe');},async end(){calls.push({name,method:'aggregate',pipeline});return {list:[...table(name).values()].filter(row=>pipeline.filter(x=>x.$match).every(x=>matches(row,x.$match)))};}};return aggregate;}
  };
 }
 const db={command,collection,async runTransaction(fn){const job=tail.then(async()=>{const backup=clone(tables);try{return await fn(db);}catch(error){tables.clear();for(const [k,v] of backup)tables.set(k,v);throw error;}});tail=job.catch(()=>{});return job;}};
 return {db,tables,table,calls};
}
module.exports={memory,matches};
