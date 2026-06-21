const cloud = require('wx-server-sdk');
const https = require('https');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const SYSTEM_PROMPT = '你是一位专业的营养与运动顾问。根据用户的热量摄入和目标数据，生成个性化、可操作的建议。\n\n核心规则：\n1. 根据热量差值判断是摄入不足还是摄入超标\n2. 摄入不足时：必须推荐碳水+蛋白质+脂肪三类食物组合，每类至少1种，包括具体名称和克数，精确计算每类提供的热量，确保营养均衡\n3. 摄入超标时：推荐1-2种具体运动，包括名称和时长，精确计算消耗热量\n4. 所有建议必须精确，用具体数字，不使用模糊词汇\n5. 严格输出JSON格式';

const FEW_SHOT_EXAMPLES = [
  {
    role: 'user',
    content: '用户热量数据：目标2100kcal，实际摄入1650kcal，缺少450kcal。请分析。'
  },
  {
    role: 'assistant',
    content: JSON.stringify({
      scenario: 'deficit',
      summary: '您今日摄入1650kcal，距离目标2100kcal还差450kcal，热量摄入不足。',
      advice: [
        '【碳水】米饭约150g（约174kcal），提供碳水化合物约39g',
        '【蛋白质】鸡胸肉约100g（约133kcal），提供蛋白质约31g',
        '【脂肪】核桃约20g（约131kcal），提供健康脂肪约13g',
        '以上合计约438kcal，覆盖三大宏量营养素'
      ]
    })
  },
  {
    role: 'user',
    content: '用户热量数据：目标1800kcal，实际摄入2350kcal，超出550kcal。请分析。'
  },
  {
    role: 'assistant',
    content: JSON.stringify({
      scenario: 'surplus',
      summary: '您今日摄入2350kcal，超出目标1800kcal共计550kcal，需要运动消耗。',
      advice: [
        '快走60分钟（6km/h）约消耗280kcal',
        '慢跑30分钟（8km/h）约消耗300kcal，两项合计约580kcal'
      ]
    })
  }
];

function llmRequest(body) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.LLM_API_KEY || '';
    if (!apiKey) {
      return reject(new Error('LLM API Key not configured'));
    }

    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.deepseek.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 30000
    };

    const req = https.request(options, function(res) {
      var chunks = '';
      res.on('data', function(chunk) { chunks += chunk; });
      res.on('end', function() {
        try {
          var result = JSON.parse(chunks);
          if (result.choices && result.choices[0]) {
            resolve(result.choices[0].message.content);
          } else {
            reject(new Error(result.error ? result.error.message : 'LLM response error'));
          }
        } catch (e) {
          reject(new Error('Failed to parse LLM response'));
        }
      });
    });

    req.on('error', function(e) { reject(new Error('LLM request failed: ' + e.message)); });
    req.on('timeout', function() { req.destroy(); reject(new Error('LLM request timeout')); });
    req.write(data);
    req.end();
  });
}

exports.main = async function(event) {
  var goal = event.goal;
  var intake = event.intake;
  var gap = event.gap;
  var gapType = event.gapType;

  if (!goal || intake === undefined || !gap) {
    return { error: true, message: 'Missing parameters' };
  }

  var gapLabel = gapType === 'deficit' ? '\u7f3a\u5c11' : '\u8d85\u51fa';
  var userContent = '\u7528\u6237\u70ed\u91cf\u6570\u636e\uff1a\u76ee\u6807' + goal + 'kcal\uff0c\u5b9e\u9645\u6444\u5165' + intake + 'kcal\uff0c' + gapLabel + gap + 'kcal\u3002\u8bf7\u5206\u6790\u3002';

  var messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    FEW_SHOT_EXAMPLES[0],
    FEW_SHOT_EXAMPLES[1],
    FEW_SHOT_EXAMPLES[2],
    FEW_SHOT_EXAMPLES[3],
    { role: 'user', content: userContent }
  ];

  try {
    var llmResponse = await llmRequest({
      model: 'deepseek-chat',
      messages: messages,
      temperature: 0.7,
      max_tokens: 800,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(llmResponse);
  } catch (e) {
    if (gapType === 'deficit') {
      var carbsKcal = Math.round(gap * 0.45);
      var proteinKcal = Math.round(gap * 0.30);
      var fatKcal = Math.round(gap * 0.25);
      return {
        scenario: 'deficit',
        summary: '\u60a8\u4eca\u65e5\u6444\u5165' + intake + 'kcal\uff0c\u8ddd\u79bb\u76ee\u6807' + goal + 'kcal\u8fd8\u5dee' + gap + 'kcal\uff0c\u5efa\u8bae\u8865\u5145\u4ee5\u4e0b\u98df\u7269\u3002',
        advice: [
          '\u3010\u78b3\u6c34\u3011\u7c73\u996d\u7ea6' + Math.round(carbsKcal / 1.16) + 'g\uff08\u7ea6' + carbsKcal + 'kcal\uff09',
          '\u3010\u86cb\u767d\u8d28\u3011\u9e21\u80f8\u8089\u7ea6' + Math.round(proteinKcal / 1.33) + 'g\uff08\u7ea6' + proteinKcal + 'kcal\uff09',
          '\u3010\u8102\u80aa\u3011\u6838\u6843\u7ea6' + Math.round(fatKcal / 6.5) + 'g\uff08\u7ea6' + fatKcal + 'kcal\uff09',
          '\u4ee5\u4e0a\u5408\u8ba1\u7ea6' + (carbsKcal + proteinKcal + fatKcal) + 'kcal\uff0c\u8986\u76d6\u4e09\u5927\u5b8f\u91cf\u8425\u517b\u7d20'
        ]
      };
    }
    return {
      scenario: 'surplus',
      summary: '\u60a8\u4eca\u65e5\u6444\u5165' + intake + 'kcal\uff0c\u8d85\u51fa\u76ee\u6807' + goal + 'kcal\u5171\u8ba1' + gap + 'kcal\uff0c\u5efa\u8bae\u901a\u8fc7\u8fd0\u52a8\u6d88\u8017\u3002',
      advice: [
        '\u5feb\u8d70' + Math.ceil(gap / 4.67) + '\u5206\u949f\u7ea6\u6d88\u8017' + gap + 'kcal',
        '\u6162\u8dd1' + Math.ceil(gap / 10) + '\u5206\u949f\u7ea6\u6d88\u8017' + gap + 'kcal'
      ]
    };
  }
};
