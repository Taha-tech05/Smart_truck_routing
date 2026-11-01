import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

export type Snap = 'peek' | 'half' | 'full'

interface Props {
  snap: Snap
  onSnapChange: (s: Snap) => void
  children: ReactNode
}

export const PEEK_PX = 132

function heights(): Record<Snap, number> {
  const h = window.innerHeight
  return { peek: PEEK_PX, half: Math.round(h * 0.5), full: Math.round(h * 0.9) }
}

function publish(px: number) {
  document.documentElement.style.setProperty('--sheet-h', `${Math.round(px)}px`)
}

/**
 * Mobile bottom sheet with three snap heights (peek / half / full) and a drag handle.
 * The visible height is published as the CSS variable --sheet-h so other floating UI can sit above it.
 */
export default function BottomSheet({ snap, onSnapChange, children }: Props) {
  const [height, setHeight] = useState(() => heights()[snap])
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ startY: number; startH: number } | null>(null)

  // follow snap prop / viewport changes
  useEffect(() => {
    const apply = () => {
      const h = heights()[snap]
      setHeight(h)
      publish(h)
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [snap])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { startY: e.clientY, startH: height }
      setDragging(true)
    },
    [height],
  )

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current) return
    const { full } = heights()
    const next = Math.min(full, Math.max(PEEK_PX, drag.current.startH + (drag.current.startY - e.clientY)))
    setHeight(next)
    publish(next)
  }, [])

  const onPointerUp = useCallback(() => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    const hs = heights()
    const nearest = (Object.keys(hs) as Snap[]).reduce((best, k) =>
      Math.abs(hs[k] - height) < Math.abs(hs[best] - height) ? k : best,
    )
    setHeight(hs[nearest])
    publish(hs[nearest])
    onSnapChange(nearest)
  }, [height, onSnapChange])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const order: Snap[] = ['peek', 'half', 'full']
    const i = order.indexOf(snap)
    if (e.key === 'ArrowUp') onSnapChange(order[Math.min(2, i + 1)])
    else if (e.key === 'ArrowDown') onSnapChange(order[Math.max(0, i - 1)])
  }

  return (
    <div
      className="float-card fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-[20px] border-b-0"
      style={{ height, transition: dragging ? 'none' : 'height 220ms ease' }}
      role="region"
      aria-label="Trip panel"
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label="Resize panel"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={2}
        aria-valuenow={['peek', 'half', 'full'].indexOf(snap)}
        aria-valuetext={snap}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        className="flex h-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-t-[20px] focus-visible:outline-offset-[-4px] active:cursor-grabbing"
      >
        <span aria-hidden="true" className="h-1 w-9 rounded-badge bg-muted/40" />
      </div>
      <div data-scroll-area className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-1">{children}</div>
    </div>
  )
}
