import axios from 'axios';
import config from '../src/utils/config.js';

async function checkModels() {
  try {
    const res = await axios.get('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${config.GROQ_API_KEY}` }
    });
    console.log('Available Groq models:');
    console.log(res.data.data.map(m => m.id));
  } catch (err) {
    console.error('Error fetching models:', err.response?.data || err.message);
  }
}

checkModels();
