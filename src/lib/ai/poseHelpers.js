// ─────────────────────────────────────────────────────────────
//  poseHelpers.js — 노트북 novel-workstation poseEditService.js 발췌
//  경로: src/lib/ai/poseHelpers.js
//
//  포함 함수:
//    - mediapipeToOpenPose(landmarks)        : MP 33 → OpenPose 18
//    - imageToBase64PngForVision(img, opts)  : Gemini 전송용 인코더 (격자 옵션)
//    - detectPoseViaAIVision(img)            : Gemini Vision 직접 감지 (최종 폴백)
//    - colorizeImageForDetection(img)        : Nano Banana 채색 (흑백 데생 대응)
//
//  ⚠ 노트북 원본 그대로 — 임의 수정 금지
// ─────────────────────────────────────────────────────────────

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY

const NANO_BANANA_CHAIN = [
  'gemini-3.1-flash-image-preview',   // Nano Banana 2
  'gemini-3-pro-image-preview',       // Nano Banana Pro
]

const OPENPOSE_NAMES_FOR_AI = [
  'nose', 'neck', 'right_shoulder', 'right_elbow', 'right_wrist',
  'left_shoulder', 'left_elbow', 'left_wrist',
  'right_hip', 'right_knee', 'right_ankle',
  'left_hip', 'left_knee', 'left_ankle',
  'right_eye', 'left_eye', 'right_ear', 'left_ear',
]

// ═════════════════════════════════════════════════════════════
//  MediaPipe Pose → OpenPose 18키포인트 변환
//  MediaPipe는 33포인트를 반환하므로 COCO 18포인트로 매핑 필요
// ═════════════════════════════════════════════════════════════
const MEDIAPIPE_TO_OPENPOSE = {
  0: 0,    // nose
  // 1 (neck): 양 어깨(11, 12) 중점으로 계산
  2: 12,   // right shoulder
  3: 14,   // right elbow
  4: 16,   // right wrist
  5: 11,   // left shoulder
  6: 13,   // left elbow
  7: 15,   // left wrist
  8: 24,   // right hip
  9: 26,   // right knee
  10: 28,  // right ankle
  11: 23,  // left hip
  12: 25,  // left knee
  13: 27,  // left ankle
  14: 5,   // right eye
  15: 2,   // left eye
  16: 8,   // right ear
  17: 7,   // left ear
}

export function mediapipeToOpenPose(mediapipeLandmarks) {
  if (!Array.isArray(mediapipeLandmarks) || mediapipeLandmarks.length < 25) {
    throw new Error('MediaPipe 랜드마크가 33개 있어야 합니다')
  }
  const result = new Array(18).fill(null)
  for (const [openIdxStr, mpIdx] of Object.entries(MEDIAPIPE_TO_OPENPOSE)) {
    const openIdx = Number(openIdxStr)
    const lm = mediapipeLandmarks[mpIdx]
    if (!lm) continue
    result[openIdx] = { x: lm.x, y: lm.y, visibility: lm.visibility ?? 1 }
  }
  // neck(1) = 양 어깨 중점
  const ls = mediapipeLandmarks[11]
  const rs = mediapipeLandmarks[12]
  if (ls && rs) {
    result[1] = {
      x: (ls.x + rs.x) / 2,
      y: (ls.y + rs.y) / 2,
      visibility: Math.min(ls.visibility ?? 1, rs.visibility ?? 1),
    }
  }
  for (let i = 0; i < 18; i++) {
    if (!result[i]) result[i] = { x: 0, y: 0, visibility: 0 }
  }
  return result
}

// ═════════════════════════════════════════════════════════════
//  Gemini 전송용 이미지 인코더 (격자 오버레이 옵션)
// ═════════════════════════════════════════════════════════════
export async function imageToBase64PngForVision(imgElement, { addGridOverlay = false } = {}) {
  const maxSide = 2048
  const iw = imgElement.naturalWidth || imgElement.width
  const ih = imgElement.naturalHeight || imgElement.height
  const ratio = Math.min(1, maxSide / Math.max(iw, ih))
  const w = Math.round(iw * ratio)
  const h = Math.round(ih * ratio)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(imgElement, 0, 0, w, h)
  if (addGridOverlay) {
    ctx.save()
    ctx.strokeStyle = 'rgba(255, 0, 255, 0.22)'
    ctx.lineWidth = 1
    ctx.font = `bold ${Math.max(10, Math.round(w / 80))}px sans-serif`
    ctx.fillStyle = 'rgba(255, 0, 255, 0.85)'
    ctx.textBaseline = 'top'
    for (let i = 1; i < 10; i++) {
      const x = (w * i) / 10
      const y = (h * i) / 10
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
      ctx.fillText(`${(i / 10).toFixed(1)}`, x + 2, 2)
      ctx.fillText(`${(i / 10).toFixed(1)}`, 2, y + 2)
    }
    ctx.restore()
  }
  const dataUrl = canvas.toDataURL('image/png')
  const base64 = dataUrl.split(',')[1] || ''
  return { base64, mimeType: 'image/png', width: w, height: h }
}

// ═════════════════════════════════════════════════════════════
//  Gemini Vision 직접 감지 (최종 폴백)
// ═════════════════════════════════════════════════════════════
export async function detectPoseViaAIVision(imgElement) {
  if (!GEMINI_KEY) throw new Error('VITE_GEMINI_API_KEY 설정 필요 (AI Vision 폴백용)')
  const { base64, mimeType } = await imageToBase64PngForVision(imgElement, { addGridOverlay: true })
  const VISION_CHAIN = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash']

  const systemPrompt = `You are an expert anatomical pose analyst for ILLUSTRATIONS, especially PENCIL SKETCHES, INK DRAWINGS, and MONOCHROME ARTWORK. You are NOT analyzing a photograph — you are reading an artist's drawing.

CRITICAL CONTEXT:
This image may be a rough pencil sketch or a black-and-white line drawing of a human body. Lines define the anatomy. You must interpret pencil strokes, cross-hatching, and foreshortening as actual limbs. Do NOT refuse or give up if the image is "low quality" — that is the NORMAL case for this task.

THE IMAGE HAS A PINK GRID OVERLAY:
• Grid lines divide the image into 10x10 cells.
• The labels "0.1, 0.2, 0.3, ..." on the top edge mark the x coordinate.
• The labels "0.1, 0.2, 0.3, ..." on the left edge mark the y coordinate.
• Use the grid to read joint positions precisely.
• (0,0) is TOP-LEFT. (1,1) is BOTTOM-RIGHT.

STEP-BY-STEP ANALYSIS (do this mentally before writing JSON):
1. Find the HEAD/FACE first. Where is the top of the skull? Where is the chin?
2. Find the TORSO. Where are the shoulders? Where are the hips?
3. Trace each ARM from shoulder → elbow → wrist (use hatching or arm outline).
4. Trace each LEG from hip → knee → ankle.
5. For occluded or cropped joints (e.g. "out of frame" or "behind body"):
   - Estimate the most likely position based on anatomy.
   - Mark visibility: 0 but still give coords.

KEYPOINT ORDER (exactly these 18, in this order):
0. nose                     — tip of the nose / center of the face
1. neck                     — base of neck, between shoulders, right below the chin
2. right_shoulder           — CHARACTER'S right shoulder (on the VIEWER'S LEFT side)
3. right_elbow
4. right_wrist              — joint at the base of the hand
5. left_shoulder            — CHARACTER'S left (VIEWER'S RIGHT)
6. left_elbow
7. left_wrist
8. right_hip                — CHARACTER'S right hip joint
9. right_knee
10. right_ankle             — joint just above the foot
11. left_hip
12. left_knee
13. left_ankle
14. right_eye               — slightly above and to the right of nose (from CHARACTER's POV)
15. left_eye
16. right_ear
17. left_ear

⚠️ "right" always means the CHARACTER'S right side, NOT the viewer's right.
If the character faces the camera, their right shoulder appears on the LEFT of the image.

OUTPUT FORMAT (strict JSON, no markdown fences, no extra text):
{
  "analysis": "brief description of pose and body orientation (1 sentence)",
  "image_type": "sketch | ink drawing | color illustration | photo | other",
  "keypoints": [
    {"name": "nose",           "x": 0.50, "y": 0.15, "visibility": 1},
    {"name": "neck",           "x": 0.50, "y": 0.22, "visibility": 1},
    {"name": "right_shoulder", "x": 0.42, "y": 0.24, "visibility": 1},
    {"name": "right_elbow",    "x": 0.36, "y": 0.36, "visibility": 1},
    {"name": "right_wrist",    "x": 0.30, "y": 0.48, "visibility": 1},
    {"name": "left_shoulder",  "x": 0.58, "y": 0.24, "visibility": 1},
    {"name": "left_elbow",     "x": 0.64, "y": 0.36, "visibility": 1},
    {"name": "left_wrist",     "x": 0.70, "y": 0.48, "visibility": 1},
    {"name": "right_hip",      "x": 0.46, "y": 0.52, "visibility": 1},
    {"name": "right_knee",     "x": 0.45, "y": 0.70, "visibility": 1},
    {"name": "right_ankle",    "x": 0.44, "y": 0.88, "visibility": 1},
    {"name": "left_hip",       "x": 0.54, "y": 0.52, "visibility": 1},
    {"name": "left_knee",      "x": 0.55, "y": 0.70, "visibility": 1},
    {"name": "left_ankle",     "x": 0.56, "y": 0.88, "visibility": 1},
    {"name": "right_eye",      "x": 0.47, "y": 0.14, "visibility": 1},
    {"name": "left_eye",       "x": 0.53, "y": 0.14, "visibility": 1},
    {"name": "right_ear",      "x": 0.45, "y": 0.15, "visibility": 1},
    {"name": "left_ear",       "x": 0.55, "y": 0.15, "visibility": 1}
  ]
}

RULES:
• Return ALL 18 entries in EXACTLY this order.
• x, y must be between 0.0 and 1.0.
• NEVER return coordinates outside the actual character's bounding area.
• If you truly cannot see the pose (image is blank), still return T-pose defaults with visibility: 0.
• DO NOT refuse because "image is a sketch" — sketches are what you are EXPECTED to analyze.
• Use the pink grid on the image to read exact positions.`

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64 } },
        { text: systemPrompt },
      ],
    }],
    generationConfig: {
      temperature: 0.0,
      responseMimeType: 'application/json',
      maxOutputTokens: 4096,
    },
  }

  let lastErr = null
  for (const model of VISION_CHAIN) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        lastErr = new Error(`${model} HTTP ${res.status} ${errText.slice(0, 120)}`)
        console.warn(`[AI Vision] ${model} 실패:`, lastErr.message)
        continue
      }
      const json = await res.json()
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      if (!text) { lastErr = new Error(`${model} 빈 응답`); continue }
      const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
      let parsed
      try { parsed = JSON.parse(cleaned) }
      catch (parseErr) { lastErr = new Error(`${model} JSON 파싱 실패: ${parseErr.message}`); continue }
      const kpsArr = parsed.keypoints || parsed
      if (!Array.isArray(kpsArr) || kpsArr.length < 18) {
        lastErr = new Error(`${model} 키포인트 배열 불량 (len=${kpsArr?.length})`)
        continue
      }
      const byName = {}
      for (const kp of kpsArr) { if (kp?.name) byName[kp.name] = kp }
      const ordered = OPENPOSE_NAMES_FOR_AI.map((name, idx) => {
        const src = byName[name] || kpsArr[idx]
        if (!src) return { x: 0.5, y: 0.5, visibility: 0 }
        return {
          x: Math.max(0, Math.min(1, Number(src.x) || 0.5)),
          y: Math.max(0, Math.min(1, Number(src.y) || 0.5)),
          visibility: Number(src.visibility) >= 0.5 ? 1 : 0,
        }
      })
      const xSpread = Math.max(...ordered.map(p => p.x)) - Math.min(...ordered.map(p => p.x))
      const ySpread = Math.max(...ordered.map(p => p.y)) - Math.min(...ordered.map(p => p.y))
      if (xSpread < 0.1 && ySpread < 0.1) {
        lastErr = new Error(`${model} 키포인트 분산 부족`)
        continue
      }
      console.log(`[AI Vision] ${model} 성공`, { analysis: parsed.analysis, image_type: parsed.image_type })
      return ordered
    } catch (e) { lastErr = e }
  }
  throw new Error(`AI Vision 폴백 실패: ${lastErr?.message || 'unknown'}`)
}

// ═════════════════════════════════════════════════════════════
//  Nano Banana 채색 폴백 (흑백 데생 대응)
// ═════════════════════════════════════════════════════════════
export async function colorizeImageForDetection(imgElement) {
  if (!GEMINI_KEY) throw new Error('VITE_GEMINI_API_KEY 설정 필요 (채색용)')
  const { base64, mimeType } = await imageToBase64PngForVision(imgElement)
  const instruction = `TASK: Colorize this black-and-white or monochrome sketch into a simple color illustration.

🚨 ABSOLUTE RULE: THE POSE MUST NOT CHANGE.
Every limb, joint, and body position in your output must match the input EXACTLY.
Do not reinterpret the pose. Just add color to the existing lines.

COLORIZATION RULES:
• Skin: natural human skin tone (light peach, tan, or medium beige — whatever fits)
• Hair: pick a single natural color (black, brown, blonde, etc.)
• Clothing: solid colors (not patterns). Shirts one color, pants another.
• Eyes: visible with iris color (so facial features are clear)
• Background: simple, solid light color (white, cream, light gray) — NOT detailed
• Style: soft-shaded painted illustration (NOT flat anime, NOT sketch)
• Add subtle gradient shading to give the body 3D form

WHY: The output will be analyzed by a computer-vision pose detector that was trained on photographs. The detector needs:
• Clear skin-tone vs background contrast
• Recognizable facial features (eyes, nose, mouth)
• Solid body silhouette
• No cross-hatching, no sketch lines remaining

OUTPUT:
• ONE full-body image of the same character in the same pose.
• No text, no watermark, no grid overlay.
• Same framing and aspect ratio as input.`

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: instruction },
      ],
    }],
    generationConfig: { responseModalities: ['IMAGE'] },
  }

  let lastErr = null
  for (const modelId of NANO_BANANA_CHAIN) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_KEY}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.error) {
        lastErr = new Error(`${modelId}: ${data.error.message}`)
        continue
      }
      const parts = data?.candidates?.[0]?.content?.parts || []
      const imgPart = parts.find(p => p.inlineData?.data)
      if (!imgPart) {
        lastErr = new Error(`${modelId}: no image in response`)
        continue
      }
      const outMime = imgPart.inlineData.mimeType || 'image/png'
      const dataUrl = `data:${outMime};base64,${imgPart.inlineData.data}`
      const colorizedImg = await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = reject
        img.src = dataUrl
      })
      console.log(`[colorize] ${modelId} 성공 — ${colorizedImg.naturalWidth}x${colorizedImg.naturalHeight}`)
      return colorizedImg
    } catch (e) { lastErr = e }
  }
  throw new Error(`채색 실패: ${lastErr?.message || 'unknown'}`)
}
