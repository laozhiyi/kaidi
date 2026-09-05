// 我的订单详情页：发布者 / 接单人共用，底部按钮根据角色切换
//   - 发布者（mypost）：「编辑」「取消」「标记完成」
//   - 接单人（myaccept）：「取消接单」「联系发单」「标记完成」
//   - 已完成：只读展示
const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');

Page({
	data: {
		isLoad: null,
		id: '',
		mail: null,

		// 当前用户角色：'poster' | 'acceptor' | 'viewer'
		role: 'viewer',
	},

	onLoad: async function (options) {
		ProjectBiz.initPage(this);
		const id = (options && options.id) || '';
		if (!id) {
			this.setData({ isLoad: 'notexist' });
			return;
		}
		this.setData({ id });
		await this._loadDetail();
	},

	onShow: async function () {
		// 编辑返回后刷新
		if (this.data.isLoad && this.data.id) {
			await this._loadDetail();
		}
	},

	onPullDownRefresh: async function () {
		await this._loadDetail();
		wx.stopPullDownRefresh();
	},

	_loadDetail: async function () {
		try {
			wx.showLoading({ title: '加载中...' });
			const res = await cloudHelper.callCloudSumbit('mail/view', { id: this.data.id });
			wx.hideLoading();
			const mail = res && res.data ? res.data : null;
			if (!mail || !mail._id) {
				this.setData({ isLoad: 'notexist' });
				return;
			}

			const obj = mail.MAIL_OBJ || {};
			const endTimestamp = Number(mail.MAIL_END_TIME || 0);
			const imgUrls = Array.isArray(obj.imgUrls) ? obj.imgUrls.filter(Boolean)
				: (obj.imgUrl ? [obj.imgUrl] : []);
			const merged = {
				_id: mail._id,
				MAIL_ID: mail.MAIL_ID,
				MAIL_STATUS: mail.MAIL_STATUS,
				MAIL_PAY_STATUS: Number(mail.MAIL_PAY_STATUS || 0),
				MAIL_TOTAL_FEE: Number(mail.MAIL_TOTAL_FEE || 0),
				endTimestamp,
				MAIL_END_TIME: mail.end2 || obj.end || '',
				MAIL_ADD_TIME: mail.MAIL_ADD_TIME,
				MAIL_ACCEPT_TIME: mail.MAIL_ACCEPT_TIME || '',
				MAIL_OVER_TIME: mail.MAIL_OVER_TIME || '',
				MAIL_OBJ: obj,
				MAIL_CATE_NAME: mail.MAIL_CATE_NAME || '',
				MAIL_USER_NAME: mail.MAIL_USER_NAME || obj.poster || '匿名用户',
				posterPic: obj.posterPic || '',
				poster: obj.poster || '匿名用户',
				tel: obj.tel || '',
				address1: obj.address1 || '',
				address2: obj.address2 || '',
				code: obj.code || '',
				desc: obj.desc || '',
				price: obj.price || '',
				rider: obj.rider || '',
				urgent: !!obj.urgent,
				imgUrl: imgUrls[0] || '',
				imgUrls,
				small: obj.small || 0,
				medium: obj.medium || 0,
				large: obj.large || 0,
				viewCnt: mail.MAIL_VIEW_CNT || 0,
				acceptUser: mail.acceptUser || null,
				statusDesc: mail.status || '',
				myaccept: !!mail.myaccept,
				mypost: !!mail.mypost,
				canPay: !!mail.mypost
					&& Number(mail.MAIL_STATUS) === 0
					&& Number(mail.MAIL_PAY_STATUS || 0) === 0
					&& Number(mail.MAIL_TOTAL_FEE || 0) > 0
					&& (!endTimestamp || endTimestamp > Date.now()),
			};

			let role = 'viewer';
			if (merged.mypost) role = 'poster';
			else if (merged.myaccept) role = 'acceptor';

			this.setData({ mail: merged, role, isLoad: true });
		} catch (err) {
			wx.hideLoading();
			console.error('[mail_my_detail]', err);
			this.setData({ isLoad: false });
		}
	},

	/** 编辑（仅发布者，且订单尚未被接单） */
	bindEditTap: function () {
		const mail = this.data.mail;
		if (!mail || !mail._id) return;
		// 进入发单页的编辑模式（复用发单 UI：件数选择/地址 picker/联系人/截止时间）
		wx.navigateTo({
			url: pageHelper.fmtURLByPID('/pages/mail/add/mail_add?id=' + mail._id),
		});
	},

	bindPayTap: async function () {
		const mail = this.data.mail;
		if (!mail || !mail.MAIL_ID || !(mail.MAIL_TOTAL_FEE > 0)) return;
		if (!await PassportBiz.loginMustCancelWin(this)) return;
		try {
			wx.showLoading({ title: '获取支付信息...' });
			const payRes = await cloudHelper.callCloudSumbit('pay/create', {
				orderId: mail.MAIL_ID,
				totalFee: mail.MAIL_TOTAL_FEE / 100,
				description: '快递代取服务费',
			});
			wx.hideLoading();
			if (!payRes || !payRes.data) {
				pageHelper.showNoneToast('获取支付参数失败');
				return;
			}
			await new Promise((resolve, reject) => wx.requestPayment({
				timeStamp: payRes.data.timeStamp,
				nonceStr: payRes.data.nonceStr,
				package: payRes.data.package,
				signType: 'MD5',
				paySign: payRes.data.paySign,
				success: resolve,
				fail: reject,
			}));
			pageHelper.showSuccToast('支付成功');
			setTimeout(() => this._loadDetail(), 1000);
		} catch (err) {
			wx.hideLoading();
			if (err && err.errMsg && err.errMsg.indexOf('cancel') >= 0) return;
			pageHelper.showNoneToast((err && err.message) || '支付失败，请稍后重试');
		}
	},

	/** 取消（发布者取消整单 / 接单人取消接单） */
	bindCancelTap: async function () {
		const mail = this.data.mail;
		if (!mail || !mail._id) return;

		const isPoster = this.data.role === 'poster';
		const confirm = await pageHelper.showConfirm(isPoster ? '确认取消该订单？取消后不可恢复' : '确认取消接单？取消后订单将重新进入可接单列表');
		if (!confirm) return;

		try {
			wx.showLoading({ title: '处理中...' });
			const res = await cloudHelper.callCloudSumbit('mail/cancel', { id: mail._id });
			wx.hideLoading();
			if (res && res.data && res.data.id) {
				pageHelper.showSuccToast(isPoster ? '已取消订单' : '已取消接单');
				setTimeout(() => wx.navigateBack(), 600);
			} else {
				pageHelper.showNoneToast('操作失败');
			}
		} catch (err) {
			wx.hideLoading();
			pageHelper.showNoneToast(err.message || '操作失败');
		}
	},

	/** 标记完成（接单人操作） */
	bindFinishTap: async function () {
		const mail = this.data.mail;
		if (!mail || !mail._id) return;
		const confirm = await pageHelper.showConfirm('确认已送达并将订单标记完成？');
		if (!confirm) return;

		try {
			wx.showLoading({ title: '提交中...' });
			const res = await cloudHelper.callCloudSumbit('mail/finish', { id: mail._id });
			wx.hideLoading();
			if (res && res.data && res.data.id) {
				pageHelper.showSuccToast('已完成');
				await this._loadDetail();
			} else {
				pageHelper.showNoneToast('操作失败，请稍后再试');
			}
		} catch (err) {
			wx.hideLoading();
			pageHelper.showNoneToast(err.message || '操作失败');
		}
	},

	/** 联系发单 / 联系接单 */
	bindCallTap: function () {
		const mail = this.data.mail;
		if (!mail) return;
		const tel = this.data.role === 'acceptor' ? (mail.tel) : (mail.acceptUser && mail.acceptUser.USER_MOBILE);
		if (!tel) {
			pageHelper.showNoneToast('暂无联系方式');
			return;
		}
		wx.makePhoneCall({ phoneNumber: String(tel) });
	},

	/** 复制取件码 */
	bindCopyCodeTap: function () {
		const code = this.data.mail && this.data.mail.code;
		if (!code) return;
		wx.setClipboardData({
			data: String(code),
			success: () => pageHelper.showSuccToast('取件码已复制'),
		});
	},

	/** 预览截图 */
	bindPreviewImageTap: function (e) {
		const url = e.currentTarget.dataset.url;
		if (!url) return;
		const urls = (this.data.mail && this.data.mail.imgUrls) || [url];
		wx.previewImage({ urls, current: url });
	},

	url: function (e) {
		pageHelper.url(e, this);
	},
});
