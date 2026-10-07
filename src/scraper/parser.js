import * as cheerio from 'cheerio';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Parser');

/**
 * Parse nilai ekonomi dari string Forex Factory / Nasdaq.
 * Menangani format: "120K", "1.2M", "-0.4%", "$1.2B", "105.60B", "-", "", dll.
 * @param {string} raw - Nilai mentah
 * @returns {number|null} - Nilai numerik atau null jika tidak bisa diparsing
 */
export function parseEconomicValue(raw) {
  if (!raw || raw.trim() === '' || raw.trim() === '-' || raw.trim() === '&nbsp;') {
    return null;
  }

  let cleaned = raw.trim();

  // Hapus HTML entities jika ada (&nbsp;, &amp;)
  cleaned = cleaned.replace(/&nbsp;/gi, '').replace(/&amp;/gi, '&');

  // Hapus karakter non-numerik di awal (misal: $, €, +)
  cleaned = cleaned.replace(/^[^0-9\-+.]+/, '');

  // Deteksi suffix multiplier
  const suffixMatch = cleaned.match(/([0-9.\-+]+)\s*([KMBTkmbt%])?$/);
  if (!suffixMatch) {
    return null;
  }

  let value = parseFloat(suffixMatch[1]);
  if (isNaN(value)) return null;

  const suffix = (suffixMatch[2] || '').toUpperCase();
  switch (suffix) {
    case 'K': value *= 1_000; break;
    case 'M': value *= 1_000_000; break;
    case 'B': value *= 1_000_000_000; break;
    case 'T': value *= 1_000_000_000_000; break;
    case '%': break; // Persentase tetap sebagai angka desimal
    default: break;
  }

  return value;
}

/**
 * Parse string tanggal dari berbagai sumber (RSS Investing, Google News, FF JSON, ISO)
 * secara akurat menjadi JavaScript Date object dalam zona UTC/WIB.
 * FIX: Mengatasi bug Investing.com RSS '2026-10-07 01:18:58' yang dianggap waktu lokal.
 * @param {string} rawDateStr
 * @returns {Date}
 */
export function parseToDateObj(rawDateStr) {
  if (!rawDateStr || typeof rawDateStr !== 'string') {
    return new Date();
  }

  const trimmed = rawDateStr.trim();

  // 1. Format YYYY-MM-DD HH:mm:ss tanpa timezone info (Investing.com RSS)
  // Harus diparse sebagai UTC / GMT!
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    const utcFormatted = trimmed.replace(' ', 'T') + 'Z';
    const d = new Date(utcFormatted);
    if (!isNaN(d.getTime())) return d;
  }

  // 2. Format YYYY-MM-DDTHH:mm:ss dengan offset (FF JSON: '2026-10-05T10:00:00-04:00')
  const dStandard = new Date(trimmed);
  if (!isNaN(dStandard.getTime())) {
    return dStandard;
  }

  // 3. Fallback ke waktu sekarang jika gagal
  return new Date();
}

/**
 * Format Date object menjadi string WIB (Asia/Jakarta) terstandarisasi.
 * Contoh: "Rabu, 07 Okt • 08.18 WIB"
 * @param {Date|string} dateInput
 * @returns {Object} { dateStr: 'YYYY-MM-DD', timeWIBStr: '08:18 WIB', displayWIB: 'Rab, 7 Okt • 08:18 WIB', timestamp: 12345678 }
 */
export function formatWIBTime(dateInput) {
  const dateObj = dateInput instanceof Date ? dateInput : parseToDateObj(dateInput);

  // Tanggal YYYY-MM-DD di WIB
  const dateStr = dateObj.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

  // Jam HH:mm WIB
  const timeWIBStr = dateObj.toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }) + ' WIB';

  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

  // Ambil nama hari, tgl, bulan di WIB
  const wibDateParts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(dateObj);

  let dayName = 'Hari';
  let dayNum = dateObj.getDate();
  let monthName = 'Bulan';
  let hourStr = '00';
  let minStr = '00';

  wibDateParts.forEach(p => {
    if (p.type === 'weekday') dayName = p.value;
    if (p.type === 'day') dayNum = p.value;
    if (p.type === 'month') monthName = p.value;
    if (p.type === 'hour') hourStr = p.value;
    if (p.type === 'minute') minStr = p.value;
  });

  const displayWIB = `${dayName}, ${dayNum} ${monthName} • ${hourStr}:${minStr} WIB`;

  return {
    dateStr,
    timeWIBStr: `${hourStr}:${minStr} WIB`,
    displayWIB,
    timestamp: dateObj.getTime(),
  };
}

/**
 * Konversi waktu ET (Eastern Time) dari Forex Factory HTML ke WIB.
 * @param {string} timeStr - Format "8:30am", "10:00pm", "All Day", dll.
 * @param {string} dateStr - Optional date string
 * @returns {string} - Waktu dalam WIB
 */
export function convertETtoWIB(timeStr, dateStr) {
  if (!timeStr || timeStr === 'All Day' || timeStr === 'Tentative' || timeStr === '') {
    return timeStr || 'TBD';
  }

  try {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
    if (!match) return timeStr;

    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const ampm = match[3].toLowerCase();

    if (ampm === 'pm' && hours !== 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    // Selisih ET ke WIB (EST = UTC-5 -> WIB = UTC+7 -> +12 jam)
    const etOffsetToWIB = 12;
    hours = (hours + etOffsetToWIB) % 24;

    const formattedHours = hours.toString().padStart(2, '0');
    const formattedMinutes = minutes.toString().padStart(2, '0');
    return `${formattedHours}:${formattedMinutes} WIB`;
  } catch (err) {
    log.warn('Gagal konversi waktu ET:', { timeStr, error: err.message });
    return timeStr;
  }
}

/**
 * Parse HTML kalender Forex Factory.
 */
export function parseCalendarHTML(html) {
  const $ = cheerio.load(html);
  const events = [];

  let currentDate = '';
  let currentTime = '';

  $('tr.calendar__row').each((_, row) => {
    const $row = $(row);
    if (!$row.hasClass('calendar__row--grey') && !$row.hasClass('calendar__row')) return;

    const dateCell = $row.find('td.calendar__date span');
    if (dateCell.length && dateCell.text().trim()) {
      currentDate = dateCell.text().trim();
    }

    const timeCell = $row.find('td.calendar__time');
    if (timeCell.length && timeCell.text().trim()) {
      const timeText = timeCell.text().trim();
      if (timeText !== '') currentTime = timeText;
    }

    const currency = $row.find('td.calendar__currency').text().trim();
    if (currency !== 'USD') return;

    const impactIcon = $row.find('td.calendar__impact span');
    let impact = 'low';
    const impactTitle = impactIcon.attr('title') || '';
    if (impactIcon.hasClass('icon--ff-impact-red') || impactTitle.includes('High')) {
      impact = 'high';
    } else if (impactIcon.hasClass('icon--ff-impact-ora') || impactTitle.includes('Medium')) {
      impact = 'medium';
    }

    const eventName = $row.find('td.calendar__event span.calendar__event-title').text().trim();
    if (!eventName) return;

    const actual = $row.find('td.calendar__actual span').text().trim() || $row.find('td.calendar__actual').text().trim();
    const forecast = $row.find('td.calendar__forecast span').text().trim() || $row.find('td.calendar__forecast').text().trim();
    const previous = $row.find('td.calendar__previous span').text().trim() || $row.find('td.calendar__previous').text().trim();

    const timeWIBStr = convertETtoWIB(currentTime, currentDate);
    const fullTimeDisplay = `${currentDate} • ${timeWIBStr}`;
    const todayWIBStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

    events.push({
      date: todayWIBStr,
      time: currentTime || timeWIBStr,
      timeWIB: fullTimeDisplay,
      currency,
      impact,
      event: eventName,
      actual: actual || '-',
      forecast: forecast || '-',
      previous: previous || '-',
      actualValue: parseEconomicValue(actual),
      forecastValue: parseEconomicValue(forecast),
      previousValue: parseEconomicValue(previous),
    });
  });

  return events;
}

export function filterHighImpact(events) {
  return events.filter(e => e.impact === 'high' || e.impact === 'medium');
}
