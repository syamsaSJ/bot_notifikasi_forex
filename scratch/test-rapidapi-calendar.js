// Test end-to-end modul rapidApiCalendar (memakai 1 request kuota pada panggilan pertama)
import { fetchRapidApiCalendar, getRapidApiQuotaStatus } from '../src/scraper/rapidApiCalendar.js';

const first = await fetchRapidApiCalendar();
console.log('FIRST CALL:', first?.length, 'events');
console.table((first || []).map(e => ({ time: e.time, impact: e.impact, event: e.event, actual: e.actual, forecast: e.forecast, previous: e.previous, timeWIB: e.timeWIB })));

const second = await fetchRapidApiCalendar();
console.log('SECOND CALL (harus dari cache, tanpa request):', second?.length, 'events');
console.log('QUOTA:', getRapidApiQuotaStatus());
