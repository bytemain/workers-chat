/**
 * @typedef {Object} IDisposable
 * @property {() => void | Promise<void>} dispose - Dispose function
 */

export class Disposable {
  /**
   * @type {IDisposable[]}
   */
  #disposables = [];

  /**
   * Adds a disposable function or Disposable instance to this Disposable.
   * @param {() => void | Promise<void> | IDisposable} disposable The disposable to add.
   */
  add(disposable) {
    this.#disposables.push(disposable);
  }

  /**
   * Disposes all registered disposables.
   * @returns {Promise<void>} A promise that resolves when all disposables have been disposed.
   */
  async dispose() {
    for (const disposable of this.#disposables) {
      await disposable.dispose();
    }
    this.#disposables = [];
  }
}

/**
 * Every time a new disposable is set, the previous one is disposed.
 */
export class MutableDisposable {
  /**
   * @type {IDisposable | null}
   */
  #current = null;

  /**
   * Sets a new disposable, disposing the previous one if it exists.
   * @param {IDisposable | null} disposable The new disposable to set.
   * @returns {Promise<void>} A promise that resolves when the previous disposable has been disposed.
   */
  set(disposable) {
    if (this.#current) {
      this.#current.dispose();
    }
    this.#current = disposable;
  }

  create() {
    const disposable = new Disposable();
    this.set(disposable);
    return disposable;
  }

  /**
   * Disposes the current disposable if it exists.
   * @returns {Promise<void>} A promise that resolves when the current disposable has been disposed.
   */
  dispose() {
    if (this.#current) {
      this.#current.dispose();
      this.#current = null;
    }
  }
}
