'use strict';
const crypto = require('crypto');
const store = require('./operation_store.js');
const cfg = require('../config/adapay_config.js');
const api = require('./adapay_api.js');
const AppError = require('../../../framework/core/app_error.js');
const key = user => store.scopeKey('adapay-account', cfg.appid, cfg.prod, user);
const memberId = user => 'runner_' + key(user);
function digest(value) {return crypto.createHmac('sha256',cfg.digestKey).update(JSON.stringify(value)).digest('hex');}
// 与小程序 public/agreements.js 中骑手协议的 version 保持一致。
const Agreements = require('../public/agreement_versions.js');
const CONSENT_VERSION = Agreements.VERSION;
function checkConsent(input) {try {Agreements.requireRider(input);} catch(error) {throw new AppError(error.message);}}
const MEMBER_MISSING = ['member_not_exists','member_not_exist','user_not_exist','user_not_exists'];
// 支付机构明确拒绝（签名有效的失败应答）时，按拒绝类别提示用户改哪一项。
const REJECTED = {
 phone:'银行预留手机号与银行登记的不一致，请核对后重新提交（可在银行App或柜台查询预留手机号）',
 card_type:'该银行卡暂不支持，请改用本人Ⅰ类借记卡（不支持信用卡及Ⅱ、Ⅲ类卡）',
 identity:'姓名与身份证号未通过核验，请确认填写的是本人真实信息',
 name:'姓名与银行卡开户名不一致，请填写银行卡开户人本人的姓名',
 card:'银行卡号未通过核验，请确认卡号无误且为本人Ⅰ类借记卡',
 limit:'核验次数过多，请稍后再试',
 exists:'支付机构显示该账户已登记过，请通过“反馈与投诉”提交问题核对后再办理',
 mismatch:'姓名、身份证号、银行卡号与预留手机号未能匹配，请逐项核对后重新提交',
 '':'支付机构未通过本次核验，请核对填写的信息后重新提交；仍有问题请通过“反馈与投诉”提交问题'
};
// 这些错误码说明是平台配置或支付机构自身的问题，与用户填写无关。
const SERVICE_CODES = ['app_not_exists','system_exception','config_exception','security_exception','mer_not_register','agent_mer_conf_error','fee_not_config','pay_channel_not_config','risk_trade'];
const PENDING = '开户或绑卡结果尚未确认，请稍后刷新本页查看。如需再次提交，请使用相同信息；仍未完成请通过“反馈与投诉”提交问题';
const SAME_PERSON = '你已用其他姓名和身份证号在支付机构完成实名，结算账户只能使用该本人信息；如有疑问请通过“反馈与投诉”提交问题';
const UNCONFIRMED = '上次提交的办理结果还在确认中，请稍后刷新本页；也可以先用上次相同的信息再提交一次以确认结果。需要更换信息请通过“反馈与投诉”提交问题';
// 只有提交开户、绑卡资料的两步被明确拒绝时，才提示用户修改填写内容；查询类步骤出错按结果未确认处理。
function userMessage(e, stage) {
 if (e && e.verified === true && ['create_member','create_binding'].includes(stage)) {
  if (e.reason && REJECTED[e.reason]) return REJECTED[e.reason];
  if (SERVICE_CODES.includes(e.code) || /^token_/.test(e.code || '')) return '结算服务暂时不可用，请稍后再试或通过“反馈与投诉”提交问题';
  return REJECTED[''];
 }
 return PENDING;
}
function parseInput(input) {
 const name=String(input.realName || '').trim(), identity=String(input.identity || '').trim().toUpperCase();
 const card=String(input.bankCard || '').replace(/\s/g,''), phone=String(input.phone || '').trim();
 if (!name || name.length > 64) throw new AppError('请填写本人真实姓名');
 if (!/^\d{17}[\dX]$/.test(identity)) throw new AppError('请填写18位身份证号');
 if (!/^\d{16,19}$/.test(card)) throw new AppError('请填写16至19位本人银行卡号');
 if (!/^1\d{10}$/.test(phone)) throw new AppError('请填写11位银行预留手机号');
 return {name,identity,card,phone,fingerprint:digest([name,identity,card,phone]),identityDigest:digest([name,identity])};
}
// pending: 上次办理结果不明，正等待核对；页面据此提示刷新或联系客服。
// boundAt：当前这张卡的绑定时间，换卡后更新；老记录没有该字段时用开通时的授权时间。
function mask(row) {return {opened:row?.status==='ready',identified:row?.identified===true,pending:row?.status==='changing' || row?.status==='needs_check' && row?.canCorrect !== true,name:row?.name || '',cardTail:row?.cardTail || '',boundAt:row?.status==='ready' ? (row.cardBoundAt === undefined ? row.consentedAt || 0 : row.cardBoundAt) : 0,status:row?.status || 'not_open',settlement:'auto',consentCurrent:Agreements.currentRider(row)};}
// 换卡记录写在账户文档里，最多保留最近 20 次，后台用户详情按时间倒序展示。
// result：processing 办理中、succeeded 已更换、refused 支付机构未受理（原卡有效）、
// unconfirmed 解除原卡结果不明、failed 原卡已解除但新卡未绑定、restored 核对后恢复原卡。
const HISTORY_LIMIT = 20;
function addHistory(row, entry) {return [...(Array.isArray(row?.cardHistory) ? row.cardHistory : []), entry].slice(-HISTORY_LIMIT);}
// 每条记录带随机 id，按 id 更新结果；同一毫秒内的两次换卡也不会互相覆盖。
function settleHistory(row, entryId, result) {
 return (Array.isArray(row?.cardHistory) ? row.cardHistory : []).map(item => item.id === entryId ? {...item,result,updatedAt:Date.now()} : item);
}
// 账户变为已开通时：记录首次开通时间、当前卡的绑定时间，并把仍未结束的换卡记录标为已更换。
function readyFields(row, accountId) {
 const now = Date.now(), changed = row.accountId !== accountId || !row.cardBoundAt;
 let history = (Array.isArray(row.cardHistory) ? row.cardHistory : []).map(item =>
  ['processing','unconfirmed','failed'].includes(item.result) && item.toTail === row.cardTail ? {...item,result:'succeeded',updatedAt:now} : item);
 // 换卡时新卡被拒、原卡已解除，之后改用另一张卡重新绑定成功：补一条记录。
 const last = history[history.length - 1];
 if (last && last.result === 'failed' && last.toTail !== row.cardTail) history = addHistory({cardHistory:history},{id:crypto.randomBytes(8).toString('hex'),at:now,fromTail:last.fromTail,toTail:row.cardTail,result:'succeeded',updatedAt:now});
 return {openedAt:row.openedAt || now,cardBoundAt:changed ? now : row.cardBoundAt,cardHistory:history};
}
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
   const next = {...row,...readyFields(row,account.id),status:'ready',identified:true,accountId:account.id,canCorrect:false,leaseUntil:0,updatedAt:Date.now()};
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
  const account = mask(await this.stored(userId));
  // 已开通时提前告知能否换卡，页面据此禁用「更换结算银行卡」并说明原因。
  return {available:cfg.ready(),...account,changeBlocked:account.opened ? await this.openOrders(userId) : ''};
 }
 // 换卡前要求本人名下没有进行中的发布或接单，也没有正在结算的跑腿报酬：
 // 解除原卡到新卡生效之间收不到分账，进行中的订单完成时会结算失败。
 // 返回拦截原因，空字符串表示可以换卡。云开发事务内不能 where 查询，因此在事务外检查。
 async openOrders(userId) {
  const db = store.database(), cmd = db.command, mail = db.collection(store.collection('mail'));
  for (const field of ['MAIL_USER_ID','MAIL_ACCEPT_USER_ID']) {
   const rows = await mail.where(cmd.and([{_pid:'crun',[field]:userId,MAIL_ADMIN_DELETED:cmd.neq(true)},{MAIL_STATUS:cmd.neq(9)},{MAIL_STATUS:cmd.neq(99)}])).limit(1).get();
   if (rows.data.length) return '你还有未完成的' + (field === 'MAIL_USER_ID' ? '发布' : '接单') + '订单，订单全部完成或取消后才能更换结算银行卡';
  }
  const earnings = await mail.where({_pid:'crun',MAIL_ACCEPT_USER_ID:userId,MAIL_STATUS:9,MAIL_EARNINGS_STATUS:'pending'}).limit(1).get();
  return earnings.data.length ? '你还有跑腿报酬正在结算，结算完成后才能更换结算银行卡' : '';
 }
 // 后台用户详情：只给脱敏信息、开通与绑卡时间和换卡记录，不返回账户标识。
 async adminSummary(userId) {
  const row = await this.stored(userId);
  if (!row) return null;
  return {...mask(row),openedAt:row.openedAt || (row.status === 'ready' ? row.consentedAt || 0 : 0),
   history:(Array.isArray(row.cardHistory) ? row.cardHistory : []).slice().reverse().map(item => ({at:item.at,fromTail:item.fromTail || '',toTail:item.toTail || '',result:item.result || ''}))};
 }
 // 上次结果不明（超时、应答丢失）且用户改了信息时，只读查询支付机构：
 // 确认该用户名下没有任何结算账户，才允许改填；换卡时删除结果不明而原账户仍有效的，恢复为已开通。
 // 查询失败或情况不符时保持待核对，交由客服与支付机构核实。
 async reconcile(userId, row) {
  let member = null;
  try {member = await api.request('GET','/v1/members/'+row.memberId,{member_id:row.memberId});}
  catch (e) {if (e.verified !== true || !MEMBER_MISSING.includes(e.code)) return;}
  if (member && (member.status!=='succeeded' || member.app_id!==cfg.appid || member.member_id!==row.memberId ||
   String(member.prod_mode)!==String(cfg.prod) || !Array.isArray(member.settle_accounts))) return;
  const accounts = member ? member.settle_accounts.filter(Boolean) : [];
  let restore = '';
  if (accounts.length) {
   if (!row.previousAccountId || accounts.length !== 1 || accounts[0].id !== row.previousAccountId) return;
   let account = null;
   try {account = await api.request('GET','/v1/settle_accounts/'+row.previousAccountId,{member_id:row.memberId,settle_account_id:row.previousAccountId});} catch (_) {return;}
   if (account?.status!=='succeeded' || account.id!==row.previousAccountId || account.app_id!==cfg.appid || String(account.prod_mode)!==String(cfg.prod)) return;
   restore = account.id;
  }
  await store.transaction(async tx => {
   const cur = await this.stored(userId,tx);
   if (!cur || cur.status === 'ready' || cur.canCorrect || cur.fingerprint !== row.fingerprint || cur.leaseUntil > Date.now()) return;
   const next = restore ? {...cur,status:'ready',identified:true,accountId:restore,previousAccountId:'',cardTail:cur.previousCardTail || cur.cardTail,
    cardHistory:(cur.cardHistory || []).map(item => ['processing','unconfirmed'].includes(item.result) ? {...item,result:'restored',updatedAt:Date.now()} : item),leaseUntil:0,updatedAt:Date.now()}
    : {...cur,canCorrect:true,bindAttempted:false,identified:member?.identified==='Y',previousAccountId:'',updatedAt:Date.now()};
   await store.set(tx,'payment',key(userId),next);
  });
 }
 // 更换结算银行卡：支付机构要求先删除原结算账户，再用同一 member_id、同一身份证和户名创建新账户。
 async change(userId, input) {
  await new (require('./mail_service.js'))()._user(userId);
  if (!cfg.ready()) throw new AppError('结算服务暂不可用，请通过“反馈与投诉”提交问题');
  checkConsent(input);
  const p = parseInput(input), id = key(userId), now = Date.now(), entryId = crypto.randomBytes(8).toString('hex');
  const blocked = await this.openOrders(userId);
  if (blocked) throw new AppError(blocked);
  const old = await store.transaction(async tx => {
   const row = await this.stored(userId,tx);
   if (!row || row.status !== 'ready' || !row.accountId) throw new AppError('结算账户尚未开通，请先完成开通');
   if (row.identityDigest !== p.identityDigest) throw new AppError('更换银行卡须填写开通时的本人姓名和身份证号');
   if (row.fingerprint === p.fingerprint) throw new AppError('填写的信息与当前结算账户相同，无需更换');
   await store.limitInTransaction(tx,'crun',userId,'adapay-open',5,3600000);
   // 记下原账户：若进程在删除前后中断，下次提交时 reconcile 可据此查询并恢复。
   // 同时写一条换卡记录，后续每个结束分支都会更新它的结果。
   await store.set(tx,'payment',id,{...row,consentVersion:CONSENT_VERSION,authorizationVersion:CONSENT_VERSION,consentedAt:now,status:'changing',previousAccountId:row.accountId,previousCardTail:row.cardTail,leaseUntil:now+60000,updatedAt:now,
    cardHistory:addHistory(row,{id:entryId,at:now,fromTail:row.cardTail || '',toTail:p.card.slice(-4),result:'processing',updatedAt:now})});
   return row;
  });
  try {
   const result = await api.request('POST','/v1/settle_accounts/delete',{member_id:old.memberId,settle_account_id:old.accountId});
   if (result?.status !== 'succeeded' || result.id && result.id !== old.accountId) throw new Error('ADAPAY_DELETE_NOT_CONFIRMED');
  } catch (e) {
   const refused = e.verified === true;
   await store.transaction(async tx => {
    const row = await this.stored(userId,tx);
    if (row?.status !== 'changing') return;
    await store.set(tx,'payment',id,refused ? {...row,status:'ready',previousAccountId:'',leaseUntil:0,updatedAt:Date.now(),cardHistory:settleHistory(row,entryId,'refused')}
     : {...row,status:'needs_check',accountId:'',previousAccountId:old.accountId,canCorrect:false,bindAttempted:false,leaseUntil:0,updatedAt:Date.now(),cardHistory:settleHistory(row,entryId,'unconfirmed')});
   });
   const code = typeof e.code === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(e.code) ? e.code : e.message === 'ADAPAY_DELETE_NOT_CONFIRMED' ? e.message : 'DELETE_UNCONFIRMED';
   console.warn('[adapay] settle account change not completed',{stage:'delete_account',code,refused});
   throw new AppError(refused ? '支付机构暂未受理换卡，原结算银行卡继续有效，请稍后再试' : '换卡结果暂未确认，原结算银行卡可能已解除。请稍后刷新本页，按页面提示重新提交新银行卡');
  }
  await store.transaction(async tx => {
   const row = await this.stored(userId,tx);
   await store.set(tx,'payment',id,{...row,status:'needs_check',accountId:'',previousAccountId:'',identified:true,canCorrect:true,bindAttempted:false,leaseUntil:0,updatedAt:Date.now()});
  });
  try {return await this.open(userId,input,{counted:true});}
  catch (e) {
   await store.transaction(async tx => {
    const row = await this.stored(userId,tx);
    if (row && row.status !== 'ready') await store.set(tx,'payment',id,{...row,cardHistory:settleHistory(row,entryId,'failed')});
   });
   throw new AppError('原结算银行卡已解除，新卡未绑定成功：' + (e instanceof AppError ? e.message : PENDING));
  }
 }
 async requireReady(userId, tx = store.database()) {
  const row = await this.stored(userId,tx);
  if (!row || row.status !== 'ready' || !row.accountId) throw new AppError('请先在“我的—跑腿结算”完成开通，再接取在线支付订单');
  return row;
 }
 async acceptAgreements(userId,input) {
  await new (require('./mail_service.js'))()._user(userId);
  checkConsent(input);
  return store.transaction(async tx=>{
   const row=await this.stored(userId,tx);
   if (!row || row.status!=='ready') throw new AppError('请先完成结算开户');
   if (Agreements.currentRider(row)) return mask(row);
   const now=Date.now(), record={consentVersion:CONSENT_VERSION,authorizationVersion:CONSENT_VERSION,consentedAt:now};
   const next={...row,...record,cardBoundAt:row.cardBoundAt === undefined ? row.consentedAt || 0 : row.cardBoundAt,consentHistory:[...(row.consentHistory || []),{consentVersion:row.consentVersion || '',authorizationVersion:row.authorizationVersion || '',consentedAt:row.consentedAt || 0}],updatedAt:now};
   await store.set(tx,'payment',key(userId),next); return mask(next);
  });
 }
 async open(userId, input, options = {}) {
  await new (require('./mail_service.js'))()._user(userId);
  if (!cfg.ready()) throw new AppError('结算服务暂不可用，请通过“反馈与投诉”提交问题');
  checkConsent(input);
  const {name,identity,card,phone,fingerprint,identityDigest} = parseInput(input);
  const id=key(userId), member=memberId(userId), now=Date.now();
  const before = await this.stored(userId);
  if (before && before.status !== 'ready' && !before.canCorrect && before.fingerprint !== fingerprint && !(before.leaseUntil > now)) await this.reconcile(userId,before);
  const reserved = await store.transaction(async tx => {
   const old=await this.stored(userId,tx);
   if (old?.status === 'ready') {
    if (old.fingerprint === fingerprint) return old;
    throw new AppError('结算账户已开通；如需换卡，请在本页点「更换结算银行卡」');
   }
   if (old && old.fingerprint !== fingerprint) {
    if (old.identified && old.identityDigest !== identityDigest) throw new AppError(SAME_PERSON);
    if (!old.canCorrect) throw new AppError(UNCONFIRMED);
   }
   if (old?.leaseUntil > now) throw new AppError('开户申请处理中，请稍后刷新');
   if (!options.counted) await store.limitInTransaction(tx,'crun',userId,'adapay-open',5,3600000);
   const next={...old,_pid:'crun',kind:'adapay_account',userId,appid:cfg.appid,prod:cfg.prod,memberId:member,fingerprint,identityDigest,canCorrect:false,
    name:name.slice(0,1)+'**',cardTail:card.slice(-4),status:'processing',identified:old?.identified===true,
    consentVersion:CONSENT_VERSION,authorizationVersion:CONSENT_VERSION,consentedAt:now,leaseUntil:now+60000,updatedAt:now};
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
     try {real=await api.request('GET','/v1/members/'+member,{member_id:member});} catch(e) {if (e.verified !== true || !['member_not_exists','member_not_exist','user_not_exist','user_not_exists'].includes(e.code)) throw e;}
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
    const next={...row,...readyFields(row,account.id),status:'ready',accountId:account.id,leaseUntil:0,updatedAt:Date.now()};
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
   // reason 是固定的拒绝类别（如 phone、card），不含用户填写内容。
   console.warn('[adapay] opening not completed',{stage,code,verified:e.verified === true,reason:e.verified === true && e.reason || '',...diagnostics});
   throw new AppError(userMessage(e,stage));
  }
 }
}
module.exports = AdapayAccountService;
