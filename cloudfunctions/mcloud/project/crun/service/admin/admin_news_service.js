/**
 * Notes: 资讯后台管理
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2021-07-11 07:48:00 
 */

const BaseProjectAdminService = require('./base_project_admin_service.js'); 
const dataUtil = require('../../../../framework/utils/data_util.js');
const util = require('../../../../framework/utils/util.js'); 
const cloudUtil = require('../../../../framework/cloud/cloud_util.js');

const NewsModel = require('../../model/news_model.js');

class AdminNewsService extends BaseProjectAdminService {


	/**添加资讯 */
	async insertNews({
		title,
		desc,
		cateId,
		cateName,
		order = 9999,
		forms,
		content,
		qr
	}) {
		if (!title) this.AppError('标题不能为空');

		const newsId = 'NEWS' + Date.now() + Math.random().toString(36).substr(2, 9);

		let data = {
			NEWS_ID: newsId,
			NEWS_TITLE: title,
			NEWS_DESC: desc || '',
			NEWS_CATE_ID: cateId || '0',
			NEWS_CATE_NAME: cateName || '',
			NEWS_ORDER: order,
			NEWS_STATUS: 1,
			NEWS_VOUCH: 0,
			NEWS_QR: qr || '',
			NEWS_FORMS: forms || [],
			NEWS_OBJ: dataUtil.dbForms2Obj(forms || []),
			NEWS_CONTENT: content || [],
			NEWS_ADD_TIME: this._timestamp,
			NEWS_EDIT_TIME: this._timestamp,
		};

		await NewsModel.insert(data);
		return { id: newsId };
	}

	/**删除资讯数据 */
	async delNews(id) {
		if (!id) this.AppError('id不能为空');
		await NewsModel.del(id);
		return { id };
	}

	/**获取资讯信息 */
	async getNewsDetail(id) {
		let fields = '*';

		let where = {
			_id: id
		}
		let news = await NewsModel.getOne(where, fields);
		if (!news) return null;

		return news;
	}

	// 更新forms信息
	async updateNewsForms({
		id,
		hasImageForms
	}) {
		if (!id) this.AppError('id不能为空');
		if (!hasImageForms || !Array.isArray(hasImageForms) || hasImageForms.length === 0) return;

		await NewsModel.editForms(id, 'NEWS_FORMS', 'NEWS_OBJ', hasImageForms);

	}


	/**
	 * 更新富文本详细的内容及图片信息
	 * @returns 返回 urls数组 [url1, url2, url3, ...]
	 */
	async updateNewsContent({
		id,
		content // 富文本数组
	}) {
		if (!id) this.AppError('id不能为空');
		await NewsModel.edit(id, { NEWS_CONTENT: content || [] });
		return { id };
	}

	/**
	 * 更新资讯图片信息
	 * @returns 返回 urls数组 [url1, url2, url3, ...]
	 */
	async updateNewsPic({
		id,
		imgList
	}) {
		if (!id) this.AppError('id不能为空');
		await NewsModel.edit(id, { NEWS_PIC: imgList || [] });
		return { id };
	}


	/**更新资讯数据 */
	async editNews({
		id,
		title,
		desc,
		cateId,
		cateName,
		order,
		forms,
		qr
	}) {
		if (!id) this.AppError('id不能为空');

		let data = {
			NEWS_EDIT_TIME: this._timestamp,
		};
		if (title !== undefined) data.NEWS_TITLE = title;
		if (desc !== undefined) data.NEWS_DESC = desc;
		if (cateId !== undefined) data.NEWS_CATE_ID = cateId;
		if (cateName !== undefined) data.NEWS_CATE_NAME = cateName;
		if (order !== undefined) data.NEWS_ORDER = order;
		if (qr !== undefined) data.NEWS_QR = qr;
		if (forms !== undefined) {
			data.NEWS_FORMS = forms;
			data.NEWS_OBJ = dataUtil.dbForms2Obj(forms);
		}

		await NewsModel.edit(id, data);
		return { id };
	}

	/**取得资讯分页列表 */
	async getAdminNewsList({
		search, // 搜索条件
		sortType, // 搜索菜单
		sortVal, // 搜索菜单
		orderBy, // 排序
		whereEx, //附加查询条件
		page,
		size,
		isTotal = true,
		oldTotal
	}) {

		orderBy = orderBy || {
			'NEWS_ORDER': 'asc',
			'NEWS_ADD_TIME': 'desc'
		};
		let fields = 'NEWS_TITLE,NEWS_DESC,NEWS_CATE_ID,NEWS_CATE_NAME,NEWS_EDIT_TIME,NEWS_ADD_TIME,NEWS_ORDER,NEWS_STATUS,NEWS_CATE2_NAME,NEWS_VOUCH,NEWS_QR,NEWS_OBJ';

		let where = {};
		where.and = {
			_pid: this.getProjectId() //复杂的查询在此处标注PID
		};

		if (util.isDefined(search) && search) {
			where.or = [
				{ NEWS_TITLE: ['like', search] },
			];

		} else if (sortType && util.isDefined(sortVal)) {
			// 搜索菜单
			switch (sortType) {
				case 'cateId': {
					where.and.NEWS_CATE_ID = String(sortVal);
					break;
				}
				case 'status': {
					where.and.NEWS_STATUS = Number(sortVal);
					break;
				}
				case 'top': {
					where.and.NEWS_ORDER = 0;
					break;
				}
				case 'sort': {
					orderBy = this.fmtOrderBySort(sortVal, 'NEWS_ADD_TIME');
					break;
				}

			}
		}

		return await NewsModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);
	}

	/**修改资讯状态 */
	async statusNews(id, status) {
		if (!id) this.AppError('id不能为空');
		await NewsModel.edit(id, { NEWS_STATUS: Number(status), NEWS_EDIT_TIME: this._timestamp });
		return { id };
	}

	/**置顶与排序设定 */
	async sortNews(id, sort) {
		if (!id) this.AppError('id不能为空');
		await NewsModel.edit(id, { NEWS_ORDER: Number(sort), NEWS_EDIT_TIME: this._timestamp });
		return { id };
	}
}

module.exports = AdminNewsService;