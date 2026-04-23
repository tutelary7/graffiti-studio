/**
 * COCO 18-keypoint 표준 — novel-workstation/src/webtoon/skeletonProjection.js 와 호환.
 *
 * ⚠ L/R은 **캐릭터 기준** (정면 사진에서 r_shoulder는 관찰자의 화면 왼쪽).
 *
 * 저장 포맷 (Firestore users/{uid}/poseLibrary):
 *   kps2D: [{ x: 0..1, y: 0..1, visibility: 0..1 }, ... ×18]  (COCO18 고정 순서)
 *
 * 이 파일은 graffiti-studio 내부 rigData 구조와 COCO18 kps2D 포맷을 상호변환.
 */

/** COCO18 고정 관절 순서 — 인덱스 바뀌면 저장본 호환 깨짐 */
export const COCO18_JOINT_NAMES = [
  'nose',        // 0
  'neck',        // 1
  'r_shoulder',  // 2
  'r_elbow',     // 3
  'r_wrist',     // 4
  'l_shoulder',  // 5
  'l_elbow',     // 6
  'l_wrist',     // 7
  'r_hip',       // 8
  'r_knee',      // 9
  'r_ankle',     // 10
  'l_hip',       // 11
  'l_knee',      // 12
  'l_ankle',     // 13
  'r_eye',       // 14
  'l_eye',       // 15
  'r_ear',       // 16
  'l_ear',       // 17
]

/**
 * COCO18 limb 연결 + OpenPose 표준 RGB 색상.
 * ControlNet OpenPose 모델이 인식하는 정확한 색상 — 이미지 생성 시 pose guide로 작동.
 */
export const COCO18_LIMBS = [
  // [from, to, color]
  ['neck', 'r_shoulder', '#ff0000'],  // 빨
  ['r_shoulder', 'r_elbow', '#ff8500'],  // 주1
  ['r_elbow', 'r_wrist', '#ffff00'],  // 노
  ['neck', 'l_shoulder', '#85ff00'],  // 연두
  ['l_shoulder', 'l_elbow', '#00ff00'],  // 초
  ['l_elbow', 'l_wrist', '#00ff85'],  // 민트
  ['neck', 'r_hip', '#00ffff'],  // 청록
  ['r_hip', 'r_knee', '#0085ff'],  // 하늘
  ['r_knee', 'r_ankle', '#0000ff'],  // 파
  ['neck', 'l_hip', '#8500ff'],  // 보1
  ['l_hip', 'l_knee', '#aa00ff'],  // 보2
  ['l_knee', 'l_ankle', '#ff00ff'],  // 핑크
  ['neck', 'nose', '#ff0085'],  // 자홍
  ['nose', 'r_eye', '#ff00aa'],
  ['nose', 'l_eye', '#ff00aa'],
  ['r_eye', 'r_ear', '#ff5500'],
  ['l_eye', 'l_ear', '#ff5500'],
]

/** 부모-자식 계층 (3D 시 사용 — 2D에서도 flipHorizontal 등에 유용) */
export const BONE_HIERARCHY = {
  neck: null,            // 루트
  nose: 'neck',
  r_eye: 'nose', l_eye: 'nose',
  r_ear: 'nose', l_ear: 'nose',
  r_shoulder: 'neck', l_shoulder: 'neck',
  r_elbow: 'r_shoulder', l_elbow: 'l_shoulder',
  r_wrist: 'r_elbow', l_wrist: 'l_elbow',
  r_hip: 'neck', l_hip: 'neck',
  r_knee: 'r_hip', l_knee: 'l_hip',
  r_ankle: 'r_knee', l_ankle: 'l_knee',
}

/** COCO18 기본 T-포즈 (2D 정규화 viewBox 0..100 기준) */
export const COCO18_DEFAULT_KPS = {
  nose:       { x: 50, y: 10 },
  neck:       { x: 50, y: 20 },
  r_shoulder: { x: 42, y: 24 },   // 화면 왼쪽 = 캐릭터 오른쪽
  r_elbow:    { x: 34, y: 38 },
  r_wrist:    { x: 28, y: 52 },
  l_shoulder: { x: 58, y: 24 },   // 화면 오른쪽 = 캐릭터 왼쪽
  l_elbow:    { x: 66, y: 38 },
  l_wrist:    { x: 72, y: 52 },
  r_hip:      { x: 45, y: 56 },
  r_knee:     { x: 44, y: 74 },
  r_ankle:    { x: 43, y: 92 },
  l_hip:      { x: 55, y: 56 },
  l_knee:     { x: 56, y: 74 },
  l_ankle:    { x: 57, y: 92 },
  r_eye:      { x: 48, y: 9 },
  l_eye:      { x: 52, y: 9 },
  r_ear:      { x: 45, y: 10 },
  l_ear:      { x: 55, y: 10 },
}

/**
 * 18-keypoints (normalized 0..1) → graffiti-studio rigData
 * Firestore 에서 받은 kps2D를 내부 렌더링 포맷으로 변환.
 *
 * 입력: [{x:0..1, y:0..1, visibility:0..1}] × 18  (COCO18 순서)
 * 출력: { joints: [{id, type, x:0..100, y:0..100, visibility}], bones: [...], facing }
 */
export function kps2DToRigData(kps2D) {
  if (!Array.isArray(kps2D)) return null
  const byName = {}
  COCO18_JOINT_NAMES.forEach((name, i) => {
    const k = kps2D[i]
    if (k && typeof k.x === 'number') {
      byName[name] = {
        x: (k.x <= 1 ? k.x * 100 : k.x),
        y: (k.y <= 1 ? k.y * 100 : k.y),
        visibility: typeof k.visibility === 'number' ? k.visibility : 1,
      }
    }
  })

  const joints = COCO18_JOINT_NAMES.map(name => {
    const p = byName[name] || COCO18_DEFAULT_KPS[name]
    return {
      id: name,
      type: jointType(name),
      x: p.x, y: p.y,
      visibility: p.visibility ?? 1,
    }
  })

  const bones = COCO18_LIMBS.map(([from, to, color]) => [from, to, color])

  return { joints, bones, headOrientation: { pitch: 0, yaw: 0, roll: 0 } }
}

/**
 * rigData → kps2D (0..1 normalized)
 * Firestore 저장 전 변환.
 */
export function rigDataToKps2D(rigData) {
  if (!rigData?.joints) return null
  const byId = Object.fromEntries(rigData.joints.map(j => [j.id, j]))
  return COCO18_JOINT_NAMES.map(name => {
    const j = byId[name]
    if (!j) return { x: 0.5, y: 0.5, visibility: 0 }
    return {
      x: j.x / 100,
      y: j.y / 100,
      visibility: j.visibility ?? 1,
    }
  })
}

function jointType(name) {
  if (name === 'nose') return 'head'
  if (name === 'neck') return 'neck'
  if (name.endsWith('_eye')) return 'eye'
  if (name.endsWith('_ear')) return 'ear'
  if (name.endsWith('_shoulder')) return 'shoulder'
  if (name.endsWith('_elbow')) return 'elbow'
  if (name.endsWith('_wrist')) return 'wrist'
  if (name.endsWith('_hip')) return 'hip'
  if (name.endsWith('_knee')) return 'knee'
  if (name.endsWith('_ankle')) return 'ankle'
  return 'custom'
}

/** COCO18 T-포즈 rigData 생성 — cloneRig 대체 */
export function makeDefaultCOCO18Rig() {
  const joints = COCO18_JOINT_NAMES.map(name => ({
    id: name,
    type: jointType(name),
    x: COCO18_DEFAULT_KPS[name].x,
    y: COCO18_DEFAULT_KPS[name].y,
    visibility: 1,
  }))
  const bones = COCO18_LIMBS.map(([f, t, c]) => [f, t, c])
  return { joints, bones, headOrientation: { pitch: 0, yaw: 0, roll: 0 } }
}

/**
 * 얼굴 5점의 nose 기준 상대 위치 캡처 — 회전 적용 전 "기준 스냅샷"
 * 사용자/MediaPipe가 잡은 진짜 얼굴 배치를 보존하기 위함.
 *
 * @returns { nose: {dx, dy}, r_eye: {dx, dy}, ... } — 모든 dx, dy는 nose 기준 SVG 좌표
 */
export function captureFaceBase(rigData) {
  if (!rigData?.joints) return null
  const nose = rigData.joints.find(j => j.id === 'nose')
  if (!nose) return null
  const FACE_IDS = ['nose', 'r_eye', 'l_eye', 'r_ear', 'l_ear']
  const base = {}
  for (const id of FACE_IDS) {
    const j = rigData.joints.find(j => j.id === id)
    if (j) base[id] = { dx: j.x - nose.x, dy: j.y - nose.y }
  }
  return base
}

/**
 * 머리 회전 적용 — 캡처된 base 위치를 yaw/pitch/roll로 회전.
 *
 * 노트북 FacePose3D.jsx의 YXZ 순서. 2D 근사를 위해 anatomical z를 자동 추정.
 * rotation = {0,0,0} 이면 base와 정확히 같은 위치로 복귀.
 *
 * @param rigData — joints 배열
 * @param baseFace — captureFaceBase()의 결과 (nose 기준 dx/dy)
 * @param rotation — { yaw, pitch, roll } degrees
 */
export function applyHeadRotation(rigData, baseFace, { yaw = 0, pitch = 0, roll = 0 } = {}) {
  if (!rigData?.joints) return rigData
  if (!baseFace) return rigData
  const nose = rigData.joints.find(j => j.id === 'nose')
  if (!nose) return rigData

  const yawR = (yaw || 0) * Math.PI / 180
  const pitchR = (pitch || 0) * Math.PI / 180
  const rollR = (roll || 0) * Math.PI / 180

  // base에서 얼굴 크기 추정 (eye 사이 거리)
  const eyeR = baseFace.r_eye, eyeL = baseFace.l_eye
  const eyeSpread = (eyeR && eyeL)
    ? Math.hypot(eyeL.dx - eyeR.dx, eyeL.dy - eyeR.dy)
    : 4

  // 관절별 추정 z (앞/뒤 깊이) — anatomical
  function estimateZ(id) {
    if (id === 'nose') return eyeSpread * 0.7
    if (id.endsWith('_eye')) return eyeSpread * 0.5
    if (id.endsWith('_ear')) return -eyeSpread * 0.1
    return 0
  }

  const FACE_IDS = new Set(['nose', 'r_eye', 'l_eye', 'r_ear', 'l_ear'])

  const newJoints = rigData.joints.map(j => {
    if (!FACE_IDS.has(j.id)) return j
    const base = baseFace[j.id]
    if (!base) return j
    // base는 SVG 좌표(dx, dy). math 좌표로: (dx, -dy, z)
    const x = base.dx
    const y = -base.dy
    const z = estimateZ(j.id)
    // YXZ 회전: yaw(Y) → pitch(X) → roll(Z)
    let px = x * Math.cos(yawR) + z * Math.sin(yawR)
    let pz = -x * Math.sin(yawR) + z * Math.cos(yawR)
    let py = y * Math.cos(pitchR) - pz * Math.sin(pitchR)
    pz = y * Math.sin(pitchR) + pz * Math.cos(pitchR)
    const fx = px * Math.cos(rollR) - py * Math.sin(rollR)
    const fy = px * Math.sin(rollR) + py * Math.cos(rollR)
    return {
      ...j,
      x: Math.max(0, Math.min(100, nose.x + fx)),
      y: Math.max(0, Math.min(100, nose.y - fy)),
      visibility: pz > -eyeSpread * 0.5 ? 1 : 0.2,
    }
  })

  return {
    ...rigData,
    joints: newJoints,
    headOrientation: { yaw, pitch, roll },
  }
}

/**
 * L/R swap — 뒷모습이거나 좌우 반전 필요 시.
 */
export function flipCOCO18(rigData) {
  if (!rigData?.joints) return rigData
  const clone = JSON.parse(JSON.stringify(rigData))
  // id 매핑: r_ ↔ l_
  const pairs = {}
  clone.joints.forEach(j => {
    if (j.id.startsWith('r_')) pairs[j.id] = 'l_' + j.id.slice(2)
    if (j.id.startsWith('l_')) pairs[j.id] = 'r_' + j.id.slice(2)
  })
  // 좌표 (x만) 미러
  clone.joints.forEach(j => {
    j.x = 100 - j.x
  })
  // id 스왑
  const byId = Object.fromEntries(clone.joints.map(j => [j.id, j]))
  const swapped = clone.joints.map(j => {
    const partner = pairs[j.id]
    if (!partner || !byId[partner]) return j
    return { ...byId[partner], id: j.id }  // 상대의 좌표 but 내 id
  })
  clone.joints = swapped
  return clone
}
