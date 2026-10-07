import axios from 'axios';
import config from '../src/utils/config.js';

async function testGroqModel(model) {
  try {
    const prompt = `Anda adalah analis pasar finansial senior spesialis XAU/USD (Gold) dan Dolar AS (USD).
Analisis headline berita: "Gold surges above $2,650 as Federal Reserve signals aggressive rate cuts following weak inflation data"

Return JSON:
{
  "signal": "BUY" | "SELL" | "NEUTRAL",
  "impact": "HIGH" | "MEDIUM" | "LOW",
  "direction": "USD Melemah / Gold Safe Haven ↑",
  "impactText": "Penjelasan ringkas dalam Bahasa Indonesia",
  "recommendation": "BUY XAU/USD"
}`;

    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${config.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 8000
      }
    );
    console.log(`✅ Model ${model} SUCCESS:`);
    console.log(res.data.choices[0].message.content);
    return true;
  } catch (err) {
    console.log(`❌ Model ${model} FAILED:`, err.response?.data?.error?.message || err.message);
    return false;
  }
}

async function testAll() {
  const models = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-8b-8192'];
  for (const m of models) {
    await testGroqModel(m);
  }
}

testAll();
