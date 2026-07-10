export const TIMEFRAMES = ['1MIN', '5MIN', '10MIN', '15MIN', '1H', '5H', '1D', '5D', '1M', '3M', '1Y', '5Y'];

const ET_TIME_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
  day: 'numeric',
});

export function formatEtLabel(time) {
  const ts = typeof time === 'number' ? time : Number(time);
  if (!Number.isFinite(ts)) return '';
  return ET_TIME_FMT.format(new Date(ts * 1000));
}

export function timeframeLabel(tf) {
  const labels = {
    '1MIN': '1m',
    '5MIN': '5m',
    '10MIN': '10m',
    '15MIN': '15m',
    '1H': '1h',
    '5H': '5h',
  };
  return labels[tf] ?? tf;
}
