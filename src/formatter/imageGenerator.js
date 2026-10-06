import { createCanvas } from '@napi-rs/canvas';

/**
 * Draw a rounded rectangle on a 2D canvas context.
 */
function drawRoundRect(ctx, x, y, width, height, radius, fillStyle, strokeStyle = null) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();

  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Wrap text lines onto canvas.
 */
function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), x, currentY);
  return currentY;
}

/**
 * Generate a high quality signal notification image (PNG Buffer).
 * Matches the client's reference screenshot design precisely.
 */
export async function generateSignalCardImage(event, signal) {
  const canvasWidth = 660;
  const canvasHeight = 420;
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');

  // Background canvas (dark outer area)
  ctx.fillStyle = '#0B0B0E';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Main Card Panel
  const cardX = 20;
  const cardY = 20;
  const cardW = 620;
  const cardH = 380;
  drawRoundRect(ctx, cardX, cardY, cardW, cardH, 20, '#191A20', '#2B2D37');

  // Header Title
  const titleText = event.event || 'Economic News';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(titleText, cardX + 24, cardY + 45);

  // Time Subtitle
  const timeStr = event.timeWIB || event.time || 'TBD';
  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText(timeStr, cardX + 24, cardY + 75);

  // Impact Badge (Top Right)
  const impactStr = (event.impact || 'MEDIUM').toUpperCase();
  const isHigh = impactStr.includes('HIGH') || impactStr.includes('RED');
  const badgeBg = isHigh ? '#DC2626' : '#D97706';
  const badgeLabel = isHigh ? 'HIGH' : 'MEDIUM';

  drawRoundRect(ctx, cardX + cardW - 130, cardY + 30, 106, 32, 16, badgeBg);
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.fillText(badgeLabel, cardX + cardW - 77, cardY + 51);
  ctx.textAlign = 'left';

  // Separator line
  ctx.strokeStyle = '#282A35';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX + 24, cardY + 95);
  ctx.lineTo(cardX + cardW - 24, cardY + 95);
  ctx.stroke();

  // Metrics Grid (Signal Badge + 3 Metric Boxes)
  const boxY = cardY + 115;
  const boxH = 76;
  const boxW = 132;
  const gap = 14;
  let startX = cardX + 24;

  // 1. Signal Box (BUY / SELL)
  const isBuy = signal.signal === 'BUY';
  const isSell = signal.signal === 'SELL';
  const signalBg = isBuy ? '#10B981' : isSell ? '#EF4444' : '#6B7280';
  const signalText = signal.signal || 'HOLD';

  drawRoundRect(ctx, startX, boxY, boxW, boxH, 14, signalBg);
  ctx.font = 'bold 24px sans-serif';
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.fillText(signalText, startX + boxW / 2, boxY + 46);
  ctx.textAlign = 'left';

  startX += boxW + gap;

  // Metric Boxes
  const metrics = [
    { label: 'ACTUAL', val: event.actual && event.actual !== '' ? event.actual : '-' },
    { label: 'FORECAST', val: event.forecast && event.forecast !== '' ? event.forecast : '-' },
    { label: 'PREVIOS', val: event.previous && event.previous !== '' ? event.previous : '-' }
  ];

  metrics.forEach(m => {
    drawRoundRect(ctx, startX, boxY, boxW, boxH, 14, '#23252E');

    // Label
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#9CA3AF';
    ctx.textAlign = 'center';
    ctx.fillText(m.label, startX + boxW / 2, boxY + 30);

    // Value
    ctx.font = 'bold 19px sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(m.val, startX + boxW / 2, boxY + 56);
    ctx.textAlign = 'left';

    startX += boxW + gap;
  });

  // PREDIKSI Box (Bottom Area)
  const predY = boxY + boxH + 18;
  const predW = cardW - 48;
  const predH = 135;
  drawRoundRect(ctx, cardX + 24, predY, predW, predH, 14, '#202128');

  // Label PREDIKSI
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText('PREDIKSI', cardX + 44, predY + 32);

  // Prediction Text Body
  const predText = signal.predictionText || signal.analysis || 'Tidak ada analisis korelasi.';
  ctx.font = '16px sans-serif';
  ctx.fillStyle = '#F3F4F6';
  wrapText(ctx, predText, cardX + 44, predY + 62, predW - 40, 24);

  return canvas.toBuffer('image/png');
}
