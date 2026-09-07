const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');

Page({
	data: {
		campusOptions: ['全部校区', '育才校区', '王城校区', '雁山校区'],
		campusIndex: 0
	},
	onLoad: function () {
		if (!AdminBiz.isAdmin(this)) return;
		this.setData({ search: '', sortMenus: [], isLoad: true });
	},
	onShow: function () {
		this.setData({ campusIndex: Math.max(0, this.data.campusOptions.findIndex(name => name.replace(/校区$/, '') === String(this.data.search || '').replace(/校区$/, ''))) });
	},
	bindCampusChange: function (e) {
		const campusIndex = Number(e.detail.value);
		if (!this.data.campusOptions[campusIndex]) return;
		this.setData({ campusIndex, search: campusIndex ? this.data.campusOptions[campusIndex].replace(/校区$/, '') : '' });
	},
	url: function (e) { pageHelper.url(e, this); },
	bindCommListCmpt: function (e) {
		if (Object.prototype.hasOwnProperty.call(e.detail, 'search')) this.setData({ campusIndex: 0 });
		pageHelper.commListListener(this, e);
	}
});
