const cloudHelper = require('../../../../helper/cloud_helper.js');
const KEY = 'SETUP_CONTENT_AFTERSALES';

Component({
  data: { nodes: [], loading: false, error: false },
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
        if (!this._detached) this.setData({ nodes });
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
    bindPreview(e) {
      const url = e.currentTarget.dataset.url;
      const urls = this.data.nodes.filter(node => node.type === 'img').map(node => node.val);
      if (url) wx.previewImage({ current: url, urls });
    },
    bindSave(e) {
      const url = e.currentTarget.dataset.url;
      if (!url) return;
      wx.getImageInfo({
        src: url,
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
