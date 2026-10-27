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

// 扫码落地页：首页接收 scene 后把邀请码存进本地，注册时自动带上。
const QR_PAGE = 'projects/crun/pages/default/index/default_index';
const QR_MAX_AGE = 86400;
// 线上还没有这一版时先给体验版码；体验版码只沿用 1 小时，之后重试正式版，
// 避免正式发布后还在对外发只能体验成员打开的码。
const QR_FALLBACK_TTL = 60 * 60 * 1000;
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
    return store.transaction(async tx => {
      const old = await store.get(tx, 'invite', id);
      if (old && old.INV_ACCEPT_USER_ID === userId) return { accepted: true, alreadyAccepted: true, inviter: old.INV_USER_ID };
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
  async getMyInviteQr(userId) {
    const { code } = await this.getOrCreateMyInviteCode(userId);
    const pid = this.getProjectId();
    const id = store.scopeKey(pid, 'invite-code', userId);
    const row = await store.get(store.database(), 'invite', id);
    const preferred = config.INVITE_QR_ENV === 'trial' ? 'trial' : 'release';
    const cachedEnv = row && row.INV_QR_ENV || '';
    const cachedUsable = !!(row && row.INV_QR_FILE && row.INV_QR_CODE === code
      && (cachedEnv === preferred || Date.now() - Number(row.INV_QR_TIME || 0) < QR_FALLBACK_TTL));
    let fileID = cachedUsable ? row.INV_QR_FILE : '';
    let envVersion = cachedUsable ? cachedEnv : preferred;
    try {
      if (!fileID) {
        const generated = await this._genInviteQr(pid, code, preferred);
        fileID = generated.fileID;
        envVersion = generated.envVersion;
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
  async _genInviteQr(pid, code, preferred) {
    const cloud = cloudBase.getCloud();
    const request = async envVersion => {
      const result = await cloud.openapi.wxacode.getUnlimited({
        scene: code, page: QR_PAGE, width: 430, checkPath: false, envVersion
      });
      if (!result || !result.buffer) throw new AppError('小程序码生成失败，请稍后重试');
      return result.buffer;
    };
    let buffer;
    let envVersion = preferred;
    try {
      buffer = await request(preferred);
    } catch (error) {
      // 线上还没发布该页面时会报 41030/85096；退到体验版，内测阶段也能扫码验证。
      if (preferred !== 'release' || ![41030, 85096].includes(wxErrCode(error))) throw error;
      envVersion = 'trial';
      buffer = await request('trial');
    }
    const upload = await cloud.uploadFile({ cloudPath: 'public/invite/' + pid + '/' + code + '.png', fileContent: buffer });
    if (!upload || !upload.fileID) throw new AppError('小程序码保存失败，请稍后重试');
    return { fileID: upload.fileID, envVersion };
  }
  async getMyInviteList(userId, { page = 1, size = 20 } = {}) {
    await this._user(userId);
    const result = await new Operations().list('invite', {
      INV_USER_ID: userId, INV_ACCEPT_USER_ID: store.database().command.neq('')
    }, page, 'INV_ADD_TIME', size);
    result.list = result.list.map(item => ({ ...item,
      INV_ADD_TIME: timeUtil.timestamp2Time(item.INV_ADD_TIME, 'Y-M-D h:m'),
      INV_ACCEPT_TIME: item.INV_ACCEPT_TIME ? timeUtil.timestamp2Time(item.INV_ACCEPT_TIME, 'Y-M-D h:m') : ''
    }));
    return result;
  }
  async getMyInviteStat(userId) {
    await this._user(userId);
    const db = store.database();
    const where = { _pid: this.getProjectId(), INV_USER_ID: userId, INV_ACCEPT_USER_ID: db.command.neq('') };
    const count = async extra => (await db.collection(store.collection('invite')).where({ ...where, ...extra }).count()).total;
    const [total, accepted, reward, pending] = await Promise.all([count({}), count({ INV_STATUS: 1 }), count({ INV_REWARD_STATUS: 1 }), count({ INV_STATUS: 0 })]);
    return { total, accepted, reward, pending };
  }
}
module.exports = InviteService;
