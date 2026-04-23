/**
 * Graffiti Studio — AI 이미지 생성 통합 어댑터
 */

import { generateWithGemini } from './providers/gemini.js'
import { generateWithFlux } from './providers/flux.js'
import { generateWithGrok } from './providers/grok.js'
import { generateWithQwen } from './providers/qwen.js'
import { generateWithKling } from './providers/kling.js'
import { generateMock } from './providers/mock.js'

export async function generateImage(options) {
  const { model = 'auto', mock = false } = options
  if (mock || model === 'mock' || !hasAnyApiKey()) {
    return generateMock(options)
  }

  // 특정 gemini 모델 직접 지정 (nano-banana-3.1, nano-banana-3-pro)
  if (model === 'nano-banana-3.1' || model === 'gemini-3.1') {
    return await generateWithGemini({ ...options, modelOverride: 'gemini-3.1-flash-image-preview' })
  }
  if (model === 'nano-banana-3-pro' || model === 'gemini-3-pro') {
    return await generateWithGemini({ ...options, modelOverride: 'gemini-3-pro-image-preview' })
  }

  const resolvedModel = model === 'auto' ? autoSelectModel(options) : model
  try {
    switch (resolvedModel) {
      case 'gemini': return await generateWithGemini(options)
      case 'flux':   return await generateWithFlux(options)
      case 'grok':   return await generateWithGrok(options)
      case 'qwen':   return await generateWithQwen(options)
      case 'kling':  return await generateWithKling(options)
      default:       return await generateMock(options)
    }
  } catch (err) {
    console.error('[AI] ' + resolvedModel + ' 호출 실패:', err)
    // 'auto' 선택 시에만 조용히 mock fallback. 명시적 선택은 에러 그대로 던짐.
    if (model === 'auto' && resolvedModel !== 'mock') {
      console.warn('[AI] auto 모드 → mock으로 fallback')
      return generateMock({ ...options, _fallbackReason: err.message })
    }
    throw err
  }
}

function autoSelectModel({ sceneMood, purpose }) {
  if (purpose === '3d_print_sheet') return 'gemini'
  if (sceneMood === 'action' || sceneMood === 'dynamic') return 'flux'
  return 'gemini'
}

function hasAnyApiKey() {
  return !!(
    import.meta.env.VITE_GEMINI_API_KEY ||
    import.meta.env.VITE_FAL_API_KEY ||
    import.meta.env.VITE_GROK_API_KEY ||
    import.meta.env.VITE_QWEN_API_KEY ||
    import.meta.env.VITE_DASHSCOPE_API_KEY ||
    import.meta.env.VITE_KLING_JWT ||
    import.meta.env.VITE_KLING_ACCESS_KEY
  )
}

/**
 * 🎭 캐릭터 교체 — 순차 호출로 여러 명 교체.
 *
 * 여러 명일 경우:
 *   1. 첫 번째 대상 교체 → 결과 이미지 받음
 *   2. 그 결과를 다음 대상의 "원본"으로 사용 → 두 번째 교체
 *   3. 반복...
 * 이렇게 하면 "마지막만 적용" 버그 해결 + 각자 다른 설명 확실히 반영.
 *
 * options:
 *   sourceImage: 원본 Blob/URL
 *   targets: [{ slotIdx, description, reference }]
 *   strength: 'soft' | 'medium' | 'strong' (교체 강도 — 원본 유지 정도)
 *   preserveBackground: boolean
 *   onProgress: (step, total, current) => void
 */
export async function swapCharacter({
  sourceImage,
  targets,
  targetDescription,
  targetReference = null,
  targetIdx = 1,
  strength = 'medium',
  preserveBackground = true,
  mock = false,
  onProgress,
}) {
  if (!sourceImage) throw new Error('원본 이미지 필요')

  if (!targets || targets.length === 0) {
    targets = [{ slotIdx: targetIdx, description: targetDescription || '', reference: targetReference }]
  }

  let currentSource = sourceImage
  let lastResult = null

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    onProgress?.({ step: i + 1, total: targets.length, current: t })

    const pos = t.slotIdx === 1 ? 'the main (1st) character'
             : t.slotIdx === 2 ? 'the 2nd character from left'
             : t.slotIdx === 3 ? 'the 3rd character from left'
             : `the ${t.slotIdx}th character`

    const desc = t.description?.trim() || 'a completely different-looking character (new face, body, hair, outfit)'

    // 강도 프롬프트 강화
    const strengthPhrase = strength === 'strong'
      ? 'COMPLETELY REPLACE this character. Change the face, body shape, hair, outfit — make them a totally new person. Do NOT preserve the original appearance.'
      : strength === 'medium'
      ? 'Replace this character with the new one. Change face, hair, and outfit substantially.'
      : 'Subtly modify the character while keeping some resemblance.'

    const refs = [currentSource]
    if (t.reference) refs.push(t.reference)

    const prompt = [
      `Edit the provided image.`,
      strengthPhrase,
      `Target: Replace ${pos} with: ${desc}.`,
      preserveBackground
        ? `IMPORTANT: Keep the background, lighting, composition, framing, and any OTHER (non-targeted) characters exactly the same.`
        : ``,
      t.reference ? `Use the second reference image as the visual source for the new character.` : ``,
      `Only character ${pos} should change; everything else must remain identical.`,
    ].filter(Boolean).join(' ')

    const result = await generateImage({
      prompt,
      references: refs,
      model: 'gemini',
      mock,
    })

    lastResult = result
    currentSource = result.blob || result.url  // 다음 교체의 원본으로
  }

  return lastResult
}

/**
 * 8면 시트 일괄 생성.
 */
export async function generateEightViewSheet({ anchorImage, character_dna, style, model = 'gemini', onProgress }) {
  const angles = [
    { key: 'front',       label: '정면',    deg: 0 },
    { key: 'front-right', label: '우3/4',   deg: 45 },
    { key: 'right',       label: '우측면',  deg: 90 },
    { key: 'back-right',  label: '뒤우3/4', deg: 135 },
    { key: 'back',        label: '뒷면',    deg: 180 },
    { key: 'back-left',   label: '뒤좌3/4', deg: 225 },
    { key: 'left',        label: '좌측면',  deg: 270 },
    { key: 'front-left',  label: '좌3/4',   deg: 315 },
  ]
  const results = []
  const refs = [anchorImage]
  for (let i = 0; i < angles.length; i++) {
    const angle = angles[i]
    onProgress?.({ step: i + 1, total: 8, angle: angle.label })
    const prompt = [
      character_dna,
      `view angle: ${angle.label} (${angle.deg} degrees rotation around Y-axis)`,
      `orthographic projection, flat lighting, clean white background`,
      `T-pose or A-pose, consistent with reference image`,
      style ? `style: ${style}` : ''
    ].filter(Boolean).join('. ')
    const result = await generateImage({
      prompt, references: refs.slice(0, 8),
      model, purpose: '3d_print_sheet',
    })
    results.push({ ...angle, ...result })
    refs.push(result.blob || result.url)
  }
  onProgress?.({ step: 8, total: 8, angle: '완료' })
  return results
}

/**
 * 스켈레톤 리그 → PNG Blob (이미지 생성 참조용).
 *
 * OpenPose / ControlNet 표준 — 검정 배경 + COCO RGB 컬러 본.
 * 노트북 가이드: "COCO 표준 색상 그대로 써야 Gemini가 OpenPose pose data로 인식"
 *
 * @param rig — rigData (joints, bones)
 * @param opts.hiddenJoints — {[jointId]: true} 사용자가 완전 숨긴 관절
 * @param opts.hiddenBones — Set<boneKey> 사용자가 숨긴 본 (boneKey = 'fromId-toId')
 */
export async function renderSkeletonToBlob(rig, { size = 512, hiddenJoints = {}, hiddenBones = new Set(), dashedBones = new Set() } = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  // 배경: 순흑
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)

  const s = size / 100
  const jointMap = Object.fromEntries(rig.joints.map(j => [j.id, j]))

  // 본 — rig에 들어있는 COCO 컬러 그대로 사용 (사용자 숨김 본은 제외, 점선은 dashed 스타일)
  ctx.lineCap = 'round'
  for (const [fromId, toId, color] of rig.bones) {
    const a = jointMap[fromId]; const b = jointMap[toId]
    if (!a || !b) continue
    if (hiddenJoints[fromId] || hiddenJoints[toId]) continue
    if (hiddenBones.has(`${fromId}-${toId}`)) continue
    const isDashed = dashedBones.has(`${fromId}-${toId}`)
    ctx.strokeStyle = color || '#888888'
    ctx.lineWidth = 6
    ctx.setLineDash(isDashed ? [8, 6] : [])
    ctx.beginPath()
    ctx.moveTo(a.x * s, a.y * s)
    ctx.lineTo(b.x * s, b.y * s)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // 관절 (사용자 숨김 제외)
  for (const j of rig.joints) {
    if (hiddenJoints[j.id]) continue
    let fill = '#ff0000'
    if (j.id === 'nose') fill = '#ff00aa'
    else if (j.type === 'eye') fill = '#ff00ff'
    else if (j.type === 'ear') fill = '#ff5500'
    else if (j.id === 'neck') fill = '#ff0055'
    else if (j.id === 'r_shoulder') fill = '#ff0000'
    else if (j.id === 'l_shoulder') fill = '#85ff00'
    else if (j.id === 'r_elbow') fill = '#ff8500'
    else if (j.id === 'l_elbow') fill = '#00ff00'
    else if (j.id === 'r_wrist') fill = '#ffff00'
    else if (j.id === 'l_wrist') fill = '#00ff85'
    else if (j.id === 'r_hip') fill = '#00ffff'
    else if (j.id === 'l_hip') fill = '#8500ff'
    else if (j.id === 'r_knee') fill = '#0085ff'
    else if (j.id === 'l_knee') fill = '#aa00ff'
    else if (j.id === 'r_ankle') fill = '#0000ff'
    else if (j.id === 'l_ankle') fill = '#ff00ff'
    ctx.fillStyle = fill
    const r = j.type === 'head' || j.type === 'eye' || j.type === 'ear' ? 4 : 7
    ctx.beginPath()
    ctx.arc(j.x * s, j.y * s, r, 0, Math.PI * 2)
    ctx.fill()
  }

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}
