module.exports = { //crun
	PROJECT_COLOR: '#397BC8',
	NAV_COLOR: '#FFFFFF',
	NAV_BG: '#397BC8',

	// setup
	SETUP_CONTENT_ITEMS: [
		{ title: '关于我们', key: 'SETUP_CONTENT_ABOUT' },
		{ title: '联系我们', key: 'SETUP_CONTENT_CONTACT' },
	],

	// 用户
	USER_REG_CHECK: false,
	USER_FIELDS: [
		{ mark: 'sex', title: '性别', type: 'select', selectOptions: ['男', '女'], must: true },
		{ mark: 'college', title: '学院', type: 'text', must: true },
		{ mark: 'sub', title: '专业', type: 'text', must: true },
		{ mark: 'payPic', title: '支付凭证', type: 'image', must: false, max: 1, ext: { hint: '请上传图片，支持jpg/png格式' } },
	],
	USER_CHECK_FORM: {
		name: 'formName|must|string|min:1|max:30|name=姓名',
		mobile: 'formMobile|must|mobile|name=手机',
		pic: 'formPic|must|string|name=头像',
		forms: 'formForms|array'
	},

	NEWS_NAME: '通知公告',
	NEWS_CATE: [
		{ id: 1, title: '通知公告', style: 'leftbig1' },

	],
	NEWS_FIELDS: [
	],


	MAIL_NAME: '快递代取',
	MAIL_CATE: [
		{ id: 1, title: '快递代取', style: 'leftbig1' },

	],
	MAIL_FIELDS: [
		{ mark: 'title', title: '快递名称', type: 'text', max: 50, must: true },
		{ mark: 'num', title: '快递件数', type: 'int', must: true },
		{ mark: 'weight', title: '预估重量(kg)', type: 'int', must: true },
		{ mark: 'price', title: '打赏金额(元)', type: 'digit', must: true },
		{ mark: 'poster', title: '联系人', type: 'text', must: true },
		{ mark: 'tel', title: '联系人电话', type: 'mobile', ext: { hint: '请放心填写电话，仅接单后可见' }, must: true },
		{ mark: 'address1', title: '取件地址', type: 'textarea', must: true },
		{ mark: 'address2', title: '送货地址', type: 'textarea', must: true },
		{ mark: 'desc', title: '补充说明', type: 'textarea', must: false },
		{ mark: 'code', title: '取件码', type: 'textarea', ext: { hint: '请放心填写取件码，仅接单后可见' }, must: true },
		{ mark: 'img', title: '相关图片', type: 'image', ext: { hint: '请放心上传，仅接单后可见' }, min: 0, max: 8, must: false },
	],

}
