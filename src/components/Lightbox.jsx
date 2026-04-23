import { useEffect } from 'react'

/**
 * Lightbox — 이미지 확대 보기.
 * ESC 또는 배경 클릭 닫기.
 *
 * props:
 *   src: 이미지 URL
 *   caption: 설명 (선택)
 *   onClose: () => void
 *   actions: [{ label, icon, onClick, variant }] 추가 버튼 (선택)
 */
export default function Lightbox({ src, caption, onClose, actions = [] }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!src) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        zIndex: 200, padding: 40,
      }}
    >
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 20, right: 20,
          background: 'rgba(255,255,255,0.1)', border: 0,
          color: 'white', width: 40, height: 40, borderRadius: 20,
          fontSize: 20, cursor: 'pointer',
        }}
      >✕</button>

      <img
        src={src}
        alt={caption || ''}
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '90%', maxHeight: actions.length > 0 ? '75%' : '85%',
          width: 'auto', height: 'auto', objectFit: 'contain',
          borderRadius: 8, boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      />

      {caption && (
        <div style={{
          marginTop: 16, color: 'var(--text-2)', fontSize: 14,
          textAlign: 'center', maxWidth: '80%',
        }}>{caption}</div>
      )}

      {actions.length > 0 && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ marginTop: 20, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}
        >
          {actions.map((a, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); a.onClick?.() }}
              className={'btn' + (a.variant === 'primary' ? ' btn-primary' : a.variant === 'ghost' ? ' btn-ghost' : '')}
              style={{ minWidth: 140 }}
            >
              {a.icon && <span style={{ marginRight: 4 }}>{a.icon}</span>}{a.label}
            </button>
          ))}
        </div>
      )}

      <div style={{
        position: 'absolute', bottom: 20, color: 'var(--text-3)', fontSize: 11,
      }}>ESC 또는 배경 클릭으로 닫기</div>
    </div>
  )
}
