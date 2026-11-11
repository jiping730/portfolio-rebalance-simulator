import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  Instrument,
  PortfolioRules,
  PortfolioSnapshot,
  RawPortfolioInstrument,
  RawPortfolioRules,
  RawPortfolioSnapshot,
} from './types.js';

const DEFAULT_PORTFOLIO_PATH = fileURLToPath(new URL('../../data/portfolio.json', import.meta.url));
const MONEY_PATTERN = /^(?:0|[1-9]\d*)\.\d{2}$/;
const RATIO_PATTERN = /^(?:0|1|0\.\d+)$/;

export type SnapshotIssueCode =
  | 'INVALID_JSON'
  | 'INVALID_ROOT'
  | 'REQUIRED_FIELD'
  | 'INVALID_CURRENCY'
  | 'INVALID_DATETIME'
  | 'INVALID_MONEY'
  | 'INVALID_RATIO'
  | 'INVALID_ARRAY'
  | 'INVALID_QUANTITY'
  | 'DUPLICATE_SYMBOL'
  | 'INVALID_RULE';

export interface SnapshotValidationIssue {
  path: string;
  code: SnapshotIssueCode;
  message: string;
}

export class SnapshotValidationError extends Error {
  constructor(public readonly issues: SnapshotValidationIssue[]) {
    super(`组合快照校验失败，共 ${issues.length} 个问题`);
    this.name = 'SnapshotValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMoneyString(value: unknown): value is string {
  return typeof value === 'string' && MONEY_PATTERN.test(value) && Number.isFinite(Number(value));
}

function isRatioString(value: unknown): value is string {
  return typeof value === 'string' && RATIO_PATTERN.test(value) && Number.isFinite(Number(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function addIssue(
  issues: SnapshotValidationIssue[],
  path: string,
  code: SnapshotIssueCode,
  message: string,
): void {
  issues.push({ path, code, message });
}

function validateRules(value: unknown, issues: SnapshotValidationIssue[]): value is RawPortfolioRules {
  if (!isRecord(value)) {
    addIssue(issues, 'rules', 'REQUIRED_FIELD', 'rules 必须存在且为对象');
    return false;
  }

  const rules = value;
  if (!isRatioString(rules.single_instrument_threshold)) {
    addIssue(issues, 'rules.single_instrument_threshold', 'INVALID_RATIO', '单标的阈值必须是 0 到 1 之间的小数文本');
  }
  if (!isRatioString(rules.industry_threshold)) {
    addIssue(issues, 'rules.industry_threshold', 'INVALID_RATIO', '行业阈值必须是 0 到 1 之间的小数文本');
  }
  if (rules.comparison !== 'strictly_greater_than') {
    addIssue(issues, 'rules.comparison', 'INVALID_RULE', 'comparison 必须为 strictly_greater_than');
  }
  if (rules.cash_in_denominator !== true) {
    addIssue(issues, 'rules.cash_in_denominator', 'INVALID_RULE', '现金必须计入总资产分母');
  }
  if (rules.cash_in_industry !== false) {
    addIssue(issues, 'rules.cash_in_industry', 'INVALID_RULE', '现金不得计入行业');
  }
  if (rules.quantity !== 'positive_integer') {
    addIssue(issues, 'rules.quantity', 'INVALID_RULE', 'quantity 规则必须为 positive_integer');
  }
  if (!isMoneyString(rules.fees) || Number(rules.fees) !== 0) {
    addIssue(issues, 'rules.fees', 'INVALID_RULE', '本原型只支持 0.00 手续费');
  }

  return true;
}

function validateInstrument(
  value: unknown,
  index: number,
  symbols: Set<string>,
  issues: SnapshotValidationIssue[],
): value is RawPortfolioInstrument {
  const path = `instruments[${index}]`;
  if (!isRecord(value)) {
    addIssue(issues, path, 'REQUIRED_FIELD', '标的必须为对象');
    return false;
  }

  const instrument = value;
  if (!isNonEmptyString(instrument.symbol)) {
    addIssue(issues, `${path}.symbol`, 'REQUIRED_FIELD', '标的代码不能为空');
  } else if (symbols.has(instrument.symbol)) {
    addIssue(issues, `${path}.symbol`, 'DUPLICATE_SYMBOL', '标的代码不能重复');
  } else {
    symbols.add(instrument.symbol);
  }
  if (!isNonEmptyString(instrument.name)) {
    addIssue(issues, `${path}.name`, 'REQUIRED_FIELD', '标的名称不能为空');
  }
  if (!isNonEmptyString(instrument.industry)) {
    addIssue(issues, `${path}.industry`, 'REQUIRED_FIELD', '行业不能为空');
  }
  if (!isMoneyString(instrument.price)) {
    addIssue(issues, `${path}.price`, 'INVALID_MONEY', '价格必须是非负且保留两位小数的金额文本');
  }
  if (!isNonNegativeInteger(instrument.quantity)) {
    addIssue(issues, `${path}.quantity`, 'INVALID_QUANTITY', '持仓数量必须是非负整数');
  }

  return true;
}

function normalizeSnapshot(raw: RawPortfolioSnapshot): PortfolioSnapshot {
  const instruments: Instrument[] = raw.instruments.map((instrument) => ({
    symbol: instrument.symbol,
    name: instrument.name,
    industry: instrument.industry,
    price: instrument.price,
    quantity: instrument.quantity,
  }));
  const rules: PortfolioRules = {
    singleInstrumentThreshold: Number(raw.rules.single_instrument_threshold),
    industryThreshold: Number(raw.rules.industry_threshold),
    comparison: raw.rules.comparison,
    cashInDenominator: raw.rules.cash_in_denominator,
    cashInIndustry: raw.rules.cash_in_industry,
    quantity: raw.rules.quantity,
    fees: raw.rules.fees,
  };

  return {
    portfolioId: raw.portfolio_id,
    snapshotId: raw.snapshot_id,
    name: raw.name,
    currency: raw.currency,
    snapshotAt: raw.snapshot_at,
    cash: raw.cash,
    instruments,
    rules,
  };
}

export function validateRawPortfolioSnapshot(input: unknown): PortfolioSnapshot {
  const issues: SnapshotValidationIssue[] = [];
  if (!isRecord(input)) {
    throw new SnapshotValidationError([
      { path: '$', code: 'INVALID_ROOT', message: '快照根节点必须为对象' },
    ]);
  }

  const raw = input as Record<string, unknown>;
  if (!isNonEmptyString(raw.portfolio_id)) {
    addIssue(issues, 'portfolio_id', 'REQUIRED_FIELD', '组合编号不能为空');
  }
  if (!isNonEmptyString(raw.name)) {
    addIssue(issues, 'name', 'REQUIRED_FIELD', '组合名称不能为空');
  }
  if (raw.currency !== 'CNY') {
    addIssue(issues, 'currency', 'INVALID_CURRENCY', '当前只支持 CNY');
  }
  if (!isNonEmptyString(raw.snapshot_id)) {
    addIssue(issues, 'snapshot_id', 'REQUIRED_FIELD', '快照编号不能为空');
  }
  if (!isNonEmptyString(raw.snapshot_at) || Number.isNaN(Date.parse(raw.snapshot_at))) {
    addIssue(issues, 'snapshot_at', 'INVALID_DATETIME', '快照时间必须是可解析的日期时间文本');
  }
  if (!isMoneyString(raw.cash)) {
    addIssue(issues, 'cash', 'INVALID_MONEY', '现金必须是非负且保留两位小数的金额文本');
  }

  const rawInstruments = raw.instruments;
  if (!Array.isArray(rawInstruments) || rawInstruments.length === 0) {
    addIssue(issues, 'instruments', 'INVALID_ARRAY', 'instruments 必须为非空数组');
  } else {
    const symbols = new Set<string>();
    rawInstruments.forEach((instrument, index) => validateInstrument(instrument, index, symbols, issues));
  }

  validateRules(raw.rules, issues);

  if (issues.length > 0) {
    throw new SnapshotValidationError(issues);
  }

  return normalizeSnapshot(raw as unknown as RawPortfolioSnapshot);
}

export function parsePortfolioSnapshotJson(jsonText: string): PortfolioSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    throw new SnapshotValidationError([
      { path: '$', code: 'INVALID_JSON', message: '快照文件不是合法 JSON' },
    ]);
  }
  return validateRawPortfolioSnapshot(parsed);
}

export function loadPortfolioSnapshot(filePath = DEFAULT_PORTFOLIO_PATH): PortfolioSnapshot {
  let jsonText: string;
  try {
    jsonText = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new SnapshotValidationError([
      {
        path: filePath,
        code: 'REQUIRED_FIELD',
        message: `无法读取组合快照文件：${error instanceof Error ? error.message : String(error)}`,
      },
    ]);
  }
  return parsePortfolioSnapshotJson(jsonText);
}
