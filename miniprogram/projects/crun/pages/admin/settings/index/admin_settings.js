const UI = require('../../../../biz/admin_console_biz.js');
const Admin = require('../../../../../../comm/biz/admin_biz.js');
Page({
  data: { groups: [
    { title: '业务设置', items: [
      { key: 'tenants', title: '学校与校区', desc: '学校目录、地点配置与管理员授权', icon: 'icon-location', platformOnly: true },
      { key: 'service', title: '服务范围与营业时间', desc: '开放状态、服务校区、营业时间', icon: 'icon-location' },
      { key: 'pricing', title: '价格与结算说明', desc: '大小件参考价、件数上限、结算规则', icon: 'icon-moneybag' },
      { key: 'rules', title: '接单与履约规则', desc: '接单数量、配送时效、加急与注册审核', icon: 'icon-settings' }
    ] },
    { title: '内容与客服', items: [
      { key: 'news', title: '公告管理', desc: '发布公告、编辑内容、调整展示', icon: 'icon-notice' },
      { key: 'chats', title: '客服会话', desc: '查看咨询并回复用户', icon: 'icon-message' },
      { key: 'services', title: '校区客服配置', desc: '客服人员、服务入口与联系方式', icon: 'icon-service' },
      { key: 'about', title: '关于与联系', desc: '小程序介绍与联系信息', icon: 'icon-info' },
      { key: 'qr', title: '小程序码', desc: '获取小程序推广入口', icon: 'icon-qr_code' }
    ] },
    { title: '数据与系统', items: [
      { key: 'analytics', title: '数据统计', desc: '订单状态、履约与运营待办', icon: 'icon-rank' },
      { key: 'export', title: '订单导出', desc: '按日期和订单状态生成报表', icon: 'icon-down' },
      { key: 'monitor', title: '系统维护', desc: '过期订单、超时提醒与通知处理', icon: 'icon-repair' }
    ] },
    { title: '账号与权限', items: [
      { key: 'managers', title: '管理员账号', desc: '创建账号、设置角色与停用账号', icon: 'icon-group', platformOnly: true },
      { key: 'logs', title: '操作日志', desc: '查询管理操作记录', icon: 'icon-footprint' },
      { key: 'password', title: '修改我的密码', desc: '更新当前管理员登录密码', icon: 'icon-lock' }
    ] }
  ] },
  onLoad() { UI.start(this); },
  onShow() { UI.authorize(this); },
  bindNavigate(e) { return UI.go(e.currentTarget.dataset.key); },
  async bindLogout() {
    if (!await UI.confirm('退出后台登录', '退出后需重新登录，用户端仍可正常使用。')) return;
    Admin.clearAdminToken();
    wx.reLaunch({ url: '/projects/crun/pages/my/index/my_index' });
  }
});
