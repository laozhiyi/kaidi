'use strict';
const crypto = require('crypto');
const store = require('./operation_store.js');
const cfg = require('../config/adapay_config.js');
const api = require('./adapay_api.js');
const AppError = require('../../../framework/core/app_error.js');
const key = user => store.scopeKey('adapay-account', cfg.appid, cfg.prod, user);
const memberId = user => 'runner_' + key(user);
function digest(value) {return crypto.createHmac('sha256',cfg.digestKey).update(JSON.stringify(value)).digest('hex');}
function mask(row) {return {opened:row?.status==='ready',identified:row?.identified===true,name:row?.name || '',cardTail:row?.cardTail || '',status:row?.status || 'not_open',settlement:'auto'};}
// Compare visible digits of provider-masked numbers in memory; never persist them.
function numberMatches(value, expected) {
 if (typeof value !== 'string') return false;
 if (value === expected) return true;
 const parts = /^(\d{4,})\*+([\dX]{1,})$/.exec(value);
 return !!parts && parts[1].length + parts[2].length >= 8 && parts[1].length + parts[2].length < expected.length && expected.startsWith(parts[1]) && expected.endsWith(parts[2]);
}
function requireChecks(checks, code) {
 if (Object.values(checks).some(value => value !== true)) throw Object.assign(new Error(code),{bindingChecks:checks});
}
class AdapayAccountService {
 async recoverBinding(userId, reserved, input) {
  // Only a signed member query scoped to this app/user may supply an account ID.
  const member = await api.request('GET','/v1/members/'+reserved.memberId,{member_id:reserved.memberId});
  requireChecks({memberStatus:member?.status==='succeeded',memberApp:member?.app_id===cfg.appid,
   memberId:member?.member_id===reserved.memberId,memberEnvironment:String(member?.prod_mode)===String(cfg.prod),
   memberIdentified:member?.identified==='Y',memberEnabled:member?.disabled==='N',accountsPresent:Array.isArray(member?.settle_accounts)
  },'ADAPAY_BIND_OUTCOME_UNKNOWN');
  const remoteName = member.user_name || member.userName;
  requireChecks({name:!remoteName || remoteName===input.name,identity:!member.cert_id || numberMatches(member.cert_id,input.identity)},'ADAPAY_ACCOUNT_NOT_CONFIRMED');
  const matches = member.settle_accounts.filter(account => account && numberMatches(account.account_info?.card_id,input.card));
  requireChecks({unique:matches.length===1},'ADAPAY_BIND_OUTCOME_UNKNOWN');
  const summary = matches[0];
  // Member results contain account summaries without status/prod_mode. Confirm the
  // complete account via a separate signed query scoped to the same member.
  requireChecks({id:typeof summary.id==='string' && /^[A-Za-z0-9_]{1,64}$/.test(summary.id),
   app:summary.app_id===cfg.appid,member:!summary.member_id || summary.member_id===reserved.memberId
  },'ADAPAY_ACCOUNT_NOT_CONFIRMED');
  const account = await api.request('GET','/v1/settle_accounts/'+summary.id,{member_id:reserved.memberId,settle_account_id:summary.id});
  const info = account?.account_info;
  requireChecks({status:account?.status==='succeeded',app:account?.app_id===cfg.appid,environment:String(account?.prod_mode)===String(cfg.prod),
   sameAccount:account?.id===summary.id,cardMatches:numberMatches(info?.card_id,input.card),
   id:typeof account?.id==='string' && /^[A-Za-z0-9_]{1,64}$/.test(account.id),channel:account?.channel==='bank_account',
   member:!account?.member_id || account.member_id===reserved.memberId,personal:info?.bank_acct_type==='2',
   identity:!!info && (!info.cert_id || numberMatches(info.cert_id,input.identity))
  },'ADAPAY_ACCOUNT_NOT_CONFIRMED');
  return store.transaction(async tx => {
   const row = await this.stored(userId,tx);
   if (!row || row.memberId !== reserved.memberId || row.fingerprint !== reserved.fingerprint || !row.bindAttempted) throw new Error('ADAPAY_ACCOUNT_NOT_CONFIRMED');
   if (row.status === 'ready') {
    if (row.accountId !== account.id) throw new Error('ADAPAY_ACCOUNT_NOT_CONFIRMED');
    return mask(row);
   }
   const next = {...row,status:'ready',identified:true,accountId:account.id,canCorrect:false,leaseUntil:0,updatedAt:Date.now()};
   await store.set(tx,'payment',key(userId),next);
   return mask(next);
  });
 }

 async stored(userId, tx = store.database()) {
  const row = await store.get(tx,'payment',key(userId));
  if (row && row.appid === cfg.appid && row.prod === cfg.prod && row.userId === userId) return row;
  return null;
 }
 async status(userId) {
  await new (require('./mail_service.js'))()._user(userId);
  return {available:cfg.ready(),...mask(await this.stored(userId))};
 }
 async requireReady(userId, tx = store.database()) {
  const row = await this.stored(userId,tx);
  if (!row || row.status !== 'ready' || !row.accountId) throw new AppError('请先在“我的—跑腿结算”完成开通，再接取在线支付订单');
  return row;
 }
 async open(userId, input) {
  await new (require('./mail_service.js'))()._user(userId);
  if (!cfg.ready()) throw new AppError('结算服务暂不可用，请联系在线客服');
  if (input.rulesAccepted !== true || input.authorizationAccepted !== true) throw new AppError('请阅读并同意服务规则与实名信息授权');
  const name=String(input.realName || '').trim(), identity=String(input.identity || '').trim().toUpperCase();
  const card=String(input.bankCard || '').replace(/\s/g,''), phone=String(input.phone || '').trim();
  if (!name || name.length > 64 || !/^\d{17}[\dX]$/.test(identity) || !/^\d{16,19}$/.test(card) || !/^1\d{10}$/.test(phone)) throw new AppError('请检查姓名、身份证号、银行卡号和银行预留手机号');
  const fingerprint = digest([name,identity,card,phone]), identityDigest = digest([name,identity]);
  const id=key(userId), member=memberId(userId), now=Date.now();
  const reserved = await store.transaction(async tx => {
   const old=await this.stored(userId,tx);
   if (old && old.fingerprint !== fingerprint && (!old.canCorrect || old.identified && old.identityDigest !== identityDigest)) throw new AppError('已有开户申请，请先联系在线客服核对；请勿重复创建其他实名账户');
   if (old?.status === 'ready') return old;
   if (old?.leaseUntil > now) throw new AppError('开户申请处理中，请稍后刷新');
   await store.limitInTransaction(tx,'crun',userId,'adapay-open',5,3600000);
   const next={...old,_pid:'crun',kind:'adapay_account',userId,appid:cfg.appid,prod:cfg.prod,memberId:member,fingerprint,identityDigest,canCorrect:false,
    name:name.slice(0,1)+'**',cardTail:card.slice(-4),status:'processing',identified:old?.identified===true,
    consentVersion:'2026-11-25',consentedAt:now,leaseUntil:now+60000,updatedAt:now};
   await store.set(tx,'payment',id,next);return {...next,existed:!!old};
  });
  if (reserved.status === 'ready') return mask(reserved);
  let binding = false;
  let stage = 'member';
  try {
   // A retry queries the same deterministic member before attempting creation again.
   let real;
   if (reserved.identified) real={identified:'Y',member_id:member,app_id:cfg.appid,status:'succeeded'};
   else {
    if(reserved.existed) {
     stage = 'query_member';
     try {real=await api.request('GET','/v1/members/'+member,{member_id:member});} catch(e) {if (!['member_not_exist','user_not_exist','user_not_exists'].includes(e.code)) throw e;}
    }
    if (!real || real.identified !== 'Y') {
     stage = 'create_member';
     real=await api.request('POST','/v1/members/realname',{
     adapay_func_code:'members.realname',member_id:member,user_name:name,cert_type:'00',cert_id:identity,tel_no:phone});
    }
   }
   stage = 'verify_member';
   if (real.status !== 'succeeded' || real.member_id !== member || real.app_id !== cfg.appid || real.identified !== 'Y' || real.disabled === 'Y') throw new Error('ADAPAY_REALNAME_NOT_CONFIRMED');
   stage = 'save_identity';
   await store.transaction(async tx => {const row=await this.stored(userId,tx);await store.set(tx,'payment',id,{...row,identified:true});});
   // Full account data stays in request-local memory. Do not return or persist provider payloads.
   stage = 'guard_binding';
   if(reserved.bindAttempted) {
    stage = 'recover_binding';
    return await this.recoverBinding(userId,reserved,{name,identity,card});
   }
   stage = 'reserve_binding';
   await store.transaction(async tx=>{const row=await this.stored(userId,tx);await store.set(tx,'payment',id,{...row,bindAttempted:true});});
   binding = true;
   stage = 'create_binding';
   const account=await api.request('POST','/v1/settle_accounts',{member_id:member,channel:'bank_account',account_info:{
    card_id:card,card_name:name,cert_id:identity,cert_type:'00',tel_no:phone,bank_acct_type:'2'}});
   stage = 'verify_binding';
   const checks = {
    status: account?.status === 'succeeded', app: account?.app_id === cfg.appid,
    id: !!account?.id, channel: account?.channel === 'bank_account',
    member: !account?.member_id || account.member_id === member,
    accountInfoObject: !!account?.account_info && typeof account.account_info === 'object' && !Array.isArray(account.account_info),
    accountInfoString: typeof account?.account_info === 'string',
    cardPresent: typeof account?.account_info?.card_id === 'string' && account.account_info.card_id.length > 0,
    cardTail: String(account?.account_info?.card_id || '').slice(-4) === card.slice(-4),
    cardMatches: numberMatches(account?.account_info?.card_id,card)
   };
   if (['status','app','id','channel','member','cardMatches'].some(field => !checks[field])) {
    throw Object.assign(new Error('ADAPAY_ACCOUNT_NOT_CONFIRMED'),{bindingChecks:checks});
   }
   stage = 'save_account';
   return await store.transaction(async tx => {
    const row=await this.stored(userId,tx);
    const next={...row,status:'ready',accountId:account.id,leaseUntil:0,updatedAt:Date.now()};
    await store.set(tx,'payment',id,next);return mask(next);
   });
  } catch (e) {
   await store.transaction(async tx => {const row=await this.stored(userId,tx);if(row?.status!=='ready')await store.set(tx,'payment',id,{...row,status:'needs_check',canCorrect:e.verified === true,bindAttempted:binding && e.verified === true ? false : row.bindAttempted || false,leaseUntil:0,updatedAt:Date.now()});});
   // Only exact internal messages may become diagnostic codes. Provider descriptions
   // may contain identity/card data and must never be printed.
   const internalCodes = ['ADAPAY_REALNAME_NOT_CONFIRMED','ADAPAY_BIND_OUTCOME_UNKNOWN','ADAPAY_ACCOUNT_NOT_CONFIRMED','ADAPAY_NETWORK_ERROR','ADAPAY_TIMEOUT','DATABASE_TRANSACTION_CONFLICT'];
   const candidate = e.code || e.errCode;
   const code = typeof candidate === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(candidate) ? candidate
    : internalCodes.includes(e.message) ? e.message : 'OPEN_UNCONFIRMED';
   const diagnostics = {};
   // Only boolean fields created by our own validation may enter cloud logs.
   if (['verify_binding','recover_binding'].includes(stage) && e.bindingChecks) {
    diagnostics.checks = {};
    for (const field of ['status','app','id','channel','member','accountInfoObject','accountInfoString','cardPresent','cardTail','environment','personal','identity','name','unique','memberStatus','memberApp','memberId','memberEnvironment','memberIdentified','memberEnabled','accountsPresent','sameAccount','cardMatches']) {
     if (typeof e.bindingChecks[field] === 'boolean') diagnostics.checks[field] = e.bindingChecks[field];
    }
   }
   console.warn('[adapay] opening pending verification',{stage,code,...diagnostics});
   throw new AppError('开户或绑卡尚未确认，请稍后使用相同信息重试；如仍未完成，请联系在线客服');
  }
 }
}
module.exports = AdapayAccountService;
