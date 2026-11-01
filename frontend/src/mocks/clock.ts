/** Hour 0 of the fake data: the current hour, floored (matches the backend "now"). */
export const MOCK_START: Date = (() => {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  return d
})()

export const MOCK_DEPARTURE: Date = new Date(MOCK_START.getTime() + 60 * 60 * 1000)
export const MOCK_LOAD_LB = 38000
