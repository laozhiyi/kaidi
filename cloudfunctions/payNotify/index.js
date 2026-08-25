/**
 * 支付回调云函数
 * 微信支付成功后会自动调用此云函数
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
  console.log('支付回调参数:', event);

  const { outTradeNo, transactionId, payResult } = event;

  // 支付成功
  if (payResult && payResult.resultCode === 'SUCCESS') {
    try {
      // 查询订单
      const orderList = await db.collection('mail')
        .where({ MAIL_ID: outTradeNo })
        .limit(1)
        .get();

      if (orderList.data && orderList.data.length > 0) {
        const order = orderList.data[0];

        // 检查是否已经处理过
        if (order.MAIL_PAY_STATUS === 1) {
          console.log('订单已支付，跳过');
          return { errcode: 0 };
        }

        // 更新订单状态
        await db.collection('mail')
          .doc(order._id)
          .update({
            data: {
              MAIL_PAY_STATUS: 1,        // 已支付
              MAIL_PAY_TIME: Date.now(), // 支付时间
              MAIL_PAY_NO: transactionId, // 微信交易号
              MAIL_STATUS: 1,           // 状态改为待接单
            }
          });

        console.log('订单支付状态更新成功:', outTradeNo);

        // 发送订阅消息通知用户（可选）
        try {
          await cloud.openapi.subscribeMessage.send({
            touser: order.MAIL_USER_ID,
            templateId: 'AT0001', // 替换为你的模板ID
            page: `/pages/mail/detail/mail_detail?id=${outTradeNo}`,
            data: {
              keyword1: { value: '跑腿服务' },
              keyword2: { value: '已支付' },
              keyword3: { value: '等待接单' },
            }
          });
        } catch (msgErr) {
          console.log('订阅消息发送失败（不影响支付）:', msgErr);
        }

        return { errcode: 0 };
      } else {
        console.error('订单不存在:', outTradeNo);
        return { errcode: -1, errmsg: '订单不存在' };
      }

    } catch (err) {
      console.error('更新订单状态失败:', err);
      return { errcode: -1, errmsg: err.message };
    }
  }

  // 支付失败
  if (payResult && payResult.resultCode === 'FAIL') {
    console.error('支付失败:', payResult);
    return { errcode: -1, errmsg: '支付失败' };
  }

  return { errcode: 0 };
};
