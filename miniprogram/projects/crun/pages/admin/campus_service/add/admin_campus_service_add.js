const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../../helper/cloud_helper.js');

Page({

	data: {
		campusOptions: [],
		campusIndex: 0,
		formCampus: '',
		formName: '',
		formMobile: '',
		formWechat: '',
		formQQ: '',
		formWorkTime: '',
		formOrder: 9999,
		isSubmit: false
	},

	onLoad: async function (options) {
		if (!AdminBiz.isAdmin(this)) return;
		wx.setNavigationBarTitle({ title: '添加校区客服' });
  try { const response=await cloudHelper.callCloud('operations/config',{}, {hint:false}); const campuses=response.data.campuses; if(!this._destroyed)this.setData({campusOptions:campuses,formCampus:campuses[0] || '',isLoad:true}); }
  catch(error){ if(!this._destroyed)pageHelper.showModal(error.msg || error.message || '校区配置加载失败，请重新进入'); }
	},

	onUnload: function () { this._destroyed = true; },

	bindCampusChange: function (e) {
		const campusIndex = Number(e.detail.value);
		if (this.data.campusOptions[campusIndex]) this.setData({ campusIndex, formCampus: this.data.campusOptions[campusIndex] });
	},

	model: function (e) {
		pageHelper.model(this, e);
	},

	bindFormSubmit: async function () {
		if (!AdminBiz.isAdmin(this)) return;
		let { formCampus, formName, formMobile, formWechat, formQQ, formWorkTime, formOrder, isSubmit } = this.data;

		if (!this.data.campusOptions.includes(formCampus)) {
			return pageHelper.showModal('请先加载当前校区配置', '温馨提示');
		}
		if (!formName || !formName.trim()) {
			return pageHelper.showModal('请填写负责人姓名', '温馨提示');
		}
		if (!formMobile || !formMobile.trim()) {
			return pageHelper.showModal('请填写手机号', '温馨提示');
		}
		// 简单手机号校验
		if (!/^1\d{10}$/.test(formMobile.trim())) {
			return pageHelper.showModal('手机号格式不正确', '温馨提示');
		}

		if (isSubmit) return;
		if (!/^\d{1,6}$/.test(String(formOrder))) return pageHelper.showModal('排序号须为 0～999999 的整数', '温馨提示');
		this.setData({ isSubmit: true });

		try {
			let params = {
				campus: formCampus.trim(),
				name: formName.trim(),
				mobile: formMobile.trim(),
				wechat: (formWechat || '').trim(),
				qq: (formQQ || '').trim(),
				workTime: (formWorkTime || '').trim(),
				order: Number(formOrder),
			};
			await cloudHelper.callCloudSumbit('admin/campus_service_insert', params, { hint: false });
			if (this._destroyed) return;
			pageHelper.showSuccToast('添加成功', 2000, () => {
				if (!this._destroyed) wx.navigateBack();
			});
		} catch (err) {
			if (!this._destroyed) pageHelper.showModal((err && (err.msg || err.message)) || '添加失败，请稍后重试', '温馨提示');
		} finally {
			if (!this._destroyed) this.setData({ isSubmit: false });
		}
	},

	url: function (e) {
		pageHelper.url(e, this);
	}

});
