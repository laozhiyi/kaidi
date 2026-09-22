/**
 * Notes: passport模块业务逻辑 
 * Date: 2020-10-14 07:48:00 
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 */

const BaseProjectService = require('./base_project_service.js');
const cloudBase = require('../../../framework/cloud/cloud_base.js');
const UserModel = require('../model/user_model.js');
const dataUtil = require('../../../framework/utils/data_util.js');
const store = require('./operation_store.js');
const rules = require('./order_rules.js');
const profileRules = require('./profile_rules.js');

function newUser(projectId, userId, id, now) {
 return { _pid: projectId, USER_ID: 'USER' + id.slice(0, 28), USER_MINI_OPENID: userId,
  USER_STATUS: 0, USER_PROFILE_COMPLETE: false, USER_MOBILE_VERIFIED: false, USER_NAME: '', USER_PIC: '',
  USER_FORMS: [], USER_OBJ: {}, USER_LOGIN_CNT: 0, USER_ADD_TIME: now };
}

class PassportService extends BaseProjectService {


 async _saveProfile(userId, input, registering) {
  if (!userId) this.AppError('请重新登录');
  const previous = await UserModel.getOne({ USER_MINI_OPENID: userId });
  if (previous && previous.USER_STATUS === 9) this.AppError('账号已停用，请联系客服');
  if (!profileRules.allowsManualRegistration() && (!previous || previous.USER_MOBILE_VERIFIED !== true)) this.AppError('请先使用微信手机号授权登录');
  if (!previous && !registering) this.AppError('请先注册并完善个人资料');
  const name = rules.text(input.name, '昵称', 30, true), mobile = rules.text(input.mobile, '手机', 11, true);
  if (previous && previous.USER_MOBILE_VERIFIED === true && mobile !== previous.USER_MOBILE) this.AppError('手机号已变化，请重新授权微信手机号后保存');
  const pic = rules.text(input.pic, '头像', 500, true), forms = input.forms || [];
  const error = profileRules.validationError({ name, mobile, pic, forms });
  if (error) this.AppError(error);
  const cfg = await new (require('./operation_config_service.js'))().getConfig();
  const campus = profileRules.formValue(forms, 'campus');
  if (!cfg.campuses.includes(campus) && campus !== profileRules.formValue(previous && previous.USER_FORMS, 'campus')) this.AppError('请选择有效的所在校区');
  const conflict = await UserModel.getOne({ USER_MOBILE: mobile, USER_MINI_OPENID: ['<>', userId] }, '_id');
  if (conflict) this.AppError('该联系电话已登记，请联系客服核实');
  await store.limit(this.getProjectId(), userId, 'profile', 10, 3600000);
  const id = previous ? previous._id : store.schoolKey(this.getProjectId(), 'user', userId);
  await store.transaction(async tx => {
   const scope = store.scope(), school = scope ? await store.get(tx, 'school', scope.schoolId) : null;
   if (scope && !school) this.AppError('学校配置不存在');
   const registrationReview = school ? school.registrationReview === true : cfg.registrationReview;
   const current = await store.get(tx, 'user', id);
   if (current && current.USER_STATUS === 9) this.AppError('账号已停用，请联系客服');
   if (!current && (previous || !registering)) this.AppError('账号状态已变化，请刷新后重试');
   if (!profileRules.allowsManualRegistration() && (!current || current.USER_MOBILE_VERIFIED !== true)) this.AppError('请先使用微信手机号授权登录');
   if (current && current.USER_MOBILE_VERIFIED === true && current.USER_MOBILE !== mobile) this.AppError('手机号已变化，请重新授权微信手机号后保存');
   if (registering && profileRules.isComplete(current)) return;
   if (current && previous && current.USER_MOBILE !== previous.USER_MOBILE && current.USER_MOBILE !== mobile) this.AppError('手机号已变化，请刷新资料后再保存');
   const phoneKey = store.schoolKey(this.getProjectId(), 'phone', mobile), phone = await store.get(tx, 'identity_unique', phoneKey);
   if (phone && phone.userId !== userId) this.AppError('该联系电话已登记，请联系客服核实');
   if (current && current.USER_MOBILE && current.USER_MOBILE !== mobile) {
    const oldKey = store.schoolKey(this.getProjectId(), 'phone', current.USER_MOBILE), old = await store.get(tx, 'identity_unique', oldKey);
    if (old && old.userId === userId) await tx.collection(store.collection('identity_unique')).doc(oldKey).remove();
   }
   const now = Date.now(), data = current || newUser(this.getProjectId(), userId, id, now);
   // Only first completion chooses the school's review policy. Editing an
   // existing pending/rejected account must not approve it implicitly.
   if (data.USER_STATUS === 8) data.USER_STATUS = 0;
   else if (data.USER_PROFILE_COMPLETE === false) data.USER_STATUS = registrationReview ? 0 : 1;
   Object.assign(data, { USER_NAME: name, USER_MOBILE: mobile, USER_MOBILE_VERIFIED: data.USER_MOBILE_VERIFIED === true,
    USER_PIC: pic, USER_FORMS: forms, USER_OBJ: dataUtil.dbForms2Obj(forms), USER_PROFILE_COMPLETE: true, USER_EDIT_TIME: now });
   await store.set(tx, 'identity_unique', phoneKey, { _pid: this.getProjectId(), userId, updatedAt: now });
   await store.set(tx, 'user', id, data);
  });
 }
 async register(userId,input){await this._saveProfile(userId,input,true);return this.login(userId);}

 /** The caller identity comes from the cloud WX context, never from the form. */
 async wechatLogin(userId, input) {
  if (!userId) this.AppError('请重新打开小程序登录');
  const code = rules.text(input && input.code, '微信手机号授权', 200, true);
  const previous = await UserModel.getOne({ USER_MINI_OPENID: userId });
  if (previous && previous.USER_STATUS === 9) this.AppError('账号已停用，请联系客服');
  await store.limit(this.getProjectId(), userId, 'wechat-phone', 10, 3600000);
  const cloud = cloudBase.getCloud();
  let result;
  try { result = await cloud.openapi.phonenumber.getPhoneNumber({ code }); }
  catch (error) {
   // Provider messages may echo the one-time code. Keep diagnostics numeric.
   const value = error && (error.errCode !== undefined ? error.errCode : error.errcode);
   const errCode = /^-?\d{1,8}$/.test(String(value)) ? Number(value) : null;
   console.warn('[wechat-phone-login]', { stage: 'phone_exchange_failure', errCode });
   this.AppError('微信手机号授权失败，请重新授权；如持续失败，请联系管理员检查手机号服务');
  }
  const info = result && (result.phoneInfo || result.phone_info);
  const appId = cloud.getWXContext().APPID;
  if (!result || (result.errCode !== undefined && Number(result.errCode) !== 0)
    || (result.errcode !== undefined && Number(result.errcode) !== 0) || !info || !appId
    || !info.watermark || info.watermark.appid !== appId) this.AppError('微信手机号授权已失效，请重新授权');
  const mobile = info.purePhoneNumber || info.pure_phone_number;
  if (String(info.countryCode || info.country_code) !== '86' || typeof mobile !== 'string' || !/^1[3-9][0-9]{9}$/.test(mobile)) this.AppError('请授权有效的中国大陆手机号');
  const conflict = await UserModel.getOne({ USER_MOBILE: mobile, USER_MINI_OPENID: ['<>', userId] }, '_id');
  if (conflict) this.AppError('该手机号已登记其他账号，请联系客服核实');
  const id = previous ? previous._id : store.schoolKey(this.getProjectId(), 'user', userId);
  await store.transaction(async tx => {
   const current = await store.get(tx, 'user', id);
   if (current && current.USER_STATUS === 9) this.AppError('账号已停用，请联系客服');
   const phoneKey = store.schoolKey(this.getProjectId(), 'phone', mobile), owner = await store.get(tx, 'identity_unique', phoneKey);
   if (owner && owner.userId !== userId) this.AppError('该手机号已登记其他账号，请联系客服核实');
   if (current && current.USER_MOBILE && current.USER_MOBILE !== mobile) {
    const oldKey = store.schoolKey(this.getProjectId(), 'phone', current.USER_MOBILE), old = await store.get(tx, 'identity_unique', oldKey);
    if (old && old.userId === userId) await tx.collection(store.collection('identity_unique')).doc(oldKey).remove();
   }
   const now = Date.now();
   const data = current || newUser(this.getProjectId(), userId, id, now);
   Object.assign(data, { USER_MOBILE: mobile, USER_MOBILE_VERIFIED: true, USER_EDIT_TIME: now });
   await store.set(tx, 'identity_unique', phoneKey, { _pid: this.getProjectId(), userId, updatedAt: now });
   await store.set(tx, 'user', id, data);
  });
  return { ...await this.login(userId), user: await this.getMyDetail(userId) };
 }
	/** 获取手机号码 */
	async getPhone(cloudID) {
		let cloud = cloudBase.getCloud();
		let res = await cloud.getOpenData({
			list: [cloudID], // 假设 event.openData.list 是一个 CloudID 字符串列表
		});
		if (res && res.list && res.list[0] && res.list[0].data) {

			let phone = res.list[0].data.phoneNumber;

			return phone;
		} else
			return '';
	}

	/** 取得我的用户信息 */
	async getMyDetail(userId) {
		let where = {
			USER_MINI_OPENID: userId
		}
		let fields = 'USER_PIC,USER_MOBILE,USER_MOBILE_VERIFIED,USER_PROFILE_COMPLETE,USER_NAME,USER_FORMS,USER_OBJ,USER_STATUS,USER_CHECK_REASON,USER_PAY_PIC'
		const user = await UserModel.getOne(where, fields);
  return user ? { ...user, USER_MOBILE_VERIFIED: user.USER_MOBILE_VERIFIED === true, USER_PROFILE_COMPLETE: profileRules.isComplete(user), allowManualRegistration: profileRules.allowsManualRegistration() } : null;
	}

 async editBase(userId,input){await this._saveProfile(userId,input,false);return {ok:true,...await this.login(userId)};}

	/** 登录 */
	async login(userId) {

		let where = {
			'USER_MINI_OPENID': userId
		};
		let fields = 'USER_ID,USER_MINI_OPENID,USER_NAME,USER_PIC,USER_STATUS,USER_MOBILE,USER_MOBILE_VERIFIED,USER_PROFILE_COMPLETE,USER_FORMS';
		let user = await UserModel.getOne(where, fields);
		let token = {};
		if (user) {

			// 正常用户
			token.id = user.USER_MINI_OPENID;
			token.key = user.USER_ID;
			token.name = user.USER_NAME;
			token.pic = user.USER_PIC;
			token.status = user.USER_STATUS;
   token.phoneVerified = user.USER_MOBILE_VERIFIED === true;
   token.profileComplete = profileRules.isComplete(user);
   token.allowManualRegistration = profileRules.allowsManualRegistration();

			// 异步更新最近更新时间
			let dataUpdate = {
				USER_LOGIN_TIME: this._timestamp
			};
			await UserModel.edit(where, dataUpdate);
			await UserModel.inc(where, 'USER_LOGIN_CNT', 1);

		} else
			token = null;

		return {
			token
		};
	}



}

module.exports = PassportService;
