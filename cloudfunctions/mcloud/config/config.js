module.exports = {

	//### 环境相关 
	CLOUD_ID: process.env.CLOUD_ENV_ID || process.env.TCB_ENV || '', //你的云环境id

	// ##################################################################   
	COLLECTION_PRFIX: 'bx_',

	IS_DEMO: false, //是否演示版 (后台不可操作提交动作)  
	// ##################################################################
	// #### 调试相关 
	TEST_MODE: false, // 测试模式 涉及小程序码生成路径， 用以下 TEST_TOKEN_ID openid.. 
	TEST_TOKEN_ID: '',
 

	// #### 内容安全
	CLIENT_CHECK_CONTENT: process.env.CONTENT_CHECK_DISABLED !== 'true', //前台图片文字是否校验
	ADMIN_CHECK_CONTENT: process.env.CONTENT_CHECK_DISABLED !== 'true', //后台图片文字是否校验

	// ### 后台业务相关
	ADMIN_LOGIN_EXPIRE: 86400, //管理员token过期时间 (秒) 

	// ### 服务者相关
	WORK_LOGIN_EXPIRE: 86400, //服务者token过期时间 (秒) 
}