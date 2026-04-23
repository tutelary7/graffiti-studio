/**
 * Placeholder — 아직 구현 안 된 화면의 "여기에 만들 예정" 박스.
 * 실제 UI는 C:\AI\NEW_TOOL_UI_mockup.html 의 해당 섹션 참고.
 */
export default function Placeholder({ icon, title, description, mockupSection }) {
  return (
    <div className="placeholder">
      <div className="ico">{icon}</div>
      <h2>{title}</h2>
      <p style={{ margin: 0 }}>{description}</p>
      {mockupSection && (
        <p style={{ marginTop: 12, fontSize: 11, color: 'var(--text-3)' }}>
          📎 UI 참고: <code>C:\AI\NEW_TOOL_UI_mockup.html</code> → {mockupSection}
        </p>
      )}
    </div>
  )
}
