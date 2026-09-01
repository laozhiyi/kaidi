const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const MailBiz = require('../../../biz/mail_biz.js');
const validate = require('../../../../../helper/validate.js');
const PublicBiz = require('../../../../../comm/biz/public_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');

Page({

	/**
	 * 页面的初始数据
	 */
	data: {
		isLoad: false
	},

	/**
	 * 生命周期函数--监听页面加载
	 */
	onLoad: async function (options) {
		ProjectBiz.initPage(this);

		if (!await PassportBiz.loginMustBackWin(this)) return;


		this.setData(MailBiz.initFormData());
		this.setData({
			isLoad: true
		});
	},


	/**
	 * 生命周期函数--监听页面初次渲染完成
	 */
	onReady: function () { },

	/**
	 * 生命周期函数--监听页面显示
	 */
	onShow: function () { },

	/**
	 * 生命周期函数--监听页面隐藏
	 */
	onHide: function () { },

	/**
	 * 生命周期函数--监听页面卸载
	 */
	onUnload: function () { },

	onPullDownRefresh: async function () { 
        wx.stopPullDownRefresh();
    },

	url: function (e) {
		pageHelper.url(e, this);
	},


	bindFormSubmit: async function () {
		if (!await PassportBiz.loginMustCancelWin(this)) return;

		let data = this.data;
		data = validate.check(data, MailBiz.CHECK_FORM, this);
		if (!data) return;

		let forms = this.selectComponent("#cmpt-form").getForms(true);
		if (!forms) return;
		data.forms = forms;

		// 注入 formEnd 到 forms 中
		if (data.formEnd) {
			forms.push({
				mark: 'formEnd',
				title: '接单截止时间',
				type: 'date',
				val: data.formEnd
			});
		}

		data.cateName = MailBiz.getCateName(data.cateId);

		// 从表单中提取价格
		let totalFee = 0;
		for (let item of forms) {
			if (item.mark === 'price') {
				totalFee = parseFloat(item.val) || 0;
				break;
			}
		}

		// 如果有价格，则先创建订单再支付
		if (totalFee > 0) {
			try {
				// 显示加载
				wx.showLoading({ title: '创建订单中...' });

				// 1. 创建订单
				let result = await cloudHelper.callCloudSumbit('mail/insert', {
					forms: forms,
					cateId: data.cateId,
					totalFee: totalFee
				});

				let mailId = result.data.id; // 订单号（用于详情/支付）
				let mailDbId = result.data._id || mailId; // 数据库 _id（用于更新图片/详情）—— 兼容未更新云函数的情况

				// 图片（用 _id 来定位记录）
				if (mailDbId) {
					try {
						await cloudHelper.transFormsTempPics(forms, 'mail/', mailDbId, 'mail/update_forms');
					} catch (e) {
						console.error('[mail_add] 图片更新失败', e);
						wx.hideLoading();
						wx.showToast({ title: e.message || '图片上传失败', icon: 'none' });
						throw e; // 中断流程
					}
				}

				// 隐藏加载
				wx.hideLoading();

				// 2. 获取支付参数（用 MAIL_ID 作为商户订单号）
				let payRes = await cloudHelper.callCloudSumbit('pay/create', {
					orderId: mailId,
					totalFee: totalFee,
					description: '跑腿服务费用'
				});

				if (!payRes || !payRes.data) {
					wx.showToast({ title: '获取支付参数失败', icon: 'none' });
					return;
				}

				// 3. 调起微信支付
				wx.requestPayment({
					timeStamp: payRes.data.timeStamp,
					nonceStr: payRes.data.nonceStr,
					package: payRes.data.package,
					signType: 'MD5',
					paySign: payRes.data.paySign,
					success: function(res) {
						console.log('支付成功', res);
						wx.showToast({ title: '支付成功', icon: 'success' });

						setTimeout(() => {
							PublicBiz.removeCacheList('admin-mail-list');
							PublicBiz.removeCacheList('mail-list');
							// 跳转到待接单列表页
							wx.redirectTo({
								url: '/projects/crun/pages/mail/index/mail_index?type=wait&sortType=wait&sortVal=wait'
							});
						}, 1500);
					},
					fail: function(err) {
						console.log('支付取消或失败', err);
						wx.showModal({
							title: '提示',
							content: '订单已创建，请在订单列表中完成支付',
							confirmText: '查看订单',
							success: function(res) {
								if (res.confirm) {
									wx.redirectTo({
										url: '/projects/crun/pages/mail/index/mail_index?type=wait&sortType=wait&sortVal=wait'
									});
								} else {
									wx.navigateBack();
								}
							}
						});
					}
				});

			} catch (err) {
				console.error(err);
				wx.hideLoading();
				wx.showToast({ title: err.message || '发布失败', icon: 'none' });
			}
		} else {
// 无需支付，直接发布
		try {
				let result = await cloudHelper.callCloudSumbit('mail/insert', {
					forms: forms,
					cateId: data.cateId,
					totalFee: 0
				});

				let mailId = result.data.id; // 订单号
				let mailDbId = result.data._id || mailId; // 数据库 _id（兼容未更新云函数）

				// 图片（用 _id 来定位记录）
				if (mailDbId) {
					try {
						await cloudHelper.transFormsTempPics(forms, 'mail/', mailDbId, 'mail/update_forms');
					} catch (e) {
						console.error('[mail_add] 图片更新失败', e);
						wx.showToast({ title: e.message || '图片上传失败', icon: 'none' });
						throw e; // 中断流程，不发布成功 toast
					}
				}

				let callback = async function () {
					PublicBiz.removeCacheList('admin-mail-list');
					PublicBiz.removeCacheList('mail-list');
					// 跳转到待接单列表页
					wx.redirectTo({
						url: '/projects/crun/pages/mail/index/mail_index?type=wait&sortType=wait&sortVal=wait'
					});
				}
				pageHelper.showSuccToast('发布成功', 2000, callback);

			} catch (err) {
				console.error(err);
				wx.showToast({ title: err.message || '发布失败', icon: 'none' });
			}
		}
	},


})