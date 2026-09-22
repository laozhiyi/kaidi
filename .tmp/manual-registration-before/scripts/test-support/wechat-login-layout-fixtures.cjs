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
    { id: 'authorizing', title: '微信登录 · 正在授权', page: reg, data: { isLoad: true, phoneAuthorizing: true }, login: true, expected: '微信手机号一键登录', absent: ['保存资料并继续'] },
    { id: 'denied', title: '微信登录 · 用户取消授权', page: reg, data: { isLoad: true, loginError: '需要授权微信手机号后才能登录' }, login: true, expected: '需要授权微信手机号后才能登录', absent: ['保存资料并继续'] },
    { id: 'incomplete', title: '完善资料 · 授权后必填', page: reg, data: { ...profile, formName: '', profileSex: '', profileCollege: '', profileSub: '', campus: '' }, profile: true, expected: '请选择所在校区后再保存', absent: ['微信手机号一键登录'] },
    { id: 'completed-form', title: '完善资料 · 填写完成', page: reg, data: profile, profile: true, expected: '保存资料并继续', absent: ['微信手机号一键登录'] },
    { id: 'saving', title: '完善资料 · 保存中', page: reg, data: { ...profile, saving: true }, profile: true, expected: '保存资料并继续' },
    { id: 'save-error', title: '完善资料 · 保存失败可重试', page: reg, data: { ...profile, saveError: '保存失败，请稍后重试' }, profile: true, expected: '保存失败，请稍后重试' },
    { id: 'rebind', title: '完善资料 · 更换授权手机号', page: reg, data: { ...profile, phoneAuthorizing: true }, profile: true, expected: '13912345678' },
    { id: 'personal', title: '个人资料 · 修改昵称头像', page: 'my/personal/my_personal', data: { ...profile, isEdit: true }, profile: true, expected: '保存资料' },
    { id: 'my-guest', title: '我的 · 未登录', page: index, data: { user: null }, route: '../reg/my_reg', expected: '点击微信一键登录' },
    { id: 'my-legacy', title: '我的 · 旧账号补授权', page: index, data: { user: { ...user, USER_MOBILE_VERIFIED: false } }, route: '../reg/my_reg', expected: '请授权微信手机号登录' },
    { id: 'my-incomplete', title: '我的 · 必须补全资料', page: index, data: { user: { ...user, USER_PROFILE_COMPLETE: false } }, route: '../reg/my_reg', expected: '请完善个人资料' },
    { id: 'my-ready', title: '我的 · 正常账号', page: index, data: { user }, route: '../personal/my_personal', expected: '查看或修改个人资料' },
    { id: 'my-review', title: '我的 · 等待审核', page: index, data: { user: { ...user, USER_STATUS: 0 } }, route: '../personal/my_personal', expected: '已注册，待审核' },
    { id: 'my-disabled', title: '我的 · 账号已停用', page: index, data: { user: { ...user, USER_STATUS: 9 } }, route: '../personal/my_personal', expected: '账号已停用' }
  ];
  return cases.map(fixture => ({ ...fixture, base: 'projects/crun/pages/' + fixture.page }));
}
module.exports = { scenarios, pageState, previewTitle: '微信登录与资料补全 · 页面检查', previewSummary: '无页面横向溢出。' };
