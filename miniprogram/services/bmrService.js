/**
 * BMR 计算服务
 * Mifflin-St Jeor 公式
 */

function calcBMR(gender, weight, height, age) {
  const w = Number(weight);
  const h = Number(height);
  const a = Number(age);
  if (!w || !h || !a) return 0;

  if (gender === 'female') {
    return Math.round(10 * w + 6.25 * h - 5 * a - 161);
  }
  return Math.round(10 * w + 6.25 * h - 5 * a + 5);
}

function calcDailyGoal(bmr, activityLevel) {
  const multipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
  };
  const mult = multipliers[activityLevel] || 1.2;
  return Math.round(bmr * mult);
}

module.exports = { calcBMR, calcDailyGoal };
