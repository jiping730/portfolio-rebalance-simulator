import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchPortfolio,
  fetchScenario,
  fetchScenarios,
  previewSimulation,
  saveScenario,
  PortfolioApiError,
  type IndustryAnalysis,
  type InstrumentAnalysis,
  type PortfolioAnalysis,
  type PortfolioOverview,
  type ScenarioListItem,
  type SimulationResult,
  type TradeOperationInput,
  type TradeSide,
} from './api';

function formatSnapshotTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function Money({ value }: { value: string }) {
  return <span className="money">¥{value}</span>;
}

function AlertBadge({ active }: { active: boolean }) {
  return <span className={`status-badge ${active ? 'status-badge--danger' : 'status-badge--safe'}`}>{active ? '超限' : '正常'}</span>;
}

function InstrumentTable({ instruments }: { instruments: InstrumentAnalysis[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>标的</th><th>行业</th><th>价格</th><th>持仓</th><th>市值</th><th>占比</th><th>状态</th></tr>
        </thead>
        <tbody>
          {instruments.map((instrument) => (
            <tr key={instrument.symbol}>
              <td><div className="primary-cell">{instrument.name}</div><div className="secondary-cell">{instrument.symbol}</div></td>
              <td>{instrument.industry}</td>
              <td><Money value={instrument.price} /></td>
              <td>{instrument.quantity.toLocaleString('zh-CN')}</td>
              <td><Money value={instrument.marketValue} /></td>
              <td>{instrument.ratioPercent}%</td>
              <td><AlertBadge active={instrument.isOverThreshold} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IndustryTable({ industries }: { industries: IndustryAnalysis[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>行业</th><th>市值</th><th>占比</th><th>阈值</th><th>状态</th></tr>
        </thead>
        <tbody>
          {industries.map((industry) => (
            <tr key={industry.industry}>
              <td className="primary-cell">{industry.industry}</td>
              <td><Money value={industry.marketValue} /></td>
              <td>{industry.ratioPercent}%</td>
              <td>{industry.thresholdPercent}%</td>
              <td><AlertBadge active={industry.isOverThreshold} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConcentrationAlerts({ alerts }: { alerts: PortfolioOverview['summary']['alerts'] }) {
  return (
    <section className="panel alert-panel" aria-labelledby="alert-title">
      <div className="panel-heading">
        <div><p className="eyebrow">CONCENTRATION CHECK</p><h2 id="alert-title">集中度提醒</h2></div>
        <span className={alerts.length > 0 ? 'alert-count alert-count--danger' : 'alert-count alert-count--safe'}>
          {alerts.length > 0 ? `${alerts.length} 项超限` : '全部正常'}
        </span>
      </div>
      {alerts.length > 0 ? (
        <div className="alert-list">
          {alerts.map((alert) => (
            <div className="alert-item" key={`${alert.type}-${alert.key}`}>
              <span className="alert-icon" aria-hidden="true">!</span>
              <div><strong>{alert.label}</strong><p>{alert.type === 'instrument' ? '单一标的' : '行业'}占比 {alert.ratioPercent}%，超过阈值 {alert.thresholdPercent}%</p></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-alert"><span className="success-icon" aria-hidden="true">✓</span><div><strong>当前没有集中度超限项</strong><p>单一标的阈值为 30%，行业阈值为 50%。</p></div></div>
      )}
    </section>
  );
}

function LoadingState() {
  return <main className="page-shell state-shell"><div className="loading-card" role="status"><span className="spinner" aria-hidden="true" /><div><strong>正在加载组合快照</strong><p>正在读取最新的固定行情数据。</p></div></div></main>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <main className="page-shell state-shell"><div className="error-card" role="alert"><span className="error-icon" aria-hidden="true">!</span><div><strong>组合数据加载失败</strong><p>{message}</p><button type="button" className="button button--primary" onClick={onRetry}>重新加载</button></div></div></main>;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

const simulationErrorLabels: Record<string, string> = {
  EMPTY_OPERATIONS: '操作列表为空',
  INVALID_OPERATION: '交易操作无效',
  INVALID_SIDE: '交易方向无效',
  INVALID_QUANTITY: '交易数量无效',
  UNKNOWN_SYMBOL: '交易标的不存在',
  INSUFFICIENT_CASH: '现金不足',
  INSUFFICIENT_HOLDING: '持仓不足',
  AMOUNT_OVERFLOW: '交易金额超出范围',
  TOTAL_ASSET_NOT_PRESERVED: '总资产校验失败',
};

function formatSimulationError(reason: unknown): string {
  if (!(reason instanceof PortfolioApiError)) {
    return reason instanceof Error ? reason.message : '模拟提交失败';
  }

  const label = reason.code ? simulationErrorLabels[reason.code] ?? '模拟校验失败' : '模拟校验失败';
  const operationIndex = reason.details?.operationIndex;
  const operationHint = typeof operationIndex === 'number' && Number.isInteger(operationIndex) && operationIndex >= 0
    ? `（第 ${operationIndex + 1} 笔操作失败）`
    : '';
  return `${label}：${reason.message}${operationHint}`;
}

function formatPercentChange(original: string, simulated: string): string {
  const change = Number(simulated) - Number(original);
  return `${change > 0 ? '+' : ''}${change.toFixed(2)}%`;
}

function ConcentrationComparison({ original, simulated }: { original: PortfolioAnalysis; simulated: PortfolioAnalysis }) {
  const originalByIndustry = useMemo(() => new Map(original.industries.map((item) => [item.industry, item])), [original]);

  return (
    <section className="concentration-comparison" aria-labelledby="simulation-concentration-title">
      <div className="comparison-section-heading">
        <div><p className="eyebrow">CONCENTRATION DELTA</p><h3 id="simulation-concentration-title">行业集中度对比</h3></div>
        <span className="panel-meta">模拟结果</span>
      </div>
      <div className="table-wrap">
        <table className="concentration-table">
          <thead><tr><th>行业</th><th>原始市值</th><th>原始占比</th><th>模拟市值</th><th>模拟占比</th><th>占比变化</th><th>阈值</th><th>模拟状态</th></tr></thead>
          <tbody>
            {simulated.industries.map((industry) => {
              const originalIndustry = originalByIndustry.get(industry.industry);
              const originalRatio = originalIndustry?.ratioPercent ?? '0.00';
              const change = Number(industry.ratioPercent) - Number(originalRatio);
              return (
                <tr key={industry.industry}>
                  <td className="primary-cell">{industry.industry}</td>
                  <td><Money value={originalIndustry?.marketValue ?? '0.00'} /></td>
                  <td>{originalRatio}%</td>
                  <td><Money value={industry.marketValue} /></td>
                  <td>{industry.ratioPercent}%</td>
                  <td className={change === 0 ? '' : change > 0 ? 'delta-positive' : 'delta-negative'}>{formatPercentChange(originalRatio, industry.ratioPercent)}</td>
                  <td>{industry.thresholdPercent}%</td>
                  <td><AlertBadge active={industry.isOverThreshold} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SimulationComparison({ result, stale }: { result: SimulationResult; stale: boolean }) {
  const originalBySymbol = useMemo(() => new Map(result.original.instruments.map((item) => [item.symbol, item])), [result.original]);

  return (
    <div className="comparison-area">
      <div className="compare-cards">
        <div className="compare-card">
          <span className="compare-label">原始组合</span>
          <strong><Money value={result.original.summary.totalAsset} /></strong>
          <p>现金 <Money value={result.original.summary.cash} /> · {result.original.summary.alerts.length} 项提醒</p>
        </div>
        <div className="compare-arrow" aria-hidden="true">→</div>
        <div className="compare-card compare-card--highlight">
          <span className="compare-label">模拟组合</span>
          <strong><Money value={result.simulated.summary.totalAsset} /></strong>
          <p>现金 <Money value={result.simulated.summary.cash} /> · {result.simulated.summary.alerts.length} 项提醒</p>
        </div>
      </div>
      <div className="invariant-note"><span aria-hidden="true">✓</span> 总资产守恒：{result.invariant.originalTotalAsset} → {result.invariant.simulatedTotalAsset}</div>
      {stale && <div className="stale-note" role="status">当前操作列表已变化，以上为上一次成功模拟结果，请重新提交后再保存。</div>}
      <ConcentrationComparison original={result.original} simulated={result.simulated} />
      <div className="table-wrap comparison-table-wrap">
        <table>
          <thead><tr><th>标的</th><th>原始持仓</th><th>模拟持仓</th><th>变化</th><th>模拟市值</th></tr></thead>
          <tbody>
            {result.simulated.instruments.map((instrument) => {
              const original = originalBySymbol.get(instrument.symbol);
              const delta = instrument.quantity - (original?.quantity ?? 0);
              return <tr key={instrument.symbol}><td className="primary-cell">{instrument.symbol} · {instrument.name}</td><td>{original?.quantity ?? 0}</td><td>{instrument.quantity}</td><td className={delta === 0 ? '' : delta > 0 ? 'delta-positive' : 'delta-negative'}>{formatSigned(delta)}</td><td><Money value={instrument.marketValue} /></td></tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RebalanceWorkspace({ portfolio }: { portfolio: PortfolioOverview }) {
  const [side, setSide] = useState<TradeSide>('buy');
  const [symbol, setSymbol] = useState(portfolio.instruments[0]?.symbol ?? '');
  const [quantity, setQuantity] = useState('');
  const [operations, setOperations] = useState<TradeOperationInput[]>([]);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [simulationStale, setSimulationStale] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioListItem[]>([]);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [loadingScenarios, setLoadingScenarios] = useState(true);
  const [openingScenario, setOpeningScenario] = useState<string | null>(null);

  const loadScenarios = useCallback(() => {
    setLoadingScenarios(true);
    void fetchScenarios()
      .then((items) => { setScenarios(items); setScenarioError(null); })
      .catch((reason: unknown) => setScenarioError(reason instanceof Error ? reason.message : '方案列表加载失败'))
      .finally(() => setLoadingScenarios(false));
  }, []);

  useEffect(() => { loadScenarios(); }, [loadScenarios]);

  const addOperation = () => {
    const parsedQuantity = Number(quantity);
    if (!Number.isSafeInteger(parsedQuantity) || parsedQuantity <= 0) {
      setFormError('交易数量必须为正整数');
      return;
    }
    setOperations((current) => [...current, { side, symbol, quantity: parsedQuantity }]);
    if (simulation) setSimulationStale(true);
    setQuantity('');
    setFormError(null);
    setSimulationError(null);
    setSaveMessage(null);
  };

  const removeOperation = (operationIndex: number) => {
    setOperations((current) => current.filter((_, index) => index !== operationIndex));
    if (simulation) setSimulationStale(true);
    setSimulationError(null);
    setSaveMessage(null);
  };

  const submitSimulation = () => {
    if (operations.length === 0) {
      setSimulationError('请至少添加一笔交易操作');
      return;
    }
    setSubmitting(true);
    setSimulationError(null);
    setSaveMessage(null);
    void previewSimulation(operations)
      .then((result) => {
        setSimulation(result);
        setSimulationStale(false);
      })
      .catch((reason: unknown) => setSimulationError(formatSimulationError(reason)))
      .finally(() => setSubmitting(false));
  };

  const saveCurrentScenario = () => {
    const name = saveName.trim();
    if (!simulation || simulationStale) {
      setSaveMessage('请先完成一次成功模拟');
      return;
    }
    if (name.length < 1 || name.length > 80) {
      setSaveMessage('方案名长度必须为 1-80 个字符');
      return;
    }
    setSubmitting(true);
    setSaveMessage(null);
    void saveScenario(name, operations)
      .then((saved) => {
        setSaveName('');
        setSaveMessage(`方案“${saved.name}”已保存`);
        loadScenarios();
      })
      .catch((reason: unknown) => setSaveMessage(reason instanceof Error ? reason.message : '方案保存失败'))
      .finally(() => setSubmitting(false));
  };

  const reopenScenario = (scenarioId: string) => {
    setOpeningScenario(scenarioId);
    setScenarioError(null);
    void fetchScenario(scenarioId)
      .then((scenario) => {
        const { invariant, ...simulated } = scenario.result;
        setOperations(scenario.operations.map(({ side: operationSide, symbol: operationSymbol, quantity: operationQuantity }) => ({ side: operationSide, symbol: operationSymbol, quantity: operationQuantity })));
        setSimulation({
          operations: scenario.operations,
          original: { summary: portfolio.summary, instruments: portfolio.instruments, industries: portfolio.industries },
          simulated,
          invariant,
        });
        setSimulationStale(false);
        setSimulationError(null);
        setSaveMessage(`已重新打开方案“${scenario.name}”`);
      })
      .catch((reason: unknown) => setScenarioError(reason instanceof Error ? reason.message : '方案重开失败'))
      .finally(() => setOpeningScenario(null));
  };

  return (
    <section className="panel simulation-panel" aria-labelledby="simulation-title">
      <div className="panel-heading">
        <div><p className="eyebrow">REBALANCE LAB</p><h2 id="simulation-title">调仓模拟</h2></div>
        <span className="panel-meta">按顺序执行 · 固定价格</span>
      </div>

      <div className="trade-form">
        <label>方向<select value={side} onChange={(event) => setSide(event.target.value as TradeSide)}><option value="buy">买入</option><option value="sell">卖出</option></select></label>
        <label>标的<select value={symbol} onChange={(event) => setSymbol(event.target.value)}>{portfolio.instruments.map((instrument) => <option key={instrument.symbol} value={instrument.symbol}>{instrument.symbol} · {instrument.name}</option>)}</select></label>
        <label>数量<input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} placeholder="正整数" /></label>
        <button type="button" className="button button--secondary" onClick={addOperation}>加入操作</button>
      </div>
      {formError && <p className="inline-error" role="alert">{formError}</p>}

      <div className="operation-list">
        <div className="operation-list-heading"><strong>待模拟操作</strong><span>{operations.length} 笔</span></div>
        {operations.length > 0 ? operations.map((operation, index) => {
          const instrument = portfolio.instruments.find((item) => item.symbol === operation.symbol);
          return <div className="operation-row" key={`${operation.symbol}-${index}`}><span className="operation-order">{index + 1}</span><span className={operation.side === 'buy' ? 'side-buy' : 'side-sell'}>{operation.side === 'buy' ? '买入' : '卖出'}</span><strong>{instrument?.name ?? operation.symbol}</strong><span>{operation.quantity} 股</span><button type="button" className="icon-button" onClick={() => removeOperation(index)} aria-label={`删除第 ${index + 1} 笔操作`}>×</button></div>;
        }) : <p className="empty-copy">添加操作后，模拟结果会显示在这里。</p>}
      </div>

      <div className="simulation-actions"><button type="button" className="button button--primary" onClick={submitSimulation} disabled={submitting}>{submitting ? '处理中…' : '提交模拟'}</button>{simulationError && <p className="inline-error" role="alert">{simulationError}</p>}</div>

      {simulation && <SimulationComparison result={simulation} stale={simulationStale} />}

      <div className="scenario-save-row">
        <div><p className="eyebrow">SAVE SCENARIO</p><strong>保存当前方案</strong></div>
        <input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="例如：降低科技集中度" disabled={!simulation || simulationStale || submitting} />
        <button type="button" className="button button--secondary" onClick={saveCurrentScenario} disabled={!simulation || simulationStale || submitting}>保存方案</button>
      </div>
      {saveMessage && <p className="inline-message">{saveMessage}</p>}

      <div className="scenario-list">
        <div className="operation-list-heading"><div><p className="eyebrow">SAVED SCENARIOS</p><strong>已保存方案</strong></div><span>{scenarios.length} 个</span></div>
        {loadingScenarios ? <p className="empty-copy">正在加载方案列表…</p> : scenarioError ? <p className="inline-error" role="alert">{scenarioError}</p> : scenarios.length === 0 ? <p className="empty-copy">暂无保存方案。</p> : scenarios.map((scenario) => <div className="scenario-row" key={scenario.scenarioId}><div><strong>{scenario.name}</strong><span>{scenario.operationCount} 笔操作 · {formatSnapshotTime(scenario.createdAt)}</span></div><button type="button" className="button button--ghost" onClick={() => reopenScenario(scenario.scenarioId)} disabled={openingScenario !== null}>{openingScenario === scenario.scenarioId ? '打开中…' : '重新打开'}</button></div>)}
      </div>
    </section>
  );
}

function OverviewPage({ data, onRefresh }: { data: PortfolioOverview; onRefresh: () => void }) {
  return (
    <main className="page-shell">
      <header className="topbar"><div className="brand-mark">PF</div><div><p className="eyebrow">PORTFOLIO LAB</p><h1>投资组合分析</h1></div><button type="button" className="button button--ghost" onClick={onRefresh}>刷新数据</button></header>
      <section className="hero-card"><div><p className="eyebrow">{data.portfolio.portfolioId} · {data.portfolio.currency}</p><h2>{data.portfolio.name}</h2><p className="muted">行情快照 · {formatSnapshotTime(data.portfolio.snapshotAt)}</p></div><div className="hero-metrics"><div><span>组合总资产</span><strong><Money value={data.summary.totalAsset} /></strong></div><div><span>现金</span><strong><Money value={data.summary.cash} /></strong></div></div></section>
      <ConcentrationAlerts alerts={data.summary.alerts} />
      <section className="panel" aria-labelledby="holdings-title"><div className="panel-heading"><div><p className="eyebrow">HOLDINGS</p><h2 id="holdings-title">持仓明细</h2></div><span className="panel-meta">{data.summary.holdingCount} 个标的</span></div>{data.instruments.length > 0 ? <InstrumentTable instruments={data.instruments} /> : <p className="empty-copy">当前没有持仓数据。</p>}</section>
      <section className="panel" aria-labelledby="industry-title"><div className="panel-heading"><div><p className="eyebrow">INDUSTRY MIX</p><h2 id="industry-title">行业分布</h2></div><span className="panel-meta">现金不计入行业</span></div>{data.industries.length > 0 ? <IndustryTable industries={data.industries} /> : <p className="empty-copy">当前没有行业数据。</p>}</section>
      <RebalanceWorkspace portfolio={data} />
      <footer className="page-footer">快照 {data.portfolio.snapshotId} · 数据由后端统一计算</footer>
    </main>
  );
}

export default function App() {
  const [data, setData] = useState<PortfolioOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPortfolio = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetchPortfolio().then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '组合数据加载失败，请稍后重试')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadPortfolio(); }, [loadPortfolio]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={loadPortfolio} />;
  if (!data) return <ErrorState message="服务端没有返回组合数据。" onRetry={loadPortfolio} />;
  return <OverviewPage data={data} onRefresh={loadPortfolio} />;
}
