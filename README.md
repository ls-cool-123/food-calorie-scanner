# AI 热量助手

项目介绍：基于微信小程序 + 腾讯云开发 + 百度视觉 AI + DeepSeek LLM 的 AI 拍照识食热量管理工具。支持拍照扫描自动识别食物并获取热量数据、1100+ 内置食物库智能搜索、每日饮食日记与热量统计，以及 AI 个性化饮食建议与基础代谢计算，目前以上线此微信小程序。


## 开发历程

这个项目是我第一次尝试让 AI 承担主要编码工作。一开始只是抱着试试看的心态，结果发现效果意外地好——需求分析和架构设计阶段，我把想法抛给 Claude 反复讨论，它帮我查缺补漏、收敛方案，很多边界情况在写代码之前就被揪出来了。进入开发后，我的做法是：自己先把模块的接口和数据结构定好，然后描述需求让 Cursor + Claude 去生成实现，生成完我再逐段审查、验证逻辑、修边界。有些复杂逻辑比如三路 API 并行调用的共识评分，来来回回调了好几轮 Prompt 才拿到满意的结果。为了让迭代速度跟上思路，我还配了个 Git Hook，文件一保存就自动提交推送，省掉了手敲 git 命令的零碎时间。整个项目跑下来，代码确实是 AI 写了大约九成，但定方向、做抉择、把质量关的还是人——AI 更像是一个打字飞快、不知疲倦的实习生。

## 主要工作

- **AI 驱动的全流程开发方法**：通过结构化 Prompt Engineering 引导 Cursor + Claude 完成需求分析、系统架构设计与模块拆分，采用"人工定义接口契约 → AI 批量生成实现 → 人工审查合入"的协作模式完成约 90% 代码生成；配置 Git PostToolUse Hook 实现每次 AI 修改后自动 commit 并 push 至 GitHub，形成"生成 → 审查 → 提交"的开发闭环，单人开发效率提升显著。
- **AI 多模态食物识别与一键热量记录**：设计三路百度视觉 API（菜品识别、果蔬识别、通用物体识别）并行调用方案，通过加权共识评分与包装特征检测自动选出最优识别结果，单次识别 < 2 秒，覆盖 1100+ 常见食物；用户拍照后自动完成识别 → 热量匹配 → 日记入账全流程，单次操作约 5 秒，无需手动输入任何文字。
- **LLM 个性化饮食顾问**：基于 DeepSeek API + Prompt Engineering（角色设定 + Few-shot 示例 + JSON 结构化输出），根据当日热量差额自动生成食物补充或运动消耗建议；LLM 调用失败时自动降级为公式估算，保证服务可用性。

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
