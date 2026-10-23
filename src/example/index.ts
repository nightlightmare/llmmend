/**
 * Example module exposed as the `PACKAGE_NAME/example` subpath.
 * Rename the folder and the `exports`, `size-limit` and tsdown entries when you start a package.
 */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) throw new RangeError(`min (${min}) must not exceed max (${max})`)
  return Math.min(Math.max(value, min), max)
}
