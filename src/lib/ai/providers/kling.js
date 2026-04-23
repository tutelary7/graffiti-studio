/**
 * Kuaishou Kling AI 이미지 생성 어댑터.
 *
 * 엔드포인트: https://api.klingai.com/v1/images/generations
 * 모델: kling-v1, kling-v1-5
 *
 * 🔑 인증: Access Key + Secret Key → JWT(HS256) 서명을 매 요청마다 생성.
 *    환경변수 (둘 다 필요):
 *      VITE_KLING_ACCESS_KEY   — Kling 콘솔 발급 Access Key
 *      VITE_KLING_SECRET_KEY   — Kling 콘솔 발급 Secret Key
 *    또는 직접 JWT 주입:
 *      VITE_KLING_JWT          — 이미 서명된 JWT (서버에서 발급받은 경우)
 *
 * ⚠ JWT 서명을 브라우저에서 하는 건 Secret Key가 노출되는 보안 이슈.
 *    프로덕션에선 반드시 서버 프록시 경유. 개인 개발용으로만 사용.
 *
 * ⚠ Kling은 img2img 지원하지만 포즈 전송 용도로는 최적화 안 됨.
 */

const ENDPOINT_BASE = 'https://api.klingai.com/v1/images/generations'

export async function generateWithKling({ prompt, references = [], aspectRatio = '3:4' }) {
  const jwt = await getKlingJwt()

  const aspect = aspectRatio === '16:9' ? '16:9'
               : aspectRatio === '9:16' ? '9:16'
               : aspectRatio === '1:1'  ? '1:1'
               : '3:4'

  // 참조 이미지 (1장) — base64
  let imageRef = null
  if (references.length > 0) {
    const b64 = await refToBase64(references[0])
    if (b64) imageRef = b64
  }

  const body = {
    model_name: 'kling-v1-5',
    prompt,
    negative_prompt: 'skeleton overlay, colored lines, stick figures, grid, wireframe',
    n: 1,
    aspect_ratio: aspect,
    ...(imageRef ? {
      image: imageRef,
      image_reference: 'subject',
      image_fidelity: 0.5,
    } : {}),
  }

  const res = await fetch(ENDPOINT_BASE, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Kling ${res.status}: ${(await res.text()).slice(0, 200)}`)

  const data = await res.json()
  const taskId = data.data?.task_id
  if (!taskId) throw new Error('Kling task_id 응답 누락')

  const imageUrl = await pollKlingTask(taskId, jwt)
  const imgRes = await fetch(imageUrl)
  const blob = await imgRes.blob()

  return {
    blob, url: URL.createObjectURL(blob),
    meta: { model: 'kling-v1-5', prompt, aspectRatio: aspect, originalUrl: imageUrl, raw: data },
  }
}

/** Kling JWT 획득 — 직접 주입(VITE_KLING_JWT) 또는 Access/Secret로 서명 */
async function getKlingJwt() {
  // 1) 이미 발급받은 JWT 우선
  const preMadeJwt = import.meta.env.VITE_KLING_JWT
  if (preMadeJwt) return preMadeJwt

  // 2) Access Key + Secret Key로 실시간 서명
  const ak = import.meta.env.VITE_KLING_ACCESS_KEY
  const sk = import.meta.env.VITE_KLING_SECRET_KEY
  if (!ak || !sk) {
    throw new Error(
      'Kling 인증 정보 부족 — .env.local 에 VITE_KLING_ACCESS_KEY + VITE_KLING_SECRET_KEY 또는 VITE_KLING_JWT 설정'
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    iss: ak,
    exp: now + 1800,   // 30분 유효
    nbf: now - 5,
  }
  return await signJwtHS256(header, payload, sk)
}

/** HS256 JWT 서명 (브라우저 SubtleCrypto) */
async function signJwtHS256(header, payload, secret) {
  const enc = new TextEncoder()
  const b64url = (bytes) => {
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  const b64urlStr = (s) => b64url(enc.encode(s))

  const headerB64 = b64urlStr(JSON.stringify(header))
  const payloadB64 = b64urlStr(JSON.stringify(payload))
  const data = `${headerB64}.${payloadB64}`

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  const sigB64 = b64url(new Uint8Array(sig))
  return `${data}.${sigB64}`
}

async function pollKlingTask(taskId, jwt, maxWaitMs = 90000) {
  const url = `${ENDPOINT_BASE}/${taskId}`
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    await new Promise(r => setTimeout(r, 3000))
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${jwt}` } })
    if (!res.ok) throw new Error(`Kling polling ${res.status}`)
    const data = await res.json()
    const status = data.data?.task_status
    if (status === 'succeed') {
      const img = data.data?.task_result?.images?.[0]?.url
      if (!img) throw new Error('Kling task 성공했으나 결과 URL 없음')
      return img
    }
    if (status === 'failed') {
      throw new Error(`Kling task 실패: ${data.data?.task_status_msg || ''}`)
    }
  }
  throw new Error('Kling task timeout')
}

async function refToBase64(ref) {
  if (!ref) return null
  if (typeof ref === 'string') {
    try { const r = await fetch(ref); const b = await r.blob(); return await blobToBase64(b) }
    catch { return null }
  }
  if (ref instanceof Blob) return await blobToBase64(ref)
  return null
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => {
      const res = fr.result
      const b64 = typeof res === 'string' ? res.split(',')[1] : ''
      resolve(b64)
    }
    fr.onerror = reject
    fr.readAsDataURL(blob)
  })
}
