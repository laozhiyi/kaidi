const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../../helper/cloud_helper.js');

Page({

	data: {
		id: '',
		detail: null,
		campusOptions: ['育才校区', '王城校区', '雁山校区'],
		campusIndex: 0,
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
			this.setData({ loadError: '参数错误，请返回重新选择客服' });
			pageHelper.showModal('参数错误', '温馨提示');
			return;
		}
		this.setData({ id: options.id });
		await this._loadDetail();
	},

	_loadDetail: async function () {
		if (!this.data.id || this._loading) return;
		this._loading = true;
		this.setData({ loadError: '' });
		try {
			const response = await cloudHelper.callCloud('admin/campus_service_detail', { id: this.data.id }, { hint: false });
			const detail = response && response.data;
			if (!detail || !detail._id) throw new Error('记录不存在或已删除');
			if (this._destroyed) return;
			const campusIndex = this.data.campusOptions.findIndex(name => name.replace(/校区$/, '') === String(detail.CS_CAMPUS || '').replace(/校区$/, ''));
			this.setData({
				detail,
				formCampus: campusIndex >= 0 ? this.data.campusOptions[campusIndex] : '',
				campusIndex: Math.max(0, campusIndex),
				formName: detail.CS_NAME || '',
				formMobile: detail.CS_MOBILE || '',
				formWechat: detail.CS_WECHAT || '',
				formQQ: detail.CS_QQ || '',
				formWorkTime: detail.CS_WORK_TIME || '',
				formOrder: detail.CS_ORDER == null ? 9999 : detail.CS_ORDER,
				isLoad: true
			});
		} catch (err) {
			if (!this._destroyed) this.setData({ loadError: (err && (err.msg || err.message)) || '加载失败，请重试' });
		} finally { this._loading = false; }
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
		let { id, formCampus, formName, formMobile, formWechat, formQQ, formWorkTime, formOrder, isSubmit } = this.data;

		if (!this.data.campusOptions.includes(formCampus)) {
			return pageHelper.showModal('请选择育才、王城或雁山校区', '温馨提示');
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
			await cloudHelper.callCloudSumbit('admin/campus_service_update', params, { hint: false });
			if (this._destroyed) return;
			pageHelper.showSuccToast('修改成功', 2000, () => {
				if (!this._destroyed) wx.navigateBack();
			});
		} catch (err) {
			if (!this._destroyed) pageHelper.showModal((err && (err.msg || err.message)) || '修改失败，请稍后重试', '温馨提示');
		} finally {
			if (!this._destroyed) this.setData({ isSubmit: false });
		}
	},

	url: function (e) {
		pageHelper.url(e, this);
	}

});
