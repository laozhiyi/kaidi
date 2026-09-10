const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const validate = require('../../../../../helper/validate.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const projectSetting = require('../../../public/project_setting.js');
const setting = require('../../../../../setting/setting.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
const profileMethods = require('../profile_methods.js');

Page(Object.assign({
	/**
	 * 页面的初始数据
	 */
	data: {
		isLoad: false,
		isEdit: true,

		userRegCheck: projectSetting.USER_REG_CHECK,
		mobileCheck: setting.MOBILE_CHECK
	},

	/**
	 * 生命周期函数--监听页面加载
	 */
	onLoad: async function (options) {
		ProjectBiz.initPage(this);
		await profileMethods.loadCampuses(this);
		await this._loadDetail();
	},

	_loadDetail: async function (e) {

		let opts = {
			title: 'bar'
		}
		let user = await cloudHelper.callCloudData('passport/my_detail', {}, opts);
		if (!user)
			return wx.redirectTo({ url: '../reg/my_reg' });

		this.setData({
			isLoad: true,
			isEdit: true,

			user,

			fields: projectSetting.USER_FIELDS,

			formName: user.USER_NAME,
			formMobile: user.USER_MOBILE,
			formPic: user.USER_PIC,
			formForms: user.USER_FORMS
		});
		profileMethods.applyUser(this, user)
	},

	/**
	 * 生命周期函数--监听页面初次渲染完成
	 */
	onReady: function () {

	},

	/**
	 * 生命周期函数--监听页面显示
	 */
	onShow: function () {

	},

	/**
	 * 生命周期函数--监听页面隐藏
	 */
	onHide: function () {

	},

	/**
	 * 生命周期函数--监听页面卸载
	 */
	onUnload: function () {

	},

	/**
	 * 页面相关事件处理函数--监听用户下拉动作
	 */
	onPullDownRefresh: async function () {
		await this._loadDetail();
		wx.stopPullDownRefresh();
	},

	/**
	 * 页面上拉触底事件的处理函数
	 */
	onReachBottom: function () {

	},

	bindGetPhoneNumber: async function (e) {
		await PassportBiz.getPhone(e, this);
	},

	bindPicTap: function (e) {  
		this.setData({
			formPic: e.detail.avatarUrl
		})
	},

	bindSubmitTap: async function (e) {
		try {
			let data = this.data;
			// 数据校验
			data = validate.check(data, projectSetting.USER_CHECK_FORM, this);
			if (!data) return;

			let forms = this.selectComponent("#cmpt-form").getForms(true);
			if (!forms) return;
			data.forms = forms;

			wx.showLoading({ title: '头像上传中' });
			let pic = await cloudHelper.transTempPicOne(this.data.formPic, 'user/', '', false);
			data.pic = pic;
			wx.hideLoading();

			// 手工处理表单中的图片（如收款码 payPic）：
			// 把本地临时路径（wxfile://tmp_xxx.jpg）逐张上传到云存储，
			// 并把 forms[i].val 数组中的元素替换为 cloud:// fileID，
			// 否则保存进数据库后，手机端读取会因本地路径不存在而无法显示
			for (let i = 0; i < forms.length; i++) {
				if (forms[i].type !== 'image') continue;
				if (!Array.isArray(forms[i].val)) continue;

				let needUploadIdx = [];
				for (let k = 0; k < forms[i].val.length; k++) {
					let p = forms[i].val[k] || '';
					if (p.includes('tmp') || p.includes('temp') || p.includes('wxfile')) {
						needUploadIdx.push(k);
					}
				}
				if (needUploadIdx.length === 0) continue;

				wx.showLoading({ title: '图片上传中(' + (forms[i].title || '') + ')' });
				let imgs = forms[i].val.slice();
				imgs = await cloudHelper.transTempPics(imgs, 'user/');
				wx.hideLoading();

				// transTempPics 会原地过滤失败项并返回新的数组，可能比原数组短
				forms[i].val = imgs;
			}

			data.forms = forms;

			let opts = {
				title: '提交中'
			}
			await cloudHelper.callCloudSumbit('passport/edit_base', data, opts).then(res => {
				let callback = () => {
					wx.reLaunch({ url: '../index/my_index' });
				}
				pageHelper.showSuccToast('修改成功', 1500, callback);
			});
		} catch (err) {
			console.error(err);
		}
	}
}, profileMethods));