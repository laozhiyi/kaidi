const AdminBiz = require('../../../../../../comm/biz/admin_biz.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
const PublicBiz = require('../../../../../../comm/biz/public_biz.js');
const cloudHelper = require('../../../../../../helper/cloud_helper.js');
const validate = require('../../../../../../helper/validate.js');
const AdminNewsBiz = require('../../../../biz/admin_news_biz.js');
const projectSetting = require('../../../../public/project_setting.js');

Page({

	/**
	 * 页面的初始数据
	 */
	data: {

	},

	/**
	 * 生命周期函数--监听页面加载
	 */
	onLoad: async function (options) {
		if (!AdminBiz.isAdmin(this)) return;

		wx.setNavigationBarTitle({
			title: projectSetting.NEWS_NAME + '-添加',
		});

		this.setData(AdminNewsBiz.initFormData()); // 初始化表单数据
		this.setData({
			isLoad: true
		});

		this._setContentDesc();

	},

	_setContentDesc: function () {
		AdminBiz.setContentDesc(this);
	},

	/**
	 * 生命周期函数--监听页面初次渲染完成
	 */
	onReady: function () {

	},

	/**
	 * 生命周期函数--监听页面显示
	 */
	onShow: function () {

	},

	/**
	 * 生命周期函数--监听页面隐藏
	 */
	onHide: function () {

	},

	/**
	 * 生命周期函数--监听页面卸载
	 */
	onUnload: function () {

	},

	model: function (e) {
		pageHelper.model(this, e);
	}, 
 

	/** 
	 * 数据提交
	 */
	bindFormSubmit: async function () {
		if (!AdminBiz.isAdmin(this)) return;
		if (this.data.isSubmit || this._published) return;

		let data = this.data;
		if (this.data.formContent.length == 0) {
			return pageHelper.showModal('详细内容不能为空');
		}
		data = validate.check(data, AdminNewsBiz.CHECK_FORM, this);
		if (!data) return; 

		const formComponent = this.selectComponent("#cmpt-form");
		let forms = formComponent ? formComponent.getForms(true) : [];
		if (!forms) return;
		data.forms = forms;

		data.cateName = AdminNewsBiz.getCateName(data.cateId);

		this.setData({ isSubmit: true });
		try {
			if (this.data.imgList.length == 0) {
				return pageHelper.showModal('请上传封面图');
			}

			// 提取简介
			data.desc = PublicBiz.getRichEditorDesc(data.desc, this.data.formContent);

			// 上传完成前保持未发布；失败重试继续使用同一篇草稿。
			if (!this._draftNewsId) {
				const result = await cloudHelper.callCloudSumbit('admin/news_insert', { ...data, draft: true });
				if (!result || !result.data || !result.data.id) throw new Error('未收到公告编号，请重试');
				this._draftNewsId = result.data.id;
			} else {
				await cloudHelper.callCloudSumbit('admin/news_edit', { ...data, id: this._draftNewsId });
			}
			let newsId = this._draftNewsId;

			// 封面图片 提交处理 
			wx.showLoading({
				title: '提交中...',
				mask: true
			});
			await cloudHelper.transCoverTempPics(this.data.imgList, 'news/', newsId, 'admin/news_update_pic');

			// 富文本
			let formContent = this.data.formContent;
			if (formContent && formContent.length > 0) {
				wx.showLoading({
					title: '提交中...',
					mask: true
				});
				let content = await cloudHelper.transRichEditorTempPics(formContent, 'news/', newsId, 'admin/news_update_content');
				this.setData({
					formContent: content
				});
			}

			await cloudHelper.transFormsTempPics(forms, 'news/', newsId, 'admin/news_update_forms');
			await cloudHelper.callCloudSumbit('admin/news_status', { id: newsId, status: 1 });
			this._published = true;

			let callback = async function () {
				PublicBiz.removeCacheList('admin-news-list');
				PublicBiz.removeCacheList('news-list');
				wx.navigateBack();

			}
			pageHelper.showSuccToast('发布成功', 2000, callback);

		} catch (err) {
			console.log(err);
		} finally {
			wx.hideLoading();
			this.setData({ isSubmit: false });
		}

	},


	bindImgUploadCmpt: function (e) {
		this.setData({
			imgList: e.detail
		});
	}, 

	url: function (e) {
		pageHelper.url(e, this);
	}
})
