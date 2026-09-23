const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const UserModel = require('../model/user_model.js');
const Operations = require('./operations_service.js');
const timeUtil = require('../../../framework/utils/time_util.js');
const crypto = require('crypto');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() { return Array.from(crypto.randomBytes(6), value => CODE_CHARS[value % CODE_CHARS.length]).join(''); }

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
        INV_ACCEPT_USER_ID: userId, INV_ACCEPT_USER_NAME: current.USER_NAME || '', INV_CODE: code, INV_STATUS: 1,
        INV_REWARD_STATUS: 0, INV_REWARD_DESC: '', INV_ADD_TIME: now, INV_EDIT_TIME: now, INV_ACCEPT_TIME: now
      });
      return { accepted: true, inviter: invite.INV_USER_ID };
    });
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
