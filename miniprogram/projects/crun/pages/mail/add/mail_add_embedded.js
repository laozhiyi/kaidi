const logic = require('./mail_add_logic.js');
const componentData = JSON.parse(JSON.stringify(logic.data || {}));
const lifecycleNames = new Set(['onLoad', 'onShow', 'onHide', 'onUnload', 'onPullDownRefresh', 'onReachBottom']);
const methods = {};
Object.keys(logic).forEach(key => {
  if (key !== 'data' && typeof logic[key] === 'function' && !lifecycleNames.has(key)) methods[key] = logic[key];
});
Component({
  properties: {
    embedded: { type: Boolean, value: true },
    service: { type: String, value: 'take' }
  },
  data: Object.assign(componentData, { embedded: true }),
  lifetimes: {
    attached() { if (typeof logic.onLoad === 'function') logic.onLoad.call(this, { embedded: true }); },
    detached() { if (typeof logic.onUnload === 'function') logic.onUnload.call(this); }
  },
  pageLifetimes: {
    show() { if (typeof logic.onShow === 'function') logic.onShow.call(this); }
  },
  methods: Object.assign(methods, {
    onPullDownRefresh() { return logic.onPullDownRefresh && logic.onPullDownRefresh.call(this); },
    onReachBottom() { return logic.onReachBottom && logic.onReachBottom.call(this); }
  })
});
