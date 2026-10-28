const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const Passport = require('../../../../../../comm/biz/passport_biz.js');
const cloudHelper = require('../../../../../../helper/cloud_helper.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
const cacheHelper = require('../../../../../../helper/cache_helper.js');

/**
 * 从页面参数里取客服邀请码：分享卡片用 ?code=XXXX，小程序码把码放在 scene 里
 * （微信可能给成 K3M7QT2X，也可能给成 %3D 编码过的 code%3DK3M7QT2X）。
 * 只认 6-12 位字母数字，避免把别的场景参数误当成邀请码。
 */
function loginInviteCode(options) {
	const clean = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
	const direct = clean(options.code);
	if (direct) return direct.slice(0, 12);
	let scene = String(options.scene || '').trim();
	try { scene = decodeURIComponent(scene); } catch (error) { /* 微信已解码时保持原值 */ }
	if (scene.includes('=')) {
		scene = scene.split('&').map(pair => pair.split('='))
			.filter(pair => pair[0] === 'code' || pair[0] === 'c')
			.map(pair => pair[1])[0] || '';
	}
	const code = clean(scene);
	return /^[A-Z0-9]{6,12}$/.test(code) ? code : '';
}

Page({

	/**
	 * 页面的初始数据
	 * mode：wechat 微信登录（唯一主入口）/ password 初始管理员账号 / invite 客服首次开通
	 */
	data: {
		mode: 'wechat',
		name: '',
		pwd: '',
		staffName: '',
		inviteCode: '',
		inviteError: '',
		agreed: false,
		loggingIn: false,
		activateBusy: false
	},

	/**
	 * 生命周期函数--监听页面加载
	 */
	onLoad: function (options) {
		AdminBiz.clearAdminToken();

		// 清理旧版本保存的明文密码，只保留登录会话。
		cacheHelper.remove('admin-pwd');

		options = options || {};
		const mode = options.mode;
		if (mode === 'password' || mode === 'invite') this.setData({ mode });

		// 邀请码可以跟着链接或小程序码进来，客服不用手输那 8 位：
		// 分享卡片用 ?code=XXXX，小程序码用 scene（可能是编码过的 code=XXXX）。
		const inviteCode = loginInviteCode(options);
		if (inviteCode) this.setData({ mode: 'invite', inviteCode });
	},

	/**
	 * 生命周期函数--监听页面初次渲染完成
	 */
	onReady: function () {

	},

	/**
	 * 生命周期函数--监听页面显示
	 */
	onShow: function () {},

	/**
	 * 生命周期函数--监听页面隐藏
	 */
	onHide: function () {this.setData({pwd:''});},

	/**
	 * 生命周期函数--监听页面卸载
	 */
	onUnload: function () {
		this._unloaded = true;
	},

	url: function (e) {
		pageHelper.url(e, this);
	},

	/** 主入口是微信登录；账号密码与邀请码只是它下面的文字链接 */
	bindModeTap: function (e) {
		if (this._busy()) return;
		const mode = (e.currentTarget.dataset.mode || 'wechat');
		if (mode === this.data.mode) return;
		this.setData({ mode, pwd: '', inviteError: '' });
	},

	_busy: function () {
		return !!(this._loggingIn || this._activateBusy);
	},

	bindNameInput: function (e) {
		this.setData({ name: String(e.detail.value || '') });
	},

	bindPwdInput: function (e) {
		this.setData({ pwd: String(e.detail.value || '') });
	},

	bindStaffNameInput: function (e) {
		this.setData({ staffName: String(e.detail.value || '').slice(0, 20) });
	},

	bindInviteCodeInput: function (e) {
		const inviteCode = String(e.detail.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		this.setData({ inviteCode, inviteError: '' });
	},

	/** 微信登录：后台权限由超级管理员在用户管理中授权 */
	bindWechatLogin: async function (e) {
		if (this._busy()) return;
		this._loggingIn = true;
		this.setData({ loggingIn: true });
		try { return await AdminBiz.wechatLogin(this); }
		finally { this._loggingIn = false; if (!this._unloaded) this.setData({ loggingIn: false, pwd: '' }); }
	},

	bindLoginTap: async function (e) {
		if (this._busy()) return;
		this._loggingIn = true;
		this.setData({ loggingIn: true });
		try { return await AdminBiz.adminLogin(this, this.data.name, this.data.pwd); }
		finally { this._loggingIn = false; if (!this._unloaded) this.setData({ pwd: '', loggingIn: false }); }
	},

	/** 同意协议：不勾选就不让提交，同意后微信身份由服务端静默绑定 */
	bindAgreeTap: function () {
		if (this._busy()) return;
		this.setData({ agreed: !this.data.agreed, inviteError: '' });
	},

	bindViewAgreement: function () {
		wx.showModal({
			title: '员工使用须知',
			content: '1. 客服账号用于接待在线咨询、处理投诉与订单履约；\n2. 账号绑定当前微信，仅本人使用，不得转借他人；\n3. 后台可见的用户资料与订单信息不得对外传播；\n4. 违规使用将被立即停用账号。',
			showCancel: false,
			confirmText: '我知道了'
		});
	},

	/**
	 * 客服开通：一次请求完成「建号 → 授权 → 开后台会话」。
	 * 服务端认的是云调用上下文里的 OpenID，所以客服没在用户端注册过也能直接开通，
	 * 不需要手机号授权、学生资料或额外同意步骤，同意协议后微信即静默绑定。
	 */
	bindInviteActivate: async function (e) {
		if (this._busy()) return;
		const code = String(this.data.inviteCode || '').trim();
		if (code.length < 6) return this.setData({ inviteError: '请输入完整的邀请码' });
		if (!this.data.agreed) return this.setData({ inviteError: '请先阅读并同意《员工使用须知》' });

		this._activateBusy = true;
		this.setData({ activateBusy: true, inviteError: '' });
		try {
			const res = await cloudHelper.callCloudSumbit('passport/staff_invite_redeem',
				{ code, name: String(this.data.staffName || '').trim() }, { hint: false });
			const data = res && res.data;
			if (!data || !data.ok) throw new Error('邀请码激活失败，请重试');
			if (data.token) Passport.setToken(data.token);
			this._activateBusy = false;
			if (!this._unloaded) this.setData({ activateBusy: false, inviteCode: '' });
			wx.showToast({ title: '已开通' + (data.roleLabel || '客服') + '权限', icon: 'none' });
			// 后端已经把后台会话一起返回，这里不再多打一次 admin/wechat_login
			if (!AdminBiz.applySession(data.admin)) throw new Error('后台会话未建立，请改用微信登录重试');
			return true;
		} catch (err) {
			if (!this._unloaded) this.setData({ inviteError: (err && (err.msg || err.message)) || '激活失败，请检查邀请码或网络' });
		} finally {
			this._activateBusy = false;
			if (!this._unloaded) this.setData({ activateBusy: false });
		}
	}

})
