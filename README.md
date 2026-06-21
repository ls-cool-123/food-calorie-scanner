# 食记 - AI 热量管理小程序

基于微信小程序的 AI 饮食热量管理工具。拍照识别食物，记录饮食日记，AI 生成个性化营养建议。

## 核心功能

| 功能 | 说明 | AI 能力 |
|---|---|---|
| 拍照识食 | 拍照/选图，百度视觉AI三路并行识别，共识评分算法选出最优结果 | 计算机视觉 |
| 手动搜索 | 1100+ 食物数据库，支持名称和别名搜索 | - |
| 饮食日记 | 记录每日饮食，按日期分组统计热量 | - |
| BMR 计算 | Mifflin-St Jeor 公式计算基础代谢和每日热量目标 | - |
| **AI 饮食建议** | 根据日记数据与目标对比，LLM 生成具体食物补充/运动消耗建议 | **LLM + Prompt 工程** |

## 技术架构

```
小程序前端 (WeChat Mini-Program)
├── pages/
│   ├── index/         拍照识别 & 手动选择
│   ├── diary/         饮食日记 & AI 建议
│   └── profile/       个人中心 & BMR 计算
├── services/          业务逻辑层
│   ├── aiService      AI 视觉识别（三路并行 + 共识评分）
│   ├── foodService    食物查询（云端 + 本地 + 缓存）
│   ├── diaryService   日记 CRUD
│   └── bmrService     BMR 计算（Mifflin-St Jeor）
└── utils/             工具函数

云函数 (Tencent Cloud Base)
├── aiAdvisor/         LLM 饮食顾问（Prompt 工程 + Few-shot 示例）
├── deleteFood/        食物删除
├── diaryService/      日记数据操作
└── foodService/       食物数据查询
```

## AI 能力详情

### 1. 视觉识别（百度 AI 视觉 API）

- 三路 API 并行调用：菜品识别、果蔬识别、通用物体识别
- 包装检测：自动识别瓶/罐/袋等包装特征，动态调整阈值
- 跨 API 共识评分：加权投票 + 共识加分算法
- 识别不可信时自动降级为手动选择

### 2. LLM 饮食顾问（DeepSeek API）

- **Prompt 工程**：System Prompt 角色设定 + Few-shot 示例注入 + JSON 结构化输出
- 热量不足 → 推荐具体食物及食用量补充
- 热量超标 → 推荐具体运动及时长消耗
- LLM 调用失败时自动降级为公式估算建议

## 快速开始

1. 在微信开发者工具中导入项目
2. 复制 `miniprogram/config.example.js` 为 `config.js`，填入百度 AI API Key
3. 在云函数 `aiAdvisor` 中配置环境变量 `LLM_API_KEY`（DeepSeek API Key）
4. 部署云函数

## 配置要求

| 服务 | 配置位置 | 获取地址 |
|---|---|---|
| 百度 AI 视觉 | `miniprogram/config.js` | [百度智能云](https://console.bce.baidu.com/ai/) |
| DeepSeek LLM | 云函数环境变量 `LLM_API_KEY` | [DeepSeek Platform](https://platform.deepseek.com/) |
| 微信云开发 | `miniprogram/app.js` | 微信开发者工具 |
