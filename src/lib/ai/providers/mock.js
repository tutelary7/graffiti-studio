/**
 * Mock provider — API 키 없이 UI 개발할 때 사용.
 * 캐릭터 배경 색상에 번호만 찍힌 placeholder 이미지를 canvas로 생성.
 */

let counter = 0

export async function generateMock(options = {}) {
  counter++
  const { prompt = '', aspectRatio = '3:4', _fallbackReason } = options

  // 약간의 딜레이로 진짜 API 호출 느낌
  await new Promise(r => setTimeout(r, 300 + Math.random() * 700))

  const [w, h] = aspectRatio === '16:9' ? [640, 360]
                : aspectRatio === '1:1' ? [512, 512]
                : aspectRatio === '9:16' ? [360, 640]
                : [384, 512]  // 3:4 default

  // Canvas에 placeholder 그리기
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')

  // 배경 그라데이션
  const hue1 = (counter * 47) % 360
  const hue2 = (hue1 + 60) % 360
  const grad = ctx.createLinearGradient(0, 0, w, h)
  grad.addColorStop(0, `hsl(${hue1}, 40%, 25%)`)
  grad.addColorStop(1, `hsl(${hue2}, 40%, 15%)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // 경계선
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'
  ctx.lineWidth = 3
  ctx.strokeRect(4, 4, w - 8, h - 8)

  // 번호
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = `bold ${Math.floor(h * 0.2)}px system-ui`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`#${counter}`, w / 2, h / 2 - 20)

  // 라벨
  ctx.font = `${Math.floor(h * 0.04)}px system-ui`
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.fillText('MOCK IMAGE', w / 2, h / 2 + 30)

  // 프롬프트 발췌
  ctx.font = `${Math.floor(h * 0.028)}px system-ui`
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  const promptSnippet = prompt.slice(0, 40) + (prompt.length > 40 ? '...' : '')
  ctx.fillText(promptSnippet, w / 2, h - 30)

  const blob = await (canvas.convertToBlob
    ? canvas.convertToBlob({ type: 'image/png' })
    : new Promise(r => canvas.toBlob(r, 'image/png')))

  const url = URL.createObjectURL(blob)

  return {
    blob,
    url,
    meta: {
      model: 'mock',
      prompt,
      aspectRatio,
      w, h,
      counter,
      _fallbackReason,
    }
  }
}
