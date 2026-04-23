import { NavLink } from 'react-router-dom'
import { useMode } from '../context/ModeContext.jsx'

const navItems = [
  { to: '/', icon: '🏠', label: '내 프로젝트', section: '탐색', end: true },
  { to: '/anchor', icon: '📥', label: '앵커 설정', section: '탐색' },
  { to: '/pose', icon: '🎭', label: '포즈 편집', section: '작업 공간' },
  { to: '/stage', icon: '🎥', label: '3D 스테이지', section: '작업 공간' },
  { to: '/sheet', icon: '📐', label: '8면 시트', section: '작업 공간' },
  { to: '/gallery', icon: '🖼️', label: '갤러리', section: '작업 공간' },
  { to: '/export', icon: '📤', label: '내보내기', section: '마무리' },
]

export default function Sidebar() {
  const { mode, setMode, isIntegrated } = useMode()

  // 섹션별로 그룹화
  const grouped = navItems.reduce((acc, item) => {
    (acc[item.section] = acc[item.section] || []).push(item)
    return acc
  }, {})

  return (
    <aside className="side">
      {Object.entries(grouped).map(([section, items]) => (
        <div key={section}>
          <div className="side-section">{section}</div>
          {items.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => 'side-item' + (isActive ? ' active' : '')}
            >
              <span className="ico">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}

      <div className="side-section">연동 상태</div>
      <div className="side-item" style={{ fontSize: 12, opacity: isIntegrated ? 1 : 0.4 }}>
        <span className="ico">🎨</span> novel-workstation
        <span className="count" style={{
          background: isIntegrated ? 'var(--accent-mint)' : 'var(--bg-3)',
          color: isIntegrated ? '#052e1f' : 'var(--text-3)'
        }}>
          {isIntegrated ? 'ON' : 'OFF'}
        </span>
      </div>
      <div className="side-item" style={{ fontSize: 12, opacity: isIntegrated ? 1 : 0.4 }}>
        <span className="ico">🎬</span> hbd-app (영상)
        <span className="count" style={{
          background: isIntegrated ? 'var(--accent-mint)' : 'var(--bg-3)',
          color: isIntegrated ? '#052e1f' : 'var(--text-3)'
        }}>
          {isIntegrated ? 'ON' : 'OFF'}
        </span>
      </div>
      <div className="side-item" style={{ fontSize: 12, opacity: 0.5 }}>
        <span className="ico">🧊</span> 3D SaaS
        <span className="count">P3</span>
      </div>

      <div className="side-mode-panel">
        <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 6, letterSpacing: 1 }}>
          동작 모드
        </div>
        <div className="mode-toggle">
          <button
            className={mode === 'integrated' ? 'active' : ''}
            onClick={() => setMode('integrated')}
          >
            🔧 개발자
          </button>
          <button
            className={mode === 'standalone' ? 'active' : ''}
            onClick={() => setMode('standalone')}
          >
            💳 구독형
          </button>
        </div>
      </div>
    </aside>
  )
}
