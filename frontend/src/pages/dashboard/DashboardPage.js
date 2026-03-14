import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Line, Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js';
import { dashboardAPI, ledgerAPI } from '../../services/api';
import { KPICard, Badge, Card, CardHeader, AlertBanner, PageHeader, Spinner, EmptyState } from '../../components/common/UI';
import { useSocket } from '../../context/SocketContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler);

// Plugin: draw numbers outside doughnut slices
const outsideLabelPlugin = {
  id: 'outsideLabels',
  afterDatasetDraw(chart) {
    const { ctx, data } = chart;
    const dataset = chart.getDatasetMeta(0);
    const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
    if (!total) return;
    dataset.data.forEach((arc, i) => {
      const val = data.datasets[0].data[i];
      if (!val) return;
      const { x, y, startAngle, endAngle, outerRadius } = arc.getProps(['x', 'y', 'startAngle', 'endAngle', 'outerRadius'], true);
      const midAngle = (startAngle + endAngle) / 2;
      const r = outerRadius + 18;
      const lx = x + Math.cos(midAngle) * r;
      const ly = y + Math.sin(midAngle) * r;
      ctx.save();
      ctx.font = 'bold 11px Plus Jakarta Sans';
      ctx.fillStyle = data.datasets[0].backgroundColor[i];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(val, lx, ly);
      ctx.restore();
    });
  },
};

// Plugin: draw total in center of doughnut
const centerTextPlugin = {
  id: 'centerText',
  beforeDraw(chart) {
    if (chart.config.type !== 'doughnut') return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const total = chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    ctx.save();
    ctx.font = 'bold 20px Plus Jakarta Sans';
    ctx.fillStyle = '#f0f4ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(total, cx, cy - 8);
    ctx.font = '10px Plus Jakarta Sans';
    ctx.fillStyle = '#4a5778';
    ctx.fillText('total ops', cx, cy + 10);
    ctx.restore();
  },
};

ChartJS.register(outsideLabelPlugin, centerTextPlugin);

const TYPE_COLOR = { RECEIPT: '#10b981', DELIVERY: '#ef4444', TRANSFER_IN: '#3b82f6', TRANSFER_OUT: '#8b5cf6', ADJUSTMENT: '#f59e0b' };
const TYPE_ICON  = { RECEIPT: '↓', DELIVERY: '↑', TRANSFER_IN: '⇥', TRANSFER_OUT: '⇤', ADJUSTMENT: '±' };

// Build last-7-days labels
function getLast7Days() {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return days[d.getDay()];
  });
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { stockEvents } = useSocket();
  const [kpis, setKpis] = useState(null);
  const [lowStock, setLowStock] = useState([]);
  const [activity, setActivity] = useState([]);
  const [allLedger, setAllLedger] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [k, l, a, led] = await Promise.all([
        dashboardAPI.getKPIs(),
        dashboardAPI.getLowStock(),
        dashboardAPI.getActivity(),
        ledgerAPI.getAll({ limit: 200 }),
      ]);
      setKpis(k.data.data);
      setLowStock(l.data.data);
      setActivity(a.data.data);
      setAllLedger(led.data.data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (stockEvents.length) load(); }, [stockEvents, load]);

  // ── Line chart: real per-day totals for last 7 days ──────────────────
  const labels = getLast7Days();
  const inData = Array(7).fill(0);
  const outData = Array(7).fill(0);
  allLedger.forEach(entry => {
    const d = new Date(entry.createdAt);
    const today = new Date();
    const diffDays = Math.floor((today - d) / 86400000);
    const idx = 6 - diffDays;
    if (idx < 0 || idx > 6) return;
    if (entry.quantity > 0) inData[idx] += entry.quantity;
    else outData[idx] += Math.abs(entry.quantity);
  });

  const lineData = {
    labels,
    datasets: [
      { label: 'Stock In',  data: inData,  borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#10b981', borderWidth: 2 },
      { label: 'Stock Out', data: outData, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)',  fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#ef4444', borderWidth: 2 },
    ],
  };
  const lineOpts = {
    responsive: true, animation: false,
    plugins: {
      legend: { labels: { color: '#8896b3', font: { size: 11, family: 'Plus Jakarta Sans' }, boxWidth: 12, padding: 16 } },
      tooltip: {
        backgroundColor: '#1a2540', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
        titleColor: '#f0f4ff', bodyColor: '#8896b3',
        callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} units` },
      },
    },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4a5778', font: { size: 11 } } },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#4a5778', font: { size: 11 } }, beginAtZero: true },
    },
  };

  // ── Doughnut: real operation counts ──────────────────────────────────
  const rcptCount = allLedger.filter(a => a.type === 'RECEIPT').length;
  const dlvCount  = allLedger.filter(a => a.type === 'DELIVERY').length;
  const trfCount  = allLedger.filter(a => a.type === 'TRANSFER_IN' || a.type === 'TRANSFER_OUT').length;
  const adjCount  = allLedger.filter(a => a.type === 'ADJUSTMENT').length;

  const donutData = {
    labels: ['Receipts', 'Deliveries', 'Transfers', 'Adjustments'],
    datasets: [{
      data: [rcptCount || 0, dlvCount || 0, trfCount || 0, adjCount || 0],
      backgroundColor: ['#10b981', '#ef4444', '#3b82f6', '#f59e0b'],
      borderWidth: 0, hoverOffset: 6,
    }],
  };
  const donutOpts = {
    responsive: true,
    layout: { padding: 24 },
    plugins: {
      legend: { position: 'bottom', labels: { color: '#8896b3', font: { size: 11, family: 'Plus Jakarta Sans' }, padding: 12, boxWidth: 10 } },
      tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } },
    },
    cutout: '62%',
    animation: false,
  };

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}><Spinner size={36} /></div>;

  const totalIn  = inData.reduce((a, b) => a + b, 0);
  const totalOut = outData.reduce((a, b) => a + b, 0);

  return (
    <div className="animate-fadeUp">
      <PageHeader title="Dashboard" subtitle="Real-time inventory overview" />

      {lowStock.length > 0 && (
        <AlertBanner type="warning">
          <strong>{lowStock.length} product{lowStock.length > 1 ? 's' : ''}</strong> at or below reorder level —{' '}
          <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => navigate('/products')}>review now →</span>
        </AlertBanner>
      )}

      {/* KPIs */}
      <div className="stagger" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 12, marginBottom: 24 }}>
        <KPICard label="Products"          value={kpis?.totalProducts}      icon="◫" accent="var(--accent)"  onClick={() => navigate('/products')} />
        <KPICard label="Low Stock"         value={kpis?.lowStockCount}       icon="⚠" accent="var(--amber)"  delta="needs reorder" onClick={() => navigate('/products')} />
        <KPICard label="Out of Stock"      value={kpis?.outOfStockCount}     icon="✕" accent="var(--red)"    onClick={() => navigate('/products')} />
        <KPICard label="Pending Receipts"  value={kpis?.pendingReceipts}     icon="↓" accent="var(--green)"  onClick={() => navigate('/receipts')} />
        <KPICard label="Pending Deliveries" value={kpis?.pendingDeliveries}  icon="↑" accent="var(--purple)" onClick={() => navigate('/deliveries')} />
        <KPICard label="Active Transfers"  value={kpis?.scheduledTransfers}  icon="⇄" accent="var(--cyan)"   onClick={() => navigate('/transfers')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 320px', gap: 16 }}>

        {/* Line chart */}
        <Card>
          <CardHeader
            title="Stock Movement"
            subtitle="Last 7 days — incoming vs outgoing"
            actions={
              <div style={{ display: 'flex', gap: 12 }}>
                <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 700 }}>+{totalIn} in</span>
                <span style={{ fontSize: 11, color: 'var(--red)',   fontWeight: 700 }}>−{totalOut} out</span>
              </div>
            }
          />
          <div style={{ padding: 16 }}><Line data={lineData} options={lineOpts} height={110} /></div>
        </Card>

        {/* Activity feed */}
        <Card>
          <CardHeader title="Recent Activity" actions={<span style={{ fontSize: 11, color: 'var(--text-accent)', cursor: 'pointer' }} onClick={() => navigate('/history')}>View all →</span>} />
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {activity.length === 0
              ? <EmptyState icon="≡" title="No activity yet" subtitle="Operations will appear here" />
              : activity.slice(0, 8).map((item, i) => (
                <div key={item._id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', animation: `fadeUp 0.3s ease ${i * 0.05}s both` }}>
                  <div style={{ width: 30, height: 30, borderRadius: 8, background: (TYPE_COLOR[item.type] || '#4a5778') + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: TYPE_COLOR[item.type] || '#4a5778', fontWeight: 700, flexShrink: 0, border: `1px solid ${(TYPE_COLOR[item.type] || '#4a5778')}25` }}>
                    {TYPE_ICON[item.type] || '·'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.product?.name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {item.warehouse?.name}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{item.type?.replace(/_/g, ' ')} · {item.referenceRef || '—'}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: item.quantity > 0 ? 'var(--green)' : 'var(--red)', flexShrink: 0, fontFamily: 'var(--mono)' }}>
                    {item.quantity > 0 ? '+' : ''}{item.quantity}
                  </div>
                </div>
              ))}
          </div>
        </Card>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <CardHeader title="Operation Mix" subtitle="All-time by type" />
            <div style={{ padding: '8px 12px 12px' }}>
              <Doughnut data={donutData} options={donutOpts} />
            </div>
          </Card>

          {lowStock.length > 0 && (
            <Card>
              <CardHeader title="Low Stock Alert" />
              {lowStock.slice(0, 5).map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 16px', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{item.product?.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{item.product?.sku} · {item.totalQty} left</div>
                  </div>
                  <Badge status={item.totalQty === 0 ? 'out' : 'low'}>{item.totalQty === 0 ? 'Out' : 'Low'}</Badge>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
