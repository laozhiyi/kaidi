const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../../helper/cloud_helper.js');

Page({

	data: {
		campusOptions: ['育才校区', '王城校区', '雁山校区'],
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
		this.setData({ isLoad: true });
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
			return pageHelper.showModal('请选择育才、王城或雁山校区', '温馨提示');
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
		this.setData({ isSubmit: true });

		try {
			let params = {
				campus: formCampus.trim(),
				name: formName.trim(),
				mobile: formMobile.trim(),
				wechat: (formWechat || '').trim(),
				qq: (formQQ || '').trim(),
				workTime: (formWorkTime || '').trim(),
				order: Number(formOrder) || 9999,
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
