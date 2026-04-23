// ─────────────────────────────────────────────────────────────
//  poseDetection.js — 이미지에서 OpenPose 18-키포인트 자동 감지
//  경로: src/lib/ai/poseDetection.js
//
//  ⚠ 노트북 novel-workstation/services/poseDetection.js 그대로 포팅
//    임의 수정 금지 — 노트북과 결과 100% 일치 목표
//
//  파이프라인 (성공할 때까지 순차 시도):
//    1. MediaPipe 7패스 (plain/enhance/sketch × complexity 0~2 × conf 0.08~0.4)
//       - isValidSpread 필터로 랜드마크 클러스터링된 '가짜 감지' 거름
//    2. 실패 시 Nano Banana(Gemini)로 채색 후 MediaPipe 3패스 재시도
//    3. 그래도 실패하면 Gemini Vision AI로 직접 18-포인트 반환
//    4. 모두 실패하면 { kps: null, reason: '...' } 반환
// ─────────────────────────────────────────────────────────────

import {
  mediapipeToOpenPose,
  detectPoseViaAIVision,
  colorizeImageForDetection,
} from './poseHelpers.js'

// ═════════════════════════════════════════════════════════════
//   이미지 전처리
// ═════════════════════════════════════════════════════════════
function preprocessForDetection(imgElement, { preprocessMode = 'plain' } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = imgElement.naturalWidth || imgElement.width
  canvas.height = imgElement.naturalHeight || imgElement.height
  const ctx = canvas.getContext('2d')

  if (preprocessMode === 'sketch') {
    const blurPx = Math.max(1.5, Math.min(4, Math.round(canvas.width / 500)))
    ctx.filter = `blur(${blurPx}px)`
  }
  ctx.drawImage(imgElement, 0, 0)
  ctx.filter = 'none'
  if (preprocessMode === 'plain') return canvas

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = data.data

  let sampleChroma = 0, samples = 0
  let lumMin = 255, lumMax = 0
  const step = Math.max(1, Math.floor(d.length / (4 * 8000)))
  for (let i = 0; i < d.length; i += 4 * step) {
    const r = d[i], g = d[i + 1], b = d[i + 2]
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    if (lum < lumMin) lumMin = lum
    if (lum > lumMax) lumMax = lum
    sampleChroma += Math.max(r, g, b) - Math.min(r, g, b)
    samples++
  }
  const avgChroma = sampleChroma / Math.max(1, samples)
  const nearlyGray = avgChroma < 12

  if (preprocessMode === 'enhance') {
    const contrast = 1.35
    const midpoint = 128
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2]
      r = (r - midpoint) * contrast + midpoint
      g = (g - midpoint) * contrast + midpoint
      b = (b - midpoint) * contrast + midpoint
      if (nearlyGray) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b
        r = lum * 1.05; g = lum * 0.95; b = lum * 0.85
      }
      d[i] = Math.max(0, Math.min(255, r))
      d[i + 1] = Math.max(0, Math.min(255, g))
      d[i + 2] = Math.max(0, Math.min(255, b))
    }
  } else if (preprocessMode === 'sketch') {
    const range = Math.max(1, lumMax - lumMin)
    const SKIN_R = 230, SKIN_G = 195, SKIN_B = 168
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2]
      const lum = 0.299 * r + 0.587 * g + 0.114 * b
      const normLum = Math.max(0, Math.min(255, ((lum - lumMin) / range) * 255))
      if (nearlyGray) {
        const t = normLum / 255
        const skinMix = 1 - Math.abs(t - 0.5) * 2
        r = t * 255 * (1 - skinMix * 0.4) + SKIN_R * skinMix * 0.4
        g = t * 240 * (1 - skinMix * 0.4) + SKIN_G * skinMix * 0.4
        b = t * 220 * (1 - skinMix * 0.4) + SKIN_B * skinMix * 0.4
      } else {
        const ratio = normLum / Math.max(1, lum)
        r = r * ratio
        g = g * ratio
        b = b * ratio
      }
      d[i] = Math.max(0, Math.min(255, r))
      d[i + 1] = Math.max(0, Math.min(255, g))
      d[i + 2] = Math.max(0, Math.min(255, b))
    }
  }
  ctx.putImageData(data, 0, 0)
  return canvas
}

// ═════════════════════════════════════════════════════════════
//   MediaPipe CDN 로딩 (한 번만)
// ═════════════════════════════════════════════════════════════
let mediapipeLoadPromise = null
function loadMediaPipe() {
  if (typeof window !== 'undefined' && window.Pose) return Promise.resolve()
  if (mediapipeLoadPromise) return mediapipeLoadPromise
  mediapipeLoadPromise = new Promise((resolve, reject) => {
    if (document.querySelector('script[data-mp-pose]')) {
      const existing = document.querySelector('script[data-mp-pose]')
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('MediaPipe 로딩 실패')))
      if (window.Pose) resolve()
      return
    }
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/pose.js'
    s.dataset.mpPose = '1'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('MediaPipe 로딩 실패'))
    document.head.appendChild(s)
  })
  return mediapipeLoadPromise
}

// ═════════════════════════════════════════════════════════════
//   단일 MediaPipe 패스
// ═════════════════════════════════════════════════════════════
async function runSinglePass(inputCanvas, { modelComplexity, confidence }) {
  const Pose = window.Pose
  const pose = new Pose({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`,
  })
  pose.setOptions({
    modelComplexity,
    smoothLandmarks: false,
    enableSegmentation: false,
    minDetectionConfidence: confidence,
    minTrackingConfidence: confidence,
  })
  const resultPromise = new Promise((resolve) => pose.onResults(resolve))
  await pose.send({ image: inputCanvas })
  const results = await resultPromise
  pose.close()
  return results
}

// ═════════════════════════════════════════════════════════════
//   가짜 감지 필터
// ═════════════════════════════════════════════════════════════
function isValidSpread(landmarks, label) {
  if (!landmarks || landmarks.length < 25) return false
  const visible = landmarks.filter(p => (p.visibility ?? 1) > 0.2)
  const pool = visible.length >= 10 ? visible : landmarks
  const xs = pool.map(p => p.x)
  const ys = pool.map(p => p.y)
  const xSpread = Math.max(...xs) - Math.min(...xs)
  const ySpread = Math.max(...ys) - Math.min(...ys)
  if (xSpread < 0.12 || ySpread < 0.2) {
    console.warn(
      `[poseDetection] ${label} 분산 부족 → 가짜 감지 (xSpread=${xSpread.toFixed(3)}, ySpread=${ySpread.toFixed(3)})`,
    )
    return false
  }
  return true
}

function clampKps(kps) {
  return kps.map(k => ({
    ...k,
    x: Math.max(0, Math.min(1, k.x ?? 0.5)),
    y: Math.max(0, Math.min(1, k.y ?? 0.5)),
  }))
}

// ═════════════════════════════════════════════════════════════
//   메인 API — 이미지에서 18-포인트 OpenPose 스켈레톤 감지
// ═════════════════════════════════════════════════════════════
/**
 * 이미지에서 OpenPose 18-키포인트 스켈레톤 자동 감지.
 *
 * @param {HTMLImageElement} imgElement - 감지할 이미지 (load 완료된 상태)
 * @param {Object} [options]
 * @param {(msg: string) => void} [options.onProgress] - 진행 메시지 콜백
 * @param {boolean} [options.useColorizeFallback=true] - Nano Banana 채색 폴백 사용
 * @param {boolean} [options.useVisionFallback=true]   - Gemini Vision 폴백 사용
 * @returns {Promise<{
 *   kps: Array<{x:number, y:number, visibility:number}> | null,
 *   source: 'mediapipe' | 'colorize+mediapipe' | 'vision' | null,
 *   label: string,
 *   reason?: string,
 * }>}
 */
export async function detectPoseFromImage(imgElement, options = {}) {
  const {
    onProgress = () => {},
    useColorizeFallback = true,
    useVisionFallback = true,
  } = options

  if (!imgElement) {
    return { kps: null, source: null, label: '', reason: 'imgElement 없음' }
  }

  // ─── MediaPipe 로드 ──
  try {
    onProgress('MediaPipe 로딩 중...')
    await loadMediaPipe()
    if (!window.Pose) throw new Error('window.Pose 없음')
  } catch (err) {
    console.warn('[poseDetection] MediaPipe 로드 실패:', err)
    if (useVisionFallback) {
      try {
        onProgress('CDN 실패 → Vision AI로 재시도...')
        const aiKps = await detectPoseViaAIVision(imgElement)
        if (aiKps && aiKps.length === 18) {
          return { kps: clampKps(aiKps), source: 'vision', label: 'Gemini Vision' }
        }
      } catch (e) { /* fall-through */ }
    }
    return { kps: null, source: null, label: '', reason: 'MediaPipe 로드 실패' }
  }

  // ─── 1차: MediaPipe 7패스 ──
  const passes = [
    { mode: 'plain',   modelComplexity: 2, confidence: 0.4,  label: '표준(정밀)' },
    { mode: 'plain',   modelComplexity: 1, confidence: 0.25, label: '표준(완화)' },
    { mode: 'enhance', modelComplexity: 2, confidence: 0.2,  label: '보정(정밀)' },
    { mode: 'enhance', modelComplexity: 1, confidence: 0.15, label: '보정(완화)' },
    { mode: 'sketch',  modelComplexity: 2, confidence: 0.2,  label: '스케치(정밀)' },
    { mode: 'sketch',  modelComplexity: 1, confidence: 0.12, label: '스케치(완화)' },
    { mode: 'sketch',  modelComplexity: 0, confidence: 0.08, label: '스케치(최완화)' },
  ]

  for (const pass of passes) {
    onProgress(`감지 · ${pass.label}...`)
    try {
      const canvas = preprocessForDetection(imgElement, { preprocessMode: pass.mode })
      const r = await runSinglePass(canvas, {
        modelComplexity: pass.modelComplexity,
        confidence: pass.confidence,
      })
      if (r?.poseLandmarks && isValidSpread(r.poseLandmarks, pass.label)) {
        const openpose = mediapipeToOpenPose(r.poseLandmarks)
        return {
          kps: clampKps(openpose),
          source: 'mediapipe',
          label: pass.label,
        }
      }
    } catch (e) {
      console.warn(`[poseDetection] ${pass.label} 패스 실패:`, e)
    }
  }

  // ─── 2차: 채색 폴백 ──
  if (useColorizeFallback) {
    try {
      onProgress('MediaPipe 실패 → Nano Banana로 채색 중 (5~15초)...')
      const colorizedImg = await colorizeImageForDetection(imgElement)
      onProgress('채색 완료 → MediaPipe 재시도 중...')
      const colorPasses = [
        { mode: 'plain',   modelComplexity: 2, confidence: 0.35, label: '채색본(정밀)' },
        { mode: 'plain',   modelComplexity: 1, confidence: 0.2,  label: '채색본(완화)' },
        { mode: 'enhance', modelComplexity: 1, confidence: 0.15, label: '채색본+보정' },
      ]
      for (const pass of colorPasses) {
        onProgress(`재감지 · ${pass.label}...`)
        try {
          const canvas = preprocessForDetection(colorizedImg, { preprocessMode: pass.mode })
          const r = await runSinglePass(canvas, {
            modelComplexity: pass.modelComplexity,
            confidence: pass.confidence,
          })
          if (r?.poseLandmarks && isValidSpread(r.poseLandmarks, `${pass.label}(채색본)`)) {
            const openpose = mediapipeToOpenPose(r.poseLandmarks)
            return {
              kps: clampKps(openpose),
              source: 'colorize+mediapipe',
              label: pass.label,
            }
          }
        } catch (e) {
          console.warn(`[poseDetection] ${pass.label} 실패:`, e)
        }
      }
    } catch (colorErr) {
      console.warn('[poseDetection] 채색 단계 실패:', colorErr)
    }
  }

  // ─── 3차: Gemini Vision AI 폴백 ──
  if (useVisionFallback) {
    onProgress('채색 실패 → Gemini Vision으로 재분석 중 (10~20초)...')
    try {
      const aiKps = await detectPoseViaAIVision(imgElement)
      if (aiKps && aiKps.length === 18) {
        return {
          kps: clampKps(aiKps),
          source: 'vision',
          label: 'Gemini Vision AI',
        }
      }
    } catch (aiErr) {
      console.warn('[poseDetection] Vision 폴백 실패:', aiErr)
    }
  }

  return {
    kps: null,
    source: null,
    label: '',
    reason: 'MediaPipe + 채색 + Vision 모두 실패',
  }
}
