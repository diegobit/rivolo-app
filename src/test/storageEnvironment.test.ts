import { expect, it } from 'vitest'

it('uses jsdom storage for browser tests', () => {
  expect(localStorage).toBeInstanceOf(Storage)
  expect(sessionStorage).toBeInstanceOf(Storage)
  expect(globalThis.localStorage).toBe(window.localStorage)
  expect(globalThis.sessionStorage).toBe(window.sessionStorage)
  expect(new StorageEvent('storage', { storageArea: localStorage }).storageArea).toBe(localStorage)
})
