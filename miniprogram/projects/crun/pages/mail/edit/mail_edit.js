Page({
 onLoad(options) {
  if(options && options.id)wx.redirectTo({url:'../add/mail_add?id='+encodeURIComponent(options.id)});
  else wx.navigateBack();
 }
});
