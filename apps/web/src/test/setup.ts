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
