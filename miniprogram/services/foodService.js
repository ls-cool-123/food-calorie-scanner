const localFoodsData = require('../foods_data');

function _getCachedFoods() {
  try {
    return wx.getStorageSync('user_added_foods') || [];
  } catch (e) {
    return [];
  }
}

function _searchInList(list, name) {
  for (const food of list) {
    if (name === food.name) return food;
    if (food.aliases && Array.isArray(food.aliases)) {
      for (const alias of food.aliases) {
        if (name === alias) return food;
      }
    }
  }
  return null;
}

function _charOverlap(a, b) {
  var charsA = a.split('');
  var charsB = b.split('');
  var overlap = 0;
  for (var i = 0; i < charsA.length; i++) {
    var idx = charsB.indexOf(charsA[i]);
    if (idx !== -1) {
      overlap++;
      charsB.splice(idx, 1);
    }
  }
  return overlap / Math.max(a.length, b.length);
}

function _fuzzySearchInList(list, name) {
  // 先精确匹配
  var exact = _searchInList(list, name);
  if (exact) return exact;

  // 子串匹配：名字包含关系
  for (var j = 0; j < list.length; j++) {
    var food = list[j];
    if (food.name.includes(name) || name.includes(food.name)) return food;
    if (food.aliases && Array.isArray(food.aliases)) {
      for (var k = 0; k < food.aliases.length; k++) {
        if (food.aliases[k].includes(name) || name.includes(food.aliases[k])) return food;
      }
    }
  }

  // 字符重叠度匹配：> 60% 重合
  var bestMatch = null;
  var bestScore = 0.6;
  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    var score = _charOverlap(name, f.name);
    if (score > bestScore) { bestScore = score; bestMatch = f; }
    if (f.aliases && Array.isArray(f.aliases)) {
      for (var m = 0; m < f.aliases.length; m++) {
        var aScore = _charOverlap(name, f.aliases[m]);
        if (aScore > bestScore) { bestScore = aScore; bestMatch = f; }
      }
    }
  }
  return bestMatch;
}

function queryCalorieAsync(dishName) {
  return new Promise((resolve) => {
    const db = wx.cloud.database();
    db.collection('foods').where({ name: dishName }).get().then(exactRes => {
      if (exactRes.data.length > 0) return resolve(exactRes.data[0]);
      return db.collection('foods').limit(100).get();
    }).then(allRes => {
      const cloudData = allRes && allRes.data ? allRes.data : [];
      const mergedData = [...(localFoodsData || [])];
      const localNames = new Set(mergedData.map(f => f.name));
      for (const f of cloudData) {
        if (!localNames.has(f.name)) mergedData.push(f);
      }
      const match = _fuzzySearchInList(mergedData, dishName);
      if (match) return resolve(match);
      const cached = _getCachedFoods();
      resolve(cached.length > 0 ? _fuzzySearchInList(cached, dishName) : null);
    }).catch(() => {
      const match = _fuzzySearchInList(localFoodsData || [], dishName);
      if (match) return resolve(match);
      const cached = _getCachedFoods();
      resolve(cached.length > 0 ? _fuzzySearchInList(cached, dishName) : null);
    });
  });
}

function getAllFoods() {
  return new Promise((resolve) => {
    const localList = (localFoodsData || []).map(f => ({ ...f, _from: 'local' }));
    const cached = _getCachedFoods().map(f => ({ ...f, _from: 'cache' }));
    const localNames = new Set(localList.map(f => f.name));
    const uniqueCached = cached.filter(f => !localNames.has(f.name));
    const initialList = [...uniqueCached, ...localList];

    const db = wx.cloud.database();
    db.collection('foods').limit(100).get().then(res => {
      const cloudFoods = (res.data || []).map(f => ({ ...f, _from: 'cloud' }));
      const currentNames = new Set(initialList.map(f => f.name));
      const newFromCloud = cloudFoods.filter(f => !currentNames.has(f.name));
      resolve([...initialList, ...newFromCloud]);
    }).catch(() => {
      resolve(initialList);
    });
  });
}

module.exports = { queryCalorieAsync, getAllFoods };
