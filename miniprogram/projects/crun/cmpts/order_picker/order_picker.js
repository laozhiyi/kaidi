const cloudHelper = require('../../../../helper/cloud_helper.js');
const MailUI = require('../../biz/mail_ui_biz.js');

const PAGE_SIZE = 20;
// 申诉与客服咨询经常发生在订单结束很久之后，列表要覆盖全部历史订单，
// 不能沿用「我的接单/我的发布」那套 12 小时可见窗口。
const SORT_TYPE = 'my_all';

// 通用订单选择器：反馈申诉关联订单、在线客服发送订单共用。
// 服务端按 my_all 只返回本人参与（发布或接单）的订单。
Component({
	properties: {
		show: { type: Boolean, value: false },
		title: { type: String, value: '选择订单' },
		hint: { type: String, value: '' }
	},
	data: {
		list: [],
		page: 1,
		total: 0,
		hasMore: false,
		loading: false,
		error: '',
		isLoad: false
	},
	observers: {
		show(value) {
			if (value) this.reload();
		}
	},
	lifetimes: {
		detached() { this._detached = true; }
	},
	methods: {
		noop() { },
		bindClose() { this.triggerEvent('close'); },
		bindMaskTap() { this.triggerEvent('close'); },
		bindRetry() { this.reload(); },
		bindScrollLower() { if (this.data.hasMore && !this.data.loading) this.load(false); },
		reload() {
			this.setData({ list: [], page: 1, total: 0, hasMore: false, isLoad: false, error: '' });
			this.load(true);
		},
		async load(reset) {
			if (this._busy) return;
			this._busy = true;
			const page = reset ? 1 : this.data.page + 1;
			this.setData({ loading: true, error: '' });
			try {
				const result = await cloudHelper.callCloudSumbit('mail/list',
					{ sortType: SORT_TYPE, page, size: PAGE_SIZE }, { hint: false });
				if (this._detached) return;
				if (!result || !result.data || !Array.isArray(result.data.list)) throw new Error('订单加载失败，请重试');
				const rows = result.data.list.map(order => this._decorate(order)).filter(Boolean);
				const list = reset ? rows : this.data.list.concat(rows);
				this.setData({
					list,
					page,
					total: Number(result.data.total) || list.length,
					hasMore: rows.length >= PAGE_SIZE,
					isLoad: true,
					loading: false
				});
			} catch (error) {
				if (this._detached) return;
				this.setData({ error: (error && (error.msg || error.message)) || '订单加载失败，请重试', isLoad: true, loading: false });
			} finally {
				this._busy = false;
			}
		},
		_decorate(order) {
			// 只认本人参与的订单：云函数未同步更新时也不会把别人的单挂上来。
			if (!order || !order._id || !(order.mypost || order.myaccept)) return null;
			const obj = order.MAIL_OBJ || {};
			const detail = MailUI.detail(order);
			const status = Number(order.MAIL_STATUS);
			return {
				id: order._id,
				no: String(order._id).slice(-6).toUpperCase(),
				statusText: detail.title || '订单状态待更新',
				tone: status === 3 ? 'amber' : status === 2 || status === 9 ? 'green' : status === 99 ? 'muted' : 'blue',
				serviceName: detail.serviceName || '快递代取',
				from: obj.address1 || (obj.serviceType === 'buy' ? '购买点待补充' : '取件点待补充'),
				to: detail.deliveryAddress || '送达地点待补充',
				fee: detail.fee || '0.00',
				role: order.mypost ? '我发布的' : order.myaccept ? '我接的单' : '',
				time: detail.createdAt || ''
			};
		},
		bindSelect(e) {
			const idx = Number(e.currentTarget.dataset.idx);
			const item = this.data.list[idx];
			if (!item) return;
			this.triggerEvent('select', { id: item.id, order: item });
		}
	}
});
