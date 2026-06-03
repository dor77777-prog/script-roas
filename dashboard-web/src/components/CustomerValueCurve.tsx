'use client';

/**
 * Wave 2 Task 8 — the zones LTV curve (port of the approved v3c mockup
 * `customer-value-v3c-zones.html` → `drawChart`).
 *
 * Renders an SVG cumulative-value curve over M0..M11 with:
 *  - a smooth Catmull-Rom line + accent gradient + soft glow,
 *  - a gradient area under the line,
 *  - two background zones split at the payback month — amber "still paying
 *    back" (left) / green "profit" (right),
 *  - a dashed nCAC break-even line,
 *  - a pulsing payback callout pill (white-on-accent → WCAG-AA),
 *  - a hover tooltip with a crosshair + dot.
 *
 * Token-driven (no hardcoded colours): the line/zones/labels resolve through
 * the project CSS variables (`--accent`, `--status-green*`, `--status-warning*`,
 * `--chart-grid-line`, `--chart-axis`, `--text*`, `--accent-fg`). Motion lives
 * in globals.css under the `cv-*` namespace so the project-wide
 * `prefers-reduced-motion` sweep collapses every animation to rest.
 *
 * CAPI-safe: pure presentation over already-aggregated Shopify cohort numbers.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { fmtMoneyCompact } from '@/lib/format';
import { Money } from '@/components/ui/Money';

const VIEW_W = 720;
const VIEW_H = 320;
const PAD = { l: 52, r: 18, t: 22, b: 36 };
/** The curve spans M0..M11 (12 points). The x-axis maps month 0..11. */
const LAST_MONTH = 11;

export interface CustomerValueCurveProps {
  /** Per-customer cumulative value at M0..M11 (net or profit, CAD). */
  points: number[];
  /** Break-even nCAC (CAD). null → no break-even line / payback / zones. */
  ncac: number | null;
  /**
   * Payback month_since (cumulative ≥ ncac), or null. When provided it pins the
   * zone split + callout; otherwise the component derives a crossing from the
   * points vs ncac (so the visual stays coherent if the headline is missing).
   */
  paybackMonths: number | null;
  /** Basis label for the tooltip ('רווח' | 'הכנסה'). */
  basisLabel: string;
}

/** Linear interpolation of the cumulative value at a fractional month. */
function valueAt(points: number[], m: number): number {
  if (points.length === 0) return 0;
  if (m <= 0) return points[0];
  if (m >= LAST_MONTH) return points[LAST_MONTH] ?? points[points.length - 1];
  const i = Math.floor(m);
  const f = m - i;
  const a = points[i] ?? 0;
  const b = points[i + 1] ?? a;
  return a + (b - a) * f;
}

/** Catmull-Rom → cubic-bezier smooth path through the points. */
function smoothPath(pts: Array<[number, number]>): string {
  if (pts.length === 0) return '';
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}

export function CustomerValueCurve({
  points,
  ncac,
  paybackMonths,
  basisLabel,
}: CustomerValueCurveProps) {
  const uid = useId().replace(/[:]/g, '');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const lineRef = useRef<SVGPathElement | null>(null);
  const [hover, setHover] = useState<{ m: number; v: number; px: number; py: number } | null>(null);

  const geo = useMemo(() => {
    const pad = PAD;
    const cur = points.length ? points : new Array(LAST_MONTH + 1).fill(0);
    const maxY = Math.max(...cur, ncac ?? 0, 1) * 1.12;
    const x = (m: number) => pad.l + (m / LAST_MONTH) * (VIEW_W - pad.l - pad.r);
    const y = (v: number) => VIEW_H - pad.b - (v / maxY) * (VIEW_H - pad.t - pad.b);
    const plotL = pad.l;
    const plotR = VIEW_W - pad.r;
    const plotT = pad.t;
    const plotB = VIEW_H - pad.b;

    const P: Array<[number, number]> = cur.map((v, m) => [x(m), y(v)]);
    const linePath = smoothPath(P);
    const areaPath =
      linePath +
      ` L ${x(LAST_MONTH).toFixed(2)} ${plotB.toFixed(2)} L ${x(0).toFixed(2)} ${plotB.toFixed(2)} Z`;

    // Payback x: prefer the headline paybackMonths; else derive a crossing.
    let pbx: number | null = null;
    if (ncac != null && ncac > 0) {
      if (paybackMonths != null && paybackMonths >= 0) {
        pbx = paybackMonths;
      } else {
        for (let m = 1; m < cur.length; m++) {
          if (cur[m] >= ncac) {
            const t = (ncac - cur[m - 1]) / (cur[m] - cur[m - 1] || 1);
            pbx = m - 1 + t;
            break;
          }
        }
      }
    }
    const cacY = ncac != null ? y(ncac) : null;
    const pbX = pbx != null ? x(pbx) : null;

    return { cur, maxY, x, y, plotL, plotR, plotT, plotB, linePath, areaPath, pbx, pbX, cacY };
  }, [points, ncac, paybackMonths]);

  // Seed the draw-in dash length AFTER mount (getTotalLength is a no-op /
  // missing under jsdom — guard so the test environment never throws).
  useEffect(() => {
    const el = lineRef.current;
    if (!el || typeof el.getTotalLength !== 'function') return;
    try {
      const len = el.getTotalLength();
      if (len > 0) el.style.setProperty('--cv-line-len', String(len));
    } catch {
      /* jsdom / unsupported — leave the CSS fallback length. */
    }
  }, [geo.linePath]);

  const { cur, x, y, plotL, plotR, plotT, plotB, linePath, areaPath, pbx, pbX, cacY } = geo;

  function handleMove(evt: React.PointerEvent<SVGRectElement> | React.MouseEvent<SVGRectElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const sx = ((evt.clientX - rect.left) / rect.width) * VIEW_W;
    let m = ((sx - plotL) / (plotR - plotL)) * LAST_MONTH;
    m = Math.max(0, Math.min(LAST_MONTH, m));
    const v = valueAt(cur, m);
    setHover({ m, v, px: x(m), py: y(v) });
  }
  function handleLeave() {
    setHover(null);
  }

  // ── Tooltip CSS position (svg viewBox → % of the rendered box) ───────────
  const tipLeftPct = hover ? (hover.px / VIEW_W) * 100 : 0;
  const tipTopPct = hover ? (hover.py / VIEW_H) * 100 : 0;
  const hoverProfitable = hover != null && ncac != null && hover.v >= ncac;

  const gid = `cv-gline-${uid}`;
  const gid2 = `cv-garea-${uid}`;
  const glow = `cv-glow-${uid}`;

  // Payback callout pill geometry (kept inside the plot).
  const pill = useMemo(() => {
    if (pbX == null || cacY == null) return null;
    const w = 122;
    const h = 38;
    let px = pbX - w / 2;
    px = Math.max(plotL + 4, Math.min(px, plotR - w - 4));
    let py = cacY - h - 18;
    if (py < plotT + 2) py = cacY + 16;
    return { w, h, px, py, cx: px + w / 2, tailY: py > cacY ? py : py + h };
  }, [pbX, cacY, plotL, plotR, plotT]);

  const showWarnLabel = pbX != null && pbX - plotL > 70;
  const warnCx = pbX != null ? (plotL + pbX) / 2 : 0;
  const goodCx = pbX != null ? (pbX + plotR) / 2 : 0;

  // Profit wedge between curve and nCAC, right of payback.
  const wedgePath = useMemo(() => {
    if (pbx == null || cacY == null) return null;
    let w = `M ${(x(pbx)).toFixed(2)} ${cacY.toFixed(2)} `;
    for (let mm = pbx; mm < LAST_MONTH; mm += 0.5) {
      w += `L ${x(mm).toFixed(2)} ${y(valueAt(cur, mm)).toFixed(2)} `;
    }
    w += `L ${x(LAST_MONTH).toFixed(2)} ${y(cur[LAST_MONTH] ?? 0).toFixed(2)} `;
    w += `L ${x(LAST_MONTH).toFixed(2)} ${cacY.toFixed(2)} Z`;
    return w;
  }, [pbx, cacY, cur, x, y]);

  return (
    <div data-testid="cv-curve" className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label="עקומת שווי לקוח לאורך זמן"
        className="block h-auto w-full"
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.75" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="1" />
          </linearGradient>
          <linearGradient id={gid2} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.32" />
            <stop offset="0.55" stopColor="var(--accent)" stopOpacity="0.10" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          <filter id={glow} x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Plot scrim — neutral so the coloured zones never collide with the
            card surface. */}
        <rect
          x={plotL}
          y={plotT}
          width={(plotR - plotL).toFixed(2)}
          height={(plotB - plotT).toFixed(2)}
          rx={10}
          fill="var(--chart-grid-line)"
          opacity={0.5}
        />

        {/* Background zones split at payback. */}
        {pbX != null && (
          <>
            <rect
              className="cv-anim-zone"
              x={plotL}
              y={plotT}
              width={(pbX - plotL).toFixed(2)}
              height={(plotB - plotT).toFixed(2)}
              fill="var(--status-warning-bg)"
            />
            <rect
              className="cv-anim-zone"
              x={pbX.toFixed(2)}
              y={plotT}
              width={(plotR - pbX).toFixed(2)}
              height={(plotB - plotT).toFixed(2)}
              fill="var(--status-green-bg)"
            />
          </>
        )}

        {/* y gridlines + $ labels */}
        {[0, 1, 2, 3, 4].map((i) => {
          const v = (geo.maxY * i) / 4;
          return (
            <g key={`y${i}`}>
              <line
                x1={plotL}
                y1={y(v).toFixed(2)}
                x2={plotR}
                y2={y(v).toFixed(2)}
                stroke="var(--chart-grid-line)"
              />
              <text
                x={plotL - 7}
                y={(y(v) + 3).toFixed(2)}
                textAnchor="end"
                fill="var(--chart-axis)"
                fontSize="11"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {fmtMoneyCompact(Math.round(v))}
              </text>
            </g>
          );
        })}

        {/* x labels */}
        {[0, 2, 4, 6, 8, 10].map((m) => (
          <text
            key={`x${m}`}
            x={x(m).toFixed(2)}
            y={(plotB + 17).toFixed(2)}
            textAnchor="middle"
            fill="var(--chart-axis)"
            fontSize="11"
          >
            {m === 0 ? 'רכישה' : `ח׳ ${m}`}
          </text>
        ))}

        {/* Zone labels (RTL Hebrew) */}
        {showWarnLabel && (
          <text
            className="cv-anim-zone"
            x={warnCx.toFixed(2)}
            y={(plotT + 16).toFixed(2)}
            textAnchor="middle"
            fill="var(--status-warning-fg)"
            fontSize="12"
            fontWeight={800}
          >
            עדיין מחזיר עלות
          </text>
        )}
        {pbX != null && (
          <text
            className="cv-anim-zone"
            x={goodCx.toFixed(2)}
            y={(plotT + 16).toFixed(2)}
            textAnchor="middle"
            fill="var(--status-green-fg)"
            fontSize="12"
            fontWeight={800}
          >
            רווח
          </text>
        )}

        {/* Gradient area under the whole curve */}
        <path className="cv-anim-area" d={areaPath} fill={`url(#${gid2})`} />

        {/* Profit wedge (curve ↔ nCAC, right of payback) */}
        {wedgePath && (
          <path className="cv-anim-zone" d={wedgePath} fill="var(--status-green)" fillOpacity={0.16} />
        )}

        {/* Break-even dashed nCAC line */}
        {cacY != null && ncac != null && (
          <>
            <line
              x1={plotL}
              y1={cacY.toFixed(2)}
              x2={plotR}
              y2={cacY.toFixed(2)}
              stroke="var(--status-warning)"
              strokeWidth={2}
              strokeDasharray="6 5"
            />
            <text
              x={plotR}
              y={(cacY - 7).toFixed(2)}
              textAnchor="end"
              fill="var(--status-warning-fg)"
              fontSize="11"
              fontWeight={800}
            >
              קו עלות-גיוס {fmtMoneyCompact(Math.round(ncac))}
            </text>
          </>
        )}

        {/* The glowing animated line */}
        <path
          ref={lineRef}
          className="cv-anim-line"
          d={linePath}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth={3.4}
          strokeLinejoin="round"
          strokeLinecap="round"
          filter={`url(#${glow})`}
        />

        {/* Payback marker + pulsing ring + callout */}
        {pbX != null && cacY != null && pill && (
          <>
            <line
              x1={pbX.toFixed(2)}
              y1={cacY.toFixed(2)}
              x2={pbX.toFixed(2)}
              y2={plotB.toFixed(2)}
              stroke="var(--accent)"
              strokeDasharray="3 4"
              opacity={0.5}
            />
            <circle
              className="cv-pulse"
              cx={pbX.toFixed(2)}
              cy={cacY.toFixed(2)}
              r={6}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
            />
            <circle
              className="cv-anim-mark"
              cx={pbX.toFixed(2)}
              cy={cacY.toFixed(2)}
              r={6}
              fill="var(--accent)"
              stroke="var(--glass-1)"
              strokeWidth={2.5}
            />
            <g className="cv-anim-callout" data-testid="cv-payback-callout">
              <line
                x1={pill.cx.toFixed(2)}
                y1={pill.tailY.toFixed(2)}
                x2={pbX.toFixed(2)}
                y2={cacY.toFixed(2)}
                stroke="var(--accent)"
                strokeWidth={1.5}
                opacity={0.55}
              />
              <rect
                x={pill.px.toFixed(2)}
                y={pill.py.toFixed(2)}
                width={pill.w}
                height={pill.h}
                rx={9}
                fill="var(--accent)"
              />
              <text
                x={pill.cx.toFixed(2)}
                y={(pill.py + 15).toFixed(2)}
                textAnchor="middle"
                fill="var(--accent-fg)"
                fontSize="11.5"
                fontWeight={800}
              >
                ↩ נקודת החזר
              </text>
              <text
                x={pill.cx.toFixed(2)}
                y={(pill.py + 29).toFixed(2)}
                textAnchor="middle"
                fill="var(--accent-fg)"
                fontSize="10.5"
                fontWeight={700}
                opacity={0.92}
              >
                חודש {pbx != null ? Math.round(pbx * 10) / 10 : ''}
              </text>
            </g>
          </>
        )}

        {/* Hover crosshair + dot */}
        {hover && (
          <>
            <line
              x1={hover.px.toFixed(2)}
              y1={plotT}
              x2={hover.px.toFixed(2)}
              y2={plotB.toFixed(2)}
              stroke="var(--accent)"
              strokeWidth={1}
              opacity={0.45}
            />
            <circle
              cx={hover.px.toFixed(2)}
              cy={hover.py.toFixed(2)}
              r={5}
              fill="var(--accent)"
              stroke="var(--glass-1)"
              strokeWidth={2}
            />
          </>
        )}

        {/* Transparent capture rect for hover */}
        <rect
          x={plotL}
          y={plotT}
          width={(plotR - plotL).toFixed(2)}
          height={(plotB - plotT).toFixed(2)}
          fill="transparent"
          style={{ cursor: 'crosshair' }}
          onPointerMove={handleMove}
          onPointerLeave={handleLeave}
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
        />
      </svg>

      {/* Hover tooltip — glass scrim, AA text on neutral surface. */}
      {hover && (
        <div
          data-testid="cv-curve-tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[118%] rounded-[10px] border border-glass-edge bg-glass-2/90 px-2.5 py-1.5 text-xs leading-snug text-ink shadow-glass backdrop-blur"
          style={{ left: `${tipLeftPct}%`, top: `${tipTopPct}%` }}
        >
          <div className="text-[11px] font-semibold text-ink-muted">
            {hover.m < 0.5 ? 'רכישה' : `חודש ${Math.round(hover.m)}`}
          </div>
          <div className="text-sm font-bold">
            <Money value={Math.round(hover.v)} />
          </div>
          {ncac != null && (
            <div
              className={
                hoverProfitable
                  ? 'text-[11px] font-bold text-status-greenFg'
                  : 'text-[11px] font-bold text-status-warningFg'
              }
            >
              {hoverProfitable ? `מעל קו האיזון — ${basisLabel}` : 'מתחת לקו — מחזיר עלות'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
