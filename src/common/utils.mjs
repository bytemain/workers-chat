export function throttle(func, wait) {
  let timer = null;
  let pending = false;

  return function throttled(...args) {
    if (timer) {
      pending = true;
      return;
    }

    func.apply(this, args);

    timer = setTimeout(() => {
      timer = null;
      if (pending) {
        pending = false;
        throttled.apply(this, args);
      }
    }, wait);
  };
}
