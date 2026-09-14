const cloudHelper = require('../../../helper/cloud_helper.js');
const PublicBiz = require('../../../comm/biz/public_biz.js');

Component({
    options: {
        addGlobalClass: true,
        //pureDataPattern: /^_dataList/, // 指定所有 _ 开头的数据字段为纯数据字段
        multipleSlots: true // 在组件定义时的选项中启用多slot支持
    },

    /**
     * 组件的属性列表
     */
    properties: {
        route: { // 业务路由
            type: String,
            value: ''
        },
        _params: { //路由的附加参数
            type: Object,
            value: {}
        },
        _dataList: {
            type: Object,
            value: null
        },
        type: {
            type: String, //业务类型 info,user,well
            value: ''
        },
        top: {
            type: String, // 顶部空出高度 rpx
            value: '0'
        },
        topBottom: {
            type: String, // 回顶部按钮的位置 rpx
            value: '50'
        },
        isLoad: {
            type: Boolean, //数据加载中
            value: false
        },
        dataNoHint: {
            type: String, //无数据提示
            value: '暂无数据哦~'
        },
        isCache: { // 非缓存状态下或者list缓存过期下onshow加载, 缓存下onload加载
            type: Boolean, //是否cache
            value: true
        },
		show: {
            type: String, //显示模式 分页page或者直接显示show
            value: 'page'
        },
    },

    /**
     * 组件的初始数据
     */
    data: {
        refresherTriggered: false, //下拉刷新是否完成  

        topNum: 0, //回顶部
        topShow: false,
    },

    lifetimes: {
        created: function () {
            // 组件实例化，但节点树还未导入，因此这时不能用setData
        },
        attached: function () {
            // 在组件实例进入页面节点树时执行 
            // 节点树完成，可以用setData渲染节点，但无法操作节点 
        },
        ready: async function () {

            // 组件布局完成，这时可以获取节点信息，也可以操作节点 

            if (this.data.isCache) //缓存状态下加载
                await this._getList(1);
        },
        move: function () {
            // 组件实例被移动到树的另一个位置
        },
        detached: function () {
            this._detached = true; this._generation = (this._generation || 0) + 1;
        },
    },

    pageLifetimes: {
        async show() {
            this._pageVisible = true;
            // 页面被展示   
            if (!this.data.isCache || !PublicBiz.isCacheList(this.data.type)) {
                // 非缓存状态下或者 list缓存过期下加载
                await this._getList(1);
            }

        },
        hide() {
            this._pageVisible = false; this._generation = (this._generation || 0) + 1; this._listRequest = null;
        },
        resize(size) {
            // 页面尺寸变化
        }
    },

    /**
     * 组件的方法列表
     */
    methods: {
        reload: async function () {
            return this._getList(1);
        },
        // 数据列表
        _getList: async function (page) {
            if (this._detached || this._pageVisible === false || !this.data.route) return;
            if (page > 1 && (!this.data._dataList || this._listRequest)) return;
            const key = this.data.route + ':' + JSON.stringify({ ...this.data._params, page });
            if (this._listRequest && this._listRequest.key === key) return this._listRequest.promise;
            const request = { key, generation: this._generation = (this._generation || 0) + 1 };
            request.promise = this._requestList(page, request.generation).finally(() => {
                if (this._listRequest === request) this._listRequest = null;
            });
            this._listRequest = request;
            return request.promise;
        },
        _requestList: async function (page, generation) {
            const isCurrent = () => !this._detached && this._pageVisible !== false && generation === this._generation;
            this.setData({ isLoad: !!this.data._dataList });

            let params = {
                page: page,
                ...this.data._params
            };

            if (page == 1 && !this.data._dataList) {
                this.triggerEvent('list', {
                    dataList: null //第一页面且没有数据提示加载中
                });
            }


            const result = await cloudHelper.dataList(this, '_dataList', this.data.route, params, { hint: false, isCurrent });
            if (!isCurrent() || result && result.applied === false) return;

            this.setData({ isLoad: true });

            this.triggerEvent('list', { //TODO 考虑改为双向数据绑定model 
                dataList: this.data._dataList
            });

            if (this.data.isCache && (!result || result.ok))
                PublicBiz.setCacheList(this.data.type);
            return result;

        },

        bindReachBottom: async function () {
            // 上拉触底  
            if (this.data._dataList) await this._getList(this.data._dataList.page + 1);

        },

        bindPullDownRefresh: async function () {
            // 下拉刷新
            this.setData({
                refresherTriggered: true
            });
            try { await this._getList(1); }
            finally { if (!this._detached) this.setData({ refresherTriggered: false }); }

        },

        /**
         * 顶部位置
         * @param {*} e 
         */
        bindScrollTop: function (e) {
            if (!!this.data.topShow === (e.detail.scrollTop > 100)) return;
            if (e.detail.scrollTop > 100) {
                this.setData({
                    topShow: true
                });
            } else {
                this.setData({
                    topShow: false
                });
            }
        },

        /**
         * 一键回到顶部
         */
        bindTopTap: function () {
            this.setData({
                topNum: 0
            });
        },

    }
})
