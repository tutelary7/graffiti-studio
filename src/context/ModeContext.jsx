import { createContext, useContext, useState, useEffect } from 'react'

const ModeContext = createContext(null)

/**
 * ModeContext — 앱 전역 동작 모드 관리
 *
 * 두 가지 모드:
 *   - 'integrated' (🔧 개발자 모드): 지수님 본인용. novel-workstation/hbd-app 연동 ON.
 *                                     웹툰·영상 전송 버튼 활성화.
 *   - 'standalone' (💳 구독형 모드): 외부 구독 유저용. 단독 실행.
 *                                    웹툰·영상 전송 버튼 잠금. PC 다운로드 + 3D 변환만.
 *
 * 기본값은 .env 의 VITE_DEFAULT_MODE 로 제어. 사용자가 사이드바 토글로 변경 가능.
 * 선택 결과는 localStorage('gs-mode')에 저장돼서 새로고침해도 유지.
 */
export function ModeProvider({ children }) {
  const [mode, setMode] = useState(() => {
    try {
      const saved = localStorage.getItem('gs-mode')
      if (saved === 'integrated' || saved === 'standalone') return saved
    } catch (e) { /* ignore */ }
    return import.meta.env.VITE_DEFAULT_MODE || 'integrated'
  })

  useEffect(() => {
    try { localStorage.setItem('gs-mode', mode) } catch (e) { /* ignore */ }
  }, [mode])

  const isIntegrated = mode === 'integrated'
  const isStandalone = mode === 'standalone'

  return (
    <ModeContext.Provider value={{ mode, setMode, isIntegrated, isStandalone }}>
      {children}
    </ModeContext.Provider>
  )
}

export function useMode() {
  const ctx = useContext(ModeContext)
  if (!ctx) throw new Error('useMode must be used inside ModeProvider')
  return ctx
}
