const cloudHelper = require('../../../../../helper/cloud_helper.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');

Page({
	data: {
		// 投诉对象
		targetArr: [
			{ val: 'manager', label: '校区负责人' },
			{ val: 'rider', label: '骑手' },
			{ val: 'merchant', label: '商家' },
			{ val: 'feedback', label: '功能反馈' }
		],
		targetIdx: -1,
		customShow: false,
		customTarget: '',

		content: '',
		img: [],
		isSubmit: false
	},

	onLoad: function (options) {
		ProjectBiz.initPage(this);
	},

	// 返回
	bindBackTap: function () {
		wx.navigateBack();
	},

	// 切换投诉对象
	bindTargetTap: function (e) {
		let idx = pageHelper.dataset(e, 'idx');
		this.setData({
			targetIdx: Number(idx),
			customShow: false,
			customTarget: ''
		});
	},

	// 切换到自定义
	bindCustomTap: function () {
		this.setData({
			targetIdx: -1,
			customShow: true
		});
	},

	// 自定义输入
	bindCustomInput: function (e) {
		this.setData({ customTarget: e.detail.value });
	},

	// 内容输入
	bindContentInput: function (e) {
		this.setData({ content: e.detail.value });
	},

	// 选择图片
	bindChooseImage: function () {
		wx.chooseImage({
			count: 9 - this.data.img.length,
			sizeType: ['compressed'],
			sourceType: ['album', 'camera'],
			success: (res) => {
				let img = this.data.img.concat(res.tempFilePaths);
				this.setData({ img });
			}
		});
	},

	// 删除图片
	bindDelImage: function (e) {
		let idx = pageHelper.dataset(e, 'idx');
		let img = this.data.img.slice();
		img.splice(idx, 1);
		this.setData({ img });
	},

	// 预览图片
	bindPreviewImage: function (e) {
		let url = pageHelper.dataset(e, 'url');
		wx.previewImage({
			urls: this.data.img,
			current: url
		});
	},

	// 获取最终投诉对象文本
	_getTargetText: function () {
		let { targetArr, targetIdx, customShow, customTarget } = this.data;
		if (targetIdx >= 0 && targetArr[targetIdx]) {
			return targetArr[targetIdx].label;
		}
		if (customShow && customTarget && customTarget.trim()) {
			return customTarget.trim();
		}
		return '';
	},

	// 提交
	bindSubmitTap: async function () {
		let { content, img, isSubmit } = this.data;

		if (isSubmit) return;

		let targetText = this._getTargetText();
		if (!targetText) {
			return pageHelper.showModal('请选择或填写投诉对象', '温馨提示');
		}
		if (!content || !content.trim()) {
			return pageHelper.showModal('请填写投诉内容', '温馨提示');
		}
		if (content.length > 500) {
			return pageHelper.showModal('内容不能超过500字', '温馨提示');
		}

		this.setData({ isSubmit: true });

		try {
			// 上传图片
			let imgList = [];
			if (img && img.length) {
				imgList = await cloudHelper.transTempPics(
					img.slice(),
					'feedback/',
					Date.now().toString(),
					'fb'
				);
			}

			let params = {
				type: 'complain',
				title: targetText.substring(0, 60),
				content: content.trim(),
				contact: '',
				img: imgList || []
			};

			await cloudHelper.callCloudSumbit('feedback/insert', params, { title: '提交中...' });
			wx.showModal({
				title: '提交成功',
				content: '感谢您的反馈，我们会尽快处理',
				showCancel: false,
				success: () => {
					wx.redirectTo({
						url: '../my_list/feedback_my_list'
					});
				}
			});
		} catch (err) {
			console.error(err);
			pageHelper.showModal('提交失败，请稍后重试', '温馨提示');
		} finally {
			this.setData({ isSubmit: false });
		}
	},

	// 查看我的反馈
	bindMyListTap: function () {
		wx.navigateTo({
			url: '../my_list/feedback_my_list'
		});
	},

	onShareAppMessage: function () { }
})
