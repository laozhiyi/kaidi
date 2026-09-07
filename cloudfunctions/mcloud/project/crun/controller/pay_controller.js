/**
 * Notes: 支付模块控制器
 * Date: 2024-08-25
 */

const BaseProjectController = require('./base_project_controller.js');
const cloudBase = require('../../../framework/cloud/cloud_base.js');

class PayController extends BaseProjectController {

	/** 创建支付订单 */
	async createPay() {
		this.AppError('当前版本仅支持线下结算，未开通微信支付');
		// 数据校验
		let rules = {
			orderId: 'must|string|name=订单ID',
			totalFee: 'must|number|min=0.01|name=支付金额',
			description: 'string|name=商品描述',
		};

		// 取得数据
		let input = this.validateData(rules);
		const order = await this._getOrderById(input.orderId);
		if (!order) this.AppError('订单不存在');
		if (order.ownerId && order.ownerId !== this._userId) this.AppError('无权支付该订单');
		if (order.payStatus === 1) this.AppError('订单已支付');
		if (!(Number(order.totalFee) > 0)) this.AppError('该订单无需支付');
		if (order.PREFIX === 'MAIL_' && order.status !== 0) this.AppError('当前订单状态不能支付');
		if (order.PREFIX === 'MAIL_' && order.endTime && Number(order.endTime) <= Date.now()) this.AppError('订单已过期，无法支付');
		if (Number(order.totalFee) > 0 && Math.round(Number(input.totalFee) * 100) !== Number(order.totalFee)) {
			this.AppError('支付金额与订单不一致');
		}
		const cloud = cloudBase.getCloud();

		try {
			// 调用微信云调起支付
			const payResult = await cloud.cloudPay.unifiedOrder({
				description: input.description || '跑腿服务费用',
				outTradeNo: input.orderId,
				totalFee: Math.round(input.totalFee * 100), // 转换为分
				envId: process.env.ENV_ID,
				functionName: 'payNotify', // 回调云函数名
			});

			return {
				timeStamp: payResult.timeStamp,
				nonceStr: payResult.nonceStr,
				package: payResult.package,
				paySign: payResult.paySign,
				orderId: input.orderId
			};

		} catch (err) {
			console.error('创建支付订单失败:', err);
			this.AppError('支付订单创建失败: ' + err.message);
		}
	}

	/** 查询支付状态（统一接口，按 orderId 前缀识别模块） */
	async queryPay() {
		let rules = {
			orderId: 'must|string|name=订单ID',
		};
		let input = this.validateData(rules);

		const order = await this._getOrderById(input.orderId);
		if (!order) this.AppError('订单不存在');
		if (order.ownerId && order.ownerId !== this._userId) this.AppError('无权查询该订单');

		return {
			payStatus: order.payStatus,
			mailStatus: order.status,
			payTime: order.payTime,
			payNo: order.payNo
		};
	}

	/** 申请退款（统一接口） */
	async refund() {
		this.AppError('当前版本不执行退款；历史支付订单请由运营核对原支付渠道处理');
		let rules = {
			orderId: 'must|string|name=订单ID',
			reason: 'string|name=退款原因',
		};
		let input = this.validateData(rules);

		const order = await this._getOrderById(input.orderId);
		if (!order) this.AppError('订单不存在');

		if (order.payStatus !== 1) {
			this.AppError('该订单未支付，无法退款');
		}
		if (order.ownerId && order.ownerId !== this._userId) this.AppError('无权退款该订单');

		if (order.PREFIX === 'MAIL_' && order.status !== 0) {
			this.AppError('订单已开始处理，无法退款');
		}

		try {
			const cloud = cloudBase.getCloud();

			// 调用微信退款接口
			const refundResult = await cloud.cloudPay.refund({
				outTradeNo: input.orderId,
				totalFee: order.totalFee,
				refundFee: order.totalFee,
				envId: process.env.ENV_ID,
			});

			// 更新订单状态
			await order.Model.edit(order._id, {
				[order.PREFIX + 'PAY_STATUS']: 2,
				[order.PREFIX + 'STATUS']: order.PREFIX === 'MAIL_' ? 99 : 9,
			});

			return { success: true, msg: '退款申请已提交' };

		} catch (err) {
			console.error('退款失败:', err);
			this.AppError('退款失败: ' + err.message);
		}
	}

	/**
	 * 根据订单号（XXX_ID）前缀查找对应的订单（统一方法）
	 */
	async _getOrderById(orderId) {
		const MailModel = require('../model/mail_model.js');

		if (typeof orderId !== 'string') return null;

		// 根据订单号前缀判断模块
		if (orderId.startsWith('MAIL')) {
			const mail = await MailModel.getOne({ MAIL_ID: orderId });
			if (!mail) return null;
			return {
				Model: MailModel, PREFIX: 'MAIL_', _id: mail._id,
				status: mail.MAIL_STATUS, payStatus: mail.MAIL_PAY_STATUS,
				payTime: mail.MAIL_PAY_TIME, payNo: mail.MAIL_PAY_NO,
				totalFee: mail.MAIL_TOTAL_FEE, ownerId: mail.MAIL_USER_ID,
				endTime: mail.MAIL_END_TIME
			};
		}
		return null;
	}
}

module.exports = PayController;
