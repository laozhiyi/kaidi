'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const base=path.resolve(__dirname,'../../cloudfunctions/mcloud/project/crun');
function load(file,deps,extra={}) {const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(base,file),'utf8'),{module,require:n=>{if(n in deps)return deps[n];throw Error('Missing mock '+n);},console,Buffer,URL,URLSearchParams,Intl,...extra});return module.exports;}
const pair=crypto.generateKeyPairSync('rsa',{modulusLength:1024});
const cfg={appid:'app_test',prod:false,wxAppid:'wx0123456789abcdef',privateKey:pair.privateKey,publicKey:pair.publicKey,ready:()=>true,notifyUrl:'https://example.test/adapay/notify',digestKey:'h'.repeat(32)};
const wire=load('service/adapay_api.js',{'crypto':crypto,'../config/adapay_config.js':cfg});
const signed=data=>crypto.sign('RSA-SHA1',Buffer.from(data),pair.privateKey).toString('base64');
test('AdaPay signed payloads reject tampering, object coercion and forged form notifications',()=>{
 const data=JSON.stringify({order_no:'a'.repeat(32)});
 assert.equal(wire.verify(data,signed(data)).order_no,'a'.repeat(32));
 assert.throws(()=>wire.verify(data+' ',signed(data)),/SIGNATURE/);
 assert.throws(()=>wire.verify({},signed(data)),/SIGNATURE/);
 assert.equal(wire.notification({body:new URLSearchParams({data,sign:signed(data)}).toString()}).order_no,'a'.repeat(32));
 assert.throws(()=>wire.notification({body:JSON.stringify({data,sign:'forged'})}),/SIGNATURE/);
});
test('AdaPay monetary conversion uses fen and rejects malformed, fractional-fen and unsafe amounts',()=>{
 assert.equal(wire.cents('12.34'),1234);assert.equal(wire.money(1234),'12.34');
 for(const a of ['1','0.001','-1.00','1e2','99999999999999999999.00'])assert.throws(()=>wire.cents(a));
 assert.throws(()=>wire.money(1.5));
});
function harness(state=-1) {
 const id='a'.repeat(32),uid='crun^^^poster';
 const rows={payment:{[id]:{provider:'adapay',appid:cfg.appid,prod:false,userId:uid,openid:'poster',orderId:'order',amount:1000,state:'pending',providerId:'pay1'}},mail:{order:{_id:'order',_pid:'crun',MAIL_PAYMENT_MODE:'adapay',MAIL_PAY_NO:id,MAIL_USER_ID:uid,MAIL_ACCEPT_USER_ID:'rider',MAIL_TOTAL_FEE:1000,MAIL_STATUS:state,MAIL_PAY_STATUS:0,MAIL_END_TIME:Date.now()+3600000}}};
 const calls=[];
 const clone=x=>x&&structuredClone(x);
 const store={key:(...a)=>crypto.createHash('sha256').update(JSON.stringify(a)).digest('hex').slice(0,32),scopeKey:(...a)=>a.join('_'),scope:()=>({schoolId:'school',campusId:'campus'}),database:()=>({}),
  get:async(tx,t,k)=>clone(rows[t]?.[k]),set:async(tx,t,k,v)=>{(rows[t]||={})[k]=clone(v);},transaction:async f=>f({}),limitInTransaction:async()=>{}};
 const paid={id:'pay1',order_no:id,pay_amt:'10.00',pay_channel:'wx_lite',pay_mode:'delay',app_id:cfg.appid,prod_mode:'false',status:'succeeded',expend:{open_id:'poster'}};
 const api={...wire,request:async(m,p,b)=>{calls.push({m,p,b});if(p==='/v1/payments/pay1')return paid;throw Error('Unhandled '+p);}};
 let ready=true;
 class Account {async requireReady(){if(!ready)throw Error('not opened');return {memberId:'runner1',accountId:'account1'};}}
 class Mail {async _user(){} async _quota(){} async _record(tx,o){calls.push({published:true});rows.mail.order=clone(o);}}
 const deps={'./operation_store.js':store,'../config/adapay_config.js':cfg,'./adapay_api.js':api,'../../../framework/tenancy/tenant_context.js':{system:f=>f(),run:(_,f)=>f()},
  '../../../framework/cloud/cloud_base.js':{getCloud:()=>({getWXContext:()=>({APPID:cfg.wxAppid,OPENID:'poster',CLIENTIP:'127.0.0.1'})})},'../../../framework/core/app_error.js':Error,
  './adapay_account_service.js':Account,'./mail_service.js':Mail};
 const Service=load('service/adapay_payment_service.js',deps);
 return {id,uid,rows,api,store,calls,paid,service:new Service(),ready:v=>{ready=v;},deps};
}
test('AdaPay payment verification publishes once, never from unverified client status',async()=>{
 const h=harness();await h.service.reconcile(h.id);await h.service.reconcile(h.id);
 assert.equal(h.rows.mail.order.MAIL_STATUS,0);assert.equal(h.rows.mail.order.MAIL_PAY_STATUS,1);
 assert.equal(h.calls.filter(x=>x.published).length,1);
});
test('wrong amount, payer, app, environment, channel and trade number never publish',async()=>{
 for(const change of [{pay_amt:'0.01'},{expend:{open_id:'other'}},{app_id:'app_other'},{prod_mode:'true'},{pay_channel:'alipay'},{order_no:'other'}]){
  const h=harness();Object.assign(h.paid,change);await assert.rejects(h.service.reconcile(h.id),/MISMATCH/);assert.equal(h.rows.mail.order.MAIL_PAY_STATUS,0);
 }
});
test('late payment on a cancelled order queues a reversal and never reopens publication',async()=>{
 const h=harness(99),req=h.api.request;let reversed=false;
 h.api.request=async(m,p,b)=>{
  if(p==='/v1/payments/reverse/list')return {status:'succeeded',payment_reverses:reversed?[{id:'reverse1',order_no:h.rows.payment[h.id].operationNo}]:[]};
  if(p==='/v1/payments/reverse'){reversed=true;h.calls.push({reversal:b});return {id:'reverse1',status:'succeeded'};}
  if(p==='/v1/payments/reverse/reverse1')return {id:'reverse1',order_no:h.rows.payment[h.id].operationNo,payment_id:'pay1',reverse_amt:'10.00',status:'succeeded'};
  return req(m,p,b);
 };
 await h.service.reconcile(h.id);
 assert.equal(h.rows.mail.order.MAIL_STATUS,99);assert.equal(h.rows.mail.order.MAIL_PAY_STATUS,1);
 await h.service.reconcile(h.id);await h.service.reconcile(h.id);
 assert.equal(h.rows.mail.order.MAIL_PAY_STATUS,2);assert.equal(h.calls.filter(x=>x.reversal).length,1);
});
test('completion splits 90:10 with platform external fees and queries before recording success',async()=>{
 const h=harness(9),req=h.api.request;let created=false,parts;
 h.api.request=async(m,p,b)=>{
  if(p==='/v1/payments/confirm/list')return {status:'succeeded',payment_confirms:created?[{id:'confirm1',order_no:h.rows.payment[h.id].operationNo}]:[]};
  if(p==='/v1/payments/confirm'){created=true;parts=b.div_members;assert.equal(b.fee_mode,'O');assert.equal(parts[0].amount,'9.00');assert.equal(parts[1].amount,'1.00');assert(!('fee_flag' in parts[0]));return {id:'confirm1',status:'succeeded'};}
  if(p==='/v1/payments/confirm/confirm1')return {id:'confirm1',order_no:h.rows.payment[h.id].operationNo,payment_id:'pay1',confirm_amt:'10.00',div_members:parts,status:'succeeded'};
  return req(m,p,b);
 };
 await h.service.reconcile(h.id);assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'pending');
 await h.service.reconcile(h.id);assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'settled');
 assert.equal(h.rows.payment[h.id].state,'complete');
});
test('a runner without an opened account cannot receive a split',async()=>{
 const h=harness(9);h.ready(false);await assert.rejects(h.service.reconcile(h.id),/not opened/);assert.equal(h.rows.payment[h.id].state,'paid');
});
test('a payment created but not paid stays unpublished and uses stored price',async()=>{
 const h=harness();delete h.rows.payment[h.id].providerId;
 h.api.request=async(m,p,b)=>{
  if(p==='/v1/payments/list')return {status:'succeeded',payments:[]};
  assert.equal(p,'/v1/payments');assert.equal(b.pay_amt,'10.00');assert.equal(b.pay_mode,'delay');assert(!Object.hasOwn(b,'fee_mode'),'delay-mode creation must omit fee_mode');assert(!('div_members' in b));
  return {...h.paid,status:'pending',expend:{pay_info:JSON.stringify({timeStamp:'1',nonceStr:'nonce',package:'prepay_id=abc',signType:'RSA',paySign:'sig'})}};
 };
 const data=await h.service.prepare(h.uid,'order');assert.equal(data.payment.package,'prepay_id=abc');assert.equal(h.rows.mail.order.MAIL_STATUS,-1);assert.equal(h.rows.mail.order.MAIL_PAY_STATUS,0);
});
test('payment callback marks a durable recheck and cannot claim that a forged outer type paid an order',async()=>{
 const h=harness();h.api.notification=()=>({order_no:h.id,status:'succeeded'});
 const result=await h.service.callback({body:''});assert.equal(result.statusCode,200);assert.equal(h.rows.mail.order.MAIL_PAY_STATUS,0);assert(h.rows.payment[h.id].nextCheckAt<=Date.now());
});
test('personal opening persists only identifiers, masked fields, consent and keyed digest',async()=>{
 const h=harness(),account='runner_'+h.store.scopeKey('adapay-account',cfg.appid,cfg.prod,'rider');
 const form={realName:'测试同学',identity:'11010519491231002X',bankCard:'6222020000001234',phone:'13800000000',rulesAccepted:true,authorizationAccepted:true};
 let binds=0;
 const api={request:async(m,p,b)=>{
  if(p==='/v1/members/realname')return {app_id:cfg.appid,member_id:account,identified:'Y',status:'succeeded'};
  assert.equal(p,'/v1/settle_accounts');binds++;return {id:'bank1',app_id:cfg.appid,status:'succeeded',channel:'bank_account',account_info:{card_id:'6222****1234'}};
 }};
 const Service=load('service/adapay_account_service.js',{...h.deps,crypto,'./adapay_api.js':api});
 const s=new Service(),result=await s.open('rider',form);
 assert.equal(result.opened,true);assert.equal(result.cardTail,'1234');
 const saved=JSON.stringify(h.rows.payment);
 for(const v of [form.realName,form.identity,form.bankCard,form.phone])assert(!saved.includes(v));
 await s.open('rider',form);assert.equal(binds,1);
});


test('AdaPay transport signs official URL+payload and refuses unsigned errors without leaking payloads',async()=>{
 const {EventEmitter}=require('node:events');
 let forged=false, captured;
 const https={request:(url,options,callback)=>{
  const req=new EventEmitter();req.setTimeout=()=>{};req.destroy=()=>{};
  req.end=body=>{
   captured={url,options,body};
   assert.equal(options.headers['Content-Type'],'application/json');
   assert(crypto.verify('RSA-SHA1',Buffer.from('https://api.adapay.tech/v1/payments'+body),pair.publicKey,Buffer.from(options.headers.Signature,'base64')));
   const res=new EventEmitter();res.statusCode=200;
   const data=JSON.stringify({status:'succeeded',description:'中文签名'});
   const envelope=Buffer.from(JSON.stringify({data,signature:forged?'bad':signed(data)}));
   callback(res);queueMicrotask(()=>{for(const byte of envelope)res.emit('data',Buffer.from([byte]));res.emit('end');});
  };
  return req;
 }};
 const transport=load('service/adapay_api.js',{'crypto':crypto,'../config/adapay_config.js':cfg,https});
 assert.equal((await transport.request('POST','/v1/payments',{pay_amt:'1.00'})).description,'中文签名');
 assert.equal(JSON.parse(captured.body).app_id,cfg.appid);
 forged=true;await assert.rejects(transport.request('POST','/v1/payments',{cert_id:'secret-identity'}),e=>!JSON.stringify(e).includes('secret-identity'));
});

test('an uncertain bank binding is not sent a second time',async()=>{
 const h=harness(),member='runner_'+h.store.scopeKey('adapay-account',cfg.appid,cfg.prod,'rider');let binds=0;
 const form={realName:'测试同学',identity:'11010519491231002X',bankCard:'6222020000001234',phone:'13800000000',rulesAccepted:true,authorizationAccepted:true};
 const api={request:async(m,p)=>{
  if(p==='/v1/members/realname')return {app_id:cfg.appid,member_id:member,identified:'Y',status:'succeeded'};
  if(p.startsWith('/v1/members/'))throw new Error('ADAPAY_NETWORK_ERROR');
  binds++;throw new Error('ADAPAY_NETWORK_ERROR');
 }};
 const Service=load('service/adapay_account_service.js',{...h.deps,crypto,'./adapay_api.js':api}),service=new Service();
 await assert.rejects(service.open('rider',form),/尚未确认/);await assert.rejects(service.open('rider',form),/尚未确认/);assert.equal(binds,1);
});


test('actual order acceptance enforces AdaPay onboarding even without the frontend gate',async()=>{
 const {fixture}=require('../test-support/operations-fixture.cjs');
 const f=fixture(),id=await f.publish();
 Object.assign(f.table('mail').get(id),{MAIL_PAYMENT_MODE:'adapay',MAIL_PAY_STATUS:1,MAIL_PAY_NO:'ada-order'});
 await assert.rejects(f.service.acceptMail('rider',id,{requestId:f.req('reject-accept')}),/跑腿结算/);
 assert.equal(f.table('mail').get(id).MAIL_STATUS,0);
 f.load('adapay_account_service.js').prototype.requireReady=async()=>({memberId:'runner1',accountId:'account1'});
 await f.service.acceptMail('rider',id,{requestId:f.req('accept')} );
 assert.equal(f.table('mail').get(id).MAIL_STATUS,1);
});


test('AdaPay config accepts multiline, escaped-newline, inline and bare RSA keys without changing key material',()=>{
 const priv=pair.privateKey.export({type:'pkcs8',format:'pem'}),pub=pair.publicKey.export({type:'spki',format:'pem'});
 const variants=[s=>s,s=>s.replace(/\n/g,'\\n'),s=>s.replace(/\n/g,' '),s=>s.replace(/-----BEGIN [A-Z ]+-----|-----END [A-Z ]+-----|\s/g,'')];
 for(const transform of variants){
  const env={ADAPAY_APP_ID:'app_test',ADAPAY_API_KEY:'api_live_unit_test',ADAPAY_PROD_MODE:'true',WECHAT_APP_ID:cfg.wxAppid,ADAPAY_PRIVATE_KEY:transform(priv),ADAPAY_PUBLIC_KEY:transform(pub),ADAPAY_NOTIFY_URL:cfg.notifyUrl,ADAPAY_IDENTITY_HMAC_KEY:'a'.repeat(64)};
  const parsed=load('config/adapay_config.js',{crypto},{process:{env}});
  assert.equal(parsed.ready(),true);
  assert(crypto.verify('RSA-SHA1',Buffer.from('normalized key'),pair.publicKey,crypto.sign('RSA-SHA1',Buffer.from('normalized key'),parsed.privateKey)));
  assert.equal(crypto.createPublicKey(parsed.publicKey).export({type:'spki',format:'pem'}),pub);
 }
});

test('AdaPay config rejects mismatched PEM markers and malformed private key bodies',()=>{
 const priv=pair.privateKey.export({type:'pkcs8',format:'pem'}),pub=pair.publicKey.export({type:'spki',format:'pem'});
 for(const bad of [pub,priv.replace('END PRIVATE KEY','END PUBLIC KEY'),'-----BEGIN PRIVATE KEY----- not-a-key -----END PRIVATE KEY-----']){
  const parsed=load('config/adapay_config.js',{crypto},{process:{env:{ADAPAY_PRIVATE_KEY:bad}}});
  assert(parsed.invalidFields().includes('ADAPAY_PRIVATE_KEY'));
 }
});


test('opening diagnostics identify local confirmation failures without logging personal data',async()=>{
 const form={realName:'测试同学',identity:'11010519491231002X',bankCard:'6222020000001234',phone:'13800000000',rulesAccepted:true,authorizationAccepted:true};
 for(const failure of ['member','account','network','unknown']){
  const h=harness(),member='runner_'+h.store.scopeKey('adapay-account',cfg.appid,cfg.prod,'rider'),logs=[];
  const api={request:async(m,p)=>{
   if(failure==='unknown')throw new Error(form.identity);
   if(failure==='network')throw new Error('ADAPAY_NETWORK_ERROR');
   if(p==='/v1/members/realname')return {app_id:cfg.appid,member_id:member,identified:failure==='member'?'N':'Y',status:'succeeded'};
   return {app_id:cfg.appid,status:'succeeded',id:'bank1',channel:'bank_account',account_info:{card_id:'****9999'}};
  }};
  const Service=load('service/adapay_account_service.js',{...h.deps,crypto,'./adapay_api.js':api},{console:{warn:(...args)=>logs.push(args)}});
  await assert.rejects(new Service().open('rider',form),/尚未确认/);
  const expected={member:['verify_member','ADAPAY_REALNAME_NOT_CONFIRMED'],account:['verify_binding','ADAPAY_ACCOUNT_NOT_CONFIRMED'],network:['create_member','ADAPAY_NETWORK_ERROR'],unknown:['create_member','OPEN_UNCONFIRMED']}[failure];
  assert.equal(logs[0][1].stage,expected[0]);assert.equal(logs[0][1].code,expected[1]);
  const serialized=JSON.stringify(logs);
  for(const value of [form.realName,form.identity,form.bankCard,form.phone])assert(!serialized.includes(value));
  const row=Object.values(h.rows.payment).find(row=>row.kind==='adapay_account');
  assert.equal(row.status,'needs_check');assert.equal(row.leaseUntil,0);
 }
});


test('an uncertain binding recovers only a unique verified account for the same member without creating another',async()=>{
 const form={realName:'测试同学',identity:'11010519491231002X',bankCard:'6222020000001234',phone:'13800000000',rulesAccepted:true,authorizationAccepted:true};
 for(const mode of ['success','no-list','empty','ambiguous','wrong-app','wrong-member','wrong-mode','disabled','wrong-name','wrong-identity','wrong-card','wrong-prefix','pending','wrong-account-app','wrong-account-mode','wrong-account-member','corporate','wrong-detail-id','wrong-detail-card','weak-mask','network']){
  const h=harness(),member='runner_'+h.store.scopeKey('adapay-account',cfg.appid,cfg.prod,'rider'),calls=[],logs=[];
  const account={id:'bank1',status:'succeeded',app_id:cfg.appid,prod_mode:'false',channel:'bank_account',account_info:{card_id:'622202****1234',cert_id:'1101****002X',bank_acct_type:'2'}};
  const remote={member_id:member,app_id:cfg.appid,prod_mode:'false',status:'succeeded',identified:'Y',disabled:'N',user_name:form.realName,settle_accounts:[account]};
  if(mode==='no-list')delete remote.settle_accounts;
  if(mode==='empty')remote.settle_accounts=[];
  if(mode==='ambiguous')remote.settle_accounts.push({...account,id:'bank2'});
  if(mode==='wrong-app')remote.app_id='app_other';
  if(mode==='wrong-member')remote.member_id='runner_other';
  if(mode==='wrong-mode')remote.prod_mode='true';
  if(mode==='disabled')remote.disabled='Y';
  if(mode==='wrong-name')remote.user_name='另一人';
  if(mode==='wrong-identity')remote.cert_id='110105194912310011';
  if(mode==='wrong-card')account.account_info.card_id='622202****9999';
  if(mode==='wrong-prefix')account.account_info.card_id='999999****1234';
  if(mode==='pending')account.status='pending';
  if(mode==='wrong-account-app')account.app_id='app_other';
  if(mode==='wrong-account-mode')account.prod_mode='true';
  if(mode==='wrong-account-member')account.member_id='runner_other';
  if(mode==='corporate')account.account_info.bank_acct_type='1';
  if(mode==='weak-mask')account.account_info.card_id='6222********4';
  const api={request:async(m,p)=>{
   calls.push({m,p});
   if(p==='/v1/members/realname')return {member_id:member,app_id:cfg.appid,status:'succeeded',identified:'Y'};
   if(m==='POST')throw new Error('ADAPAY_NETWORK_ERROR');
   if(mode==='network')throw new Error('ADAPAY_NETWORK_ERROR');
   if(p==='/v1/settle_accounts/bank1'){
    if(mode==='wrong-detail-id')return {...account,id:'other'};
    if(mode==='wrong-detail-card')return {...account,account_info:{...account.account_info,card_id:'6222020000*****9'}};
    return account;
   }
   assert.equal(p,'/v1/members/'+member);
   return remote;
  }};
  const Service=load('service/adapay_account_service.js',{...h.deps,crypto,'./adapay_api.js':api},{console:{warn:(...args)=>logs.push(args)}}),service=new Service();
  await assert.rejects(service.open('rider',form),/尚未确认/);
  if(mode==='success'){
   const result=await service.open('rider',form);assert.equal(result.opened,true);assert.equal(result.cardTail,'1234');
   assert.equal((await service.requireReady('rider')).accountId,'bank1');
   await service.open('rider',form);
  }else {
   await assert.rejects(service.open('rider',form),/尚未确认/);
   const row=Object.values(h.rows.payment).find(row=>row.kind==='adapay_account');
   assert.equal(row.status,'needs_check');assert.equal(row.bindAttempted,true);assert(!row.accountId);
   const last=logs.at(-1)[1];assert.equal(last.stage,'recover_binding');
   if(mode!=='network'){assert(last.checks);assert(Object.values(last.checks).every(value=>typeof value==='boolean'));assert(Object.values(last.checks).includes(false));}
   for(const value of [form.realName,form.identity,form.bankCard,form.phone])assert(!JSON.stringify(logs).includes(value));
  }
  assert.equal(calls.filter(call=>call.m==='POST'&&call.p==='/v1/settle_accounts').length,1);
  const saved=JSON.stringify(h.rows.payment);
  for(const value of [form.realName,form.identity,form.bankCard,form.phone])assert(!saved.includes(value));
 }
});


test('binding validation reports boolean mismatch flags and never logs response or form contents',async()=>{
 const form={realName:'测试同学',identity:'11010519491231002X',bankCard:'6222020000001234',phone:'13800000000',rulesAccepted:true,authorizationAccepted:true};
 for(const failure of ['status','app','id','channel','member','card','infoString']){
  const h=harness(),member='runner_'+h.store.scopeKey('adapay-account',cfg.appid,cfg.prod,'rider'),logs=[];
  const account={status:'succeeded',app_id:cfg.appid,id:'bank1',channel:'bank_account',member_id:member,account_info:{card_id:'622202****1234'},description:form.identity};
  if(failure==='status')account.status='pending';
  if(failure==='app')account.app_id='app_other';
  if(failure==='id')delete account.id;
  if(failure==='channel')account.channel='other';
  if(failure==='member')account.member_id='other';
  if(failure==='card')account.account_info.card_id='622202****9999';
  if(failure==='infoString')account.account_info=JSON.stringify(account.account_info);
  const api={request:async(m,p)=>p==='/v1/members/realname'?{status:'succeeded',app_id:cfg.appid,member_id:member,identified:'Y'}:account};
  const Service=load('service/adapay_account_service.js',{...h.deps,crypto,'./adapay_api.js':api},{console:{warn:(...args)=>logs.push(args)}});
  await assert.rejects(new Service().open('rider',form),/尚未确认/);
  const checks=logs[0][1].checks;
  assert.equal(checks[failure==='card'||failure==='infoString'?'cardTail':failure],false);
  assert.equal(checks.accountInfoString,failure==='infoString');
  assert(Object.values(checks).every(value=>typeof value==='boolean'));
  for(const value of [form.realName,form.identity,form.bankCard,form.phone])assert(!JSON.stringify(logs).includes(value));
 }
});


test('GET requests follow official SDK headers and carry signed query parameters',async()=>{
 const {EventEmitter}=require('node:events');
 const https={request:(url,options,callback)=>{
  assert.equal(options.method,'GET');assert(!('Content-Type' in options.headers));
  assert.equal(url.searchParams.get('app_id'),cfg.appid);assert.equal(url.searchParams.get('member_id'),'runner_test');
  const canonical='https://api.adapay.tech/v1/members/runner_testapp_id='+cfg.appid+'&member_id=runner_test';
  assert(crypto.verify('RSA-SHA1',Buffer.from(canonical),pair.publicKey,Buffer.from(options.headers.Signature,'base64')));
  const req=new EventEmitter();req.setTimeout=()=>{};
  req.end=body=>{
   assert.equal(body,undefined);
   const res=new EventEmitter();res.statusCode=200;callback(res);
   const data=JSON.stringify({status:'succeeded'});
   queueMicrotask(()=>{res.emit('data',Buffer.from(JSON.stringify({data,signature:signed(data)})));res.emit('end');});
  };
  return req;
 }};
 const transport=load('service/adapay_api.js',{crypto,'../config/adapay_config.js':cfg,https});
 assert.equal((await transport.request('GET','/v1/members/runner_test',{member_id:'runner_test'})).status,'succeeded');
});

test('provider masks with ten leading digits and one trailing digit work for creation and signed recovery',async()=>{
 const form={realName:'测试同学',identity:'11010519491231002X',bankCard:'6222020000001234',phone:'13800000000',rulesAccepted:true,authorizationAccepted:true};
 for(const recovery of [false,true]){
  const h=harness(),member='runner_'+h.store.scopeKey('adapay-account',cfg.appid,cfg.prod,'rider'),calls=[];
  const account={status:'succeeded',app_id:cfg.appid,prod_mode:'false',id:'bank1',channel:'bank_account',member_id:member,
   account_info:{card_id:'6222020000*****4',cert_id:'1101051949*******X',bank_acct_type:'2'}};
  const summary={...account};delete summary.status;delete summary.prod_mode;
  const api={request:async(m,p,args)=>{
   calls.push({m,p});
   if(p==='/v1/members/realname')return {app_id:cfg.appid,member_id:member,status:'succeeded',identified:'Y'};
   if(m==='POST'){if(recovery)throw Error('ADAPAY_NETWORK_ERROR');return account;}
   assert.equal(args.member_id,member);
   if(p==='/v1/members/'+member)return {app_id:cfg.appid,member_id:member,prod_mode:'false',status:'succeeded',identified:'Y',disabled:'N',settle_accounts:[summary]};
   assert.equal(p,'/v1/settle_accounts/bank1');assert.equal(args.settle_account_id,'bank1');return account;
  }};
  const Service=load('service/adapay_account_service.js',{...h.deps,crypto,'./adapay_api.js':api},{console:{warn:()=>{}}}),service=new Service();
  if(recovery)await assert.rejects(service.open('rider',form),/尚未确认/);
  assert.equal((await service.open('rider',form)).opened,true);
  assert.equal(calls.filter(c=>c.m==='POST'&&c.p==='/v1/settle_accounts').length,1);
  if(recovery)assert(calls.some(c=>c.p==='/v1/settle_accounts/bank1'));
  for(const v of [form.realName,form.identity,form.bankCard,form.phone])assert(!JSON.stringify(h.rows).includes(v));
 }
});


test('external-fee rejection at split never falls back to deducting the runner share',async()=>{
 const h=harness(9),baseRequest=h.api.request,confirms=[];
 h.api.request=async(method,path,body)=>{
  if(path==='/v1/payments/confirm/list')return {status:'succeeded',payment_confirms:[]};
  if(path==='/v1/payments/confirm'){
   confirms.push(body);
   throw Object.assign(new Error('ADAPAY_REQUEST_FAILED'),{code:'not_support_out_fee',verified:true});
  }
  return baseRequest(method,path,body);
 };
 await assert.rejects(h.service.reconcile(h.id),error=>error.code==='not_support_out_fee');
 assert.equal(confirms.length,1);assert.equal(confirms[0].fee_mode,'O');
 assert.deepEqual(Array.from(confirms[0].div_members,part=>part.amount),['9.00','1.00']);
 assert(confirms[0].div_members.every(part=>!('fee_flag' in part)));
 assert.equal(h.rows.payment[h.id].state,'paid');
 assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'pending');
});


test('signed confirmation details without payment_id settle once using scoped list and object binding',async()=>{
 const h=harness(9),baseRequest=h.api.request;let parts,created=0;
 h.api.request=async(method,path,body)=>{
  if(path==='/v1/payments/confirm/list'){
   assert.equal(body.payment_id,'pay1');assert.equal(body.order_no,h.rows.payment[h.id].operationNo);
   return {status:'succeeded',payment_confirms:created?[{id:'confirm1',order_no:body.order_no}]:[]};
  }
  if(path==='/v1/payments/confirm'){created++;parts=body.div_members;return {id:'confirm1',status:'succeeded'};}
  if(path==='/v1/payments/confirm/confirm1')return {id:'confirm1',app_id:cfg.appid,prod_mode:'false',order_no:h.rows.payment[h.id].operationNo,confirm_amt:'10.00',div_members:parts,status:'succeeded'};
  return baseRequest(method,path,body);
 };
 await h.service.reconcile(h.id);assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'pending');
 await h.service.reconcile(h.id);assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'settled');
 await h.service.reconcile(h.id);assert.equal(created,1);assert.equal(h.rows.payment[h.id].state,'complete');
});

test('missing payment_id never permits mismatched confirmation object, app, mode, amounts or recipients',async()=>{
 for(const failure of ['id','order_no','app_id','prod_mode','payment_id','confirm_amt','parts']){
  const h=harness(9),baseRequest=h.api.request;
  h.api.request=async(method,path,body)=>{
   if(path==='/v1/payments/confirm/list')return {status:'succeeded',payment_confirms:[{id:'confirm1',order_no:body.order_no}]};
   if(path==='/v1/payments/confirm/confirm1'){
    const result={id:'confirm1',app_id:cfg.appid,prod_mode:'false',order_no:h.rows.payment[h.id].operationNo,confirm_amt:'10.00',div_members:[{member_id:'runner1',amount:'9.00'},{member_id:'0',amount:'1.00'}],status:'succeeded'};
    if(failure==='id')result.id='other';
    if(failure==='order_no')result.order_no='other';
    if(failure==='app_id')result.app_id='app_other';
    if(failure==='prod_mode')result.prod_mode='true';
    if(failure==='payment_id')result.payment_id='other_payment';
    if(failure==='confirm_amt')result.confirm_amt='0.10';
    if(failure==='parts')result.div_members[0].member_id='other_runner';
    return result;
   }
   assert.notEqual(method,'POST','existing operation must not be submitted again');
   return baseRequest(method,path,body);
  };
  await assert.rejects(h.service.reconcile(h.id),/MISMATCH/);
  assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'pending');assert.equal(h.rows.payment[h.id].state,'paid');
 }
});


test('saved confirmation ID is queried during list lag instead of submitting another split',async()=>{
 const h=harness(9),baseRequest=h.api.request;let created=0,queried=0,parts;
 h.api.request=async(method,path,body)=>{
  if(path==='/v1/payments/confirm/list')return {status:'succeeded',payment_confirms:[]};
  if(path==='/v1/payments/confirm'){created++;parts=body.div_members;return {id:'confirm1',status:'succeeded'};}
  if(path==='/v1/payments/confirm/confirm1'){
   queried++;return {id:'confirm1',order_no:h.rows.payment[h.id].operationNo,app_id:cfg.appid,prod_mode:'false',confirm_amt:'10.00',div_members:parts,status:'succeeded'};
  }
  return baseRequest(method,path,body);
 };
 await h.service.reconcile(h.id);assert.equal(h.rows.payment[h.id].operationId,'confirm1');
 await h.service.reconcile(h.id);await h.service.reconcile(h.id);
 assert.equal(created,1);assert.equal(queried,1);assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'settled');
});

test('conflicting listed and saved confirmation IDs never mark earnings settled or submit again',async()=>{
 const h=harness(9),baseRequest=h.api.request;let created=0;
 h.api.request=async(method,path,body)=>{
  if(path==='/v1/payments/confirm/list')return {status:'succeeded',payment_confirms:created?[{id:'other',order_no:body.order_no}]:[]};
  if(path==='/v1/payments/confirm'){created++;return {id:'confirm1',status:'succeeded'};}
  return baseRequest(method,path,body);
 };
 await h.service.reconcile(h.id);
 await assert.rejects(h.service.reconcile(h.id),/OPERATION_MISMATCH/);
 assert.equal(created,1);assert.equal(h.rows.payment[h.id].state,'paid');assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'pending');
});


test('new-user retry creates the same member after a verified member-not-found query',async()=>{
 for(const code of ['member_not_exists','member_not_exist','user_not_exists','user_not_exist']){
  const h=harness(),member='runner_'+h.store.scopeKey('adapay-account',cfg.appid,cfg.prod,'new-rider');
  const form={realName:'测试同学',identity:'11010519491231002X',bankCard:'6222020000001234',phone:'13800000000',rulesAccepted:true,authorizationAccepted:true};
  let creates=0,queries=0,binds=0;
  const api={request:async(method,path,body)=>{
   if(method==='GET'){
    queries++;assert.equal(path,'/v1/members/'+member);assert.equal(body.member_id,member);
    throw Object.assign(Error('ADAPAY_REQUEST_FAILED'),{code,verified:true});
   }
   if(path==='/v1/members/realname'){
    creates++;assert.equal(body.member_id,member);
    if(creates===1)throw Error('ADAPAY_NETWORK_ERROR');
    return {app_id:cfg.appid,member_id:member,status:'succeeded',identified:'Y'};
   }
   assert.equal(path,'/v1/settle_accounts');binds++;
   return {id:'bank1',app_id:cfg.appid,status:'succeeded',channel:'bank_account',account_info:{card_id:'6222020000*****4'}};
  }};
  const Service=load('service/adapay_account_service.js',{...h.deps,crypto,'./adapay_api.js':api},{console:{warn:()=>{}}}),service=new Service();
  await assert.rejects(service.open('new-rider',form),/尚未确认/);
  assert.equal((await service.open('new-rider',form)).opened,true);
  await service.open('new-rider',form);
  assert.equal(queries,1);assert.equal(creates,2);assert.equal(binds,1);
 }
});

test('member retry does not treat configuration, network or unverified errors as a missing user',async()=>{
 for(const error of [Object.assign(Error('ADAPAY_REQUEST_FAILED'),{code:'app_not_exists',verified:true}),Error('ADAPAY_NETWORK_ERROR'),Object.assign(Error('ADAPAY_REQUEST_FAILED'),{code:'member_not_exists',verified:false})]){
  const h=harness(),form={realName:'测试同学',identity:'11010519491231002X',bankCard:'6222020000001234',phone:'13800000000',rulesAccepted:true,authorizationAccepted:true};
  let creates=0,binds=0;
  const api={request:async(method,path)=>{
   if(method==='GET')throw error;
   if(path==='/v1/members/realname'){creates++;throw Error('ADAPAY_NETWORK_ERROR');}
   binds++;throw Error('unexpected binding');
  }};
  const Service=load('service/adapay_account_service.js',{...h.deps,crypto,'./adapay_api.js':api},{console:{warn:()=>{}}}),service=new Service();
  await assert.rejects(service.open('new-rider',form),/尚未确认/);
  await assert.rejects(service.open('new-rider',form),/尚未确认/);
  assert.equal(creates,1);assert.equal(binds,0);
 }
});

// ---- 开户/换卡的失败反馈、结果核对与更换结算银行卡 ----
const riderForm=(over={})=>({realName:'测试同学',identity:'11010519491231002X',bankCard:'6222020000001234',phone:'13800000000',rulesAccepted:true,authorizationAccepted:true,...over});
function accountHarness(handler){
 const h=harness(),member='runner_'+h.store.scopeKey('adapay-account',cfg.appid,cfg.prod,'rider'),calls=[];
 const api={request:async(m,p,b)=>{calls.push(m+' '+p);return handler(m,p,b,member);}};
 const Service=load('service/adapay_account_service.js',{...h.deps,crypto,'./adapay_api.js':api},{console:{warn:()=>{}}});
 const row=()=>Object.values(h.rows.payment).find(x=>x.kind==='adapay_account');
 return {h,member,calls,service:new Service(),row};
}
const rejected=(reason,code='channel_error')=>Object.assign(Error('ADAPAY_REQUEST_FAILED'),{code,verified:true,reason});
const realnameOk=member=>({app_id:cfg.appid,member_id:member,identified:'Y',status:'succeeded'});
const bank=(id,card)=>({id,app_id:cfg.appid,status:'succeeded',channel:'bank_account',prod_mode:'false',account_info:{card_id:card.slice(0,4)+'****'+card.slice(-4)}});

test('AdaPay rejection reasons are classified without keeping the provider description',()=>{
 for(const [data,reason] of [[{error_msg:'银行卡预留手机号不一致'},'phone'],[{invalid_param:'tel_no'},'phone'],[{error_msg:'该卡为信用卡，暂不支持'},'card_type'],
  [{error_msg:'姓名与身份证号不匹配'},'identity'],[{error_msg:'户名不符'},'name'],[{invalid_param:'card_id'},'card'],[{error_msg:'四要素验证失败'},'mismatch'],[{error_msg:'系统繁忙'},''],
  [{error_msg:'身份证号与银行卡不匹配'},'mismatch'],[{error_msg:'结算账户已存在'},'exists'],[{invalid_param:'card_id',error_msg:'预留手机号不一致'},'card']])
  assert.equal(wire.reasonOf(data),reason,JSON.stringify(data));
});

test('a verified bank rejection names the field to fix and the corrected details can be resubmitted',async()=>{
 let first=true;
 const t=accountHarness((m,p,b,member)=>{
  if(p==='/v1/members/realname')return realnameOk(member);
  if(p==='/v1/settle_accounts'){if(first){first=false;throw rejected('phone');}return bank('bank1',b.account_info.card_id);}
  throw Error('unexpected '+p);
 });
 await assert.rejects(t.service.open('rider',riderForm({phone:'13900000000'})),/预留手机号/);
 assert.equal(t.row().canCorrect,true);
 const result=await t.service.open('rider',riderForm());
 assert.equal(result.opened,true);
 assert.equal(t.calls.filter(x=>x.endsWith('/v1/members/realname')).length,1,'a confirmed realname member is reused');
});

test('provider or configuration failures are not reported as wrong user details',async()=>{
 const t=accountHarness((m,p,b,member)=>{
  if(p==='/v1/members/realname')return realnameOk(member);
  throw rejected('','system_exception');
 });
 await assert.rejects(t.service.open('rider',riderForm()),/暂时不可用/);
});

test('an unconfirmed result with changed details is reconciled before correction is allowed',async()=>{
 for(const accounts of [[],[{id:'other'}]]){
  let binds=0;
  const t=accountHarness((m,p,b,member)=>{
   if(p==='/v1/members/realname')return realnameOk(member);
   if(m==='GET'&&p==='/v1/members/'+member)return {...realnameOk(member),prod_mode:'false',disabled:'N',settle_accounts:accounts};
   if(p==='/v1/settle_accounts'){if(++binds===1)throw Error('ADAPAY_TIMEOUT');return bank('bank2',b.account_info.card_id);}
   throw Error('unexpected '+p);
  });
  await assert.rejects(t.service.open('rider',riderForm({phone:'13900000000'})),/尚未确认/);
  assert.equal(t.row().canCorrect,false);
  if(accounts.length){
   await assert.rejects(t.service.open('rider',riderForm()),/还在确认中/);
   assert.equal(binds,1,'an existing provider account blocks another binding');
  } else {
   const result=await t.service.open('rider',riderForm());
   assert.equal(result.opened,true);assert.equal(binds,2);
  }
 }
});

test('changing the settlement card requires the same person and deletes the old account before binding the new one',async()=>{
 const t=accountHarness((m,p,b,member)=>{
  if(p==='/v1/members/realname')return realnameOk(member);
  if(p==='/v1/settle_accounts')return bank(b.account_info.card_id.endsWith('1234')?'bank1':'bank2',b.account_info.card_id);
  if(p==='/v1/settle_accounts/delete'){assert.equal(JSON.stringify(b),JSON.stringify({member_id:member,settle_account_id:'bank1'}));return {id:'bank1',status:'succeeded',prod_mode:'false'};}
  throw Error('unexpected '+p);
 });
 await t.service.open('rider',riderForm());
 await assert.rejects(t.service.change('rider',riderForm({realName:'别人',bankCard:'6222020000005678'})),/开通时的本人姓名和身份证号/);
 await assert.rejects(t.service.change('rider',riderForm()),/无需更换/);
 await assert.rejects(t.service.open('rider',riderForm({bankCard:'6222020000005678'})),/更换结算银行卡/);
 const result=await t.service.change('rider',riderForm({bankCard:'6222020000005678'}));
 assert.equal(result.opened,true);assert.equal(result.cardTail,'5678');assert.equal(t.row().accountId,'bank2');
 const order=t.calls.filter(x=>x.includes('/v1/settle_accounts'));
 assert.deepEqual(order,['POST /v1/settle_accounts','POST /v1/settle_accounts/delete','POST /v1/settle_accounts']);
 const saved=JSON.stringify(t.h.rows.payment);assert(!saved.includes('6222020000005678'));
});

test('a refused card change keeps the old account and an unknown deletion is reconciled later',async()=>{
 let deletion='refuse';
 const t=accountHarness((m,p,b,member)=>{
  if(p==='/v1/members/realname')return realnameOk(member);
  if(p==='/v1/settle_accounts')return bank('bank1',b.account_info.card_id);
  if(p==='/v1/settle_accounts/delete'){if(deletion==='refuse')throw rejected('');throw Error('ADAPAY_TIMEOUT');}
  if(m==='GET'&&p==='/v1/members/'+member)return {...realnameOk(member),prod_mode:'false',disabled:'N',settle_accounts:[{id:'bank1'}]};
  if(m==='GET'&&p==='/v1/settle_accounts/bank1')return bank('bank1','6222020000001234');
  throw Error('unexpected '+p);
 });
 await t.service.open('rider',riderForm());
 await assert.rejects(t.service.change('rider',riderForm({bankCard:'6222020000005678'})),/继续有效/);
 assert.equal(t.row().status,'ready');assert.equal(t.row().accountId,'bank1');
 deletion='timeout';
 await assert.rejects(t.service.change('rider',riderForm({bankCard:'6222020000005678'})),/换卡结果暂未确认/);
 assert.equal(t.row().status,'needs_check');assert.equal(t.row().previousAccountId,'bank1');
 assert.equal((await t.service.status('rider')).pending,true);
 // 再次提交时先核对：原账户仍然有效，恢复为已开通，不会再绑一张卡。
 await assert.rejects(t.service.open('rider',riderForm({bankCard:'6222020000005678'})),/更换结算银行卡/);
 assert.equal(t.row().status,'ready');assert.equal(t.row().accountId,'bank1');
});

test('when the new card is rejected after the old one is removed the rider can correct and bind again',async()=>{
 let rejectNew=true,realname=0;
 const t=accountHarness((m,p,b,member)=>{
  if(p==='/v1/members/realname'){realname++;return realnameOk(member);}
  if(p==='/v1/settle_accounts'){
   if(b.account_info.card_id.endsWith('1234'))return bank('bank1',b.account_info.card_id);
   if(rejectNew){rejectNew=false;throw rejected('card_type');}
   return bank('bank3',b.account_info.card_id);
  }
  if(p==='/v1/settle_accounts/delete')return {id:'bank1',status:'succeeded'};
  throw Error('unexpected '+p);
 });
 await t.service.open('rider',riderForm());
 await assert.rejects(t.service.change('rider',riderForm({bankCard:'6222020000005678'})),/原结算银行卡已解除，新卡未绑定成功：该银行卡暂不支持/);
 const status=await t.service.status('rider');
 assert.equal(status.opened,false);assert.equal(status.identified,true);assert.equal(status.pending,false);
 const result=await t.service.open('rider',riderForm({bankCard:'6222020000009999'}));
 assert.equal(result.opened,true);assert.equal(t.row().accountId,'bank3');assert.equal(realname,1);
});
