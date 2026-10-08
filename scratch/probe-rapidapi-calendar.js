// Probe direct REST endpoint RapidAPI Forex Factory Scraper (realtime calendar)
import dotenv from 'dotenv';
import axios from 'axios';
dotenv.config();

const now = new Date();
const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));

const res = await axios.get(`https://${process.env.RAPIDAPI_FF_HOST}/get_real_time_calendar_details`, {
  params: {
    calendar: 'Forex',
    year: wib.getFullYear(),
    month: wib.getMonth() + 1,
    day: wib.getDate(),
    currency: 'USD',
    event_name: 'ALL',
    timezone: 'GMT+07:00 Jakarta',
    time_format: '24h',
  },
  headers: {
    'x-rapidapi-host': process.env.RAPIDAPI_FF_HOST,
    'x-rapidapi-key': process.env.RAPIDAPI_KEY,
  },
  timeout: 30000,
  validateStatus: () => true,
});

console.log('STATUS', res.status);
console.log('RATE', res.headers['x-ratelimit-requests-remaining'], '/', res.headers['x-ratelimit-requests-limit']);
console.log(JSON.stringify(res.data, null, 2).slice(0, 4000));
