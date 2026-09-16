/* Decorative mini-visuals for the hero poster and demo card thumbnails. Pure SVG/CSS, no data lib. */

const line = (pts: number[], w: number, h: number) => {
  const lo = Math.min(...pts), hi = Math.max(...pts)
  return pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - ((v - lo) / (hi - lo || 1)) * (h - 6) - 3}`).join(' ')
}

export function HeroPoster() {
  const demand = [62, 58, 71, 69, 80, 84, 79, 93, 97, 104, 99, 112]
  const fc = [null, null, null, null, null, null, null, null, 97, 106, 111, 118]
  const w = 300, h = 70
  return (
    <div className="hero-poster" aria-hidden>
      <div className="chrome"><i /><i /><i /><span>stockline · purchasing console</span></div>
      <div className="poster-grid">
        <div className="poster-tile"><small>Active SKUs</small><strong>1,642</strong><em>▲ 93.4% instock</em></div>
        <div className="poster-tile"><small>Reorder alerts</small><strong>27</strong><em style={{ color: 'var(--warn)' }}>9 under 14d cover</em></div>
        <div className="poster-tile poster-chart">
          <small>Demand vs forecast · units / month</small>
          <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ marginTop: 6 }}>
            <polyline points={line(demand, w, h)} fill="none" stroke="#ee5a2b" strokeWidth="2" />
            <polyline points={line(fc.map((v, i) => v ?? demand[i]), w, h)} fill="none" stroke="#fafafa" strokeWidth="1.5" strokeDasharray="4 3" opacity=".7" />
            <line x1={(8 / 11) * w} x2={(8 / 11) * w} y1="0" y2={h} stroke="#ffffff44" strokeDasharray="2 2" />
          </svg>
        </div>
        <div className="poster-log">
          <div><b>✓</b> 02:00 shopify.sync — 1,642 variants, 0 conflicts</div>
          <div><b>✓</b> 02:07 forecast.rebuild — 12-mo horizon, MAPE 8.9%</div>
          <div><b>✓</b> 02:08 reorder.alerts — 27 SKUs flagged → #purchasing</div>
          <div><span style={{ color: 'var(--warn)' }}>!</span> 02:08 PO-2618 awaiting admin approval <span className="cursor" /></div>
        </div>
      </div>
    </div>
  )
}

