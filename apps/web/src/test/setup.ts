import '@testing-library/jest-dom/vitest';

const makeStorage = () => {
  let store: Record<string, string> = {};

  return {
    getItem(key: string) {
      return key in store ? store[key] : null;
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
    removeItem(key: string) {
      delete store[key];
    },
    clear() {
      store = {};
    }
  };
};

Object.defineProperty(window, 'localStorage', {
  value: makeStorage(),
  configurable: true
});

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, 'IntersectionObserver', {
  value: MockIntersectionObserver,
  configurable: true
});

Object.defineProperty(globalThis, 'IntersectionObserver', {
  value: MockIntersectionObserver,
  configurable: true
});

Object.defineProperty(window, 'scrollTo', {
  value: () => {},
  configurable: true
});

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  value: () => {},
  configurable: true
});
