export function createReactiveState(initialState) {
  const listeners = new Set();

  const proxy = new Proxy(initialState, {
    get(target, property, receiver) {
      return Reflect.get(target, property, receiver);
    },

    set(target, property, value, receiver) {
      const oldValue = target[property];
      const success = Reflect.set(target, property, value, receiver);
      if (success && oldValue !== value) {
        listeners.forEach((listener) => listener(property, value, oldValue));
      }
      return success;
    },
  });

  return {
    state: proxy,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
