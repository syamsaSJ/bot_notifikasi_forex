import * as cheerio from 'cheerio';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Parser');

/**
 * Parse nilai ekonomi dari string Forex Factory.
 * Menangani format: "120K", "1.2M", "-0.4%", "$1.2B", "-", "", dll.
 * @param {string} raw - Nilai mentah dari Forex Factory
 * @returns {number|null} - Nilai numerik atau null jika tidak bisa diparsing
 */
export function parseEconomicValue(raw) {
  if (!raw || raw.trim() === '' || raw.trim() === '-') {
    return null;
  }

  let cleaned = raw.trim();

  // Hapus karakter non-numerik di awal (misal: $, €)
  cleaned = cleaned.replace(/^[^0-9\-+.]+/, '');

  // Deteksi suffix multiplier
  const suffixMatch = cleaned.match(/([0-9.\-+]+)\s*([KMBTkmbt%])?$/);
  if (!suffixMatch) {
    log.warn('Tidak bisa parse nilai ekonomi:', raw);
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
    case '%': break; // Persentase tetap sebagai angka decimal
    default: break;
  }

  return value;
}

/**
 * Parse HTML kalender Forex Factory menjadi array event terstruktur.
 * @param {string} html - Raw HTML dari halaman kalender
 * @returns {Array<Object>} - Array of event objects
 */
export function parseCalendarHTML(html) {
  const $ = cheerio.load(html);
  const events = [];

  let currentDate = '';
  let currentTime = '';

  // Forex Factory menggunakan tabel dengan class "calendar__row"
  $('tr.calendar__row').each((_, row) => {
    const $row = $(row);

    // Skip jika bukan baris event (bisa baris separator, dll)
    if (!$row.hasClass('calendar__row--grey') && !$row.hasClass('calendar__row')) {
      return;
    }

    // Ambil tanggal (hanya muncul di baris pertama per tanggal)
    const dateCell = $row.find('td.calendar__date span');
    if (dateCell.length && dateCell.text().trim()) {
      currentDate = dateCell.text().trim();
    }

    // Ambil waktu
    const timeCell = $row.find('td.calendar__time');
    if (timeCell.length && timeCell.text().trim()) {
      const timeText = timeCell.text().trim();
      if (timeText !== '') {
        currentTime = timeText;
      }
    }

    // Ambil currency
    const currency = $row.find('td.calendar__currency').text().trim();

    // Filter: hanya USD
    if (currency !== 'USD') return;

    // Ambil impact
    const impactIcon = $row.find('td.calendar__impact span');
    let impact = 'low';
    const impactTitle = impactIcon.attr('title') || '';
    if (impactIcon.hasClass('icon--ff-impact-red') || impactTitle.includes('High')) {
      impact = 'high';
    } else if (impactIcon.hasClass('icon--ff-impact-ora') || impactTitle.includes('Medium')) {
      impact = 'medium';
    } else if (impactIcon.hasClass('icon--ff-impact-yel') || impactTitle.includes('Low')) {
      impact = 'low';
    }

    // Ambil nama event
    const eventName = $row.find('td.calendar__event span.calendar__event-title').text().trim();
    if (!eventName) return;

    // Ambil data: Actual, Forecast, Previous
    const actual = $row.find('td.calendar__actual span').text().trim() ||
                   $row.find('td.calendar__actual').text().trim();
    const forecast = $row.find('td.calendar__forecast span').text().trim() ||
                     $row.find('td.calendar__forecast').text().trim();
    const previous = $row.find('td.calendar__previous span').text().trim() ||
                     $row.find('td.calendar__previous').text().trim();

    events.push({
      date: currentDate,
      time: currentTime,
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

  log.info(`Parsed ${events.length} USD events dari HTML`);
  return events;
}

/**
 * Filter hanya berita high impact.
 * @param {Array<Object>} events 
 * @returns {Array<Object>}
 */
export function filterHighImpact(events) {
  return events.filter(e => e.impact === 'high');
}

/**
 * Konversi waktu ET (Eastern Time) ke WIB (UTC+7).
 * Forex Factory menampilkan waktu dalam ET.
 * @param {string} timeStr - Waktu dalam format "8:30am", "10:00pm", dll.
 * @param {string} dateStr - Tanggal dalam format Forex Factory
 * @returns {string} - Waktu dalam format WIB
 */
export function convertETtoWIB(timeStr, dateStr) {
  if (!timeStr || timeStr === 'All Day' || timeStr === 'Tentative' || timeStr === '') {
    return timeStr || 'TBD';
  }

  try {
    // Parse time (misal: "8:30am" → 8:30)
    const match = timeStr.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
    if (!match) return timeStr;

    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const ampm = match[3].toLowerCase();

    if (ampm === 'pm' && hours !== 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;

    // ET ke UTC = +5 (EST) atau +4 (EDT)
    // Untuk simplisitas, gunakan +5 (bisa di-tweak)
    // UTC ke WIB = +7
    // Jadi ET ke WIB = +12
    const etOffsetToWIB = 12; // EST+12 = WIB
    hours = (hours + etOffsetToWIB) % 24;

    const formattedHours = hours.toString().padStart(2, '0');
    const formattedMinutes = minutes.toString().padStart(2, '0');
    return `${formattedHours}:${formattedMinutes} WIB`;
  } catch (err) {
    log.warn('Gagal konversi waktu:', { timeStr, error: err.message });
    return timeStr;
  }
}
