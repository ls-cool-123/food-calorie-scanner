const { getTodayDiary, getDiaryList, deleteEntry } = require('../../services/diaryService');
const { today, toDisplay } = require('../../utils/format');

Page({
  data: {
    todayDiary: null,
    todayEmpty: true,
    totalToday: 0,
    goal: 0,
    gap: 0,
    gapType: '', // 'deficit' | 'surplus' | ''
    history: [],
    showAiAdvice: false,
    aiAdvice: null,
    aiLoading: false
  },

  onShow() {
    this.loadData();
  },

  loadData() {
    this.loadProfile();
    this.loadTodayDiary();
    this.loadHistory();
  },

  loadProfile() {
    try {
      const profile = wx.getStorageSync('user_profile');
      if (profile && profile.dailyGoal) {
        this.setData({ goal: profile.dailyGoal });
      }
    } catch (e) {}
    this._syncProfileFromCloud();
  },

  _syncProfileFromCloud() {
    wx.cloud.database().collection('profiles').where({}).get().then(res => {
      if (res.data.length > 0) {
        const cloud = res.data[0];
        const local = wx.getStorageSync('user_profile');
        if (cloud.dailyGoal && (!local || !local.dailyGoal || cloud.updatedAt > (local.updatedAt || 0))) {
          wx.setStorageSync('user_profile', cloud);
          this.setData({ goal: cloud.dailyGoal });
          if (this.data.totalToday > 0) this.calcGap(this.data.totalToday);
        }
      }
    }).catch(() => {});
  },

  loadTodayDiary() {
    getTodayDiary().then(diary => {
      if (diary && diary.foods && diary.foods.length > 0) {
        const total = diary.foods.reduce((sum, f) => sum + f.totalCalorie, 0);
        this.setData({
          todayDiary: diary,
          todayEmpty: false,
          totalToday: total
        });
        if (this.data.goal > 0) {
          this.calcGap(total);
        }
      } else {
        this.setData({ todayDiary: null, todayEmpty: true, totalToday: 0, gap: 0, gapType: '' });
      }
    }).catch(() => {
      this.setData({ todayDiary: null, todayEmpty: true, totalToday: 0 });
    });
  },

  loadHistory() {
    getDiaryList(30).then(list => {
      const grouped = {};
      for (const item of list) {
        const d = item.date;
        if (!grouped[d]) grouped[d] = [];
        grouped[d].push(item);
      }
      const todayStr = today();
      const history = Object.entries(grouped)
        .filter(([date]) => date !== todayStr)
        .map(([date, items]) => {
          const total = items.reduce((sum, item) =>
            sum + item.foods.reduce((s, f) => s + f.totalCalorie, 0), 0);
          return { date, displayDate: toDisplay(date), items, total };
        });
      this.setData({ history });
    }).catch(() => {});
  },

  calcGap(totalToday) {
    const goal = this.data.goal;
    if (totalToday >= goal) {
      this.setData({
        gap: totalToday - goal,
        gapType: 'surplus'
      });
    } else {
      this.setData({
        gap: goal - totalToday,
        gapType: 'deficit'
      });
    }
  },

  deleteFood(e) {
    const date = e.currentTarget.dataset.date;
    const index = e.currentTarget.dataset.index;
    wx.showModal({
      title: '删除记录',
      content: '确定删除这条饮食记录吗？',
      success: (res) => {
        if (!res.confirm) return;
        deleteEntry(date, index).then(result => {
          if (result.success) {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadData();
          } else {
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        });
      }
    });
  },

  requestAiAdvice() {
    const { totalToday, goal, gap, gapType } = this.data;
    if (!goal) {
      wx.showToast({ title: '请先到个人中心设置身高体重', icon: 'none' });
      return;
    }

    this.setData({ aiLoading: true, showAiAdvice: true, aiAdvice: null });

    wx.cloud.callFunction({
      name: 'aiAdvisor',
      data: {
        goal,
        intake: totalToday,
        gap,
        gapType
      }
    }).then(res => {
      this.setData({ aiLoading: false, aiAdvice: res.result });
    }).catch(err => {
      this.setData({ aiLoading: false, aiAdvice: { error: true, message: 'AI 服务暂不可用，请稍后重试' } });
    });
  },

  hideAiAdvice() {
    this.setData({ showAiAdvice: false, aiAdvice: null });
  }
});
