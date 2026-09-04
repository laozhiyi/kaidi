const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ThingBiz = require('../../../biz/thing_biz.js');
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


		this.setData(ThingBiz.initFormData());
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
		data = validate.check(data, ThingBiz.CHECK_FORM, this);
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

		data.cateName = ThingBiz.getCateName(data.cateId);

		try {

			// 创建
			let result = await cloudHelper.callCloudSumbit('thing/insert', data);
			let thingId = result.data.id;
			let thingDbId = result.data._id;

			// 图片（用数据库 _id 来定位记录）
			if (thingDbId) {
				await cloudHelper.transFormsTempPics(forms, 'thing/', thingDbId, 'thing/update_forms');
			}

			let callback = async function () {
				PublicBiz.removeCacheList('admin-thing-list');
				PublicBiz.removeCacheList('thing-list');
				if (thingDbId) {
					wx.redirectTo({
						url: '/pages/thing/detail/thing_detail?id=' + thingDbId
					});
				} else {
					wx.navigateBack();
				}

			}
			pageHelper.showSuccToast('发布成功', 2000, callback);

		} catch (err) {
			console.log(err);
		}
	},


})