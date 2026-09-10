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

class PassportService extends BaseProjectService {


 async _saveProfile(userId, input, registering) {
  if (!userId) this.AppError('请重新登录');
  const name=rules.text(input.name,'姓名',30,true), mobile=rules.text(input.mobile,'手机',11,true);
  if (!/^1[3-9][0-9]{9}$/.test(mobile)) this.AppError('手机号格式无效');
  const pic=rules.text(input.pic,'头像',500,true), forms=input.forms || [];
  if (!Array.isArray(forms) || forms.length>20 || JSON.stringify(forms).length>10000) this.AppError('资料过长');
  await store.limit(this.getProjectId(),userId,'profile',10,3600000);
  const previous=await UserModel.getOne({USER_MINI_OPENID:userId});
  if(registering && previous) return;
  if(!registering && !previous) this.AppError('请先注册');
  // Existing users must be migrated/deduplicated before enabling service.
  const conflict=await UserModel.getOne({USER_MOBILE:mobile,USER_MINI_OPENID:['<>',userId]},'_id');
  if(conflict) this.AppError('该联系电话已登记；如非本人登记，请联系客服核实');
  const cfg=await new (require('./operation_config_service.js'))().getConfig();
  const id=previous ? previous._id : store.key(this.getProjectId(),'user',userId);
  await store.transaction(async tx=>{
   const current=await store.get(tx,'user',id);
   if(registering && current) return;
   if(current && current.USER_STATUS===9) this.AppError('账号已停用，请联系客服');
   const phoneKey=store.key(this.getProjectId(),'phone',mobile), phone=await store.get(tx,'identity_unique',phoneKey);
   if(phone && phone.userId!==userId) this.AppError('该联系电话已登记，请联系客服核实');
   if(current && current.USER_MOBILE!==mobile){
    const oldKey=store.key(this.getProjectId(),'phone',current.USER_MOBILE), old=await store.get(tx,'identity_unique',oldKey);
    if(old && old.userId===userId) await tx.collection(store.collection('identity_unique')).doc(oldKey).remove();
   }
   const now=Date.now();const data=current || {_pid:this.getProjectId(),USER_ID:'USER'+id.slice(0,28),USER_MINI_OPENID:userId,USER_STATUS:cfg.registrationReview?0:1,USER_LOGIN_CNT:0,USER_ADD_TIME:now};
   if(data.USER_STATUS===8)data.USER_STATUS=0;
   Object.assign(data,{USER_NAME:name,USER_MOBILE:mobile,USER_MOBILE_VERIFIED:false,USER_PIC:pic,USER_FORMS:forms,USER_OBJ:dataUtil.dbForms2Obj(forms),USER_EDIT_TIME:now});
   // Self-entered contact details are never represented as verified identity.
   await store.set(tx,'identity_unique',phoneKey,{_pid:this.getProjectId(),userId,updatedAt:now});
   await store.set(tx,'user',id,data);
  });
 }
 async register(userId,input){await this._saveProfile(userId,input,true);return this.login(userId);}
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
		let fields = 'USER_PIC,USER_MOBILE,USER_MOBILE_VERIFIED,USER_NAME,USER_FORMS,USER_OBJ,USER_STATUS,USER_CHECK_REASON,USER_PAY_PIC'
		return await UserModel.getOne(where, fields);
	}

 async editBase(userId,input){await this._saveProfile(userId,input,false);return {ok:true};}

	/** 登录 */
	async login(userId) {

		let where = {
			'USER_MINI_OPENID': userId
		};
		let fields = 'USER_ID,USER_MINI_OPENID,USER_NAME,USER_PIC,USER_STATUS';
		let user = await UserModel.getOne(where, fields);
		let token = {};
		if (user) {

			// 正常用户
			token.id = user.USER_MINI_OPENID;
			token.key = user.USER_ID;
			token.name = user.USER_NAME;
			token.pic = user.USER_PIC;
			token.status = user.USER_STATUS;

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