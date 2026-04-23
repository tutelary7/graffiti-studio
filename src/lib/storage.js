/**
 * Graffiti Studio — 로컬 스토리지 추상화
 *
 * 작은 데이터(설정, 최근 프로젝트 ID 등)는 localStorage,
 * 큰 데이터(이미지, 스켈레톤 JSON, 갤러리 컷)는 IndexedDB.
 *
 * 앞으로 Firestore 클라우드 동기화 붙일 때 이 파일의 함수만 교체하면 됨.
 */

const DB_NAME = 'graffiti-studio'
const DB_VERSION = 1
const STORES = {
  projects: 'projects',       // { id, name, emoji, createdAt, ... }
  anchors: 'anchors',         // { projectId, imageBlob, meta }
  skeletons: 'skeletons',     // { id, name, rigType, png, json, tags, createdAt }
  cuts: 'cuts',               // { id, projectId, imageBlob, kind, tags, createdAt }
}

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      Object.values(STORES).forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id', autoIncrement: true })
        }
      })
    }
  })
  return dbPromise
}

export async function put(storeName, record) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).put(record)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getAll(storeName) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function get(storeName, id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).get(id)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function remove(storeName, id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// localStorage 간편 래퍼 (설정값 전용)
const LS_PREFIX = 'gs-'
export const settings = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(LS_PREFIX + key)
      return v ? JSON.parse(v) : fallback
    } catch (e) { return fallback }
  },
  set(key, value) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)) } catch (e) { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(LS_PREFIX + key) } catch (e) { /* ignore */ }
  }
}

export { STORES }
