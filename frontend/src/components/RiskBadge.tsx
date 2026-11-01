import { levelName, riskCssVar } from '../utils/risk'

/** Risk level as colour dot + text (never colour alone). */
export default function RiskBadge({ level }: { level: number }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-badge border border-line bg-surface-2 px-2.5 text-xs font-semibold text-fg">
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ background: riskCssVar(level) }}
      />
      {levelName(level)}
    </span>
  )
}
