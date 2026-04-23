import { useMode } from '../context/ModeContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'

export default function TopBar() {
  const { isIntegrated } = useMode()
  const { user, loading, signIn, signOutUser } = useAuth()

  async function handleAuthClick() {
    try {
      if (user) {
        if (confirm(`${user.displayName || user.email}로 로그아웃?`)) {
          await signOutUser()
        }
      } else {
        await signIn()
      }
    } catch (e) {
      alert('로그인 실패: ' + e.message + '\n\nFirebase 콘솔에서 localhost:5180을 Authorized domains에 추가했나요?')
    }
  }

  return (
    <header className="top-nav">
      <div className="brand">
        <span style={{ fontSize: 22 }}>◈</span>
        <span>Graffiti Studio</span>
        <span className="brand-tag">CHARACTER STAGE · v0.1.0</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* 로그인 상태 */}
        {loading ? (
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>⏳</span>
        ) : user ? (
          <button onClick={handleAuthClick} style={authBtn(true)}
            title={`${user.email} · 클릭하면 로그아웃`}>
            {user.photoURL && <img src={user.photoURL} alt="" style={{ width: 18, height: 18, borderRadius: '50%' }} />}
            <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.displayName || user.email.split('@')[0]}
            </span>
            <span style={{ color: 'var(--accent-mint)' }}>●</span>
          </button>
        ) : (
          <button onClick={handleAuthClick} style={authBtn(false)}
            title="novel-workstation과 같은 계정으로 로그인 → 클라우드 스켈레톤 라이브러리 공유">
            🔑 Google 로그인
          </button>
        )}

        <span className={'mode-badge ' + (isIntegrated ? 'integrated' : 'standalone')}>
          {isIntegrated ? '🔧 개발자 모드' : '💳 구독형 모드'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'ui-monospace, monospace' }}>
          localhost:5180
        </span>
      </div>
    </header>
  )
}

function authBtn(signedIn) {
  return {
    display: 'flex', alignItems: 'center', gap: 6,
    background: signedIn ? 'var(--bg-2)' : 'var(--bg-3)',
    border: '1px solid ' + (signedIn ? 'var(--accent-mint)' : 'var(--border)'),
    color: signedIn ? 'var(--text-1)' : 'var(--text-2)',
    padding: '4px 10px', borderRadius: 20,
    fontSize: 11, cursor: 'pointer',
  }
}
