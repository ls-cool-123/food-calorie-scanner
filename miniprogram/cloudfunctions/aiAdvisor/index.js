const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const SYSTEM_PROMPT = `你是一位专业的营养与运动顾问。你的任务是分析用户的热量摄入数据，给出精准、可操作的建议。

核心规则：
1. 根据热量差值判断是"摄入不足"还是"摄入超标"
2. 摄入不足时：推荐1-2种具体的食物，包括食物名称和建议食用量（克数），并计算补充的热量
3. 摄入超标时：推荐1-2种具体的运动，包括运动名称和建议时长（分钟），并计算消耗的热量
4. 所有建议必须精确，用具体数字，不能使用"一些"、"大概"等模糊词汇
5. 必须严格输出JSON格式

输出JSON格式：
{
  "scenario": "deficit" 或 "surplus",
  "summary": "一两句话总结当前营养状态",
  "advice": ["具体建议1", "具体建议2"]
}`;

const FEW_SHOT_EXAMPLES = [
  {
    role: 'user',
    content: `用户热量数据：目标2100kcal，实际摄入1650kcal，缺少450kcal。请分析。`
  },
  {
    role: 'assistant',
    content: JSON.stringify({
      scenario: 'deficit',
      summary: '您今日摄入1650kcal，距离目标2100kcal还差450kcal，热量摄入不足。',
      advice: [
        '建议食用约100g鸡胸肉（水煮），可补充约133kcal热量和优质蛋白质',
        '建议加餐一小把核桃（约30g，去壳），可补充约196kcal，同时提供健康的不饱和脂肪酸',
        '再搭配一根中等大小的香蕉（约100g），可补充约93kcal的碳水化合物。三项合计约422kcal'
      ]
    })
  },
  {
    role: 'user',
    content: `用户热量数据：目标1800kcal，实际摄入2350kcal，超出550kcal。请分析。`
  },
  {
    role: 'assistant',
    content: JSON.stringify({
      scenario: 'surplus',
      summary: '您今日摄入2350kcal，超出目标1800kcal共计550kcal，需要适当运动消耗多余热量。',
      advice: [
        '快走60分钟（速度6km/h），约消耗280kcal',
        '慢跑30分钟（速度8km/h），约消耗300kcal。两项合计约580kcal',
        '如果时间有限，可以选择跳绳20分钟，约消耗280kcal，再加20分钟快走消耗约90kcal'
      ]
    })
  }
];

function llmRequest(body) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.LLM_API_KEY || '';
    if (!apiKey) {
      return reject(new Error('LLM API Key 未配置'));
    }

    const data = JSON.stringify(body);
    const url = new URL('https://api.deepseek.com/v1/chat/completions');

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', chunk => chunks += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(chunks);
          if (result.choices && result.choices[0]) {
            resolve(result.choices[0].message.content);
          } else {
            reject(new Error(result.error ? result.error.message : 'LLM 返回异常'));
          }
        } catch (e) {
          reject(new Error('解析 LLM 响应失败'));
        }
      });
    });

    req.on('error', (e) => reject(new Error('LLM 请求失败: ' + e.message)));
    req.on('timeout', () => { req.destroy(); reject(new Error('LLM 请求超时')); });
    req.write(data);
    req.end();
  });
}

exports.main = async (event) => {
  const { goal, intake, gap, gapType } = event;

  if (!goal || intake === undefined || !gap) {
    return { error: true, message: '参数不完整' };
  }

  const gapLabel = gapType === 'deficit' ? '缺少' : '超出';
  const userContent = `用户热量数据：目标${goal}kcal，实际摄入${intake}kcal，${gapLabel}${gap}kcal。请分析。`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...FEW_SHOT_EXAMPLES,
    { role: 'user', content: userContent }
  ];

  try {
    const llmResponse = await llmRequest({
      model: 'deepseek-chat',
      messages,
      temperature: 0.7,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(llmResponse);
    return parsed;
  } catch (e) {
    // 降级：返回静态建议
    if (gapType === 'deficit') {
      return {
        scenario: 'deficit',
        summary: `您今日摄入${intake}kcal，距离目标${goal}kcal还差${gap}kcal，建议适当补充。`,
        advice: [
          `额外摄入约${gap}kcal，相当于约${Math.round(gap / 1.16)}g米饭，或${Math.round(gap / 1.33)}g水煮鸡胸肉`,
          `可加餐一个鸡蛋（约80kcal）配合水果补充维生素`
        ]
      };
    }
    return {
      scenario: 'surplus',
      summary: `您今日摄入${intake}kcal，超出目标${goal}kcal共计${gap}kcal，建议通过运动消耗。`,
      advice: [
        `快走${Math.ceil(gap / 4.67)}分钟约消耗${gap}kcal（按4.67kcal/min估算）`,
        `慢跑${Math.ceil(gap / 10)}分钟约消耗${gap}kcal（按10kcal/min估算）`
      ]
    };
  }
};
