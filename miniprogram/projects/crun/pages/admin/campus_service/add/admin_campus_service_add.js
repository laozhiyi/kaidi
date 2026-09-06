const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../../helper/cloud_helper.js');

Page({

	data: {
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

	model: function (e) {
		pageHelper.model(this, e);
	},

	bindFormSubmit: async function () {
		if (!AdminBiz.isAdmin(this)) return;
		let { formCampus, formName, formMobile, formWechat, formQQ, formWorkTime, formOrder, isSubmit } = this.data;

		if (!formCampus || !formCampus.trim()) {
			return pageHelper.showModal('请填写校区名称', '温馨提示');
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
			await cloudHelper.callCloudSumbit('admin/campus_service_insert', params, { title: '提交中...' });
			pageHelper.showSuccToast('添加成功', 2000, () => {
				wx.navigateBack();
			});
		} catch (err) {
			console.error(err);
			pageHelper.showModal('添加失败，请稍后重试', '温馨提示');
		} finally {
			this.setData({ isSubmit: false });
		}
	},

	url: function (e) {
		pageHelper.url(e, this);
	}

});
