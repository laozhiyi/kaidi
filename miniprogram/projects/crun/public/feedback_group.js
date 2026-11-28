const DEFAULT_QR = '/projects/crun/images/feedback-wechat-group.png';
const MARKER = '微信群二维码：v1';
function validImage(value) {
 return typeof value === 'string' && (value === DEFAULT_QR || /^(cloud:\/\/|https:\/\/|wxfile:\/\/|http:\/\/tmp\/|\/tmp\/)[^\s]+$/.test(value));
}
function read(content) {
 const nodes = Array.isArray(content) ? content : [];
 if (!nodes.some(node => node && node.type === 'text' && node.val === MARKER)) return {image:DEFAULT_QR,note:'',configured:false};
 const image = nodes.find(node => node && node.type === 'img' && validImage(node.val));
 const note = nodes.find(node => node && node.type === 'text' && /^加群说明[：:]/.test(node.val));
 return {image:image ? image.val : DEFAULT_QR,note:note ? note.val.replace(/^加群说明[：:]\s*/, '').slice(0,200) : '',configured:!!image};
}
function build(image, note = '') {
 if (!validImage(image)) throw new Error('请选择有效的微信群二维码图片');
 note = String(note || '').trim();
 if (note.length > 200) throw new Error('加群说明最多200字');
 return [{type:'text',val:MARKER},{type:'img',val:image},...(note ? [{type:'text',val:'加群说明：' + note}] : [])];
}
module.exports = {DEFAULT_QR, read, build};
