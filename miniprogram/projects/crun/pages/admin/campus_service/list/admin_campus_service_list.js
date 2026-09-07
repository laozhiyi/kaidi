const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../../helper/cloud_helper.js');

Page({

	data: {
		campusOptions: ['全部校区', '育才校区', '王城校区', '雁山校区'],
		campusIndex: 0,
	},

	bindCampusChange: function (e) {
		const campusIndex = Number(e.detail.value);
		if (!this.data.campusOptions[campusIndex]) return;
		this.setData({ campusIndex, search: campusIndex ? this.data.campusOptions[campusIndex].replace(/校区$/, '') : '' });
	},

	onLoad: async function (options) {
		if (!AdminBiz.isAdmin(this)) return;

		wx.setNavigationBarTitle({
			title: '校区客服管理',
		});

		this._getSearchMenu();
	},

	onUnload: function () { this._destroyed = true; },
	onShow: function () {
		this.setData({ campusIndex: Math.max(0, this.data.campusOptions.findIndex(name => name.replace(/校区$/, '') === String(this.data.search || '').replace(/校区$/, ''))) });
	},

	url: async function (e) {
		pageHelper.url(e, this);
	},

	bindCommListCmpt: function (e) {
		if (Object.prototype.hasOwnProperty.call(e.detail, 'search')) this.setData({ campusIndex: 0 });
		pageHelper.commListListener(this, e);
	},
	_setStatus: async function (e) {
		if (!AdminBiz.isAdmin(this)) return;
		let id = pageHelper.dataset(e, 'id');
		let status = Number(pageHelper.dataset(e, 'status'));
		let params = { id, status };

		if (this._busy || !id) return;
		this._busy = true;
		try {
			await cloudHelper.callCloudSumbit('admin/campus_service_status', params, { hint: false });
			if (this._destroyed) return;
			const list = this.selectComponent('#campus-list');
			if (list) await list.reload();
			pageHelper.showSuccToast('设置成功');
		} catch (err) {
			if (!this._destroyed) pageHelper.showModal((err && (err.msg || err.message)) || '设置失败，请重试', '温馨提示');
		} finally { this._busy = false; }
	},

	_del: async function (e) {
		if (!AdminBiz.isAdmin(this)) return;
		let id = pageHelper.dataset(e, 'id');
		let params = { id };

		let callback = async () => {
			if (this._busy || this._destroyed || !id) return;
			this._busy = true;
			try {
				await cloudHelper.callCloudSumbit('admin/campus_service_del', params, { hint: false });
				if (this._destroyed) return;
				const list = this.selectComponent('#campus-list');
				if (list) await list.reload();
				pageHelper.showSuccToast('删除成功');
			} catch (err) {
				if (!this._destroyed) pageHelper.showModal((err && (err.msg || err.message)) || '删除失败，请重试', '温馨提示');
			} finally { this._busy = false; }
		};
		pageHelper.showConfirm('确认删除？删除不可恢复。已有对话消息的客服不能删除，请改为停用以保留历史。', callback);
	},

	bindStatusMoreTap: async function (e) {
		if (!AdminBiz.isAdmin(this)) return;
		let itemList = ['启用', '停用(不可见)', '删除'];
		wx.showActionSheet({
			itemList,
			success: async res => {
				switch (res.tapIndex) {
					case 0: {
						e.currentTarget.dataset['status'] = 1;
						await this._setStatus(e);
						break;
					}
					case 1: {
						e.currentTarget.dataset['status'] = 0;
						await this._setStatus(e);
						break;
					}
					case 2: {
						await this._del(e);
						break;
					}
				}
			}
		});
	},

	_getSearchMenu: function () {
		let sortMenus = [
			{ label: '全部', type: '', value: '' },
			{ label: '正常', type: 'status', value: 1 },
			{ label: '停用', type: 'status', value: 0 },
		];

		this.setData({
			search: '',
			sortMenus,
			isLoad: true
		});
	}

});
