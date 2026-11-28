const Group = require('../public/feedback_group.js');

// A package asset is valid for <image>, but preview/save need a readable local file.
async function localPath(image, platform = wx) {
 const info = await new Promise((resolve, reject) => platform.getImageInfo({src:image,success:resolve,fail:reject}));
 if (!info || !info.path) throw new Error('二维码图片暂时无法读取');
 if (image !== Group.DEFAULT_QR) return info.path;
 const path = platform.env.USER_DATA_PATH + '/feedback-wechat-group.png';
 await new Promise((resolve, reject) => platform.getFileSystemManager().copyFile({srcPath:info.path,destPath:path,success:resolve,fail:reject}));
 return path;
}
module.exports = {localPath};
