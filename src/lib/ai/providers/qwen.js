/**
 * Qwen 이미지 생성 어댑터.
 *
 * 경로 2가지 지원:
 *   1) fal.ai 경유 (권장) — 이미 Flux로 쓰는 `VITE_FAL_API_KEY` 그대로 사용
 *      엔드포인트: https://fal.run/fal-ai/qwen-image
 *   2) Alibaba DashScope 직접 호출 — VITE_QWEN_API_KEY 또는 VITE_DASHSCOPE_API_KEY
 *
 * fal.ai 키가 있으면 fal.ai 우선. 없으면 DashScope 시도.
 */

const FAL_ENDPOINT = 'https://fal.run/fal-ai/qwen-image'
const DASHSCOPE_T2I = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis'

export async function generateWithQwen({ prompt, references = [], aspectRatio = '3:4' }) {
  // fal.ai 우선 (Flux와 키 공유)
  const falKey = import.meta.env.VITE_FAL_API_KEY
  if (falKey) {
    try {
      return await generateViaFal({ prompt, aspectRatio, falKey, references })
    } catch (e) {
      console.warn('[qwen] fal.ai 경로 실패, DashScope 시도:', e.message)
    }
  }

  // DashScope 직접
  const apiKey = import.meta.env.VITE_QWEN_API_KEY
               || import.meta.env.VITE_DASHSCOPE_API_KEY
               || import.meta.env.VITE_QWEN_KEY
               || import.meta.env.VITE_ALIBABA_API_KEY
  if (!apiKey) {
    throw new Error(
      'Qwen API 키 없음. 둘 중 하나 필요:\n' +
      '  (A) fal.ai: VITE_FAL_API_KEY (Flux와 공유)\n' +
      '  (B) Alibaba 직접: VITE_QWEN_API_KEY 또는 VITE_DASHSCOPE_API_KEY'
    )
  }
  return await generateViaDashScope({ prompt, aspectRatio, apiKey })
}

// ─── fal.ai 경로 (권장) ───
async function generateViaFal({ prompt, aspectRatio, falKey, references }) {
  const imageSize = aspectRatio === '16:9' ? 'landscape_16_9'
                  : aspectRatio === '9:16' ? 'portrait_16_9'
                  : aspectRatio === '1:1'  ? 'square_hd'
                  : 'portrait_4_3'

  const body = {
    prompt,
    image_size: imageSize,
    num_inference_steps: 30,
    guidance_scale: 4,
    num_images: 1,
    output_format: 'png',
  }

  const res = await fetch(FAL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`fal.ai/qwen ${res.status}: ${t.slice(0, 200)}`)
  }
  const data = await res.json()
  const imageUrl = data.images?.[0]?.url
  if (!imageUrl) throw new Error('fal.ai/qwen 응답에 이미지 URL 없음')
  const imgRes = await fetch(imageUrl)
  const blob = await imgRes.blob()
  return {
    blob, url: URL.createObjectURL(blob),
    meta: { model: 'qwen-image (via fal.ai)', prompt, aspectRatio, originalUrl: imageUrl, raw: data },
  }
}

// ─── DashScope 직접 경로 (fallback) ───
async function generateViaDashScope({ prompt, aspectRatio, apiKey }) {
  const size = aspectRatio === '16:9' ? '1280*720'
             : aspectRatio === '9:16' ? '720*1280'
             : aspectRatio === '1:1'  ? '1024*1024'
             : '720*960'

  const body = {
    model: 'wan2.2-t2i-plus',
    input: { prompt },
    parameters: { size, n: 1 },
  }
  const res = await fetch(DASHSCOPE_T2I, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`DashScope ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const taskId = data.output?.task_id
  if (!taskId) throw new Error('DashScope task_id 없음')

  const imageUrl = await pollTask(taskId, apiKey)
  const imgRes = await fetch(imageUrl)
  const blob = await imgRes.blob()
  return {
    blob, url: URL.createObjectURL(blob),
    meta: { model: 'qwen-wan2.2 (via DashScope)', prompt, aspectRatio, originalUrl: imageUrl, raw: data },
  }
}

async function pollTask(taskId, apiKey, maxWaitMs = 60000) {
  const url = `https://dashscope-intl.aliyuncs.com/api/v1/tasks/${taskId}`
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 2000))
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } })
    if (!res.ok) throw new Error(`DashScope polling ${res.status}`)
    const data = await res.json()
    const status = data.output?.task_status
    if (status === 'SUCCEEDED') {
      const img = data.output?.results?.[0]?.url
      if (!img) throw new Error('task 성공했으나 결과 URL 없음')
      return img
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new Error(`DashScope task ${status}: ${data.output?.message || ''}`)
    }
  }
  throw new Error('DashScope task timeout')
}
