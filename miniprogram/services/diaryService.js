/**
 * 饮食日记服务
 */
const { today } = require('../utils/format');

const COLLECTION = 'diaries';

function getDB() {
  return wx.cloud.database();
}

async function addFood(food, weight, totalCalorie) {
  const date = today();
  const entry = {
    name: food.name,
    calorie: food.calorie,
    weight: Number(weight),
    totalCalorie: Number(totalCalorie),
    addedAt: Date.now()
  };

  const db = getDB();
  try {
    const existingRes = await db.collection(COLLECTION).where({ date }).get();

    if (existingRes.data.length > 0) {
      const doc = existingRes.data[0];
      const updatedFoods = [...doc.foods, entry];
      const updatedTotal = updatedFoods.reduce((sum, f) => sum + f.totalCalorie, 0);
      await db.collection(COLLECTION).doc(doc._id).update({
        data: { foods: updatedFoods, totalCalorie: updatedTotal }
      });
      return { ...doc, foods: updatedFoods, totalCalorie: updatedTotal };
    }

    await db.collection(COLLECTION).add({
      data: {
        date,
        foods: [entry],
        totalCalorie: Number(totalCalorie),
        createdAt: Date.now()
      }
    });
    return { date, foods: [entry], totalCalorie: Number(totalCalorie) };
  } catch (e) {
    throw new Error('数据库写入失败，请检查云数据库中是否已创建 diaries 集合');
  }
}

async function getTodayDiary() {
  const db = getDB();
  const date = today();
  try {
    const res = await db.collection(COLLECTION).where({ date }).get();
    return res.data.length > 0 ? res.data[0] : null;
  } catch (e) {
    return null;
  }
}

async function getDiaryList(limit = 30) {
  const db = getDB();
  try {
    const res = await db.collection(COLLECTION)
      .orderBy('date', 'desc')
      .limit(limit)
      .get();
    return res.data || [];
  } catch (e) {
    return [];
  }
}

async function deleteEntry(date, index) {
  const db = getDB();
  try {
    const res = await db.collection(COLLECTION).where({ date }).get();
    if (res.data.length === 0) return { success: false };

    const doc = res.data[0];
    const foods = [...doc.foods];
    foods.splice(index, 1);

    if (foods.length === 0) {
      await db.collection(COLLECTION).doc(doc._id).remove();
      return { success: true };
    }

    const totalCalorie = foods.reduce((sum, f) => sum + f.totalCalorie, 0);
    await db.collection(COLLECTION).doc(doc._id).update({
      data: { foods, totalCalorie }
    });
    return { success: true };
  } catch (e) {
    return { success: false };
  }
}

module.exports = { addFood, getTodayDiary, getDiaryList, deleteEntry };
