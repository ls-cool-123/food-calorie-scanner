/**
 * wx API Promise 封装
 */

function request(options) {
  return new Promise((resolve, reject) => {
    wx.request({ ...options, success: resolve, fail: reject });
  });
}

function chooseImage(options) {
  return new Promise((resolve, reject) => {
    wx.chooseImage({ ...options, success: resolve, fail: reject });
  });
}

function compressImage(src) {
  return new Promise((resolve, reject) => {
    wx.compressImage({ src, quality: 80, success: resolve, fail: reject });
  });
}

function readFile(options) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({ ...options, success: resolve, fail: reject });
  });
}

module.exports = { request, chooseImage, compressImage, readFile };
