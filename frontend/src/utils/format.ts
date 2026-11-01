const dayTime = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric' })
const dayClock = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })

/** "Tue 3 PM" */
export function formatHour(d: Date): string {
  return dayTime.format(d).replace(',', '')
}

/** "Tue 3:42 PM" */
export function formatEta(iso: string | Date): string {
  return dayClock.format(typeof iso === 'string' ? new Date(iso) : iso).replace(',', '')
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} h ${m.toString().padStart(2, '0')} min` : `${m} min`
}

export function formatMiles(miles: number): string {
  return `${Math.round(miles).toLocaleString('en-US')} mi`
}

export function formatLb(lb: number): string {
  return `${Math.round(lb).toLocaleString('en-US')} lb`
}
