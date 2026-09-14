const cloudHelper = require('../../helper/cloud_helper.js');
const pageHelper = require('../../helper/page_helper.js');
const PassportBiz = require('./passport_biz.js');
class FavBiz {
  static async isFav(that, oid, type = '') {
    if (!oid) return;
    that.setData({ isFav: -1 });
    try {
      const result = await cloudHelper.callCloudSumbit('fav/is_fav', { oid, type }, { hint: false });
      that.setData({ isFav: result.data.isFav });
    } catch (_) { /* 保留未知状态，点击收藏时可重新加载。 */ }
  }
  static async updateFav(that, oid, isFav, type, title) {
    if (that._favSaving) return;
    that._favSaving = true;
    try {
      if (!await PassportBiz.loginMustCancelWin(that) || !oid || !type) return;
      const result = await cloudHelper.callCloudSumbit('fav/update', { oid, type }, { hint: false });
      that.setData({ isFav: result.data.isFav });
      pageHelper.showSuccToast(result.data.isFav ? '已收藏' : '已取消收藏');
    } catch (error) {
      pageHelper.showNoneToast(error && (error.msg || error.message) || '收藏失败，请重试');
    } finally { that._favSaving = false; }
  }
}
module.exports = FavBiz;
