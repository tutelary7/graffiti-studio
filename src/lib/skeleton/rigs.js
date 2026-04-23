/**
 * Graffiti Studio — 리그 템플릿 8종
 *
 * 각 리그는 관절(joints) 배열과 본(bones) 연결로 정의.
 * 좌표계: (x, y) — 0..100 정규화. SVG viewBox 기준.
 *         y축은 위→아래 (SVG 표준). 머리=낮은 y, 발=높은 y.
 *
 * 사용 예:
 *   import { RIGS, cloneRig } from './rigs.js'
 *   const actor = cloneRig('human')
 *   actor.joints[3].x += 5   // 우측 어깨 이동
 */

// ---------- 공통 관절 색상 팔레트 (뼈다귀 PNG 출력 시 사용) ----------
export const BONE_COLORS = {
  spine: '#06b6d4',
  armUpper: '#f97316',
  armLowerL: '#ef4444',
  armLowerR: '#84cc16',
  legUpperL: '#10b981',
  legUpperR: '#3b82f6',
  legLowerL: '#22c55e',
  legLowerR: '#1d4ed8',
  head: '#8b5cf6',
  tail: '#a855f7',
  wing: '#ec4899',
  extra: '#f59e0b',
}

// ---------- 관절 타입 (편집 UI에서 구분용) ----------
export const JOINT_TYPES = {
  HEAD: 'head',      // 머리 중심 (코 위치)
  EYE: 'eye',        // 눈 (L/R)
  EAR: 'ear',        // 귀 (L/R)
  NECK: 'neck',
  SHOULDER: 'shoulder',
  ELBOW: 'elbow',
  WRIST: 'wrist',
  HIP: 'hip',
  KNEE: 'knee',
  ANKLE: 'ankle',
  SPINE: 'spine',
  TAIL: 'tail',
  WING: 'wing',
  CUSTOM: 'custom',  // 사용자 추가 관절
}

// ==========================================================================
// 리그 1. 인간 (Human) — MediaPipe 기준 단순화 버전 (주요 관절만)
// ==========================================================================
// COCO18 표준 — novel-workstation과 호환. L/R은 캐릭터 기준 (r_shoulder = 화면 왼쪽).
// 색상: OpenPose ControlNet RGB (AI가 pose guide로 인식하는 표준).
const human = {
  id: 'human',
  label: '인간',
  icon: '👤',
  description: 'COCO18 표준 (18-keypoint). OpenPose/ControlNet 호환.',
  joints: [
    { id: 'nose',       type: 'head',     x: 50, y: 10, visibility: 1 },
    { id: 'neck',       type: 'neck',     x: 50, y: 20, visibility: 1 },
    { id: 'r_shoulder', type: 'shoulder', x: 42, y: 24, visibility: 1 },
    { id: 'r_elbow',    type: 'elbow',    x: 34, y: 38, visibility: 1 },
    { id: 'r_wrist',    type: 'wrist',    x: 28, y: 52, visibility: 1 },
    { id: 'l_shoulder', type: 'shoulder', x: 58, y: 24, visibility: 1 },
    { id: 'l_elbow',    type: 'elbow',    x: 66, y: 38, visibility: 1 },
    { id: 'l_wrist',    type: 'wrist',    x: 72, y: 52, visibility: 1 },
    { id: 'r_hip',      type: 'hip',      x: 45, y: 56, visibility: 1 },
    { id: 'r_knee',     type: 'knee',     x: 44, y: 74, visibility: 1 },
    { id: 'r_ankle',    type: 'ankle',    x: 43, y: 92, visibility: 1 },
    { id: 'l_hip',      type: 'hip',      x: 55, y: 56, visibility: 1 },
    { id: 'l_knee',     type: 'knee',     x: 56, y: 74, visibility: 1 },
    { id: 'l_ankle',    type: 'ankle',    x: 57, y: 92, visibility: 1 },
    { id: 'r_eye',      type: 'eye',      x: 48, y: 9,  visibility: 1 },
    { id: 'l_eye',      type: 'eye',      x: 52, y: 9,  visibility: 1 },
    { id: 'r_ear',      type: 'ear',      x: 45, y: 10, visibility: 1 },
    { id: 'l_ear',      type: 'ear',      x: 55, y: 10, visibility: 1 },
  ],
  bones: [
    ['neck', 'r_shoulder', '#ff0000'],
    ['r_shoulder', 'r_elbow', '#ff8500'],
    ['r_elbow', 'r_wrist', '#ffff00'],
    ['neck', 'l_shoulder', '#85ff00'],
    ['l_shoulder', 'l_elbow', '#00ff00'],
    ['l_elbow', 'l_wrist', '#00ff85'],
    ['neck', 'r_hip', '#00ffff'],
    ['r_hip', 'r_knee', '#0085ff'],
    ['r_knee', 'r_ankle', '#0000ff'],
    ['neck', 'l_hip', '#8500ff'],
    ['l_hip', 'l_knee', '#aa00ff'],
    ['l_knee', 'l_ankle', '#ff00ff'],
    ['neck', 'nose', '#ff0085'],
    ['nose', 'r_eye', '#ff00aa'],
    ['nose', 'l_eye', '#ff00aa'],
    ['r_eye', 'r_ear', '#ff5500'],
    ['l_eye', 'l_ear', '#ff5500'],
  ],
  headOrientation: { pitch: 0, yaw: 0, roll: 0 },
  coco18: true,   // 플래그
}

// ==========================================================================
// 리그 2. 인간형 (Humanoid) — 엘프, 오크 등 (귀 끝 관절 추가)
// ==========================================================================
const humanoid = {
  id: 'humanoid',
  label: '인간형',
  icon: '🧝',
  description: '엘프/오크 등 — COCO18 + 귀 끝 관절.',
  joints: [
    ...human.joints,
    { id: 'earTipR', type: 'custom', x: 42, y: 6, visibility: 1 },
    { id: 'earTipL', type: 'custom', x: 58, y: 6, visibility: 1 },
  ],
  bones: [
    ...human.bones,
    ['r_ear', 'earTipR', BONE_COLORS.extra],
    ['l_ear', 'earTipL', BONE_COLORS.extra],
  ],
  headOrientation: { pitch: 0, yaw: 0, roll: 0 },
  coco18: true,
}

// ==========================================================================
// 리그 3. 4족 짐승 (Quadruped) — 개, 말, 사자
// ==========================================================================
const quadruped = {
  id: 'quadruped',
  label: '4족 짐승',
  icon: '🐕',
  description: '개/말/사자 등. 4개 다리 + 꼬리.',
  joints: [
    { id: 'head',       type: 'head',     x: 20, y: 35, color: BONE_COLORS.head },
    { id: 'neck',       type: 'neck',     x: 28, y: 42 },
    { id: 'spineFront', type: 'spine',    x: 40, y: 48 },
    { id: 'spineBack',  type: 'spine',    x: 65, y: 50 },
    { id: 'tailBase',   type: 'tail',     x: 75, y: 48 },
    { id: 'tailTip',    type: 'tail',     x: 88, y: 35 },
    { id: 'fLegShoulderL', type: 'shoulder', x: 40, y: 55 },
    { id: 'fLegShoulderR', type: 'shoulder', x: 40, y: 55 },
    { id: 'fKneeL',     type: 'knee',     x: 38, y: 72 },
    { id: 'fKneeR',     type: 'knee',     x: 42, y: 72 },
    { id: 'fPawL',      type: 'ankle',    x: 37, y: 90 },
    { id: 'fPawR',      type: 'ankle',    x: 43, y: 90 },
    { id: 'rLegHipL',   type: 'hip',      x: 68, y: 55 },
    { id: 'rLegHipR',   type: 'hip',      x: 68, y: 55 },
    { id: 'rKneeL',     type: 'knee',     x: 66, y: 72 },
    { id: 'rKneeR',     type: 'knee',     x: 70, y: 72 },
    { id: 'rPawL',      type: 'ankle',    x: 65, y: 90 },
    { id: 'rPawR',      type: 'ankle',    x: 71, y: 90 },
  ],
  bones: [
    ['head', 'neck', BONE_COLORS.head],
    ['neck', 'spineFront', BONE_COLORS.spine],
    ['spineFront', 'spineBack', BONE_COLORS.spine],
    ['spineBack', 'tailBase', BONE_COLORS.tail],
    ['tailBase', 'tailTip', BONE_COLORS.tail],
    ['spineFront', 'fLegShoulderL', BONE_COLORS.spine],
    ['fLegShoulderL', 'fKneeL', BONE_COLORS.armUpper],
    ['fKneeL', 'fPawL', BONE_COLORS.armLowerL],
    ['spineFront', 'fLegShoulderR', BONE_COLORS.spine],
    ['fLegShoulderR', 'fKneeR', BONE_COLORS.armUpper],
    ['fKneeR', 'fPawR', BONE_COLORS.armLowerR],
    ['spineBack', 'rLegHipL', BONE_COLORS.spine],
    ['rLegHipL', 'rKneeL', BONE_COLORS.legUpperL],
    ['rKneeL', 'rPawL', BONE_COLORS.legLowerL],
    ['spineBack', 'rLegHipR', BONE_COLORS.spine],
    ['rLegHipR', 'rKneeR', BONE_COLORS.legUpperR],
    ['rKneeR', 'rPawR', BONE_COLORS.legLowerR],
  ],
  headOrientation: { pitch: 0, yaw: 0, roll: 0 },
}

// ==========================================================================
// 리그 4. 뱀/긴 형체 (Serpentine)
// ==========================================================================
const serpentine = {
  id: 'serpentine',
  label: '뱀/긴형체',
  icon: '🐍',
  description: '뱀, 장어 등. 척추 S자로 구불구불.',
  joints: [
    { id: 'head', type: 'head', x: 15, y: 30, color: BONE_COLORS.head },
    { id: 'seg1', type: 'spine', x: 25, y: 35 },
    { id: 'seg2', type: 'spine', x: 35, y: 45 },
    { id: 'seg3', type: 'spine', x: 45, y: 55 },
    { id: 'seg4', type: 'spine', x: 55, y: 50 },
    { id: 'seg5', type: 'spine', x: 65, y: 60 },
    { id: 'seg6', type: 'spine', x: 75, y: 70 },
    { id: 'tailTip', type: 'tail', x: 88, y: 78 },
  ],
  bones: [
    ['head', 'seg1', BONE_COLORS.head],
    ['seg1', 'seg2', BONE_COLORS.spine],
    ['seg2', 'seg3', BONE_COLORS.spine],
    ['seg3', 'seg4', BONE_COLORS.spine],
    ['seg4', 'seg5', BONE_COLORS.spine],
    ['seg5', 'seg6', BONE_COLORS.spine],
    ['seg6', 'tailTip', BONE_COLORS.tail],
  ],
  headOrientation: { pitch: 0, yaw: 0, roll: 0 },
}

// ==========================================================================
// 리그 5. 날개 생물 (Winged) — 용, 천사, 악마, 하피
// ==========================================================================
const winged = {
  id: 'winged',
  label: '날개생물',
  icon: '🐉',
  description: '용/천사/악마/하피 등. 인간형 + 날개 + 꼬리.',
  joints: [
    ...human.joints,
    // 날개
    { id: 'wingBaseL', type: 'wing', x: 40, y: 28, color: BONE_COLORS.wing },
    { id: 'wingMidL',  type: 'wing', x: 20, y: 20, color: BONE_COLORS.wing },
    { id: 'wingTipL',  type: 'wing', x: 5,  y: 30, color: BONE_COLORS.wing },
    { id: 'wingBaseR', type: 'wing', x: 60, y: 28, color: BONE_COLORS.wing },
    { id: 'wingMidR',  type: 'wing', x: 80, y: 20, color: BONE_COLORS.wing },
    { id: 'wingTipR',  type: 'wing', x: 95, y: 30, color: BONE_COLORS.wing },
    // 꼬리 (옵션)
    { id: 'tailBase', type: 'tail', x: 50, y: 60, color: BONE_COLORS.tail },
    { id: 'tailTip',  type: 'tail', x: 50, y: 85, color: BONE_COLORS.tail },
  ],
  bones: [
    ...human.bones,
    ['shoulderL', 'wingBaseL', BONE_COLORS.wing],
    ['wingBaseL', 'wingMidL', BONE_COLORS.wing],
    ['wingMidL', 'wingTipL', BONE_COLORS.wing],
    ['shoulderR', 'wingBaseR', BONE_COLORS.wing],
    ['wingBaseR', 'wingMidR', BONE_COLORS.wing],
    ['wingMidR', 'wingTipR', BONE_COLORS.wing],
    ['spine', 'tailBase', BONE_COLORS.tail],
    ['tailBase', 'tailTip', BONE_COLORS.tail],
  ],
  headOrientation: { pitch: 0, yaw: 0, roll: 0 },
}

// ==========================================================================
// 리그 6. 하이브리드 (Hybrid) — 센타우로스, 인어
// ==========================================================================
const hybrid = {
  id: 'hybrid',
  label: '하이브리드',
  icon: '🧜',
  description: '센타우로스(인간 상체+말 하체), 인어 등 하반신 대체형.',
  joints: [
    // 인간 상체
    { id: 'head',      type: 'head',     x: 50, y: 10, color: BONE_COLORS.head },
    { id: 'neck',      type: 'neck',     x: 50, y: 20 },
    { id: 'shoulderL', type: 'shoulder', x: 42, y: 23 },
    { id: 'shoulderR', type: 'shoulder', x: 58, y: 23 },
    { id: 'elbowL',    type: 'elbow',    x: 36, y: 38 },
    { id: 'elbowR',    type: 'elbow',    x: 64, y: 38 },
    { id: 'wristL',    type: 'wrist',    x: 32, y: 50 },
    { id: 'wristR',    type: 'wrist',    x: 68, y: 50 },
    { id: 'waist',     type: 'spine',    x: 50, y: 48 },
    // 하체 대체 (꼬리/말 몸통)
    { id: 'bodyMid',   type: 'spine',    x: 50, y: 60 },
    { id: 'tailBase',  type: 'tail',     x: 70, y: 65, color: BONE_COLORS.tail },
    { id: 'tailTip',   type: 'tail',     x: 88, y: 75, color: BONE_COLORS.tail },
  ],
  bones: [
    ['head', 'neck', BONE_COLORS.head],
    ['neck', 'shoulderL', BONE_COLORS.spine],
    ['neck', 'shoulderR', BONE_COLORS.spine],
    ['neck', 'waist', BONE_COLORS.spine],
    ['shoulderL', 'elbowL', BONE_COLORS.armUpper],
    ['elbowL', 'wristL', BONE_COLORS.armLowerL],
    ['shoulderR', 'elbowR', BONE_COLORS.armUpper],
    ['elbowR', 'wristR', BONE_COLORS.armLowerR],
    ['waist', 'bodyMid', BONE_COLORS.spine],
    ['bodyMid', 'tailBase', BONE_COLORS.tail],
    ['tailBase', 'tailTip', BONE_COLORS.tail],
  ],
  headOrientation: { pitch: 0, yaw: 0, roll: 0 },
}

// ==========================================================================
// 리그 7. 로봇/메카 (Mechanical)
// ==========================================================================
const robot = {
  id: 'robot',
  label: '로봇',
  icon: '🤖',
  description: '각진 기계형. 기본은 인간과 같지만 편집에서 패널/무기 관절 추가 권장.',
  joints: human.joints.map(j => ({ ...j })),  // 인간 복제
  bones: [...human.bones],
  headOrientation: { pitch: 0, yaw: 0, roll: 0 },
}

// ==========================================================================
// 리그 8. 비정형 (Amorphous) — 슬라임, 촉수
// ==========================================================================
const amorphous = {
  id: 'amorphous',
  label: '비정형',
  icon: '🪼',
  description: '슬라임, 촉수, 액체 형체. 중심점 + 방사형 관절.',
  joints: [
    { id: 'core',   type: 'spine',  x: 50, y: 50 },
    { id: 'top',    type: 'head',   x: 50, y: 25, color: BONE_COLORS.head },
    { id: 'bottom', type: 'custom', x: 50, y: 85, color: BONE_COLORS.extra },
    { id: 'armL1',  type: 'custom', x: 20, y: 40, color: BONE_COLORS.extra },
    { id: 'armL2',  type: 'custom', x: 15, y: 60, color: BONE_COLORS.extra },
    { id: 'armR1',  type: 'custom', x: 80, y: 40, color: BONE_COLORS.extra },
    { id: 'armR2',  type: 'custom', x: 85, y: 60, color: BONE_COLORS.extra },
  ],
  bones: [
    ['core', 'top', BONE_COLORS.head],
    ['core', 'bottom', BONE_COLORS.extra],
    ['core', 'armL1', BONE_COLORS.extra],
    ['core', 'armL2', BONE_COLORS.extra],
    ['core', 'armR1', BONE_COLORS.extra],
    ['core', 'armR2', BONE_COLORS.extra],
  ],
  headOrientation: { pitch: 0, yaw: 0, roll: 0 },
}

// ==========================================================================
// 리그 9. 사용자 정의 (Custom) — 빈 시작점
// ==========================================================================
const custom = {
  id: 'custom',
  label: '사용자 정의',
  icon: '⚙',
  description: '빈 캔버스. 관절을 0개부터 직접 추가.',
  joints: [
    { id: 'origin', type: 'spine', x: 50, y: 50 },
  ],
  bones: [],
  headOrientation: { pitch: 0, yaw: 0, roll: 0 },
}

// ==========================================================================
// 전체 리그 맵
// ==========================================================================
export const RIGS = {
  human, humanoid, quadruped, serpentine, winged, hybrid, robot, amorphous, custom,
}

export const RIG_LIST = Object.values(RIGS)

/**
 * 리그 복사 — 편집 시 원본 보존용.
 */
export function cloneRig(rigId) {
  const src = RIGS[rigId]
  if (!src) throw new Error(`Unknown rig: ${rigId}`)
  return {
    id: src.id,
    label: src.label,
    joints: src.joints.map(j => ({ ...j })),
    bones: src.bones.map(b => [...b]),
    headOrientation: { ...src.headOrientation },
  }
}

/**
 * 관절 추가 유틸.
 */
export function addJoint(rig, { id, type = 'custom', x = 50, y = 50, color = BONE_COLORS.extra, parentId = null }) {
  const newJoint = { id, type, x, y, color }
  rig.joints.push(newJoint)
  if (parentId && rig.joints.find(j => j.id === parentId)) {
    rig.bones.push([parentId, id, color])
  }
  return rig
}

/**
 * 관절 삭제 (관련 본도 같이 제거).
 */
export function removeJoint(rig, jointId) {
  rig.joints = rig.joints.filter(j => j.id !== jointId)
  rig.bones = rig.bones.filter(([a, b]) => a !== jointId && b !== jointId)
  return rig
}

/**
 * 관절 위치 이동.
 */
export function moveJoint(rig, jointId, x, y) {
  const j = rig.joints.find(j => j.id === jointId)
  if (j) { j.x = x; j.y = y }
  return rig
}

/**
 * 리그 → SVG 뼈다귀 이미지 생성 (라이브러리 썸네일용).
 * Returns: SVG string
 */
export function rigToSVG(rig, { size = 120, background = '#0a0b10' } = {}) {
  const jointMap = Object.fromEntries(rig.joints.map(j => [j.id, j]))
  const lines = rig.bones.map(([fromId, toId, color]) => {
    const a = jointMap[fromId]
    const b = jointMap[toId]
    if (!a || !b) return ''
    const w = a.type === 'spine' || b.type === 'spine' ? 3.5 : 2.5
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color || '#8b5cf6'}" stroke-width="${w}" stroke-linecap="round"/>`
  }).join('')
  const dots = rig.joints.map(j => {
    const r = j.type === 'head' ? 5 : 2.2
    const fill = j.type === 'head' ? '#ec4899' : '#ef4444'
    return `<circle cx="${j.x}" cy="${j.y}" r="${r}" fill="${fill}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" style="background:${background}">${lines}${dots}</svg>`
}
