const config = require('../../config');
const localFoodsData = require('../../foods_data');

// Promise 化封装
function requestPromise(options) {
  return new Promise((resolve, reject) => {
    wx.request({ ...options, success: resolve, fail: reject });
  });
}

function readFilePromise(options) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({ ...options, success: resolve, fail: reject });
  });
}

function compressImagePromise(src) {
  return new Promise((resolve, reject) => {
    wx.compressImage({ src, quality: 80, success: resolve, fail: reject });
  });
}

Page({
  data: {
    imgSrc: '',
    result: null,
    totalCalorie: 0,
    showFoodList: false,
    allFoods: [],
    filteredFoods: [],
    foodSearchKeyword: ''
  },

  // 1. 选择图片/拍照（增加压缩步骤）
  chooseImage() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const tempFilePath = res.tempFilePaths[0];
        this.setData({ imgSrc: tempFilePath });
        // 先压缩图片，提高识别速度和准确率
        try {
          const compressRes = await compressImagePromise(tempFilePath);
          this.getAccessToken(compressRes.tempFilePath);
        } catch (e) {
          // 压缩失败就用原图
          this.getAccessToken(tempFilePath);
        }
      },
      fail: (err) => {
        if (err.errMsg.includes('auth deny')) {
          wx.showModal({
            title: '需要权限',
            content: '需要开启相机/相册权限，才能拍照识别食物',
            confirmText: '去开启',
            success: (modalRes) => {
              if (modalRes.confirm) wx.openSetting();
            }
          });
        } else if (!err.errMsg.includes('cancel')) {
          wx.showToast({ title: '选图失败，请重试', icon: 'none' });
        }
      }
    });
  },

  // 2. 获取百度AI的Access Token
  getAccessToken(filePath) {
    const API_KEY = config.BAIDU_API_KEY;
    const SECRET_KEY = config.BAIDU_SECRET_KEY;

    wx.request({
      url: 'https://aip.baidubce.com/oauth/2.0/token',
      method: 'POST',
      header: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: {
        grant_type: 'client_credentials',
        client_id: API_KEY,
        client_secret: SECRET_KEY
      },
      success: (res) => {
        if (res.data.access_token) {
          this.identifyFood(filePath, res.data.access_token);
        } else {
          wx.showToast({
            title: res.data.error_description || '获取AI权限失败',
            icon: 'none',
            duration: 3000
          });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络请求失败，请检查网络', icon: 'none' });
      }
    });
  },

  // 3. 识别食物（三路并行 + 包装检测，防止果蔬API误判瓶装食品）
  async identifyFood(filePath, accessToken) {
    wx.showLoading({ title: '识别中...' });

    let base64Img;
    try {
      const fileRes = await readFilePromise({ filePath, encoding: 'base64' });
      base64Img = fileRes.data;
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '图片读取失败', icon: 'none' });
      return;
    }

    const NON_DISH_KEYWORDS = ['非菜', '无法识别', '未知菜品', '非菜品', '其他'];
    const NON_INGREDIENT_KEYWORDS = ['非果蔬食材', '无法识别', '未知食材', '其他'];
    const NON_FOOD_KEYWORDS = ['人物', '建筑', '汽车', '桌子', '盘子', '筷子', '碗', '杯子', '手机', '书本', '动物', '风景',
      '瓶子', '罐子', '包装', '塑料', '标签', '纸箱', '盒子', '袋子', 'logo', '商标'];
    const PACKAGING_KEYWORDS = ['瓶', '罐', '包装', '盒', '袋', '桶', '杯', '碗', '盘', '塑料', '玻璃', '易拉罐', '容器'];

    function isValidResult(name, blacklist, minConf, confidence) {
      return name && !blacklist.includes(name) && confidence >= minConf;
    }

    // 收集该 API 全部有效候选（不再提前返回，用于跨 API 共识评分）
    const tryMatchAll = async (results, blacklist, minConf, apiLabel) => {
      const candidates = results
        .filter(r => isValidResult(r.name || r.keyword, blacklist, minConf, r.probability || r.score))
        .map(r => ({ name: r.name || r.keyword, confidence: r.probability || r.score }));

      const matched = [];
      for (const { name, confidence } of candidates) {
        console.log(`[${apiLabel}] 尝试匹配候选: "${name}" (置信度: ${(confidence * 100).toFixed(0)}%)`);
        const food = await this.queryCalorieAsync(name);
        if (food) {
          console.log(`[${apiLabel}] 匹配成功: "${name}" -> "${food.name}"`);
          food._confidence = confidence;
          food._apiLabel = apiLabel;
          matched.push(food);
        }
      }
      return matched;
    };

    // 三路 API 并行调用
    const API_URLS = {
      dish: 'https://aip.baidubce.com/rest/2.0/image-classify/v2/dish',
      ingredient: 'https://aip.baidubce.com/rest/2.0/image-classify/v1/classify/ingredient',
      general: 'https://aip.baidubce.com/rest/2.0/image-classify/v2/advanced_general'
    };

    // 用 reflect 模式替代 Promise.allSettled（兼容低版本微信）
    const reflect = (p) => p.then(v => ({ ok: true, v })).catch(e => ({ ok: false, e }));

    const [dishRef, ingredientRef, generalRef] = await Promise.all([
      reflect(this.callBaiduAPIPromise(API_URLS.dish, accessToken, base64Img)),
      reflect(this.callBaiduAPIPromise(API_URLS.ingredient, accessToken, base64Img)),
      reflect(this.callBaiduAPIPromise(API_URLS.general, accessToken, base64Img))
    ]);

    const dishResults = dishRef.ok ? (dishRef.v.result || []) : [];
    const ingredientResults = ingredientRef.ok ? (ingredientRef.v.result || []) : [];
    const generalResults = generalRef.ok ? (generalRef.v.result || []) : [];

    // 包装检测：通用识别结果中是否包含包装/容器类关键词
    const generalTopNames = generalResults.slice(0, 5).map(r => (r.name || r.keyword || '').toLowerCase());
    const isPackaging = generalTopNames.some(name =>
      PACKAGING_KEYWORDS.some(kw => name.includes(kw))
    );
    if (isPackaging) {
      console.log('[包装检测] 检测到包装/容器特征，果蔬识别阈值提升至 0.85');
    }

    // 跨 API 共识评分决策
    const ingredientThreshold = isPackaging ? 0.85 : 0.6;

    const API_WEIGHTS = { '菜品识别': 0.95, '果蔬识别': 1.0, '通用识别': 0.85 };
    const CONSENSUS_BONUS = 0.25;

    // 并行收集三路全部候选
    const [dishCandidates, ingredientCandidates, generalCandidates] = await Promise.all([
      tryMatchAll(dishResults, NON_DISH_KEYWORDS, 0.5, '菜品识别'),
      tryMatchAll(ingredientResults, NON_INGREDIENT_KEYWORDS, ingredientThreshold, '果蔬识别'),
      tryMatchAll(generalResults, NON_FOOD_KEYWORDS, 0.4, '通用识别')
    ]);

    const allCandidates = [...dishCandidates, ...ingredientCandidates, ...generalCandidates];

    if (allCandidates.length > 0) {
      // 按食物名称分组，取每组最高加权分
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

      const best = ranked[0];
      console.log(`[共识评分] 最优: "${best.name}" score=${best._score.toFixed(2)} consensus=${best._consensus}`);

      // 评分 >= 0.5 直接用，有共识且 >= 0.3 也用
      if (best._score >= 0.5 || (best._consensus && best._score >= 0.3)) {
        wx.hideLoading();
        wx.showToast({ title: '识别到：' + best.name, icon: 'success' });
        this.handleQuerySuccess(best);
        return;
      }
    }

    // 无足够信心的结果，进入手动选择
    wx.hideLoading();
    wx.showToast({ title: '未识别到食物，请手动选择', icon: 'none', duration: 2000 });
    setTimeout(() => this.showAllFoodsList(), 2000);
  },

  // Promise 版百度API调用
  callBaiduAPIPromise(url, accessToken, base64Img) {
    return new Promise((resolve, reject) => {
      wx.request({
        url: url + '?access_token=' + accessToken,
        method: 'POST',
        header: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: { image: base64Img, top_num: 5 },
        success: (res) => resolve(res.data),
        fail: reject
      });
    });
  },

  // Promise 版热量查询（云数据库 + 本地数据兜底）
  queryCalorieAsync(dishName) {
    return new Promise((resolve) => {
      const db = wx.cloud.database();
      // 策略1：云数据库精确匹配 name
      db.collection('foods').where({ name: dishName }).get().then(exactRes => {
        if (exactRes.data.length > 0) {
          return resolve(exactRes.data[0]);
        }
        // 策略2：云数据库全量扫描（增加 limit 到 100）
        return db.collection('foods').limit(100).get();
      }).then(allRes => {
        // 在云数据中模糊匹配
        const searchInList = (list) => {
          let bestMatch = null;
          let bestLen = 0;
          let bestRatio = 0;
          for (const food of list) {
            if (dishName.includes(food.name) || food.name.includes(dishName)) {
              if (food.name.length > bestLen) {
                bestMatch = food;
                bestLen = food.name.length;
              }
            }
            if (food.aliases && Array.isArray(food.aliases)) {
              for (const alias of food.aliases) {
                if (dishName.includes(alias) || alias.includes(dishName)) {
                  // 偏向长度接近的别名，避免"牛奶"误匹配"牛奶巧克力"
                  const ratio = Math.min(dishName.length, alias.length) / Math.max(dishName.length, alias.length);
                  if (ratio > bestRatio) {
                    bestMatch = food;
                    bestRatio = ratio;
                  }
                }
              }
            }
          }
          return bestMatch;
        };

        const cloudMatch = allRes && allRes.data ? searchInList(allRes.data) : null;
        if (cloudMatch) return resolve(cloudMatch);

        // 策略3：本地数据兜底
        const localMatch = searchInList(localFoodsData || []);
        if (localMatch) return resolve(localMatch);

        // 策略4：用户缓存食物兜底
        const cachedMatch = searchInList(this._getCachedFoods());
        resolve(cachedMatch);
      }).catch(() => {
        // 云数据库失败，直接用本地数据 + 用户缓存
        const searchInList = (list) => {
          let bestMatch = null;
          let bestLen = 0;
          let bestRatio = 0;
          for (const food of list) {
            if (dishName.includes(food.name) || food.name.includes(dishName)) {
              if (food.name.length > bestLen) {
                bestMatch = food;
                bestLen = food.name.length;
              }
            }
            if (food.aliases && Array.isArray(food.aliases)) {
              for (const alias of food.aliases) {
                if (dishName.includes(alias) || alias.includes(dishName)) {
                  // 偏向长度接近的别名，避免"牛奶"误匹配"牛奶巧克力"
                  const ratio = Math.min(dishName.length, alias.length) / Math.max(dishName.length, alias.length);
                  if (ratio > bestRatio) {
                    bestMatch = food;
                    bestRatio = ratio;
                  }
                }
              }
            }
          }
          return bestMatch;
        };
        resolve(searchInList(localFoodsData || []) || searchInList(this._getCachedFoods()));
      });
    });
  },

  // 原有的回调版 queryCalorie（保留兼容，实际已改用 queryCalorieAsync）
  queryCalorie(dishName) {
    const db = wx.cloud.database();
    wx.showLoading({ title: '查询热量中...' });

    db.collection('foods').where({ name: dishName }).get().then(exactRes => {
      if (exactRes.data.length > 0) {
        this.handleQuerySuccess(exactRes.data[0]);
        return;
      }
      return db.collection('foods').get();
    }).then(allFoodsRes => {
      if (!allFoodsRes) return;
      const allFoods = allFoodsRes.data;
      let bestMatch = null;
      let bestLen = 0;
      let bestRatio = 0;
      for (const food of allFoods) {
        if (dishName.includes(food.name) || food.name.includes(dishName)) {
          if (food.name.length > bestLen) {
            bestMatch = food;
            bestLen = food.name.length;
          }
        }
        if (food.aliases && Array.isArray(food.aliases)) {
          for (const alias of food.aliases) {
            if (dishName.includes(alias) || alias.includes(dishName)) {
              // 偏向长度接近的别名，避免"牛奶"误匹配"牛奶巧克力"
              const ratio = Math.min(dishName.length, alias.length) / Math.max(dishName.length, alias.length);
              if (ratio > bestRatio) {
                bestMatch = food;
                bestRatio = ratio;
              }
            }
          }
        }
      }
      if (bestMatch) {
        this.handleQuerySuccess(bestMatch);
      } else {
        wx.hideLoading();
        wx.showToast({ title: '未收录该食物', icon: 'none' });
      }
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '查询失败', icon: 'none' });
    });
  },

  handleQuerySuccess(food) {
    wx.hideLoading();
    this.setData({
      result: food,
      totalCalorie: 0
    });
  },

  // 手动选择食物列表（本地831条 + 云端补充去重）
  showAllFoodsList() {
    // 立即展示本地数据 + 用户缓存食物，标记来源
    const localList = (localFoodsData || []).map(f => ({ ...f, _from: 'local' }));
    const cachedFoods = this._getCachedFoods().map(f => ({ ...f, _from: 'cache' }));
    const localNames = new Set(localList.map(f => f.name));
    const uniqueCached = cachedFoods.filter(f => !localNames.has(f.name));
    const initialList = [...uniqueCached, ...localList];
    this.setData({
      showFoodList: true,
      allFoods: initialList,
      filteredFoods: initialList,
      foodSearchKeyword: ''
    });

    // 异步加载云端数据补充，标记来源
    const db = wx.cloud.database();
    db.collection('foods').limit(100).get().then(res => {
      const cloudFoods = (res.data || []).map(f => ({ ...f, _from: 'cloud' }));
      if (cloudFoods.length === 0) return;
      const currentNames = new Set(this.data.allFoods.map(f => f.name));
      const newFromCloud = cloudFoods.filter(f => !currentNames.has(f.name));
      if (newFromCloud.length > 0) {
        const merged = [...this.data.allFoods, ...newFromCloud];
        this.setData({
          allFoods: merged,
          filteredFoods: merged
        });
      }
    }).catch(() => {});
  },

  hideFoodList() {
    this.setData({ showFoodList: false });
  },

  filterFoodList(e) {
    const keyword = e.detail.value.toLowerCase();
    const filtered = this.data.allFoods.filter(food => {
      const matchName = food.name.toLowerCase().includes(keyword);
      const matchAlias = food.aliases && food.aliases.some(a => a.toLowerCase().includes(keyword));
      return matchName || matchAlias;
    });
    this.setData({ filteredFoods: filtered, foodSearchKeyword: keyword });
  },

  selectFood(e) {
    const index = e.currentTarget.dataset.index;
    const food = this.data.filteredFoods[index];
    this.setData({ showFoodList: false });
    this.handleQuerySuccess(food);
    wx.showToast({ title: '已选择：' + food.name, icon: 'success' });
  },

  nop() {},

  // 长按删除食物（仅限用户添加的，内置local不可删）
  deleteFood(e) {
    const name = e.currentTarget.dataset.name;
    const from = e.currentTarget.dataset.from;
    if (from === 'local') {
      wx.showToast({ title: '内置食物不可删除', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删除食物',
      content: `确定删除「${name}」吗？`,
      success: (res) => {
        if (!res.confirm) return;
        // 删除本地缓存
        if (from === 'cache') this._removeCachedFood(name);
        // 删除云端数据
        wx.cloud.callFunction({ name: 'deleteFood', data: { name } }).then(() => {
          // 刷新列表
          const all = this.data.allFoods.filter(f => f.name !== name);
          const filtered = this.data.filteredFoods.filter(f => f.name !== name);
          this.setData({ allFoods: all, filteredFoods: filtered });
          wx.showToast({ title: '已删除', icon: 'success' });
        }).catch(() => {
          wx.showToast({ title: '删除失败', icon: 'none' });
        });
      }
    });
  },

  _removeCachedFood(name) {
    const cached = this._getCachedFoods();
    const updated = cached.filter(f => f.name !== name);
    wx.setStorageSync('user_added_foods', updated);
  },

  // 本地缓存用户添加的食物（用于食物列表补充）
  _getCachedFoods() {
    try {
      return wx.getStorageSync('user_added_foods') || [];
    } catch (e) {
      return [];
    }
  },

  calcTotalCalorie(e) {
    const weight = e.detail.value;
    const caloriePer100g = this.data.result.calorie;
    if (weight && caloriePer100g && !isNaN(caloriePer100g)) {
      const total = (caloriePer100g * weight / 100).toFixed(0);
      this.setData({ totalCalorie: total });
    } else {
      this.setData({ totalCalorie: 0 });
    }
  }
})