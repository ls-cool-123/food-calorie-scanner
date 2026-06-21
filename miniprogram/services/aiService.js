const config = require('../config');
const { request, readFile } = require('../utils/request');
const { queryCalorieAsync } = require('./foodService');

const API_URLS = {
  dish: 'https://aip.baidubce.com/rest/2.0/image-classify/v2/dish',
  ingredient: 'https://aip.baidubce.com/rest/2.0/image-classify/v1/classify/ingredient',
  general: 'https://aip.baidubce.com/rest/2.0/image-classify/v2/advanced_general'
};

const NON_DISH_KEYWORDS = ['非菜', '无法识别', '未知菜品', '非菜品', '其他'];
const NON_INGREDIENT_KEYWORDS = ['非果蔬食材', '无法识别', '未知食材', '其他'];
const NON_FOOD_KEYWORDS = ['人物', '建筑', '汽车', '桌子', '筷子', '手机', '书本', '动物', '风景', 'logo', '商标'];
const PACKAGING_KEYWORDS = ['瓶', '罐', '包装', '盒', '袋', '桶', '杯', '碗', '盘', '塑料', '玻璃', '易拉罐', '容器'];
const API_WEIGHTS = { '菜品识别': 0.95, '果蔬识别': 1.0, '通用识别': 0.85 };
const CONSENSUS_BONUS = 0.25;

function getAccessToken() {
  return new Promise((resolve, reject) => {
    request({
      url: 'https://aip.baidubce.com/oauth/2.0/token',
      method: 'POST',
      header: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: {
        grant_type: 'client_credentials',
        client_id: config.BAIDU_API_KEY,
        client_secret: config.BAIDU_SECRET_KEY
      }
    }).then(res => {
      if (res.data.access_token) resolve(res.data.access_token);
      else reject(new Error(res.data.error_description || '获取AI权限失败'));
    }).catch(reject);
  });
}

function callBaiduAPI(url, accessToken, base64Img) {
  return new Promise((resolve, reject) => {
    request({
      url: url + '?access_token=' + accessToken,
      method: 'POST',
      header: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: { image: base64Img, top_num: 5 }
    }).then(res => resolve(res.data)).catch(reject);
  });
}

function isValidResult(name, blacklist, minConf, confidence) {
  return name && !blacklist.includes(name) && confidence >= minConf;
}

async function tryMatchAll(results, blacklist, minConf, apiLabel) {
  const candidates = results
    .filter(r => isValidResult(r.name || r.keyword, blacklist, minConf, r.probability || r.score))
    .map(r => ({ name: r.name || r.keyword, confidence: r.probability || r.score }));

  const matched = [];
  for (const { name, confidence } of candidates) {
    const food = await queryCalorieAsync(name);
    if (food) {
      food._confidence = confidence;
      food._apiLabel = apiLabel;
      matched.push(food);
    }
  }
  return matched;
}

function reflect(p) {
  return p.then(v => ({ ok: true, v })).catch(e => ({ ok: false, e }));
}

async function identifyFood(filePath) {
  let base64Img;
  try {
    const fileRes = await readFile({ filePath, encoding: 'base64' });
    base64Img = fileRes.data;
  } catch (e) {
    throw new Error('图片读取失败');
  }

  const accessToken = await getAccessToken();

  const [dishRef, ingredientRef, generalRef] = await Promise.all([
    reflect(callBaiduAPI(API_URLS.dish, accessToken, base64Img)),
    reflect(callBaiduAPI(API_URLS.ingredient, accessToken, base64Img)),
    reflect(callBaiduAPI(API_URLS.general, accessToken, base64Img))
  ]);

  const dishResults = dishRef.ok ? (dishRef.v.result || []) : [];
  const ingredientResults = ingredientRef.ok ? (ingredientRef.v.result || []) : [];
  const generalResults = generalRef.ok ? (generalRef.v.result || []) : [];

  const generalTopNames = generalResults.slice(0, 5).map(r => (r.name || r.keyword || '').toLowerCase());
  const isPackaging = generalTopNames.some(name =>
    PACKAGING_KEYWORDS.some(kw => name.includes(kw))
  );

  const ingredientThreshold = isPackaging ? 0.80 : 0.6;

  const [dishCandidates, ingredientCandidates, generalCandidates] = await Promise.all([
    tryMatchAll(dishResults, NON_DISH_KEYWORDS, 0.5, '菜品识别'),
    tryMatchAll(ingredientResults, NON_INGREDIENT_KEYWORDS, ingredientThreshold, '果蔬识别'),
    tryMatchAll(generalResults, NON_FOOD_KEYWORDS, 0.4, '通用识别')
  ]);

  const allCandidates = [...dishCandidates, ...ingredientCandidates, ...generalCandidates];

  if (allCandidates.length === 0) return null;

  const groups = {};
  for (const food of allCandidates) {
    const name = food.name;
    if (!groups[name]) groups[name] = [];
    groups[name].push(food);
  }

  const ranked = [];
  for (const [name, items] of Object.entries(groups)) {
    const apiSources = new Set(items.map(f => f._apiLabel));
    const consensusBonus = apiSources.size >= 2 ? CONSENSUS_BONUS : 0;
    let bestScore = 0;
    let bestItem = items[0];
    for (const item of items) {
      const apiWeight = API_WEIGHTS[item._apiLabel] || 1.0;
      const score = item._confidence * apiWeight + consensusBonus;
      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
    }
    bestItem._score = bestScore;
    bestItem._consensus = apiSources.size >= 2;
    ranked.push(bestItem);
  }
  ranked.sort((a, b) => b._score - a._score);

  const topByConfidence = [...allCandidates].sort((a, b) => b._confidence - a._confidence)[0];
  if (topByConfidence._apiLabel === '菜品识别') {
    return topByConfidence;
  }

  const best = ranked[0];
  if (best._score >= 0.35 || (best._consensus && best._score >= 0.25)) {
    return best;
  }

  return null;
}

module.exports = { identifyFood, getAccessToken };
