/**
 * Flux 1.1 Pro (fal.ai) 어댑터.
 *
 * fal.ai는 별도 클라이언트 SDK가 있지만, 여기선 REST 호출로 단순화.
 * 실제 사용 시 @fal-ai/serverless-client 패키지 도입 권장.
 */

const ENDPOINT = 'https://fal.run/fal-ai/flux-pro/v1.1'

export async function generateWithFlux({ prompt, aspectRatio = '3:4' }) {
  const apiKey = import.meta.env.VITE_FAL_API_KEY
  if (!apiKey) throw new Error('VITE_FAL_API_KEY 미설정')

  const imageSize = aspectRatio === '16:9' ? 'landscape_16_9'
                  : aspectRatio === '9:16' ? 'portrait_16_9'
                  : aspectRatio === '1:1'  ? 'square_hd'
                  : 'portrait_4_3'

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: imageSize,
      num_inference_steps: 28,
      guidance_scale: 3.5,
      num_images: 1,
      safety_tolerance: 2,
      output_format: 'png',
    })
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Flux API ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  const imageUrl = data.images?.[0]?.url
  if (!imageUrl) throw new Error('Flux 응답에 이미지 URL 없음')

  // URL → Blob
  const imgRes = await fetch(imageUrl)
  const blob = await imgRes.blob()
  const url = URL.createObjectURL(blob)

  return {
    blob,
    url,
    meta: { model: 'flux-pro-1.1', prompt, aspectRatio, originalUrl: imageUrl, raw: data }
  }
}
