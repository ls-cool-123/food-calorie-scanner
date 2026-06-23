const { calcBMR, calcDailyGoal } = require('../../services/bmrService');

const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'active'];
const ACTIVITY_LABELS = ['久坐不动（几乎不运动）', '轻度活动（每周1-3天）', '中度活动（每周3-5天）', '高强度活动（每周5-7天）'];

Page({
  data: {
    height: '',
    weight: '',
    age: '',
    gender: 'male',
    activityIndex: 0,
    activityLabels: ACTIVITY_LABELS,
    bmr: 0,
    dailyGoal: 0,
    hasProfile: false,
    avatarUrl: '',
    nickName: ''
  },

  onShow() {
    this.loadProfile();
    this.loadUserInfo();
  },

  loadProfile() {
    const local = this._loadLocalProfile();
    if (local) {
      this._applyProfile(local);
    }
    this._loadCloudProfile();
  },

  _loadLocalProfile() {
    try {
      return wx.getStorageSync('user_profile');
    } catch (e) {
      return null;
    }
  },

  _applyProfile(profile) {
    const idx = ACTIVITY_LEVELS.indexOf(profile.activityLevel || 'sedentary');
    this.setData({
      height: String(profile.height || ''),
      weight: String(profile.weight || ''),
      age: String(profile.age || ''),
      gender: profile.gender || 'male',
      activityIndex: idx >= 0 ? idx : 0,
      bmr: profile.bmr || 0,
      dailyGoal: profile.dailyGoal || 0,
      hasProfile: true
    });
  },

  _loadCloudProfile() {
    wx.cloud.database().collection('profiles').where({}).get().then(res => {
      if (res.data.length > 0) {
        const cloud = res.data[0];
        const local = this._loadLocalProfile();
        if (!local || cloud.updatedAt > (local.updatedAt || 0)) {
          this._applyProfile(cloud);
          wx.setStorageSync('user_profile', cloud);
        }
      }
    }).catch(() => {});
  },

  onHeightInput(e) {
    this.setData({ height: e.detail.value });
  },
  onWeightInput(e) {
    this.setData({ weight: e.detail.value });
  },
  onAgeInput(e) {
    this.setData({ age: e.detail.value });
  },

  onGenderChange(e) {
    this.setData({ gender: e.detail.value });
  },

  onActivityChange(e) {
    this.setData({ activityIndex: Number(e.detail.value) });
  },

  loadUserInfo() {
    try {
      const saved = wx.getStorageSync('user_info');
      if (saved) {
        this.setData({
          avatarUrl: saved.avatarUrl || '',
          nickName: saved.nickName || ''
        });
      }
    } catch (e) {}
  },

  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    this.setData({ avatarUrl });
    this._saveUserInfo({ avatarUrl });
  },

  onNickNameInput(e) {
    const nickName = e.detail.value;
    this.setData({ nickName });
    this._saveUserInfo({ nickName });
  },

  _saveUserInfo(partial) {
    try {
      const saved = wx.getStorageSync('user_info') || {};
      wx.setStorageSync('user_info', { ...saved, ...partial });
    } catch (e) {}
  },

  saveProfile() {
    const { height, weight, age, gender, activityIndex } = this.data;
    const h = Number(height);
    const w = Number(weight);
    const a = Number(age);

    if (!h || !w || !a) {
      wx.showToast({ title: '请完整填写身高、体重、年龄', icon: 'none' });
      return;
    }

    const activityLevel = ACTIVITY_LEVELS[activityIndex];
    const bmr = calcBMR(gender, w, h, a);
    const dailyGoal = calcDailyGoal(bmr, activityLevel);

    const profile = { height: h, weight: w, age: a, gender, activityLevel, bmr, dailyGoal };
    wx.setStorageSync('user_profile', profile);
    this._saveProfileToCloud(profile);

    this.setData({ bmr, dailyGoal, hasProfile: true });
    wx.showToast({ title: '保存成功', icon: 'success' });
  },

  _saveProfileToCloud(profile) {
    const db = wx.cloud.database();
    db.collection('profiles').where({}).get().then(res => {
      if (res.data.length > 0) {
        return db.collection('profiles').doc(res.data[0]._id).update({
          data: { ...profile, updatedAt: Date.now() }
        });
      }
      return db.collection('profiles').add({
        data: { ...profile, createdAt: Date.now(), updatedAt: Date.now() }
      });
    }).catch(() => {});
  }
});
