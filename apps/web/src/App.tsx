import { useCallback, useEffect, useState } from 'react';
import { fetchPortfolio, type IndustryAnalysis, type InstrumentAnalysis, type PortfolioOverview } from './api';

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
          <tr>
            <th>标的</th>
            <th>行业</th>
            <th>价格</th>
            <th>持仓</th>
            <th>市值</th>
            <th>占比</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {instruments.map((instrument) => (
            <tr key={instrument.symbol}>
              <td>
                <div className="primary-cell">{instrument.name}</div>
                <div className="secondary-cell">{instrument.symbol}</div>
              </td>
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
          <tr>
            <th>行业</th>
            <th>市值</th>
            <th>占比</th>
            <th>阈值</th>
            <th>状态</th>
          </tr>
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
        <div>
          <p className="eyebrow">CONCENTRATION CHECK</p>
          <h2 id="alert-title">集中度提醒</h2>
        </div>
        <span className={alerts.length > 0 ? 'alert-count alert-count--danger' : 'alert-count alert-count--safe'}>
          {alerts.length > 0 ? `${alerts.length} 项超限` : '全部正常'}
        </span>
      </div>
      {alerts.length > 0 ? (
        <div className="alert-list">
          {alerts.map((alert) => (
            <div className="alert-item" key={`${alert.type}-${alert.key}`}>
              <span className="alert-icon" aria-hidden="true">!</span>
              <div>
                <strong>{alert.label}</strong>
                <p>{alert.type === 'instrument' ? '单一标的' : '行业'}占比 {alert.ratioPercent}%，超过阈值 {alert.thresholdPercent}%</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-alert">
          <span className="success-icon" aria-hidden="true">✓</span>
          <div>
            <strong>当前没有集中度超限项</strong>
            <p>单一标的阈值为 30%，行业阈值为 50%。</p>
          </div>
        </div>
      )}
    </section>
  );
}

function LoadingState() {
  return (
    <main className="page-shell state-shell">
      <div className="loading-card" role="status">
        <span className="spinner" aria-hidden="true" />
        <div>
          <strong>正在加载组合快照</strong>
          <p>正在读取最新的固定行情数据。</p>
        </div>
      </div>
    </main>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="page-shell state-shell">
      <div className="error-card" role="alert">
        <span className="error-icon" aria-hidden="true">!</span>
        <div>
          <strong>组合数据加载失败</strong>
          <p>{message}</p>
          <button type="button" className="button button--primary" onClick={onRetry}>重新加载</button>
        </div>
      </div>
    </main>
  );
}

function OverviewPage({ data, onRefresh }: { data: PortfolioOverview; onRefresh: () => void }) {
  return (
    <main className="page-shell">
      <header className="topbar">
        <div className="brand-mark">PF</div>
        <div>
          <p className="eyebrow">PORTFOLIO LAB</p>
          <h1>投资组合分析</h1>
        </div>
        <button type="button" className="button button--ghost" onClick={onRefresh}>刷新数据</button>
      </header>

      <section className="hero-card">
        <div>
          <p className="eyebrow">{data.portfolio.portfolioId} · {data.portfolio.currency}</p>
          <h2>{data.portfolio.name}</h2>
          <p className="muted">行情快照 · {formatSnapshotTime(data.portfolio.snapshotAt)}</p>
        </div>
        <div className="hero-metrics">
          <div>
            <span>组合总资产</span>
            <strong><Money value={data.summary.totalAsset} /></strong>
          </div>
          <div>
            <span>现金</span>
            <strong><Money value={data.summary.cash} /></strong>
          </div>
        </div>
      </section>

      <ConcentrationAlerts alerts={data.summary.alerts} />

      <section className="panel" aria-labelledby="holdings-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">HOLDINGS</p>
            <h2 id="holdings-title">持仓明细</h2>
          </div>
          <span className="panel-meta">{data.summary.holdingCount} 个标的</span>
        </div>
        {data.instruments.length > 0 ? <InstrumentTable instruments={data.instruments} /> : <p className="empty-copy">当前没有持仓数据。</p>}
      </section>

      <section className="panel" aria-labelledby="industry-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">INDUSTRY MIX</p>
            <h2 id="industry-title">行业分布</h2>
          </div>
          <span className="panel-meta">现金不计入行业</span>
        </div>
        {data.industries.length > 0 ? <IndustryTable industries={data.industries} /> : <p className="empty-copy">当前没有行业数据。</p>}
      </section>

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
    void fetchPortfolio()
      .then(setData)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : '组合数据加载失败，请稍后重试');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  if (loading) {
    return <LoadingState />;
  }
  if (error) {
    return <ErrorState message={error} onRetry={loadPortfolio} />;
  }
  if (!data) {
    return <ErrorState message="服务端没有返回组合数据。" onRetry={loadPortfolio} />;
  }
  return <OverviewPage data={data} onRefresh={loadPortfolio} />;
}
