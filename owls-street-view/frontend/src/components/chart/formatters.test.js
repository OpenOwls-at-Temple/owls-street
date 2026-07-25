import { formatEtLabel, timeframeLabel } from './formatters';

describe('timeframeLabel', () => {
  it('maps known values', () => {
    expect(timeframeLabel('1MIN')).toBe('1m');
    expect(timeframeLabel('5MIN')).toBe('5m');
    expect(timeframeLabel('1H')).toBe('1h');
  });

  it('falls back for unknown values', () => {
    expect(timeframeLabel('XYZ')).toBe('XYZ');
  });
});

describe('formatEtLabel', () => {
  it('returns empty string for invalid input', () => {
    expect(formatEtLabel('abc')).toBe('');
  });

  it('formats a unix timestamp', () => {
    const out = formatEtLabel(1704067200);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});
