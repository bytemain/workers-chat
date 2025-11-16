/**
 * @template T
 * @param {T[]} array - Array to iterate over
 * @param {(item: T, index: number, array: T[]) => string} callback - Callback function that returns a string
 * @returns {string} Joined string result
 */
export function forEach(array, callback) {
  return array.map(callback).join('');
}
