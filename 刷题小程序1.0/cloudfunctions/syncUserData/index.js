// 云函数: syncUserData
// 将用户本地学习数据同步到云数据库
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { stats } = event;

  if (!stats) {
    return { code: -1, message: '缺少 stats 参数' };
  }

  try {
    const userRes = await db.collection('users').where({ _openid: openid }).get();

    const updateData = {
      todayDone: stats.todayDone || 0,
      todayGoal: stats.todayGoal || 100,
      accuracyRate: stats.accuracyRate || 0,
      streakDays: stats.streakDays || 0,
      totalDone: stats.totalDone || 0,
      avgAccuracy: stats.avgAccuracy || 0,
      vipStatus: stats.vipStatus || '标准会员',
      updatedAt: db.serverDate(),
    };

    if (userRes.data.length > 0) {
      // 更新已有记录
      await db.collection('users').doc(userRes.data[0]._id).update({ data: updateData });
    } else {
      // 新建记录
      updateData._openid = openid;
      updateData.userName = stats.userName || '考公学子';
      updateData.createdAt = db.serverDate();
      await db.collection('users').add({ data: updateData });
    }

    return { code: 0, message: 'ok' };
  } catch (err) {
    return { code: -1, message: err.message };
  }
};
