const { chooseImage, compressImage } = require('../../utils/request');
const { identifyFood } = require('../../services/aiService');
const { getAllFoods } = require('../../services/foodService');
const { addFood } = require('../../services/diaryService');

Page({
  data: {
    imgSrc: '',
    result: null,
    totalCalorie: 0,
    selectedWeight: 0,
    showFoodList: false,
    allFoods: [],
    filteredFoods: [],
    foodSearchKeyword: ''
  },

  chooseImage() {
    chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera']
    }).then(res => {
      const tempFilePath = res.tempFilePaths[0];
      this.setData({ imgSrc: tempFilePath });
      return compressImage(tempFilePath).catch(() => ({ tempFilePath }));
    }).then(compressRes => {
      const filePath = compressRes.tempFilePath;
      wx.showLoading({ title: '识别中...' });
      return identifyFood(filePath);
    }).then(food => {
      wx.hideLoading();
      if (food) {
        wx.showToast({ title: '识别到：' + food.name, icon: 'success' });
        this.setData({ result: food, totalCalorie: 0, selectedWeight: 0 });
      } else {
        wx.showToast({ title: '未识别到食物，请手动选择', icon: 'none', duration: 2000 });
        setTimeout(() => this.showAllFoodsList(), 2000);
      }
    }).catch(err => {
      wx.hideLoading();
      if (err && err.errMsg && err.errMsg.includes('auth deny')) {
        wx.showModal({
          title: '需要权限',
          content: '需要开启相机/相册权限，才能拍照识别食物',
          confirmText: '去开启',
          success: (modalRes) => {
            if (modalRes.confirm) wx.openSetting();
          }
        });
      } else if (!(err && err.errMsg && err.errMsg.includes('cancel'))) {
        wx.showToast({ title: '操作失败，请重试', icon: 'none' });
      }
    });
  },

  calcTotalCalorie(e) {
    const weight = Number(e.detail.value);
    const caloriePer100g = this.data.result && this.data.result.calorie;
    this.setData({ selectedWeight: weight });
    if (weight && caloriePer100g && !isNaN(caloriePer100g)) {
      const total = (caloriePer100g * weight / 100).toFixed(0);
      this.setData({ totalCalorie: total });
    } else {
      this.setData({ totalCalorie: 0 });
    }
  },

  addToDiary() {
    const { result, selectedWeight, totalCalorie } = this.data;
    if (!result || !selectedWeight || !totalCalorie) {
      wx.showToast({ title: '请先输入食用克数', icon: 'none' });
      return;
    }
    addFood(result, selectedWeight, totalCalorie).then(() => {
      wx.showToast({ title: '已添加到日记', icon: 'success' });
    }).catch(err => {
      console.error('添加日记失败:', err);
      wx.showToast({ title: err.message || '添加失败', icon: 'none', duration: 3000 });
    });
  },

  openDiary() {
    wx.switchTab({ url: '/pages/diary/diary' }).catch(() => {
      wx.navigateTo({ url: '/pages/diary/diary' });
    });
  },

  // ========== 手动选择食物 ==========

  showAllFoodsList() {
    getAllFoods().then(foods => {
      this.setData({
        showFoodList: true,
        allFoods: foods,
        filteredFoods: foods,
        foodSearchKeyword: ''
      });
    }).catch(() => {
      this.setData({
        showFoodList: true,
        allFoods: [],
        filteredFoods: [],
        foodSearchKeyword: ''
      });
    });
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
    this.setData({ showFoodList: false, result: food, totalCalorie: 0, selectedWeight: 0 });
    wx.showToast({ title: '已选择：' + food.name, icon: 'success' });
  },

  nop() {},

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
        if (from === 'cache') this._removeCachedFood(name);
        wx.cloud.callFunction({ name: 'deleteFood', data: { name } }).then(() => {
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

  _getCachedFoods() {
    try {
      return wx.getStorageSync('user_added_foods') || [];
    } catch (e) {
      return [];
    }
  }
});
