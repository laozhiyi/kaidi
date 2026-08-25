/**
 * Notes: 支付模块控制器
 * Date: 2024-08-25
 */

const BaseProjectController = require('./base_project_controller.js');
const cloudBase = require('../../../framework/cloud/cloud_base.js');

class PayController extends BaseProjectController {

	/** 创建支付订单 */
	async createPay() {
		// 数据校验
		let rules = {
			orderId: 'must|string|name=订单ID',
			totalFee: 'must|number|min=0.01|name=支付金额',
			description: 'string|name=商品描述',
		};

		// 取得数据
		let input = this.validateData(rules);
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

		return {
			payStatus: order.payStatus,
			mailStatus: order.status,
			payTime: order.payTime,
			payNo: order.payNo
		};
	}

	/** 申请退款（统一接口） */
	async refund() {
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

		if (order.status === 2 || order.status === 3) {
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
				[order.PREFIX + 'STATUS']: 9,
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
		const ThingModel = require('../model/thing_model.js');
		const FoodModel = require('../model/food_model.js');
		const FollowModel = require('../model/follow_model.js');

		if (typeof orderId !== 'string') return null;

		// 根据订单号前缀判断模块
		if (orderId.startsWith('MAIL')) {
			const mail = await MailModel.getOne({ MAIL_ID: orderId });
			if (!mail) return null;
			return {
				Model: MailModel, PREFIX: 'MAIL_', _id: mail._id,
				status: mail.MAIL_STATUS, payStatus: mail.MAIL_PAY_STATUS,
				payTime: mail.MAIL_PAY_TIME, payNo: mail.MAIL_PAY_NO,
				totalFee: mail.MAIL_TOTAL_FEE
			};
		}
		if (orderId.startsWith('THING')) {
			const thing = await ThingModel.getOne({ THING_ID: orderId });
			if (!thing) return null;
			return {
				Model: ThingModel, PREFIX: 'THING_', _id: thing._id,
				status: thing.THING_STATUS, payStatus: thing.THING_PAY_STATUS,
				payTime: thing.THING_PAY_TIME, payNo: thing.THING_PAY_NO,
				totalFee: thing.THING_TOTAL_FEE
			};
		}
		if (orderId.startsWith('FOOD')) {
			const food = await FoodModel.getOne({ FOOD_ID: orderId });
			if (!food) return null;
			return {
				Model: FoodModel, PREFIX: 'FOOD_', _id: food._id,
				status: food.FOOD_STATUS, payStatus: food.FOOD_PAY_STATUS,
				payTime: food.FOOD_PAY_TIME, payNo: food.FOOD_PAY_NO,
				totalFee: food.FOOD_TOTAL_FEE
			};
		}
		if (orderId.startsWith('FOLLOW')) {
			const follow = await FollowModel.getOne({ FOLLOW_ID: orderId });
			if (!follow) return null;
			return {
				Model: FollowModel, PREFIX: 'FOLLOW_', _id: follow._id,
				status: follow.FOLLOW_STATUS, payStatus: follow.FOLLOW_PAY_STATUS,
				payTime: follow.FOLLOW_PAY_TIME, payNo: follow.FOLLOW_PAY_NO,
				totalFee: follow.FOLLOW_TOTAL_FEE
			};
		}
		return null;
	}
}

module.exports = PayController;
