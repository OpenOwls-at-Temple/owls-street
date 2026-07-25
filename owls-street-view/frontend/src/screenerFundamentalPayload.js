/**
 * Maps screener filter `<select>` values to `/api/screener` fundamental fields (FMP-backed on server).
 * All yields are partial payloads merged into the scan request.
 */

/** @param {Record<string, string>} filterSelects */
export function buildFundamentalPayload(filterSelects) {
  /** @type {Record<string, unknown>} */
  const p = {};

  const mc = filterSelects.market_cap;
  if (mc === 'mc_nano') {
    p.max_market_cap = 50e6;
  } else if (mc === 'mc_micro') {
    p.max_market_cap = 300e6;
  } else if (mc === 'mc_small') {
    p.min_market_cap = 300e6;
    p.max_market_cap = 2e9;
  } else if (mc === 'mc_mid') {
    p.min_market_cap = 2e9;
    p.max_market_cap = 10e9;
  } else if (mc === 'mc_large') {
    p.min_market_cap = 10e9;
    p.max_market_cap = 200e9;
  } else if (mc === 'mc_mega') {
    p.min_market_cap = 200e9;
  } else if (mc === 'mc_lt1b') {
    p.max_market_cap = 1e9;
  } else if (mc === 'mc_1b_10b') {
    p.min_market_cap = 1e9;
    p.max_market_cap = 10e9;
  } else if (mc === 'mc_10b_50b') {
    p.min_market_cap = 10e9;
    p.max_market_cap = 50e9;
  } else if (mc === 'mc_50b_200b') {
    p.min_market_cap = 50e9;
    p.max_market_cap = 200e9;
  } else if (mc === 'mc_gt200b') {
    p.min_market_cap = 200e9;
  }

  const pe = filterSelects.pe;
  if (pe === 'pe_lt0') {
    p.max_pe = -1e-9;
  } else if (pe === 'pe_0_5') {
    p.min_pe = 0;
    p.max_pe = 5;
  } else if (pe === 'pe_5_10') {
    p.min_pe = 5;
    p.max_pe = 10;
  } else if (pe === 'pe_10_15') {
    p.min_pe = 10;
    p.max_pe = 15;
  } else if (pe === 'pe_15_25') {
    p.min_pe = 15;
    p.max_pe = 25;
  } else if (pe === 'pe_25_40') {
    p.min_pe = 25;
    p.max_pe = 40;
  } else if (pe === 'pe_gt40') {
    p.min_pe = 40;
  } else if (pe === 'pe_lt15') {
    p.max_pe = 15;
  } else if (pe === 'pe_gt50') {
    p.min_pe = 50;
  }

  const peg = filterSelects.peg;
  if (peg === 'peg_lt1') {
    p.max_peg = 0.999;
  } else if (peg === 'peg_1_2') {
    p.min_peg = 1;
    p.max_peg = 2;
  } else if (peg === 'peg_2_3') {
    p.min_peg = 2;
    p.max_peg = 3;
  } else if (peg === 'peg_gt3') {
    p.min_peg = 3;
  }

  const roe = filterSelects.roe;
  if (roe === 'roe_gt30') p.min_roe = 30;
  else if (roe === 'roe_gt20') p.min_roe = 20;
  else if (roe === 'roe_gt15') p.min_roe = 15;
  else if (roe === 'roe_gt10') p.min_roe = 10;
  else if (roe === 'roe_gt5') p.min_roe = 5;
  else if (roe === 'roe_lt0') p.max_roe = -1e-9;

  const div = filterSelects.div;
  if (div === 'div_gt8') p.min_dividend_yield = 8;
  else if (div === 'div_gt5') p.min_dividend_yield = 5;
  else if (div === 'div_gt3') p.min_dividend_yield = 3;
  else if (div === 'div_gt2') p.min_dividend_yield = 2;
  else if (div === 'div_gt1') p.min_dividend_yield = 1;
  else if (div === 'div_gt0') p.min_dividend_yield = 0.05;
  else if (div === 'div_0') p.max_dividend_yield = 0.01;

  const beta = filterSelects.beta;
  if (beta === 'b_lt0') p.max_beta = -1e-9;
  else if (beta === 'b_0_0_5') {
    p.min_beta = 0;
    p.max_beta = 0.5;
  } else if (beta === 'b_0_5_1') {
    p.min_beta = 0.5;
    p.max_beta = 1;
  } else if (beta === 'b_1_1_5') {
    p.min_beta = 1;
    p.max_beta = 1.5;
  } else if (beta === 'b_1_5_2') {
    p.min_beta = 1.5;
    p.max_beta = 2;
  } else if (beta === 'b_gt2') p.min_beta = 2;

  const sector = (filterSelects.sector || '').trim();
  if (sector) p.sector = sector;

  const eps = filterSelects.eps;
  if (eps === 'eps_gt25') p.min_eps_growth = 25;
  else if (eps === 'eps_gt15') p.min_eps_growth = 15;
  else if (eps === 'eps_gt5') p.min_eps_growth = 5;
  else if (eps === 'eps_gt0') p.min_eps_growth = 0.01;
  else if (eps === 'eps_lt0') p.max_eps_growth = -0.01;

  const rev = filterSelects.rev;
  if (rev === 'rev_gt30') p.min_revenue_growth = 30;
  else if (rev === 'rev_gt20') p.min_revenue_growth = 20;
  else if (rev === 'rev_gt10') p.min_revenue_growth = 10;
  else if (rev === 'rev_gt5') p.min_revenue_growth = 5;
  else if (rev === 'rev_lt0') p.max_revenue_growth = -0.01;

  return p;
}
