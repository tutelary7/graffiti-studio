/**
 * 이미지 → 스켈레톤 자동 추출 (COCO18)
 *
 * 노트북 novel-workstation의 7-pass 파이프라인 사용.
 * 결과 100% 일치.
 *
 * 출력:
 *   { rigData, kps2D, aspectRatio, confidence, notes, engine }
 *     - rigData: graffiti-studio 내부 렌더링 포맷 (COCO18)
 *     - kps2D: [{x:0..1, y:0..1, visibility:0..1}] × 18 — Firestore 저장용
 *     - engine: 'mediapipe' | 'colorize+mediapipe' | 'vision' | 'mock'
 */
import { kps2DToRigData } from '../skeleton/coco18.js'
import { detectPoseFromImage } from './poseDetection.js'

export async function extractPoseFromImage(image, { targetActorIdx = 1 } = {}) {
  // image가 Blob이면 HTMLImageElement로 변환
  const imgElement = image instanceof HTMLImageElement
    ? image
    : await blobToImageElement(image)

  console.log('[extractPose] 노트북 7-pass 파이프라인 시작...')

  const result = await detectPoseFromImage(imgElement, {
    onProgress: (msg) => console.log('[extractPose]', msg),
    useColorizeFallback: true,
    useVisionFallback: true,
  })

  if (!result.kps) {
    console.warn('[extractPose] 모든 단계 실패:', result.reason)
    return {
      rigData: kps2DToRigData(fallbackKps2D()),
      kps2D: fallbackKps2D(),
      confidence: 0,
      notes: result.reason || '추출 실패',
      mock: true,
      engine: 'mock',
    }
  }

  // letterbox 보정 (정사각 viewBox에 letterbox된 이미지 표시 영역에 맞추기)
  const dims = { width: imgElement.naturalWidth, height: imgElement.naturalHeight }
  const aspectRatio = dims.width / dims.height
  const correctedKps = result.kps.map(k => {
    let x = k.x, y = k.y
    if (aspectRatio < 1) x = 0.5 + (x - 0.5) * aspectRatio
    else if (aspectRatio > 1) y = 0.5 + (y - 0.5) / aspectRatio
    return { x, y, visibility: k.visibility ?? 1 }
  })

  // 평균 visibility = confidence
  const avgVis = correctedKps.reduce((s, k) => s + (k.visibility ?? 1), 0) / correctedKps.length

  return {
    rigData: kps2DToRigData(correctedKps),
    kps2D: correctedKps,
    rawKps2D: result.kps,
    aspectRatio,
    imageDims: dims,
    confidence: avgVis,
    notes: result.label,
    engine: result.source,   // 'mediapipe' | 'colorize+mediapipe' | 'vision'
  }
}

function fallbackKps2D() {
  // T-pose 기본 좌표 (0..1)
  return [
    { x: 0.50, y: 0.10, visibility: 0 },  // nose
    { x: 0.50, y: 0.20, visibility: 0 },  // neck
    { x: 0.42, y: 0.24, visibility: 0 },  // r_shoulder
    { x: 0.34, y: 0.38, visibility: 0 },  // r_elbow
    { x: 0.28, y: 0.52, visibility: 0 },  // r_wrist
    { x: 0.58, y: 0.24, visibility: 0 },  // l_shoulder
    { x: 0.66, y: 0.38, visibility: 0 },  // l_elbow
    { x: 0.72, y: 0.52, visibility: 0 },  // l_wrist
    { x: 0.45, y: 0.56, visibility: 0 },  // r_hip
    { x: 0.44, y: 0.74, visibility: 0 },  // r_knee
    { x: 0.43, y: 0.92, visibility: 0 },  // r_ankle
    { x: 0.55, y: 0.56, visibility: 0 },  // l_hip
    { x: 0.56, y: 0.74, visibility: 0 },  // l_knee
    { x: 0.57, y: 0.92, visibility: 0 },  // l_ankle
    { x: 0.48, y: 0.09, visibility: 0 },  // r_eye
    { x: 0.52, y: 0.09, visibility: 0 },  // l_eye
    { x: 0.45, y: 0.10, visibility: 0 },  // r_ear
    { x: 0.55, y: 0.10, visibility: 0 },  // l_ear
  ]
}

function blobToImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(new Error('이미지 로드 실패')) }
    img.src = url
  })
}
