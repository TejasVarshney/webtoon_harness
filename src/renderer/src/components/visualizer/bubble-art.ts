// Outlines for the bubble shapes that are generated rather than listed. Fixed arithmetic and no randomness, so a panel
// draws the same in the editor, on the strip and in an export.

/** A number from 0 to 1 that looks arbitrary but depends only on `i`. */
function scatter(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

const point = (angle: number, radius: number): string => {
  const x = 50 + radius * Math.cos(angle)
  const y = 50 + radius * Math.sin(angle)
  return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
}

/** A closed spiky ring as SVG polygon points, centred in a 100 x 100 box. Radii are in the box's units. */
export function spikyRing(spikes: number, inner: number, outerMin: number, outerMax: number): string {
  const step = Math.PI / spikes
  const points: string[] = []
  for (let i = 0; i < spikes; i++) {
    points.push(point(2 * i * step, outerMin + (outerMax - outerMin) * scatter(i + 1)))
    points.push(point((2 * i + 1) * step, inner))
  }
  return points.join(' ')
}
