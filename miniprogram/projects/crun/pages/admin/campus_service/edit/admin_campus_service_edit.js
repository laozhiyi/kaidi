const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../../helper/cloud_helper.js');

Page({

	data: {
		id: '',
		detail: null,
		formCampus: '',
		formName: '',
		formMobile: '',
		formWechat: '',
		formQQ: '',
		formWorkTime: '',
		formOrder: 9999,
		isSubmit: false,
		isLoad: false
	},

	onLoad: async function (options) {
		if (!AdminBiz.isAdmin(this)) return;
		if (!options || !options.id) {
			pageHelper.showModal('参数错误', '温馨提示');
			return;
		}
		this.setData({ id: options.id });
		await this._loadDetail();
	},

	_loadDetail: async function () {
		let opts = { title: 'bar' };
		let detail = await cloudHelper.callCloudData('admin/campus_service_detail', { id: this.data.id }, opts);
		if (!detail) {
			pageHelper.showModal('记录不存在', '温馨提示');
			return;
		}
		this.setData({
			detail,
			formCampus: detail.CS_CAMPUS || '',
			formName: detail.CS_NAME || '',
			formMobile: detail.CS_MOBILE || '',
			formWechat: detail.CS_WECHAT || '',
			formQQ: detail.CS_QQ || '',
			formWorkTime: detail.CS_WORK_TIME || '',
			formOrder: detail.CS_ORDER || 9999,
			isLoad: true
		});
	},

	model: function (e) {
		pageHelper.model(this, e);
	},

	bindFormSubmit: async function () {
		if (!AdminBiz.isAdmin(this)) return;
		let { id, formCampus, formName, formMobile, formWechat, formQQ, formWorkTime, formOrder, isSubmit } = this.data;

		if (!formCampus || !formCampus.trim()) {
			return pageHelper.showModal('请填写校区名称', '温馨提示');
		}
		if (!formName || !formName.trim()) {
			return pageHelper.showModal('请填写负责人姓名', '温馨提示');
		}
		if (!formMobile || !formMobile.trim()) {
			return pageHelper.showModal('请填写手机号', '温馨提示');
		}
		if (!/^1\d{10}$/.test(formMobile.trim())) {
			return pageHelper.showModal('手机号格式不正确', '温馨提示');
		}

		if (isSubmit) return;
		this.setData({ isSubmit: true });

		try {
			let params = {
				id,
				campus: formCampus.trim(),
				name: formName.trim(),
				mobile: formMobile.trim(),
				wechat: (formWechat || '').trim(),
				qq: (formQQ || '').trim(),
				workTime: (formWorkTime || '').trim(),
				order: Number(formOrder) || 9999,
			};
			await cloudHelper.callCloudSumbit('admin/campus_service_update', params, { title: '提交中...' });
			pageHelper.showSuccToast('修改成功', 2000, () => {
				wx.navigateBack();
			});
		} catch (err) {
			console.error(err);
			pageHelper.showModal('修改失败，请稍后重试', '温馨提示');
		} finally {
			this.setData({ isSubmit: false });
		}
	},

	url: function (e) {
		pageHelper.url(e, this);
	}

});
