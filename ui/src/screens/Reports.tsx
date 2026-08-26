import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';
import { useApi } from '../lib/api';
import { titleCase } from '../lib/format';
import { Panel, StatTile, Empty, ErrorState, Skeleton } from '../components/primitives';

interface ReportsData {
  rates: { successRate: number; responseRate: number; interviewRate: number; offerRate: number };
  overTime: { date: string; applications: number }[];
  byStatus: { name: string; value: number }[];
  topSkills: { skill: string; pct: number }[];
  bySource: { source: string; discovered: number; qualified: number }[];
}

/**
 * Outcome colours are a STATUS palette, not a categorical one: each hue is
 * bound to a meaning and never reassigned. Validated against the #14141c chart
 * surface for lightness band, chroma, colour-vision separation and contrast --
 * worst adjacent pair is 8.5 deltaE under protanopia. Every slice is also
 * labelled, so identity never rests on colour alone.
 */
const OUTCOME_FILL: Record<string, string> = {
  awaiting: '#6366f1',
  acknowledged: '#0e97c4',
  screening: '#bf8b0c',
  interview: '#06a172',
  offer: '#d946ef',
  rejected: '#f43f5e',
};

const VIOLET = '#7c5cff';
const AXIS = '#6e6e88';
const GRID = '#262633';

const tooltipStyle = {
  background: '#1b1b26',
  border: '1px solid #33334a',
  borderRadius: 10,
  fontSize: 12,
  color: '#e8e8f0',
};

export function Reports() {
  const { data, error, loading, reload } = useApi<ReportsData>('/api/reports');

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton rows={8} />;
  if (!data) return null;

  const totalOutcomes = data.byStatus.reduce((n, s) => n + s.value, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="mt-1 text-xs text-ink-dim">
          Every rate below is measured against applications actually sent, so they stay at zero until the
          pipeline submits something.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Moved forward" value={`${data.rates.successRate}%`} tone="violet" />
        <StatTile label="Replied at all" value={`${data.rates.responseRate}%`} tone="info" />
        <StatTile label="Reached interview" value={`${data.rates.interviewRate}%`} tone="warn" />
        <StatTile label="Received an offer" value={`${data.rates.offerRate}%`} tone="good" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel eyebrow="Volume" title="Applications over time">
          {data.overTime.length < 2 ? (
            <Empty
              title="Not enough history to plot"
              hint="A trend needs at least two days with applications. It appears here as soon as there are."
            />
          ) : (
            <div className="h-64 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.overTime} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="date" stroke={AXIS} tickLine={false} axisLine={false}
                    tick={{ fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  />
                  <YAxis
                    stroke={AXIS} tickLine={false} axisLine={false} allowDecimals={false}
                    tick={{ fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ stroke: GRID }}
                    formatter={(v) => [Number(v), 'Applications']}
                  />
                  <Line
                    type="monotone" dataKey="applications" stroke={VIOLET} strokeWidth={2}
                    dot={{ r: 4, fill: VIOLET, stroke: '#14141c', strokeWidth: 2 }}
                    activeDot={{ r: 6, fill: VIOLET, stroke: '#14141c', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel eyebrow="Outcomes" title="Where applications ended up">
          {totalOutcomes === 0 ? (
            <Empty
              title="No outcomes to break down"
              hint="Each application lands in one state. The split appears once there is at least one."
            />
          ) : (
            <div className="flex flex-wrap items-center gap-4 p-4">
              <div className="h-52 w-52 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.byStatus} dataKey="value" nameKey="name"
                      innerRadius={54} outerRadius={80} paddingAngle={2} stroke="#14141c" strokeWidth={2}
                    >
                      {data.byStatus.map((s) => (
                        <Cell key={s.name} fill={OUTCOME_FILL[s.name] ?? '#6e6e88'} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v, n) => [`${Number(v)} (${Math.round((Number(v) / totalOutcomes) * 100)}%)`, titleCase(String(n))]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Legend is not optional here: colour alone must never carry the outcome. */}
              <ul className="min-w-40 flex-1 space-y-1.5">
                {data.byStatus.map((s) => (
                  <li key={s.name} className="flex items-center gap-2 text-xs">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: OUTCOME_FILL[s.name] ?? '#6e6e88' }}
                    />
                    <span className="flex-1 text-ink-dim">{titleCase(s.name)}</span>
                    <span className="tabular text-ink-faint">{s.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel eyebrow="Demand" title="Skills employers ask for">
          {data.topSkills.length === 0 ? (
            <Empty
              title="No descriptions scored yet"
              hint="This reads the descriptions of jobs that cleared your score threshold."
            />
          ) : (
            <div className="p-4" style={{ height: Math.max(200, data.topSkills.length * 34 + 24) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.topSkills} layout="vertical" barSize={12} barCategoryGap={6}
                  margin={{ top: 4, right: 36, bottom: 4, left: 4 }}
                >
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} hide />
                  <YAxis
                    type="category" dataKey="skill" width={92} stroke={AXIS}
                    tickLine={false} axisLine={false} tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: '#ffffff08' }}
                    formatter={(v) => [`${Number(v)}% of matching jobs`, 'Mentions']}
                  />
                  <Bar dataKey="pct" fill={VIOLET} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel eyebrow="Sources" title="Where the jobs come from">
          {data.bySource.length === 0 ? (
            <Empty title="No sources polled yet" hint="Run discovery to populate this." />
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="eyebrow border-b border-hairline">
                  <th className="px-5 py-2.5 font-normal">Source</th>
                  <th className="px-3 py-2.5 text-right font-normal">Discovered</th>
                  <th className="px-3 py-2.5 text-right font-normal">Qualified</th>
                  <th className="px-5 py-2.5 text-right font-normal">Hit rate</th>
                </tr>
              </thead>
              <tbody>
                {data.bySource.map((s) => (
                  <tr key={s.source} className="border-b border-hairline/60 last:border-0">
                    <td className="px-5 py-2.5 text-ink">{s.source}</td>
                    <td className="tabular px-3 py-2.5 text-right text-ink-dim">{s.discovered.toLocaleString()}</td>
                    <td className="tabular px-3 py-2.5 text-right text-ink-dim">{s.qualified.toLocaleString()}</td>
                    <td className="tabular px-5 py-2.5 text-right text-ink-faint">
                      {s.discovered === 0 ? '--' : `${Math.round((s.qualified / s.discovered) * 100)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
