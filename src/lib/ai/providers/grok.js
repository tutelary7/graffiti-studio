/**
 * xAI Grok 이미지 생성 어댑터.
 *
 * 모델 체인(실패 시 다음 시도):
 *   - grok-2-image-1212 (안정 버전 · 2024 말)
 *   - grok-2-image        (기본 alias)
 *   - grok-image           (Aurora alias)
 * 키별 권한 따라 일부만 동작할 수 있음.
 *
 * 환경변수:
 *   VITE_GROK_API_KEY
 *   VITE_GROK_MODEL (선택) — 특정 모델 고정하고 싶을 때
 */

const ENDPOINT = 'https://api.x.ai/v1/images/generations'
const FALLBACK_MODELS = ['grok-2-image-1212', 'grok-2-image', 'grok-image']

export async function generateWithGrok({ prompt, aspectRatio = '3:4' }) {
  const apiKey = import.meta.env.VITE_GROK_API_KEY
  if (!apiKey) throw new Error('VITE_GROK_API_KEY 미설정')

  const explicit = import.meta.env.VITE_GROK_MODEL
  const chain = explicit ? [explicit] : FALLBACK_MODELS

  let lastErr = null
  for (const model of chain) {
    try {
      console.log(`[grok] ${model} 시도`)
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          response_format: 'url',
        })
      })

      if (!res.ok) {
        const errText = await res.text()
        const errObj = safeJson(errText)
        // 특정 에러는 체인 진행 의미 없음 — 즉시 throw
        if (res.status === 401 || res.status === 403) {
          // 키 문제 — 다른 모델 시도해도 동일
          throw new Error(
            `Grok API ${res.status} — ${errObj?.error || errText.slice(0, 200)}\n` +
            `💡 해결: xAI 콘솔(console.x.ai)에서 (1) 이 키가 활성 상태인지 (2) 올바른 팀에서 발급됐는지 (3) 이미지 생성 권한이 있는지 확인`
          )
        }
        lastErr = new Error(`Grok ${model} ${res.status}: ${errText.slice(0, 150)}`)
        console.warn(`[grok] ${model} 실패, 다음 모델 시도:`, lastErr.message)
        continue
      }

      const data = await res.json()
      const imageUrl = data.data?.[0]?.url
      if (!imageUrl) {
        lastErr = new Error(`Grok ${model} 응답에 이미지 URL 없음`)
        continue
      }

      const imgRes = await fetch(imageUrl)
      const blob = await imgRes.blob()
      console.log(`[grok] ${model} 성공`)
      return {
        blob,
        url: URL.createObjectURL(blob),
        meta: { model, prompt, aspectRatio, originalUrl: imageUrl, raw: data }
      }
    } catch (e) {
      // 401/403은 바로 던짐
      if (e.message?.includes('401') || e.message?.includes('403')) throw e
      lastErr = e
      console.warn(`[grok] ${model} 예외:`, e.message)
    }
  }
  throw new Error(`Grok 모델 체인 전부 실패: ${lastErr?.message || 'unknown'}`)
}

function safeJson(text) {
  try { return JSON.parse(text) } catch { return null }
}
