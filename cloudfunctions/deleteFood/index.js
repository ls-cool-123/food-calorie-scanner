const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  try {
    const res = await db.collection("foods").where({ name: event.name }).remove();
    return { success: true, removed: res.stats.removed };
  } catch (e) {
    return { success: false, errMsg: e.message };
  }
};
