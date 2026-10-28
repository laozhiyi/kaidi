const cloudHelper = require('../../../../helper/cloud_helper.js');
const KEY = 'SETUP_CONTENT_AFTERSALES';
// 后台未配置售后群图片时的兜底二维码（微信「扫一扫 → 相册」可识别）。
// 群二维码有有效期（当前这张 2026-11-03 前有效），过期后替换本图，或在后台「售后群」重新上传。
const FALLBACK_QR = '/projects/crun/images/aftersales_qr.jpg';

Component({
  data: { nodes: [], hasImage: false, fallbackQr: FALLBACK_QR, loading: false, error: false },
  lifetimes: {
    attached() { this.load(); },
    detached() { this._detached = true; }
  },
  methods: {
    async load() {
      if (this.data.loading) return;
      this.setData({ loading: true, error: false });
      try {
        const result = await cloudHelper.callCloudSumbit('home/setup_get', { key: KEY }, { hint: false });
        if (!result || result.data === undefined) throw new Error('售后群信息加载失败');
        const list = Array.isArray(result.data) ? result.data : [];
        // 只保留有内容的文本和图片节点
        const nodes = list.filter(node => node && (node.type === 'text' || node.type === 'img') && String(node.val || '').trim());
        if (!this._detached) this.setData({ nodes, hasImage: nodes.some(node => node.type === 'img') });
      } catch (error) {
        if (!this._detached) this.setData({ error: true });
      } finally {
        if (!this._detached) this.setData({ loading: false });
      }
    },
    bindCopy(e) {
      const text = String(e.currentTarget.dataset.text || '').trim();
      if (!text) return;
      wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '已复制', icon: 'none' }) });
    },
    // 后台换上来的二维码是 cloud:// 文件ID；预览和存相册都要先换临时 https 地址。
    async tempUrl(url) {
      if (!/^cloud:\/\//.test(url)) return url;
      try { return await cloudHelper.getTempFileURLOne(url) || url; } catch (error) { return url; }
    },
    async bindPreview(e) {
      const url = e.currentTarget.dataset.url;
      if (!url) return;
      const urls = await Promise.all(this.data.nodes.filter(node => node.type === 'img').map(node => this.tempUrl(node.val)));
      const current = await this.tempUrl(url);
      if (!urls.includes(current)) urls.push(current);
      wx.previewImage({ current, urls });
    },
    async bindSave(e) {
      const url = e.currentTarget.dataset.url;
      if (!url) return;
      wx.getImageInfo({
        src: await this.tempUrl(url),
        success: info => wx.saveImageToPhotosAlbum({
          filePath: info.path,
          success: () => wx.showToast({ title: '已保存到相册', icon: 'none' }),
          fail: error => wx.showToast({ title: /auth deny|authorize/i.test(error && error.errMsg || '') ? '请允许保存到相册' : '保存失败', icon: 'none' })
        }),
        fail: () => wx.showToast({ title: '图片加载失败', icon: 'none' })
      });
    }
  }
});
