/** How a camera select reads a panel's camera: its main angle, the reverse, or the user's own words. Shared by the Scene tab and the Generate page. */
export function cameraKind(camera: string): 'main' | 'reverse' | 'other' {
  const said = camera.trim().toLowerCase()
  return said === '' || said === 'main' ? 'main' : said === 'reverse' ? 'reverse' : 'other'
}
