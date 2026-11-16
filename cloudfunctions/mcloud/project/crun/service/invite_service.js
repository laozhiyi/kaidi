const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const UserModel = require('../model/user_model.js');
const Operations = require('./operations_service.js');
const timeUtil = require('../../../framework/utils/time_util.js');
const cloudBase = require('../../../framework/cloud/cloud_base.js');
const config = require('../../../config/config.js');
const AppError = require('../../../framework/core/app_error.js');
const crypto = require('crypto');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() { return Array.from(crypto.randomBytes(6), value => CODE_CHARS[value % CODE_CHARS.length]).join(''); }

// 扫码落地页：app.js 接收 scene 后把邀请码存进本地，注册时自动带上。
const QR_PAGE = 'projects/crun/pages/default/index/default_index';
const QR_MAX_AGE = 86400;
// 小程序码版本：develop 开发版 / trial 体验版 / release 正式版。
// 默认 trial（内测期）；正式上线前把云函数环境变量 INVITE_QR_ENV 设为 release，
// 或改 config/config.js 的 INVITE_QR_ENV。缓存按版本区分，切换后会自动重新生成。
const QR_ENVS = ['develop', 'trial', 'release'];
const QR_ERROR_TEXT = {
  41030: '小程序码需要正式版页面，当前还没有线上版本，可先分享给好友',
  48001: '小程序码接口未开通云调用权限，请联系管理员',
  48002: '小程序码接口未开通云调用权限，请联系管理员',
  45009: '小程序码生成太频繁了，请稍后再试'
};
function wxErrCode(error) {
  const raw = error && (error.errCode !== undefined ? error.errCode : error.errcode);
  return /^-?\d{1,8}$/.test(String(raw)) ? Number(raw) : null;
}
function qrErrorText(error) {
  const message = error && error.message || '';
  if (/[\u4e00-\u9fa5]/.test(message)) return message;
  return QR_ERROR_TEXT[wxErrCode(error)] || '小程序码暂时无法生成，请稍后重试';
}

class InviteService extends Base {
  async _user(userId, allowPending = false) {
    const user = userId && await UserModel.getOne({ USER_MINI_OPENID: userId });
    if (!user || (allowPending ? user.USER_STATUS === 9 : user.USER_STATUS !== 1)) this.AppError('请先完成注册并登录');
    return user;
  }
  async getOrCreateMyInviteCode(userId) {
    const user = await this._user(userId);
    const pid = this.getProjectId();
    const id = store.scopeKey(pid, 'invite-code', userId);
    const current = await store.get(store.database(), 'invite', id);
    if (current && current.INV_USER_ID === userId && current.INV_CODE) return { code: current.INV_CODE };
    const legacy = await store.database().collection(store.collection('invite')).where({ _pid: pid, INV_USER_ID: userId }).orderBy('INV_ADD_TIME', 'asc').limit(1).get();
    let code = legacy.data[0] && legacy.data[0].INV_CODE || newCode();
    for (let attempt = 0; attempt < 8; attempt++) {
      const owners = await store.database().collection(store.collection('invite')).where({ _pid: pid, INV_CODE: code }).limit(1).get();
      if (owners.data[0] && owners.data[0].INV_USER_ID !== userId) { code = newCode(); continue; }
      const result = await store.transaction(async tx => {
        const existing = await store.get(tx, 'invite', id);
        if (existing && existing.INV_USER_ID === userId && existing.INV_CODE) return { code: existing.INV_CODE };
        const currentUser = await store.get(tx, 'user', user._id);
        if (!currentUser || currentUser.USER_MINI_OPENID !== userId || currentUser.USER_STATUS !== 1) this.AppError('账号不可用');
        const uniqueId = store.schoolKey(pid, 'invite-code', code);
        const owner = await store.get(tx, 'identity_unique', uniqueId);
        if (owner && owner.userId !== userId) return null;
        const now = Date.now();
        await store.set(tx, 'identity_unique', uniqueId, { _pid: pid, userId, code, updatedAt: now });
        await store.set(tx, 'invite', id, {
          _pid: pid, INV_ID: id, INV_KIND: 'code', INV_USER_ID: userId, INV_USER_NAME: currentUser.USER_NAME || '',
          INV_ACCEPT_USER_ID: '', INV_ACCEPT_USER_NAME: '', INV_CODE: code, INV_STATUS: 0,
          INV_REWARD_STATUS: 0, INV_REWARD_DESC: '', INV_ADD_TIME: now, INV_EDIT_TIME: now, INV_ACCEPT_TIME: 0
        });
        return { code };
      });
      if (result) return result;
      code = newCode();
    }
    this.AppError('邀请码生成失败，请重试');
  }
  /**
   * 资料页用：我自己的邀请码（仅审核通过的账号才有）+ 我已绑定的邀请人的邀请码。
   * 已绑定的人资料页只读展示，不能再改。
   */
  async getMyInviteInfo(userId) {
    const user = await this._user(userId, true);
    const pid = this.getProjectId();
    const accepted = await store.get(store.database(), 'invite', store.scopeKey(pid, 'invite-accept', userId));
    const legacy = accepted ? null : (await store.database().collection(store.collection('invite')).where({ _pid: pid, INV_ACCEPT_USER_ID: userId }).limit(1).get()).data[0];
    const bound = accepted && accepted.INV_ACCEPT_USER_ID === userId ? accepted : legacy;
    const code = user.USER_STATUS === 1 ? (await this.getOrCreateMyInviteCode(userId)).code : '';
    return { code, bound: !!bound, boundCode: bound && bound.INV_CODE || '' };
  }
  async acceptInvite(userId, inputCode) {
    const user = await this._user(userId, true);
    const code = String(inputCode || '').trim().toUpperCase();
    const pid = this.getProjectId();
    if (!/^[A-Z0-9]{6}$/.test(code)) return { accepted: false, reason: '邀请码无效' };
    const result = await store.database().collection(store.collection('invite')).where({ _pid: pid, INV_CODE: code }).limit(1).get();
    const invite = result.data[0];
    if (!invite) return { accepted: false, reason: '邀请码无效' };
    if (invite.INV_USER_ID === userId) return { accepted: false, reason: '不能使用自己的邀请码' };
    const inviter = await UserModel.getOne({ USER_MINI_OPENID: invite.INV_USER_ID });
    if (!inviter || inviter.USER_STATUS === 9) return { accepted: false, reason: '邀请码已失效' };
    const legacy = await store.database().collection(store.collection('invite')).where({ _pid: pid, INV_ACCEPT_USER_ID: userId }).limit(1).get();
    if (legacy.data.length) return { accepted: true, alreadyAccepted: true, inviter: legacy.data[0].INV_USER_ID };
    const id = store.scopeKey(pid, 'invite-accept', userId);
    // 防刷：A 已经是被 B 邀请的，B 就不能再用 A 的码，否则两人互邀各拿两份首单奖励。
    const reverseId = store.scopeKey(pid, 'invite-accept', invite.INV_USER_ID);
    const mutual = row => !!row && row.INV_ACCEPT_USER_ID === invite.INV_USER_ID && row.INV_USER_ID === userId;
    if (mutual(await store.get(store.database(), 'invite', reverseId))) return { accepted: false, reason: '不能和邀请你的好友互相邀请' };
    return store.transaction(async tx => {
      const old = await store.get(tx, 'invite', id);
      if (old && old.INV_ACCEPT_USER_ID === userId) return { accepted: true, alreadyAccepted: true, inviter: old.INV_USER_ID };
      if (mutual(await store.get(tx, 'invite', reverseId))) return { accepted: false, reason: '不能和邀请你的好友互相邀请' };
      const current = await store.get(tx, 'user', user._id);
      if (!current || current._pid !== pid || current.USER_MINI_OPENID !== userId || current.USER_STATUS === 9) this.AppError('账号不可用');
      const source = await store.get(tx, 'invite', invite._id);
      const currentInviter = await store.get(tx, 'user', inviter._id);
      if (!source || source.INV_USER_ID !== invite.INV_USER_ID || source.INV_CODE !== code || !currentInviter
        || currentInviter.USER_MINI_OPENID !== invite.INV_USER_ID || currentInviter.USER_STATUS === 9
        || !await require('./account_service.js').guardRelated(tx, invite.INV_USER_ID)) return { accepted: false, reason: '邀请码已失效' };
      const now = Date.now();
      await store.set(tx, 'invite', id, {
        _pid: pid, INV_ID: id, INV_KIND: 'accept', INV_USER_ID: invite.INV_USER_ID, INV_USER_NAME: currentInviter.USER_NAME || '',
        INV_ACCEPT_USER_ID: userId, INV_ACCEPT_USER_NAME: current.USER_NAME || '', INV_CODE: code,
        // 审核制下「绑定」和「注册成功」是两件事：先记待审核，通过后再转已注册。
        INV_STATUS: current.USER_STATUS === 1 ? 1 : 0,
        INV_REWARD_STATUS: 0, INV_REWARD_DESC: '', INV_ADD_TIME: now, INV_EDIT_TIME: now, INV_ACCEPT_TIME: now
      });
      return { accepted: true, inviter: invite.INV_USER_ID };
    });
  }
  /**
   * 审核结果回写邀请关系：0=待审核 / 1=已注册 / 2=未通过或已停用。
   * 只改状态，不改邀请人和奖励字段，重复调用无副作用。
   */
  async syncAcceptedStatus(userId, userStatus) {
    if (!userId) return { changed: false };
    const status = Number(userStatus);
    const next = status === 1 ? 1 : status === 0 ? 0 : 2;
    const id = store.scopeKey(this.getProjectId(), 'invite-accept', userId);
    const current = await store.get(store.database(), 'invite', id);
    if (!current || current.INV_ACCEPT_USER_ID !== userId || Number(current.INV_STATUS) === next) return { changed: false };
    await store.transaction(async tx => {
      const row = await store.get(tx, 'invite', id);
      if (!row || row.INV_ACCEPT_USER_ID !== userId || Number(row.INV_STATUS) === next) return;
      const { _id, ...rest } = row;
      await store.set(tx, 'invite', id, { ...rest, INV_STATUS: next, INV_EDIT_TIME: Date.now() });
    });
    return { changed: true };
  }
  /**
   * 专属小程序码：scene 直接放 6 位邀请码，扫码进入首页即静默绑定。
   * 生成结果按「码 + 版本」缓存在邀请码文档上，同一用户只生成一次。
   */
  _qrEnv() {
    return QR_ENVS.includes(config.INVITE_QR_ENV) ? config.INVITE_QR_ENV : 'trial';
  }
  async getMyInviteQr(userId) {
    const { code } = await this.getOrCreateMyInviteCode(userId);
    const pid = this.getProjectId();
    const id = store.scopeKey(pid, 'invite-code', userId);
    const row = await store.get(store.database(), 'invite', id);
    const envVersion = this._qrEnv();
    // 缓存命中：同一个码、同一个小程序版本只生成一次，之后只换临时链接。
    let fileID = row && row.INV_QR_FILE && row.INV_QR_CODE === code && row.INV_QR_ENV === envVersion ? row.INV_QR_FILE : '';
    try {
      if (!fileID) {
        fileID = (await this._genInviteQr(pid, code, envVersion)).fileID;
        if (row) await store.database().collection(store.collection('invite')).doc(id).update({ data: {
          INV_QR_FILE: fileID, INV_QR_CODE: code, INV_QR_ENV: envVersion, INV_QR_TIME: Date.now()
        } });
      }
      const result = await cloudBase.getCloud().getTempFileURL({ fileList: [{ fileID, maxAge: QR_MAX_AGE }] });
      const item = result && result.fileList && result.fileList[0];
      const url = item && item.tempFileURL || '';
      if (!url) throw new AppError('小程序码地址获取失败，请稍后重试');
      return { code, fileID, url, envVersion };
    } catch (error) {
      // 生成失败不影响分享卡片和手填邀请码，页面降级提示即可。
      console.warn('[invite qr]', { errCode: wxErrCode(error) });
      return { code, fileID: '', url: '', envVersion, error: qrErrorText(error) };
    }
  }
  async _genInviteQr(pid, code, envVersion) {
    const cloud = cloudBase.getCloud();
    // wx-server-sdk 的参数是驼峰：checkPath 即接口文档里的 check_path，envVersion 即 env_version。
    // 还没上线，页面不在线上版本里，所以必须 checkPath:false。
    const result = await cloud.openapi.wxacode.getUnlimited({
      scene: code, page: QR_PAGE, width: 430, checkPath: false, envVersion
    });
    if (!result || !result.buffer) throw new AppError('小程序码生成失败，请稍后重试');
    const buffer = result.buffer;
    const upload = await cloud.uploadFile({ cloudPath: 'public/invite/' + pid + '/' + code + '-' + envVersion + '.png', fileContent: buffer });
    if (!upload || !upload.fileID) throw new AppError('小程序码保存失败，请稍后重试');
    return { fileID: upload.fileID, envVersion };
  }
  /**
   * 受邀好友「已使用」= 对方至少下过一单（状态不限）。
   * 按邮件集合反查，避免在发单链路里额外写标记；一次最多查 10 个好友。
   */
  async _usedIds(userIds) {
    const ids = [...new Set((userIds || []).filter(Boolean))], used = new Set();
    if (!ids.length) return used;
    const db = store.database();
    for (let i = 0; i < ids.length; i += 10) {
      const rows = await db.collection(store.collection('mail'))
        .where({ MAIL_USER_ID: db.command.in(ids.slice(i, i + 10)) })
        .field({ MAIL_USER_ID: true }).limit(1000).get();
      for (const row of rows.data || []) used.add(row.MAIL_USER_ID);
    }
    return used;
  }
  // 我的受邀记录：只含真正绑定过好友的行，按接受时间从新到旧分页读取。
  async _acceptedRows(userId) {
    const db = store.database(), rows = [];
    for (let page = 0; page < 10; page++) {
      const batch = await db.collection(store.collection('invite'))
        .where({ INV_USER_ID: userId, INV_ACCEPT_USER_ID: db.command.neq('') })
        .field({ INV_ACCEPT_USER_ID: true, INV_STATUS: true, INV_REWARD_STATUS: true })
        .orderBy('INV_ADD_TIME', 'desc').skip(page * 500).limit(500).get();
      rows.push(...(batch.data || []));
      if ((batch.data || []).length < 500) break;
    }
    return rows;
  }
  // 好友状态：未通过 / 待审核 / 未使用 / 已使用 / 已得奖励
  _inviteState(invite, used) {
    const status = Number(invite.INV_STATUS);
    if (Number(invite.INV_REWARD_STATUS) === 1) return { state: 'rewarded', stateText: '已得奖励' };
    if (used) return { state: 'used', stateText: '已使用' };
    if (status === 2) return { state: 'rejected', stateText: '未通过' };
    if (status === 1) return { state: 'unused', stateText: '未使用' };
    return { state: 'pending', stateText: '待审核' };
  }
  async getMyInviteList(userId, { page = 1, size = 20 } = {}) {
    await this._user(userId);
    const result = await new Operations().list('invite', {
      INV_USER_ID: userId, INV_ACCEPT_USER_ID: store.database().command.neq('')
    }, page, 'INV_ADD_TIME', size);
    const used = await this._usedIds(result.list.map(item => item.INV_ACCEPT_USER_ID));
    result.list = result.list.map(item => ({ ...item, ...this._inviteState(item, used.has(item.INV_ACCEPT_USER_ID)),
      INV_ADD_TIME: timeUtil.timestamp2Time(item.INV_ADD_TIME, 'Y-M-D h:m'),
      INV_ACCEPT_TIME: item.INV_ACCEPT_TIME ? timeUtil.timestamp2Time(item.INV_ACCEPT_TIME, 'Y-M-D h:m') : ''
    }));
    return result;
  }
  async getMyInviteStat(userId) {
    await this._user(userId);
    const rows = await this._acceptedRows(userId);
    const accepted = rows.filter(item => Number(item.INV_STATUS) === 1);
    const used = await this._usedIds(accepted.map(item => item.INV_ACCEPT_USER_ID));
    return {
      total: rows.length,
      accepted: accepted.length,
      // 已使用：绑定成功且至少下过一单的好友数。
      used: used.size,
      // 已得奖励：已完成首单并发放过积分的好友数。
      rewarded: rows.filter(item => Number(item.INV_REWARD_STATUS) === 1).length,
      pending: rows.filter(item => Number(item.INV_STATUS) === 0).length
    };
  }
}
module.exports = InviteService;
