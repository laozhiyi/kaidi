// 接单详情页：浏览全部待接订单的详情
const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');

Page({
	data: {
		isLoad: null, // null=加载中, true=已加载, false=加载失败, 'notexist'=不存在
		id: '',
		mail: null,

		// 接单人是否能看到取件码（仅接单成功后可见）
		isAcceptant: false,
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

	onShow: function () {},

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

			// 兼容：MAIL_OBJ 中读取业务字段；个别字段模型冗余在 mail 顶层
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
				// 是否展示取件码：仅接单成功后可见
				canSeeCode: mail.MAIL_STATUS > 0 && mail.MAIL_ACCEPT_USER_ID,
				canAccept: !mail.mypost
					&& Number(mail.MAIL_STATUS) === 0
					&& (Number(mail.MAIL_TOTAL_FEE || 0) <= 0 || Number(mail.MAIL_PAY_STATUS || 0) === 1)
					&& (!endTimestamp || endTimestamp >= Date.now()),
			};

			this.setData({ mail: merged, isLoad: true });
		} catch (err) {
			wx.hideLoading();
			console.error('[mail_detail]', err);
			this.setData({ isLoad: false });
		}
	},

	/** 立即接单 */
	bindAcceptTap: async function () {
		const mail = this.data.mail;
		if (!mail || !mail._id) return;
		if (!await PassportBiz.loginMustCancelWin(this)) return;

		const confirm = await pageHelper.showConfirm('确认接单后请尽快前往快递点取件，是否继续？');
		if (!confirm) return;

		try {
			wx.showLoading({ title: '接单中...' });
			const res = await cloudHelper.callCloudSumbit('mail/accept', { id: mail._id });
			wx.hideLoading();

			if (res && res.data && res.data.id) {
				pageHelper.showSuccToast('接单成功');
				setTimeout(() => {
					wx.redirectTo({
						url: pageHelper.fmtURLByPID('/pages/mail/my_detail/mail_my_detail?id=' + mail._id),
					});
				}, 800);
			} else {
				pageHelper.showNoneToast('手慢了，订单已被接走');
			}
		} catch (err) {
			wx.hideLoading();
			pageHelper.showNoneToast(err.message || '接单失败');
		}
	},

	/** 联系发单人 */
	bindCallTap: function () {
		const tel = this.data.mail && this.data.mail.tel;
		if (!tel) {
			pageHelper.showNoneToast('暂无联系方式');
			return;
		}
		wx.makePhoneCall({ phoneNumber: String(tel) });
	},

	/** 复制取件码（接单后） */
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
