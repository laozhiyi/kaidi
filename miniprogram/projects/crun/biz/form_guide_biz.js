// Local validation only: provider/network errors must never be assigned to a field.
function invalid(field, message) {
 const error = new Error(message);
 error.formField = field;
 return error;
}
function show(page, field, message) {
 if (!page || page._unloaded) return;
 const currentPage = () => typeof getCurrentPages === 'function' ? getCurrentPages().slice(-1)[0] : null;
 const owner = currentPage();
 const active = () => !page._unloaded && (!owner || currentPage() === owner) && page.data.guideField === field;
 page.setData({ guideField: field, guideMessage: message }, () => {
  const locate = () => {
   if (!active() || !wx.createSelectorQuery || !wx.pageScrollTo) return;
   const query = wx.createSelectorQuery().in(page);
   query.select('#guide-' + field).boundingClientRect();
   query.selectViewport().scrollOffset();
   query.exec(results => {
    if (!active()) return;
    const rect = results && results[0], viewport = results && results[1];
    if (!rect || !viewport) return;
    wx.pageScrollTo({ scrollTop: Math.max(0, viewport.scrollTop + rect.top - 96), duration: 250 });
   });
  };
  if (wx.nextTick) wx.nextTick(locate); else locate();
 });
}
function clear(page, field) {
 if (page.data.guideField && (!field || page.data.guideField === field)) page.setData({guideField: '', guideMessage: ''});
}
module.exports = { invalid, show, clear };
