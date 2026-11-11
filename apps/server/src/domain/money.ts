const MONEY_PATTERN = /^(?:0|[1-9]\d*)\.\d{2}$/;

export class MoneyFormatError extends Error {
  constructor(value: unknown) {
    super(`金额必须是非负且保留两位小数的文本：${String(value)}`);
    this.name = 'MoneyFormatError';
  }
}

export class RatioFormatError extends Error {
  constructor(value: unknown) {
    super(`比例必须是 0 到 1 之间的有限小数：${String(value)}`);
    this.name = 'RatioFormatError';
  }
}

interface RatioFraction {
  numerator: bigint;
  denominator: bigint;
}

function assertSafeCents(cents: number): void {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new MoneyFormatError(cents);
  }
}

export function parseMoneyToCents(value: string): number {
  if (!MONEY_PATTERN.test(value)) {
    throw new MoneyFormatError(value);
  }

  const [whole, fraction] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyFormatError(value);
  }
  return Number(cents);
}

export function formatCents(cents: number): string {
  assertSafeCents(cents);
  const value = BigInt(cents);
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

function parseRatioFraction(value: number | string): RatioFraction {
  const text = typeof value === 'number' ? String(value) : value;
  if (!/^(?:0|1|0\.\d+)$/.test(text)) {
    throw new RatioFormatError(value);
  }

  const [whole, fraction = ''] = text.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * denominator + BigInt(fraction || '0');
  if (numerator < 0n || numerator > denominator) {
    throw new RatioFormatError(value);
  }
  return { numerator, denominator };
}

function formatPercentFraction(fraction: RatioFraction): string {
  const scaledPercent = (fraction.numerator * 10000n + fraction.denominator / 2n) / fraction.denominator;
  const whole = scaledPercent / 100n;
  const decimal = (scaledPercent % 100n).toString().padStart(2, '0');
  return `${whole}.${decimal}`;
}

export function formatRatioPercent(ratio: number | string): string {
  return formatPercentFraction(parseRatioFraction(ratio));
}

export function formatPercentFromCents(numeratorCents: number, denominatorCents: number): string {
  assertSafeCents(numeratorCents);
  assertSafeCents(denominatorCents);
  if (denominatorCents === 0) {
    throw new RangeError('比例分母不能为零');
  }
  return formatPercentFraction({
    numerator: BigInt(numeratorCents),
    denominator: BigInt(denominatorCents),
  });
}

export function isRatioOverThreshold(
  numeratorCents: number,
  denominatorCents: number,
  threshold: number | string,
): boolean {
  assertSafeCents(numeratorCents);
  assertSafeCents(denominatorCents);
  if (denominatorCents === 0) {
    throw new RangeError('比例分母不能为零');
  }

  const ratio = parseRatioFraction(threshold);
  return BigInt(numeratorCents) * ratio.denominator > BigInt(denominatorCents) * ratio.numerator;
}
