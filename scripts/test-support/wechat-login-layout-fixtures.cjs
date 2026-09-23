'use strict';
const path = require('node:path');
const { runMiniProgram } = require('./miniprogram-module.cjs');
const mini = path.resolve(__dirname, '../../miniprogram');
const definitions = new Map();
function pageState(fixture) {
  if (!definitions.has(fixture.base)) {
    let definition;
    runMiniProgram(path.join(mini, fixture.base + '.js'), { Page: value => { definition = value; }, require: () => ({}) });
    definitions.set(fixture.base, definition.data || {});
  }
  return { ...definitions.get(fixture.base), skin: {}, ...fixture.data };
}
function scenarios() {
  const reg = 'my/reg/my_reg', index = 'my/index/my_index';
  const profile = { isLoad: true, phoneVerified: true, formMobile: '13912345678', formName: '校园同学',
    genderOptions: ['男', '女'], profileSex: '女', profileCollege: '计算机科学与信息工程学院', profileSub: '软件工程',
    campus: '育才校区', campuses: ['育才校区', '王城校区', '雁山校区'] };
  const user = { USER_NAME: '校园同学', USER_STATUS: 1, USER_MOBILE_VERIFIED: true, USER_PROFILE_COMPLETE: true };
  const cases = [
    { id: 'loading', title: '微信登录 · 加载中', page: reg, data: {}, expected: '正在加载登录信息', absent: ['微信手机号一键登录', '保存资料并继续'] },
    { id: 'load-error', title: '微信登录 · 加载失败', page: reg, data: { loadError: '登录信息加载失败，请重试' }, expected: '重新加载', absent: ['微信手机号一键登录', '保存资料并继续'] },
    { id: 'guest', title: '微信登录 · 首次进入', page: reg, data: { isLoad: true }, login: true, expected: '微信手机号一键登录', absent: ['保存资料并继续', '所在校区'] },
    { id: 'guest-manual-option', title: '登录入口 · 手动注册已隐藏', page: reg, data: { isLoad: true, allowManualRegistration: true }, login: true, expected: '微信手机号一键登录', absent: ['手动填写资料注册', '可授权手机号或手动填写资料注册', '保存资料并继续'] },
    { id: 'authorizing', title: '微信登录 · 正在授权', page: reg, data: { isLoad: true, phoneAuthorizing: true }, login: true, expected: '微信手机号一键登录', absent: ['保存资料并继续'] },
    { id: 'denied', title: '微信登录 · 用户取消授权', page: reg, data: { isLoad: true, loginError: '需要授权微信手机号后才能登录' }, login: true, expected: '需要授权微信手机号后才能登录', absent: ['保存资料并继续'] },
    { id: 'incomplete', title: '完善资料 · 授权后必填', page: reg, data: { ...profile, formName: '', profileSex: '', profileCollege: '', profileSub: '', campus: '' }, profile: true, expected: '请选择所在校区后再保存', absent: ['微信手机号一键登录'] },
    { id: 'completed-form', title: '完善资料 · 填写完成', page: reg, data: profile, profile: true, expected: '保存资料并继续', absent: ['微信手机号一键登录'] },
    { id: 'saving', title: '完善资料 · 保存中', page: reg, data: { ...profile, saving: true }, profile: true, expected: '保存资料并继续' },
    { id: 'save-error', title: '完善资料 · 保存失败可重试', page: reg, data: { ...profile, saveError: '保存失败，请稍后重试' }, profile: true, expected: '保存失败，请稍后重试' },
    { id: 'rebind', title: '完善资料 · 更换授权手机号', page: reg, data: { ...profile, phoneAuthorizing: true }, profile: true, expected: '13912345678' },
    { id: 'personal', title: '个人资料 · 修改昵称头像', page: 'my/personal/my_personal', data: { ...profile, isEdit: true }, profile: true, expected: '保存资料' },
    { id: 'personal-saving', title: '个人资料 · 保存时禁止退出', page: 'my/personal/my_personal', data: { ...profile, saving: true }, profile: true, expected: '退出登录' },
    { id: 'personal-logout-pending', title: '个人资料 · 正在确认退出', page: 'my/personal/my_personal', data: { ...profile, loggingOut: true }, profile: true, expected: '退出登录' },
    { id: 'personal-offline', title: '个人资料 · 离线仍可退出', page: 'my/personal/my_personal', data: { hasSession: true, loadError: '资料加载失败，请重试' }, expected: '退出登录', absent: ['保存资料'] },
    { id: 'manual-registration', title: '旧手动状态 · 保持微信登录入口', page: reg, data: { ...profile, phoneVerified: false, allowManualRegistration: true, manualRegistration: true }, login: true, expected: '微信手机号一键登录', absent: ['手动填写', '保存资料并继续'] },
    { id: 'manual-fallback', title: '授权不可用 · 不再回退手动注册', page: reg, data: { ...profile, phoneVerified: false, allowManualRegistration: true, manualRegistration: true, canGetWechatPhone: false }, expected: '请更新微信后重试', absent: ['手动注册', '保存资料并继续'] },
    { id: 'manual-saving', title: '旧手动保存状态 · 不展示注册表单', page: reg, data: { ...profile, phoneVerified: false, allowManualRegistration: true, manualRegistration: true, saving: true }, login: true, expected: '微信手机号一键登录', absent: ['保存资料并继续'] },
    { id: 'manual-personal', title: '个人资料 · 未验证联系电话', page: 'my/personal/my_personal', data: { ...profile, phoneVerified: false, allowManualRegistration: true, manualRegistration: true }, profile: true, expected: '保存资料' },
    { id: 'native-profile-unsupported', title: '个人资料 · 微信资料能力不可用', page: 'my/personal/my_personal', data: { ...profile, canChooseWechatAvatar: false, canUseWechatNickname: false, canGetWechatPhone: false }, profile: true, expected: '保存资料' },
    { id: 'my-guest', title: '我的 · 未登录', page: index, data: { user: null }, route: '../reg/my_reg', expected: '点击微信登录', absent: ['退出登录', '注销账户'] },
    { id: 'my-legacy', title: '我的 · 已登录旧账号', page: index, data: { user: { ...user, USER_MOBILE_VERIFIED: false } }, route: '../personal/my_personal', expected: '查看或修改个人资料' },
    { id: 'my-incomplete', title: '我的 · 已登录待完善联系资料', page: index, data: { user: { ...user, USER_PROFILE_COMPLETE: false } }, route: '../personal/my_personal', expected: '已登录，发单或接单前完善联系资料' },
    { id: 'my-ready', title: '我的 · 正常账号', page: index, data: { user }, route: '../personal/my_personal', expected: '查看或修改个人资料' },
    { id: 'my-manual-ready', title: '我的 · 手填注册账号', page: index, data: { user: { ...user, USER_MOBILE_VERIFIED: false, allowManualRegistration: true } }, route: '../personal/my_personal', expected: '查看或修改个人资料', absent: ['请授权微信手机号登录'] },
    { id: 'my-manual-review', title: '我的 · 手填注册待审核', page: index, data: { user: { ...user, USER_MOBILE_VERIFIED: false, USER_STATUS: 0, allowManualRegistration: true } }, route: '../personal/my_personal', expected: '已注册，待审核', absent: ['请授权微信手机号登录'] },
    { id: 'my-manual-strict', title: '我的 · 已恢复授权要求', page: index, data: { user: { ...user, USER_MOBILE_VERIFIED: false, allowManualRegistration: false } }, route: '../personal/my_personal', expected: '查看或修改个人资料' },
    { id: 'my-review', title: '我的 · 等待审核', page: index, data: { user: { ...user, USER_STATUS: 0 } }, route: '../personal/my_personal', expected: '已注册，待审核' },
    { id: 'my-disabled', title: '我的 · 账号已停用', page: index, data: { user: { ...user, USER_STATUS: 9 } }, route: '../personal/my_personal', expected: '账号已停用' }
  ];
  const identityCases = [
    { id: 'identity-guest', title: '微信账号登录 · 等待点击', page: reg, data: { isLoad: true }, identityLogin: true, expected: '微信登录', absent: ['微信手机号一键登录', '手动填写资料注册', '保存资料并继续'] },
    { id: 'identity-logged-out', title: '退出后 · 已有资料不自动恢复', page: reg, data: { ...profile, hasSession: false }, identityLogin: true, expected: '微信登录', absent: ['校园同学', '保存资料并继续', '微信手机号一键登录'] },
    { id: 'identity-pending', title: '微信账号登录 · 请求中', page: reg, data: { isLoad: true, identityLoggingIn: true }, identityLogin: true, expected: '微信登录', absent: ['微信手机号一键登录', '保存资料并继续'] },
    { id: 'identity-error', title: '微信账号登录 · 失败可重试', page: reg, data: { isLoad: true, loginError: '登录失败，请重试' }, identityLogin: true, expected: '登录失败，请重试', absent: ['微信手机号一键登录'] },
    { id: 'identity-incomplete', title: '点击微信登录 · 头像昵称弹层', page: reg, data: { ...profile, wechatProfileVisible: true, phoneVerified: false, allowManualRegistration: true, formMobile: '' }, wechatOnly: true, expected: '确认并继续', absent: ['微信手机号一键登录', '手机号已通过微信验证', '所在校区', '联系电话', '学院', '专业'] },
    { id: 'identity-profile-saving', title: '微信头像昵称 · 保存中', page: reg, data: { ...profile, wechatProfileVisible: true, hasSession: true, saving: true }, wechatOnly: true, expected: '确认并继续', absent: ['所在校区', '联系电话'] },
    { id: 'identity-profile-login-pending', title: '微信头像昵称 · 登录中', page: reg, data: { ...profile, wechatProfileVisible: true, identityLoggingIn: true }, wechatOnly: true, expected: '确认并继续', absent: ['所在校区', '联系电话'] },
    { id: 'identity-profile-fallback', title: '微信头像昵称 · 原生组件不可用', page: reg, data: { ...profile, wechatProfileVisible: true, canChooseWechatAvatar: false, canUseWechatNickname: false }, wechatOnly: true, expected: '从相册选择或拍照', absent: ['所在校区', '联系电话'] },
    { id: 'identity-contact', title: '个人资料 · 登录后填写联系资料', page: 'my/personal/my_personal', data: { ...profile, hasSession: true, formName: '微信昵称', formMobile: '', profileSex: '', profileCollege: '', profileSub: '', campus: '', allowManualRegistration: true }, profile: true, expected: '保存资料', absent: ['微信手机号一键登录', '收起联系资料', '编辑联系资料'] },
    { id: 'identity-personal', title: '个人资料 · 联系资料一直展开', page: 'my/personal/my_personal', data: { ...profile, hasSession: true, allowManualRegistration: true }, profile: true, expected: '保存资料', absent: ['请授权微信手机号', '收起联系资料', '编辑联系资料'] },
    { id: 'identity-cancelling', title: '个人资料 · 确认注销期间', page: 'my/personal/my_personal', data: { ...profile, hasSession: true, cancellingAccount: true }, profile: true, expected: '注销账户', absent: ['收起联系资料', '编辑联系资料'] }
  ];
  return [...cases.map(fixture => ({ ...fixture, data: { phoneLoginEnabled: true, ...fixture.data } })),
    ...identityCases.map(fixture => ({ ...fixture, data: { phoneLoginEnabled: false, ...fixture.data } }))]
    .map(fixture => ({ ...fixture, base: 'projects/crun/pages/' + fixture.page }));
}
module.exports = { scenarios, pageState, previewTitle: 'GXNU校跑 · 微信登录与账户资料', previewSummary: '点击登录，选择头像昵称，进入始终展开的个人资料。' };
