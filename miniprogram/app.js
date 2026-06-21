App({
  globalData: {
    openid: ''
  },

  onLaunch() {
    wx.cloud.init({
      env: 'cloud1-4gooq8uib59576fe',
      traceUser: true,
    });
    this._login();
  },

  _login() {
    wx.cloud.callFunction({ name: 'getOpenId' }).then(res => {
      this.globalData.openid = res.result.openid;
    }).catch(() => {});
  }
})