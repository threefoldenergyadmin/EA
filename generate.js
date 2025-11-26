#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const MAIN_CSV = process.env.MAIN_CSV || '/mnt/Technical and Financial Output.csv';
const CHART_CSV = process.env.CHART_CSV || '/mnt/Outputs - Chart Financed (1).csv';
const TEMPLATE_PATH = process.env.TEMPLATE_PATH || path.join(__dirname, 'template.html');
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(__dirname, 'output');

function parseCsv(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  const lines = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      const peek = text[i + 1];
      if (peek === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === '\n' && !inQuotes) {
      lines.push(current.replace(/\r$/, ''));
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim() !== '') lines.push(current.replace(/\r$/, ''));

  if (!lines.length) return rows;

  // Auto-detect delimiter from header line.
  const headerLine = lines[0];
  const delimiters = [',', '\t', ';'];
  const countDelim = (line, delim) => {
    let count = 0;
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        const next = line[i + 1];
        if (next === '"') {
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (c === delim && !quoted) {
        count++;
      }
    }
    return count;
  };

  let delimiter = ',';
  let bestCount = -1;
  delimiters.forEach((d) => {
    const c = countDelim(headerLine, d);
    if (c > bestCount) {
      bestCount = c;
      delimiter = d;
    }
  });

  const splitRow = (row) => {
    const cols = [];
    let value = '';
    let quoted = false;
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      const next = row[i + 1];
      if (c === '"') {
        if (next === '"') {
          value += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (c === delimiter && !quoted) {
        cols.push(value);
        value = '';
      } else {
        value += c;
      }
    }
    cols.push(value);
    return cols.map((v) => v.trim());
  };

  const header = splitRow(lines.shift() || '');
  lines.forEach((line) => {
    if (!line.trim()) return;
    const cols = splitRow(line);
    const row = {};
    header.forEach((key, idx) => {
      row[key.trim()] = cols[idx] ?? '';
    });
    rows.push(row);
  });

  return rows;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).replace(/,/g, '').trim();
  if (str === '' || str === '-' || str.toLowerCase() === 'null') return null;
  const num = Number(str);
  return Number.isFinite(num) ? num : null;
}

function parseScientificToString(raw) {
  const s = String(raw).trim();
  if (!/[eE]/.test(s)) return s;
  const match = s.match(/^([+-]?\d+(?:\.\d+)?)[eE]([+-]?\d+)$/);
  if (!match) return s;
  const [, mantissaStr, exponentStr] = match;
  const [intPart, fracPart = ''] = mantissaStr.split('.');
  const exponent = parseInt(exponentStr, 10);
  let digits = intPart + fracPart;
  let decimalIndex = intPart.length;
  decimalIndex += exponent;
  if (decimalIndex < digits.length) {
    digits = digits.slice(0, decimalIndex) + digits.slice(decimalIndex);
  } else {
    digits = digits.padEnd(decimalIndex, '0');
  }
  return digits.replace(/^0+(?=\d)/, '');
}

function formatMpan(raw) {
  const cleaned = String(raw ?? '').trim();
  if (!cleaned) return '';
  const numeric = parseScientificToString(cleaned);
  return numeric;
}

function formatCurrency(value) {
  const str = String(value ?? '').trim();
  if (!str) return '';
  if (str.startsWith('£')) return str;
  const num = toNumber(str);
  if (num === null) return str;
  const abs = Math.abs(num);
  const formatted = abs.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (num < 0) {
    return `(£${formatted})`;
  }
  return `£${formatted}`;
}

function formatPercent(value) {
  const str = String(value ?? '').trim();
  if (!str) return '';
  if (str.includes('%')) return str;
  const num = toNumber(str);
  if (num === null) return str;
  return `${num.toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`;
}

function formatUnit(value, unit) {
  const str = String(value ?? '').trim();
  if (!str) return '';
  const num = toNumber(str);
  if (num === null) return `${str} ${unit}`.trim();
  const formatted = num.toLocaleString('en-GB', { maximumFractionDigits: 1 });
  return `${formatted} ${unit}`.trim();
}

function formatYears(value) {
  const str = String(value ?? '').trim();
  if (!str) return '';
  const num = toNumber(str);
  if (num === null) return str;
  return `${num.toLocaleString('en-GB', { maximumFractionDigits: 1 })} years`;
}

function buildValueMap(records) {
  // Map CSV "Variable" names to internal dotted keys used by placeholders.
  const VARIABLE_TO_KEY = {
    'Site Name': 'site_name',
    'Address': 'address',
    'MPAN': 'mpan',
    'Current Demand Period': 'current_demand_period',
    'Number of Days': 'number_of_days',
    'Created Date': 'created_date',
    'Contract End Date': 'contract_end_date',
    'Current Supplier': 'current_supplier',
    'GSP': 'gsp',
    'Total Consumption': 'total_consumption_kwh',

    'Current Energy Bill £': 'current_energy_bill_gbp',
    'Optima Energy Bill £': 'optima_energy_bill_gbp',
    'Savings': 'savings_percent',

    'Optima System Type': 'optima_system_type',
    'Power': 'optima_power_kw',
    'Capacity': 'optima_capacity_kwh',
    'Capital Cost Value': 'capital_cost_gbp',
    'Optima Annual Savings': 'optima_annual_savings_gbp',

    'Dynamic Savings': 'dynamic_savings_percent',
    'Dynamic Forecast Savings *': 'dynamic_forecast_savings_gbp',
    'Dynamic ROI inc. Full Expensing': 'dynamic_roi_inc_full_expensing_years',

    'Day units Current kWh': 'units.current.day_kwh',
    'Night units Current kWh': 'units.current.night_kwh',
    'Red units Current kWh': 'units.current.red_kwh',
    'Amber units Current kWh': 'units.current.amber_kwh',
    'Green units Current kWh': 'units.current.green_kwh',
    'Capacity Current KVA': 'capacity.current_kva',

    'Day units Optima kWh': 'units.optima.day_kwh',
    'Night units Optima kWh': 'units.optima.night_kwh',
    'Red units Optima kWh': 'units.optima.red_kwh',
    'Amber units Optima kWh': 'units.optima.amber_kwh',
    'Green units Optima kWh': 'units.optima.green_kwh',
    'Capacity Optima KVA': 'capacity.optima_kva',

    'Day Current P/kWh': 'tariff.current.day_p_kwh',
    'Night Current P/kWh': 'tariff.current.night_p_kwh',
    'Peak Current P/kWh': 'tariff.current.peak_p_kwh',
    'Standing charge Current P/D': 'tariff.current.standing_p_day',
    'Availability Current P/KVA/D': 'tariff.current.availability_p_kva_day',
    'CCL Current P/kWh': 'tariff.current.ccl_p_kwh',

    'Day Optima P/kWh': 'tariff.optima.day_p_kwh',
    'Night Optima P/kWh': 'tariff.optima.night_p_kwh',
    'Peak Optima P/kWh': 'tariff.optima.peak_p_kwh',
    'Standing charge Optima P/D': 'tariff.optima.standing_p_day',
    'Availability Optima P/KVA/D': 'tariff.optima.availability_p_kva_day',
    'CCL Optima P/kWh': 'tariff.optima.ccl_p_kwh',

    'Product': 'finance.product',
    'Term (months)': 'finance.term_months',
    'Interest Rate': 'finance.interest_rate',
    'Repayment (p/m)': 'finance.repayment_gbp_pm',
    'Deposit': 'finance.deposit_gbp',
    'VAT': 'finance.vat_gbp',
    'Est. Price (inc. install)': 'finance.est_price_gbp',

    'Purchase - Savings Year 1': 'purchase_savings_year_1',
    'Purchase - Savings within Warranty': 'purchase_savings_warranty',
    'Purchase - Savings within Useful Life': 'purchase_savings_useful_life',
    'Purchase - ROI ex. Full Expensing': 'purchase_roi_ex_full_expensing',
    'Purchase - ROI inc. Full Expensing': 'purchase_roi_inc_full_expensing',
    'Basic ROI (years) *': 'basic_roi_years',
    'Full Expensing': 'full_expensing_value',

    'Finance - Savings Year 1': 'finance_savings_year_1',
    'Finance - Savings within Warranty': 'finance_savings_warranty',
    'Finance - Savings within Useful Life': 'finance_savings_useful_life',
    'Finance - ROI ex. Full Expensing': 'finance_roi_ex_full_expensing',
    'Finance - ROI inc. Full Expensing': 'finance_roi_inc_full_expensing',

    'Dynamic ROI ex. Full Expensing': 'dynamic_roi_ex_full_expensing',
  };

  const normaliseKey = (k) =>
    k
      .toLowerCase()
      .replace(/\*/g, '')
      .replace(/£/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

  const map = {};

  records.forEach((row) => {
    const rawKey = (row.Variable || row.variable || '').trim();
    const value = row.Value ?? row.value ?? '';
    if (!rawKey) return;

    const internalKey = VARIABLE_TO_KEY[rawKey] || normaliseKey(rawKey);
    const parts = internalKey.split('.');
    let cursor = map;
    parts.forEach((part, idx) => {
      if (idx === parts.length - 1) {
        cursor[part] = value;
      } else {
        cursor[part] = cursor[part] || {};
        cursor = cursor[part];
      }
    });
  });

  return map;
}

function getRaw(map, pathStr) {
  const parts = pathStr.split('.');
  let cursor = map;
  for (const part of parts) {
    if (cursor && Object.prototype.hasOwnProperty.call(cursor, part)) {
      cursor = cursor[part];
    } else {
      return '';
    }
  }
  return cursor;
}

function formatByKey(key, raw) {
  if (key.includes('mpan')) return formatMpan(raw);
  if (key.includes('percent')) return formatPercent(raw);
  if (key.includes('roi')) return formatYears(raw);
  if (key.endsWith('_p_kwh')) return `${raw || ''} p/kWh`;
  if (key.endsWith('_p_day')) return `${raw || ''} p/day`;
  if (key.endsWith('_p_kva_day')) return `${raw || ''} p/kVA/day`;
  if (key.endsWith('_kwh')) return formatUnit(raw, 'kWh');
  if (key.endsWith('_kva')) return formatUnit(raw, 'kVA');
  if (key.includes('savings') || key.includes('payment') || key.includes('cost') || key.includes('deposit') || key.includes('price') || key.includes('bill') || key.endsWith('_gbp')) {
    return formatCurrency(raw);
  }
  return String(raw ?? '');
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'report';
}

function computeCostBands(values) {
  const labels = ['Day', 'Night', 'Red', 'Amber', 'Green'];
  const tariffsCurrent = {
    Day: toNumber(getRaw(values, 'tariff.current.day_p_kwh')),
    Night: toNumber(getRaw(values, 'tariff.current.night_p_kwh')),
    Red: toNumber(getRaw(values, 'tariff.current.peak_p_kwh')),
    Amber: toNumber(getRaw(values, 'tariff.current.amber_p_kwh') || getRaw(values, 'tariff.current.red_p_kwh')),
    Green: toNumber(getRaw(values, 'tariff.current.green_p_kwh')),
  };
  const tariffsOptima = {
    Day: toNumber(getRaw(values, 'tariff.optima.day_p_kwh')),
    Night: toNumber(getRaw(values, 'tariff.optima.night_p_kwh')),
    Red: toNumber(getRaw(values, 'tariff.optima.peak_p_kwh')),
    Amber: toNumber(getRaw(values, 'tariff.optima.amber_p_kwh') || getRaw(values, 'tariff.optima.red_p_kwh')),
    Green: toNumber(getRaw(values, 'tariff.optima.green_p_kwh')),
  };
  const unitsCurrent = {
    Day: toNumber(getRaw(values, 'units.current.day_kwh')),
    Night: toNumber(getRaw(values, 'units.current.night_kwh')),
    Red: toNumber(getRaw(values, 'units.current.red_kwh')),
    Amber: toNumber(getRaw(values, 'units.current.amber_kwh')),
    Green: toNumber(getRaw(values, 'units.current.green_kwh')),
  };
  const unitsOptima = {
    Day: toNumber(getRaw(values, 'units.optima.day_kwh')),
    Night: toNumber(getRaw(values, 'units.optima.night_kwh')),
    Red: toNumber(getRaw(values, 'units.optima.red_kwh')),
    Amber: toNumber(getRaw(values, 'units.optima.amber_kwh')),
    Green: toNumber(getRaw(values, 'units.optima.green_kwh')),
  };

  const currentValues = [];
  const optimaValues = [];
  const table = { tariff: { current: {}, optima: {} }, cost: { current: {}, optima: {} } };

  labels.forEach((label) => {
    const tCurrent = tariffsCurrent[label] ?? 0;
    const tOptima = tariffsOptima[label] ?? 0;
    const uCurrent = unitsCurrent[label] ?? 0;
    const uOptima = unitsOptima[label] ?? 0;
    const costCurrent = (uCurrent * tCurrent) / 100;
    const costOptima = (uOptima * tOptima) / 100;
    currentValues.push(Number.isFinite(costCurrent) ? Number(costCurrent.toFixed(2)) : 0);
    optimaValues.push(Number.isFinite(costOptima) ? Number(costOptima.toFixed(2)) : 0);
    table.tariff.current[label.toLowerCase()] = tCurrent ? `${tCurrent} p/kWh` : '';
    table.tariff.optima[label.toLowerCase()] = tOptima ? `${tOptima} p/kWh` : '';
    table.cost.current[label.toLowerCase()] = costCurrent ? formatCurrency(costCurrent) : '';
    table.cost.optima[label.toLowerCase()] = costOptima ? formatCurrency(costOptima) : '';
  });

  return { labels, currentValues, optimaValues, table };
}

function parseChartCsv(csvText, targetMpan) {
  const rows = parseCsv(csvText);
  const filtered = targetMpan
    ? rows.filter((row) => formatMpan(row.MPAN || row.mpan) === formatMpan(targetMpan))
    : rows;
  if (!filtered.length) return { years: [], series: {} };
  const headers = Object.keys(filtered[0]);
  const toKey = (header) => header.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  const valueHeaders = headers.filter((h) => !['Year', 'MPAN', 'mpan'].includes(h));
  const years = filtered.map((row) => row.Year || row.year).filter(Boolean);
  const series = {};
  valueHeaders.forEach((header) => {
    series[toKey(header)] = [];
  });

  filtered.forEach((row) => {
    valueHeaders.forEach((header) => {
      const key = toKey(header);
      const val = row[header];
      const cleaned = typeof val === 'string' ? val.trim() : val;
      if (cleaned === '' || cleaned === '-' || cleaned === null || cleaned === undefined) {
        series[key].push(null);
      } else {
        const num = toNumber(cleaned);
        series[key].push(num === null ? null : Number(num.toFixed(2)));
      }
    });
  });

  return { years, series };
}

function buildPlaceholderMap(values, costBands, chartData) {
  const flatKeys = [
    'site_name', 'address', 'mpan', 'current_demand_period', 'number_of_days', 'created_date',
    'current_supplier', 'contract_end_date', 'gsp', 'total_consumption_kwh',
    'current_energy_bill_gbp', 'optima_energy_bill_gbp', 'savings_percent', 'optima_system_type',
    'optima_power_kw', 'optima_capacity_kwh', 'capital_cost_gbp', 'optima_annual_savings_gbp',
    'dynamic_savings_percent', 'dynamic_forecast_savings_gbp', 'dynamic_roi_inc_full_expensing_years', 'dynamic_roi_inc_full_expensing',
    'units.current.day_kwh', 'units.current.night_kwh', 'units.current.red_kwh', 'units.current.amber_kwh', 'units.current.green_kwh',
    'capacity.current_kva', 'units.optima.day_kwh', 'units.optima.night_kwh', 'units.optima.red_kwh', 'units.optima.amber_kwh', 'units.optima.green_kwh',
    'capacity.optima_kva',
    'tariff.current.day_p_kwh', 'tariff.current.night_p_kwh', 'tariff.current.peak_p_kwh', 'tariff.current.standing_p_day', 'tariff.current.availability_p_kva_day', 'tariff.current.ccl_p_kwh',
    'tariff.optima.day_p_kwh', 'tariff.optima.night_p_kwh', 'tariff.optima.peak_p_kwh', 'tariff.optima.standing_p_day', 'tariff.optima.availability_p_kva_day', 'tariff.optima.ccl_p_kwh',
    'finance.product', 'finance.term_months', 'finance.interest_rate', 'finance.repayment_gbp_pm', 'finance.deposit_gbp', 'finance.vat_gbp', 'finance.est_price_gbp',
    'purchase_savings_year_1', 'purchase_savings_warranty', 'purchase_savings_useful_life', 'purchase_roi_ex_full_expensing', 'purchase_roi_inc_full_expensing', 'basic_roi_years', 'full_expensing_value',
    'finance_savings_year_1', 'finance_savings_warranty', 'finance_savings_useful_life', 'finance_roi_ex_full_expensing', 'finance_roi_inc_full_expensing', 'dynamic_forecast_savings', 'dynamic_roi_ex_full_expensing',
    'finance_payment_label', 'finance_payment_total'
  ];

  const map = {};
  flatKeys.forEach((key) => {
    const raw = getRaw(values, key);
    map[`{{${key}}}`] = formatByKey(key, raw);
  });

  // Chart A placeholders
  map['{{costBands.labels}}'] = JSON.stringify(costBands.labels);
  map['{{costBands.current.values}}'] = JSON.stringify(costBands.currentValues);
  map['{{costBands.optima.values}}'] = JSON.stringify(costBands.optimaValues);

  ['day', 'night', 'red', 'amber', 'green'].forEach((band) => {
    map[`{{tariff.current.${band}}}`] = costBands.table.tariff.current[band] || '';
    map[`{{tariff.optima.${band}}}`] = costBands.table.tariff.optima[band] || '';
    map[`{{cost.current.${band}}}`] = costBands.table.cost.current[band] || '';
    map[`{{cost.optima.${band}}}`] = costBands.table.cost.optima[band] || '';
  });

  // Chart B placeholders
  map['{{chartYears}}'] = JSON.stringify(chartData.years || []);
  map['{{chartSeries.finance_payment}}'] = JSON.stringify(chartData.series.finance_payment || chartData.series.finance_payment_gbp || []);
  map['{{chartSeries.finance_optima_cum_savings}}'] = JSON.stringify(chartData.series.finance_optima_cum_savings || []);
  map['{{chartSeries.finance_dynamic_forecast_savings}}'] = JSON.stringify(chartData.series.finance_dynamic_forecast_savings || []);
  map['{{chartSeries.purchase_optima_cum_savings}}'] = JSON.stringify(chartData.series.purchase_optima_cum_savings || []);
  map['{{chartSeries.purchase_dynamic_forecast_savings}}'] = JSON.stringify(chartData.series.purchase_dynamic_forecast_savings || []);

  map['{{static_disclaimer_text}}'] = `This report is based on the supplied consumption profile and tariff information. Savings are indicative and subject to final engineering design, site surveys, and prevailing market conditions. Finance illustrations are for guidance only and may vary. Please refer to your agreement for full terms and conditions.`;

  map['{{mpan}}'] = formatMpan(getRaw(values, 'mpan'));

  return map;
}

function applyPlaceholders(template, map) {
  let output = template;
  Object.entries(map).forEach(([key, value]) => {
    output = output.split(key).join(value ?? '');
  });
  return output;
}

async function main() {
  const template = await fs.promises.readFile(TEMPLATE_PATH, 'utf8');
  const mainCsvText = await fs.promises.readFile(MAIN_CSV, 'utf8');
  const chartCsvText = await fs.promises.readFile(CHART_CSV, 'utf8');

  const mainRecords = parseCsv(mainCsvText);
  const values = buildValueMap(mainRecords);
  const mpan = formatMpan(getRaw(values, 'mpan'));

  const costBands = computeCostBands(values);
  const chartData = parseChartCsv(chartCsvText, mpan);

  const placeholderMap = buildPlaceholderMap(values, costBands, chartData);

  if (!fs.existsSync(OUTPUT_DIR)) {
    await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
  }

  const filename = path.join(OUTPUT_DIR, `${sanitizeFilename(mpan || getRaw(values, 'site_name') || 'report')}.html`);
  const outputHtml = applyPlaceholders(template, placeholderMap);
  await fs.promises.writeFile(filename, outputHtml, 'utf8');

  console.log(`Report written to ${filename}`);
}

main().catch((err) => {
  console.error('Generation failed:', err);
  process.exit(1);
});
