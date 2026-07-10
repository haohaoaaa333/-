// 云函数: getUserStats
// 获取或初始化用户学习统计数据
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  try {
    // 查询用户数据
    const userRes = await db.collection('users').where({ _openid: openid }).get();

    if (userRes.data.length > 0) {
      return {
        code: 0,
        data: userRes.data[0],
        message: 'ok',
      };
    }

    // 新用户: 创建初始记录
    const defaultStats = {
      _openid: openid,
      todayDone: 0,
      todayGoal: 100,
      accuracyRate: 0,
      streakDays: 0,
      totalDone: 0,
      avgAccuracy: 0,
      userName: '考公学子',
      vipStatus: '标准会员',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    };

    await db.collection('users').add({ data: defaultStats });

    return {
      code: 0,
      data: defaultStats,
      message: 'created',
    };
  } catch (err) {
    return { code: -1, message: err.message };
  }
};
