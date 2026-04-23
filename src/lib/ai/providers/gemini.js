/**
 * Gemini Nano Banana — 노트북 아크 인수인계 기준 (2026-04-22).
 *
 * 모델 체인:
 *   1순위 `gemini-3.1-flash-image-preview`  (Nano Banana 2, 기본)
 *   2순위 `gemini-3-pro-image-preview`       (Nano Banana Pro, 고품질 fallback)
 *
 * ⛔ 2.5-flash-image 는 영구 배제 — 포즈 가이드 무시함.
 *
 * 현재 구현: fetch로 Google REST API 직접 호출 (개발 환경).
 * 프로덕션은 Firebase AI Logic 프록시 경유 권장.
 */

export const NANO_BANANA_CHAIN = [
  'gemini-3.1-flash-image-preview',   // Nano Banana 2
  'gemini-3-pro-image-preview',       // Nano Banana Pro
]

export async function generateWithGemini({ prompt, references = [], aspectRatio, modelOverride = null }) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY 미설정')

  // Parts — 이미지를 먼저, text를 마지막에 (노트북 아크 지침)
  const parts = []
  for (const ref of references.slice(0, 14)) {
    const base64 = await refToBase64(ref)
    if (base64) {
      parts.push({
        inlineData: { mimeType: 'image/png', data: base64 },
      })
    }
  }
  parts.push({ text: prompt })

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
    },
  }

  // 모델 체인 — modelOverride 지정 시 그것만, 아니면 1→2 폴백
  const chain = modelOverride ? [modelOverride] : NANO_BANANA_CHAIN
  let lastErr = null
  for (const model of chain) {
    try {
      console.log(`[nano-banana] ${model} 호출 (refs=${references.length}, aspect=${aspectRatio || '기본'})`)
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errText = await res.text()
        lastErr = new Error(`${model} ${res.status}: ${errText.slice(0, 180)}`)
        console.warn(`[nano-banana] ${model} 실패, 다음 체인 시도:`, lastErr.message)
        continue
      }
      const data = await res.json()
      const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)
      if (!imagePart) {
        lastErr = new Error(`${model} 응답에 이미지 없음`)
        continue
      }
      const imgBlob = base64ToBlob(imagePart.inlineData.data, imagePart.inlineData.mimeType || 'image/png')
      const imgUrl = URL.createObjectURL(imgBlob)
      console.log(`[nano-banana] ${model} 성공`)
      return {
        blob: imgBlob,
        url: imgUrl,
        meta: { model, prompt, aspectRatio, raw: data },
      }
    } catch (e) {
      lastErr = e
      console.warn(`[nano-banana] ${model} 예외:`, e.message)
    }
  }
  throw new Error(`Nano Banana 체인 전부 실패: ${lastErr?.message || 'unknown'}`)
}

async function refToBase64(ref) {
  if (!ref) return null
  if (typeof ref === 'string') {
    if (ref.startsWith('data:')) return ref.split(',')[1]
    const r = await fetch(ref)
    const blob = await r.blob()
    return blobToBase64(blob)
  }
  if (ref instanceof Blob) return blobToBase64(ref)
  return null
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function base64ToBlob(b64, mimeType) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}
