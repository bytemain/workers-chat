/**
 * Reef.js v13 TypeScript Declarations
 * https://reefjs.com/
 *
 * Lightweight reactive UI library with signal() and store()
 */

declare module 'reefjs' {
  /**
   * Signal - Reactive state with direct property updates (Proxy-based)
   * Emits 'reef:signal-{name}' event on every property assignment
   *
   * @template T - The type of the state object
   * @param {T} data - Initial state data
   * @param {string} name - Signal name for event emission
   * @returns {T & { _isSignal: true }} - Proxied state object
   *
   * @example
   * const myState = signal({ count: 0, name: 'Alice' }, 'mySignal');
   * myState.count = 1; // Triggers 'reef:signal-mySignal' event
   * myState.name = 'Bob'; // Triggers another event
   */
  export function signal<T extends Record<string, any>>(
    data: T,
    name: string,
  ): T & { _isSignal: true };

  /**
   * Store - Reactive state with actions (Redux-like)
   * Emits 'reef:signal-{name}' event once per action (after all mutations complete)
   * State is read-only outside of actions
   *
   * @template T - The type of the state object
   * @template A - The type of the actions object
   * @param {T} data - Initial state data
   * @param {A} actions - Action methods that mutate state
   * @param {string} name - Store name for event emission
   * @returns Store instance with .value getter and action methods
   *
   * @example
   * const myStore = store(
   *   { count: 0 },
   *   {
   *     increment(state) { state.count++; },
   *     add(state, n: number) { state.count += n; }
   *   },
   *   'myStore'
   * );
   * console.log(myStore.value.count); // Read state
   * myStore.increment(); // Call action
   * myStore.add(5); // Call action with parameter
   */
  export function store<
    T extends Record<string, any>,
    A extends Record<string, (state: T, ...args: any[]) => void>,
  >(
    data: T,
    actions: A,
    name: string,
  ): {
    readonly value: Readonly<T>;
    _isSignal?: false;
  } & {
    [K in keyof A]: A[K] extends (state: T, ...args: infer P) => void
      ? (...args: P) => void
      : never;
  };

  /**
   * Component options for Reef.js
   */
  export interface ComponentOptions {
    /**
     * Array of signal/store names to listen to
     * Component will re-render when any of these signals emit events
     */
    signals?: string[];
  }

  /**
   * Component - Reactive UI component
   * Automatically re-renders when subscribed signals/stores change
   *
   * @param {Element | string} elem - Container element or CSS selector
   * @param {Function} template - Template function that returns HTML string
   * @param {ComponentOptions} options - Component options
   * @returns Component instance
   *
   * @example
   * const myComponent = component(
   *   '#app',
   *   () => `<div>${myState.name}</div>`,
   *   { signals: ['mySignal'] }
   * );
   */
  export function component(
    elem: Element | string,
    template: () => string,
    options?: ComponentOptions,
  ): {
    /**
     * The root element of the component
     */
    elem: Element;
    /**
     * The template function
     */
    template: () => string;
    /**
     * Manually trigger a render
     */
    render(): void;
  };

  /**
   * Emit a custom Reef.js signal event
   * @param {string} name - Signal name
   */
  export function emit(name: string): void;
}

/**
 * Global Reef.js event types
 * Reef.js emits custom events on the document
 */
declare global {
  interface DocumentEventMap {
    /**
     * Reef.js signal event
     * Emitted when a signal or store changes
     * Event name format: 'reef:signal-{signalName}'
     */
    [key: `reef:signal-${string}`]: CustomEvent<void>;
  }
}

export {};
