const MailUI = require('../../../biz/mail_ui_biz.js');
const Ops = require('../../../biz/operations_biz.js');
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
        detailUI: null, accepting: false,

		// 接单人是否能看到取件码（仅接单成功后可见）
		isAcceptant: false,
		errorMessage: '',
	},

	onLoad: async function (options) {
		ProjectBiz.initPage(this);
		this._visible = true;
		const id = (options && options.id) || '';
		if (!id) {
			this.setData({ isLoad: 'notexist', mail: null });
			return;
		}
		this.setData({ id });
		await this._loadDetail();
	},

	onShow: function () { this._visible = true; if (this._wasHidden) { this._wasHidden = false; return this._loadDetail(); } },
 onHide: function () { this._visible = false; this._wasHidden = true; this._seq = (this._seq || 0) + 1; },
 onUnload: function () { this.onHide(); },

	onPullDownRefresh: async function () {
		await this._loadDetail();
		wx.stopPullDownRefresh();
	},

	_loadDetail: async function () {
		if (!this.data.id) { this.setData({ isLoad: 'notexist', mail: null }); return; }
		this.setData({ isLoad: null, errorMessage: '' });
		const seq = this._seq = (this._seq || 0) + 1;
		try {
			const res = await cloudHelper.callCloudSumbit('mail/view', { id: this.data.id }, { hint: false });
			if (!this._visible || seq !== this._seq) return;
			const mail = res && res.data ? res.data : null;
			if (!mail || !mail._id) {
				this.setData({ isLoad: 'notexist', mail: null });
				return;
			}

			// 兼容：MAIL_OBJ 中读取业务字段；个别字段模型冗余在 mail 顶层
			const obj = mail.MAIL_OBJ || {};
			const endTimestamp = Number(mail.MAIL_END_TIME || 0);
			const imgUrls = mail.MAIL_MEDIA && mail.MAIL_MEDIA.pickup || [];
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
                MAIL_MEDIA: mail.MAIL_MEDIA || {},
                MAIL_MEDIA_ERROR: mail.MAIL_MEDIA_ERROR || '',
                MAIL_DELIVERY_PROOF: mail.MAIL_DELIVERY_PROOF || null,
                MAIL_EXCEPTION: mail.MAIL_EXCEPTION || null,
                overdue: !!mail.overdue,
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
				mediaError: mail.MAIL_MEDIA_ERROR || '',
				small: obj.small || 0,
				medium: obj.medium || 0,
				large: obj.large || 0,
				viewCnt: mail.MAIL_VIEW_CNT || 0,
				acceptUser: mail.acceptUser || null,
				statusDesc: mail.status || '',
				myaccept: !!mail.myaccept,
				mypost: !!mail.mypost,
				// 是否展示取件码：仅接单成功后可见
				canSeeCode: !!(mail.mypost || mail.myaccept),
				canAccept: !mail.mypost
					&& Number(mail.MAIL_STATUS) === 0
					&& mail.MAIL_PAYMENT_MODE === 'offline'
					&& Number.isFinite(endTimestamp) && endTimestamp > Date.now(),
			};

			this.setData({ mail: merged, detailUI: MailUI.detail(mail), isLoad: true });
		} catch (err) {
			if (!this._visible || seq !== this._seq) return;
			console.error('[mail_detail]', err);
			this.setData({ isLoad: false, errorMessage: err && (err.msg || err.message) || '加载失败，请检查网络后重试' });
		}
	},

 bindReload() { return this._loadDetail(); },
 bindBackOrders() { wx.switchTab({ url: '/projects/crun/pages/order/index/order_index' }); },
 bindServiceHelpTap() { wx.navigateTo({ url: '/projects/crun/pages/campus_service/list/campus_service_list' }); },
 bindCopyOrderTap() { const mail = this.data.mail; if (mail) wx.setClipboardData({ data: String(mail.MAIL_ID || mail._id) }); },
 bindNoticeTap() { wx.showModal({ title: '结算说明', content: this.data.detailUI && this.data.detailUI.legacyPayment ? '本单未标记为线下结算订单，请联系校区客服核对支付与退款记录，勿重复向对方转账。' : '费用由双方线下协商结算，平台不代收、不担保；请勿提前向陌生人转账。', showCancel: false, confirmText: '我知道了' }); },
 bindManageTap() { if (this.data.detailUI && this.data.detailUI.participant) wx.navigateTo({ url: '../my_detail/mail_my_detail?id=' + this.data.id }); },
 async bindAcceptTap() {
  const mail = this.data.mail;
  if (this.data.isLoad !== true || !mail || !mail._id || !mail.canAccept || this._accepting) return;
  if (mail.endTimestamp && mail.endTimestamp <= Date.now()) { await this._loadDetail(); return; }
  this._accepting = true;
  this.setData({ accepting: true });
  let loading = false;
  try {
   if (!await PassportBiz.loginMustCancelWin(this)) return;
   const confirm = await pageHelper.showConfirm('确认接单后请尽快前往快递点取件。费用由双方线下协商结算，是否继续？');
   if (!confirm) return;
   wx.showLoading({ title: '接单中...' }); loading = true;
   const result = await Ops.command('mail/accept', { id: mail._id });
   wx.hideLoading(); loading = false;
   if (result && result.id) {
    if (this._visible) {
     this.setData({ 'mail.canAccept': false });
     pageHelper.showSuccToast('接单成功');
     wx.redirectTo({ url: pageHelper.fmtURLByPID('/pages/mail/my_detail/mail_my_detail?id=' + mail._id) });
    } else if (this.data.mail) this.data.mail.canAccept = false;
   } else if (this._visible) { pageHelper.showNoneToast('订单状态已变化，请刷新后查看'); await this._loadDetail(); }
  } catch (err) { if (this._visible) Ops.error(err); }
  finally { if (loading) wx.hideLoading(); this._accepting = false; if (this._visible) this.setData({ accepting: false }); else this.data.accepting = false; }
 },
 bindCallTap() { const ui = this.data.detailUI; if (ui && ui.participant && ui.phone) wx.makePhoneCall({ phoneNumber: String(ui.phone) }); },
 bindCopyCodeTap() { const mail = this.data.mail; if (mail && mail.canSeeCode && mail.code) wx.setClipboardData({ data: String(mail.code) }); },
 bindPreviewImageTap(e) { const mail = this.data.mail; if (!mail || !mail.canSeeCode) return; const { url, group } = e.currentTarget.dataset; const urls = mail.MAIL_MEDIA && mail.MAIL_MEDIA[group] || []; if (url && urls.includes(url)) wx.previewImage({ urls, current: url }); },

	url: function (e) {
		pageHelper.url(e, this);
	},
});
