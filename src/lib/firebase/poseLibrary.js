/**
 * poseLibraryService — 노트북 novel-workstation/services/poseLibraryService.js 그대로 포팅
 *
 * 저장 구조 (Firestore):
 *   users/{uid}/poseLibrary/{poseId}
 *     - kind: '2d' | '3d'
 *     - label: string
 *     - keypoints: Array (2D, 18개 OpenPose)
 *     - joints: Array (3D)
 *     - imgDim: { w, h }
 *     - ts: 최초 저장 시각 (ms)
 *     - updatedAt: serverTimestamp
 *
 * 로컬 키 (노트북과 동일):
 *   - webtoon_skeleton_poses_2d
 *   - webtoon_custom_poses
 */
import {
  collection, doc, getDocs, setDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from './config.js'
import {
  COCO18_JOINT_NAMES, COCO18_DEFAULT_KPS,
  kps2DToRigData, rigDataToKps2D, makeDefaultCOCO18Rig,
} from '../skeleton/coco18.js'

export const LS_KEY_2D = 'webtoon_skeleton_poses_2d'
export const LS_KEY_3D = 'webtoon_custom_poses'

// ─── 로컬 ────────────────────────────────────────────────────
function loadLocal(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]') }
  catch { return [] }
}
function saveLocalArr(key, list) {
  try { localStorage.setItem(key, JSON.stringify(list)) } catch {}
}
export function loadLocal2D() { return loadLocal(LS_KEY_2D) }
export function loadLocal3D() { return loadLocal(LS_KEY_3D) }
export function saveLocal2D(list) { saveLocalArr(LS_KEY_2D, list) }
export function saveLocal3D(list) { saveLocalArr(LS_KEY_3D, list) }

// ─── Firestore ───────────────────────────────────────────────
function colRef(uid) {
  if (!uid) throw new Error('uid 필요')
  return collection(db, 'users', uid, 'poseLibrary')
}
function docRefFor(uid, id) {
  return doc(db, 'users', uid, 'poseLibrary', id)
}

export async function fetchCloudLibrary(uid) {
  const snap = await getDocs(colRef(uid))
  const items = []
  snap.forEach(d => {
    const data = d.data()
    items.push({
      id: d.id,
      ...data,
      cloudUpdatedMs: data.updatedAt?.toMillis?.() || data.ts || 0,
    })
  })
  return items
}

export async function pushItemToCloud(uid, item) {
  if (!item?.id) throw new Error('item.id 필요')
  const ref = docRefFor(uid, item.id)
  const clean = Object.fromEntries(
    Object.entries(item).filter(([, v]) => v !== undefined)
  )
  await setDoc(ref, {
    ...clean,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export async function deleteItemFromCloud(uid, id) {
  await deleteDoc(docRefFor(uid, id))
}

/** 라벨만 변경 (rename) — 노트북에 없는 추가 기능 */
export async function renameItemInCloud(uid, id, newLabel) {
  if (!uid || !id) throw new Error('uid + id 필요')
  await setDoc(docRefFor(uid, id), {
    label: newLabel,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

// ─── 양방향 머지 ─────────────────────────────────────────────
export async function syncLibrary(uid) {
  if (!uid) throw new Error('로그인 필요')
  const local2D = loadLocal2D()
  const local3D = loadLocal3D()
  const cloud = await fetchCloudLibrary(uid)

  const cloudById = new Map(cloud.map(c => [c.id, c]))
  const localById = new Map([
    ...local2D.map(x => [x.id, { ...x, kind: '2d' }]),
    ...local3D.map(x => [x.id, { ...x, kind: '3d' }]),
  ])

  let pushed = 0, pulled = 0

  // 로컬 → 클라우드
  for (const [id, localItem] of localById) {
    const cloudItem = cloudById.get(id)
    const localTs = localItem.ts || 0
    const cloudTs = cloudItem?.cloudUpdatedMs || cloudItem?.ts || 0
    if (!cloudItem || localTs > cloudTs) {
      await pushItemToCloud(uid, localItem)
      pushed++
    }
  }

  // 클라우드 → 로컬
  const merged2D = [...local2D]
  const merged3D = [...local3D]
  for (const cItem of cloud) {
    const localItem = localById.get(cItem.id)
    const localTs = localItem?.ts || 0
    const cloudTs = cItem.cloudUpdatedMs || cItem.ts || 0
    if (!localItem || cloudTs > localTs) {
      const clean = stripCloudMeta(cItem)
      if (cItem.kind === '2d' || cItem.keypoints) {
        const idx = merged2D.findIndex(x => x.id === cItem.id)
        if (idx >= 0) merged2D[idx] = clean; else merged2D.unshift(clean)
      } else if (cItem.kind === '3d' || cItem.joints) {
        const idx = merged3D.findIndex(x => x.id === cItem.id)
        if (idx >= 0) merged3D[idx] = clean; else merged3D.unshift(clean)
      } else {
        // kind 모름 → 2D로 분류 (기본)
        const idx = merged2D.findIndex(x => x.id === cItem.id)
        if (idx >= 0) merged2D[idx] = clean; else merged2D.unshift(clean)
      }
      pulled++
    }
  }

  merged2D.sort((a, b) => (b.ts || 0) - (a.ts || 0))
  merged3D.sort((a, b) => (b.ts || 0) - (a.ts || 0))

  saveLocal2D(merged2D)
  saveLocal3D(merged3D)

  return { merged2D, merged3D, pushedCount: pushed, pulledCount: pulled }
}

function stripCloudMeta(cloudItem) {
  const { updatedAt, cloudUpdatedMs, ...rest } = cloudItem
  return rest
}

// ─── graffiti-studio 호환 함수들 (기존 import 깨지지 않게) ─────────────
// 통합 라이브러리 항목 (노트북 포맷) → graffiti rigData 변환
export function normalizeToRig(item) {
  if (!item) return makeDefaultCOCO18Rig()
  // 노트북 2D 포맷: { keypoints: Array(18) [{x, y, visibility}] }
  if (Array.isArray(item.keypoints) && item.keypoints.length === 18) {
    return kps2DToRigData(item.keypoints)
  }
  if (Array.isArray(item.kps2D) && item.kps2D.length === 18) {
    return kps2DToRigData(item.kps2D)
  }
  if (item.rigData?.joints?.length) {
    return JSON.parse(JSON.stringify(item.rigData))
  }
  const rig = makeDefaultCOCO18Rig()
  rig._unknownSchema = true
  return rig
}

// 클라우드 + 로컬 합쳐서 가져오기 (UI 용)
export async function listPoseLibrary(uid, { max = 100 } = {}) {
  if (!uid) {
    // 비로그인 — 로컬만
    return loadLocal2D().slice(0, max)
  }
  const cloud = await fetchCloudLibrary(uid)
  const local = loadLocal2D()
  // 같은 id면 cloud 우선
  const byId = new Map()
  for (const item of local) byId.set(item.id, { ...item, _src: 'local' })
  for (const item of cloud) byId.set(item.id, { ...item, _src: 'cloud' })
  const merged = [...byId.values()]
  merged.sort((a, b) => (b.ts || 0) - (a.ts || 0))
  return merged.slice(0, max)
}

// 새 포즈 저장 (graffiti-studio 호출용 — 노트북 포맷으로 저장)
export async function savePoseToCloud(uid, { name, rigData, source = 'graffiti-studio' } = {}) {
  if (!uid) throw new Error('로그인 필요')
  const kps2D = rigDataToKps2D(rigData)
  if (!kps2D || kps2D.length !== 18) throw new Error('유효한 rigData 없음')
  const id = `pose_2d_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const item = {
    id,
    label: name || id,
    kind: '2d',
    keypoints: kps2D,
    ts: Date.now(),
    source,
  }
  await pushItemToCloud(uid, item)
  // 로컬에도 미러
  const local = loadLocal2D()
  saveLocal2D([item, ...local])
  return id
}

export async function deletePoseFromCloud(uid, docId) {
  if (uid) {
    try { await deleteItemFromCloud(uid, docId) } catch (e) { console.warn(e) }
  }
  // 로컬에서도 제거
  const local = loadLocal2D()
  saveLocal2D(local.filter(x => x.id !== docId))
}

export async function updatePoseLabel(uid, docId, newLabel) {
  if (uid) {
    try { await renameItemInCloud(uid, docId, newLabel) } catch (e) { console.warn(e) }
  }
  // 로컬도 업데이트
  const local = loadLocal2D()
  const updated = local.map(x => x.id === docId ? { ...x, label: newLabel } : x)
  saveLocal2D(updated)
}
