const ProjectBiz = require('../../../biz/project_biz.js');
const Agreements = require('../../../public/agreements.js');

// 协议全文页：?key=user 用户服务协议，?key=rider 代取人（骑手）服务与结算协议。
Page({
	data: { agreement: null },
	onLoad(options = {}) {
		ProjectBiz.initPage(this);
		const agreement = Agreements.get(options.key || 'user');
        if (!agreement) { this.setData({error:'协议不存在，请返回重新选择'}); return; }
		wx.setNavigationBarTitle({ title: agreement.title });
		this.setData({ agreement });
	}
});
