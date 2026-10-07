import axios from 'axios';
import xml2js from 'xml2js';

function parseFFXmlDate(dateStr, timeStr) {
  // dateStr: "10-05-2026" (MM-DD-YYYY)
  // timeStr: "2:00pm", "8:30am", "All Day", "Tentative", ""
  if (!dateStr) return new Date();

  const parts = dateStr.split('-'); // [MM, DD, YYYY]
  if (parts.length !== 3) return new Date();

  const month = parts[0];
  const day = parts[1];
  const year = parts[2];

  let hours = 12;
  let minutes = 0;

  if (timeStr && /^\d{1,2}:\d{2}(am|pm)$/i.test(timeStr.trim())) {
    const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
    let h = parseInt(match[1]);
    const m = parseInt(match[2]);
    const ampm = match[3].toLowerCase();

    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    hours = h;
    minutes = m;
  }

  // ForexFactory XML time is in Eastern Time (EDT/EST = UTC-4 or UTC-5)
  // Construct ISO string: YYYY-MM-DDTHH:mm:00-04:00 (EDT offset)
  const isoStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00-04:00`;
  const dateObj = new Date(isoStr);
  return isNaN(dateObj.getTime()) ? new Date() : dateObj;
}

const url = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';
const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
const parsed = await xml2js.parseStringPromise(res.data);
const events = parsed?.weeklyevents?.event || [];

console.log('Sample parsed XML events:');
events.filter(e => e.country?.[0] === 'USD').slice(0, 5).forEach(e => {
  const dStr = e.date?.[0];
  const tStr = e.time?.[0];
  const dateObj = parseFFXmlDate(dStr, tStr);
  const wibTime = dateObj.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
  const wibDate = dateObj.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
  console.log(`Title: ${e.title?.[0]} | Raw: ${dStr} ${tStr} | WIB: ${wibDate} ${wibTime} WIB | Imp: ${e.impact?.[0]} | Fore: ${e.forecast?.[0]} | Prev: ${e.previous?.[0]}`);
});
