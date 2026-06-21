/**
 * 格式化工具
 */

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toDisplay(dateStr) {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[0]}年${parts[1]}月${parts[2]}日`;
  }
  return dateStr;
}

function toFixed(n, digits = 0) {
  const num = Number(n);
  if (isNaN(num)) return 0;
  return Number(num.toFixed(digits));
}

module.exports = { today, toDisplay, toFixed };
