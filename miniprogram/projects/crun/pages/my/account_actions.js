const Passport = require('../../../../comm/biz/passport_biz.js');
const MY_PAGE = '/projects/crun/pages/my/index/my_index';

function resetPage(page) {
  if (!page._unloaded) page.setData({ user: null, hasSession: false, isLoad: false, isLogin: false, settingsVisible: false,
    formName: '', formPic: '', formMobile: '', formForms: [], contacts: [], addresses: [], unreadCount: 0, messageBadge: '', loadError: '', userError: '' });
  wx.reLaunch({ url: MY_PAGE, fail: () => wx.switchTab({ url: MY_PAGE }) });
}
function run(page, cancel) {
  if (page._unloaded || page.data.saving || page.data.phoneAuthorizing || page.data.collectionSaving || page.data.loggingOut || page.data.cancellingAccount || !Passport.getToken()) return Promise.resolve(false);
  const flag = cancel ? 'cancellingAccount' : 'loggingOut';
  page.setData({ [flag]: true });
  return new Promise(resolve => {
    const finish = value => { if (!page._unloaded) page.setData({ [flag]: false }); resolve(value); };
    wx.showModal({
      title: cancel ? '注销账户' : '退出登录', confirmText: cancel ? '申请注销' : '退出登录', confirmColor: '#c95353',
      content: cancel ? '有未完成的发单或接单时不能注销。申请后立即退出；2小时内重新微信登录将自动取消注销，超过2小时后账号资料将删除。确定申请注销吗？'
        : page._profileDirty ? '尚未保存的资料将不会保留，确定退出登录吗？' : '确定退出当前账号吗？',
      success: result => {
        if (!result.confirm || page._unloaded) return finish(false);
        (async () => {
          try {
            if (cancel) {
              await Passport.cancelAccount(); resetPage(page);
              wx.showToast({ title: '已申请注销，2小时内登录可撤销', icon: 'none', duration: 3000 });
            } else {
              const revoke = Passport.logoutByUser(); resetPage(page); await revoke;
            }
            finish(true);
          } catch (error) {
            if (!page._unloaded) wx.showToast({ title: error.msg || error.message || '操作失败，请重试', icon: 'none', duration: 3000 });
            finish(false);
          }
        })();
      },
      fail: () => { wx.showToast({ title: '暂时无法操作，请重试', icon: 'none' }); finish(false); }
    });
  });
}
module.exports = {
  bindLogoutTap() { return run(this, false); },
  bindCancelAccountTap() { return run(this, true); }
};
