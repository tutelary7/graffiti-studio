# Graffiti Studio

**Character Stage Tool** — 2D→3D 캐릭터 포즈/스테이지/시트 제작 도구.
스튜디오그라피티(Studio Graffiti)의 하브드(HBD) 생태계의 일부.

- **하브드(HBD) 엄브렐러** 안의 모듈:
  - `hbd-app` (원본, 영상 제작 · 포트 5174)
  - `novel-workstation` (이미지/스토리 강화 · 포트 5173)
  - `graffiti-studio` ← **이 프로젝트** (포트 **5180**, 구독제 분리 대상)

---

## 🚀 빠른 시작

```bash
# 1. 의존성 설치
npm install

# 2. 환경변수 설정
cp .env.example .env
# .env 파일 열어서 실제 API 키 입력 (원본 키는 C:\AI\hbdkey.txt 참고)

# 3. 개발 서버 실행
npm run dev
# → http://localhost:5180 자동 오픈
```

포트 5180이 이미 쓰이고 있으면 에러가 뜹니다. (`strictPort: true` 설정 때문)
다른 Graffiti Studio 인스턴스가 안 돌고 있는지 확인하세요.

---

## 📂 프로젝트 구조

```
graffiti-studio/
├── src/
│   ├── main.jsx                 # React 엔트리
│   ├── App.jsx                  # 라우팅 + 전역 프로바이더
│   │
│   ├── components/
│   │   ├── TopBar.jsx           # 상단바 (브랜드, 모드 배지)
│   │   ├── Sidebar.jsx          # 좌측 네비 + 모드 토글
│   │   └── Placeholder.jsx      # 미구현 화면 안내 박스
│   │
│   ├── pages/
│   │   ├── HomePage.jsx         # 🏠 내 프로젝트 (구현 시작됨)
│   │   ├── AnchorPage.jsx       # 📥 앵커 설정 (placeholder)
│   │   ├── PosePage.jsx         # 🎭 포즈 편집 (placeholder)
│   │   ├── StagePage.jsx        # 🎥 3D 스테이지 MAIN (placeholder)
│   │   ├── SheetPage.jsx        # 📐 8면 시트 (placeholder)
│   │   ├── GalleryPage.jsx      # 🖼️ 갤러리 (placeholder)
│   │   └── ExportPage.jsx       # 📤 내보내기 (모드 분기 구현됨)
│   │
│   ├── context/
│   │   └── ModeContext.jsx      # 🔧개발자/💳구독형 전역 모드
│   │
│   ├── lib/
│   │   └── storage.js           # IndexedDB/localStorage 래퍼
│   │
│   └── styles/
│       └── theme.css            # 다크 테마 CSS 변수
│
├── public/
│   └── favicon.svg              # 앱 아이콘
│
├── index.html                   # HTML 엔트리
├── vite.config.js               # 포트 5180, strictPort
├── package.json
├── .env.example                 # 환경변수 템플릿
├── .gitignore                   # .env, node_modules 등 제외
└── README.md                    # 이 파일
```

---

## 🎨 디자인 시스템

모든 UI는 **다크 테마** 기반. CSS 변수로 토큰 관리.

```css
--bg-0: #0b0d12    (페이지 배경)
--bg-1: #121521    (카드)
--bg-2: #1a1f2e    (호버/섹션)
--bg-3: #252b3d    (활성)

--accent-purple: #8b5cf6   (주 액센트)
--accent-mint:   #34d399   (긍정/OK)
--accent-teal:   #22d3ee   (정보)
--warn:          #f59e0b   (경고/Phase3)
--danger:        #ef4444   (삭제/위험)
```

전체 UI 사양은 **`C:\AI\Graffiti_Studio_UI_mockup.html`** 의 ③탭(UI 목업)을 참고하세요. 지금 스캐폴드된 구조는 그 목업을 실제 React로 옮기는 출발점입니다.

---

## 🔧 두 가지 동작 모드

| 모드 | 용도 | 웹툰/영상 전송 |
|---|---|---|
| 🔧 **개발자 (integrated)** | 지수님 본인 작업 | ✅ 활성 |
| 💳 **구독형 (standalone)** | 외부 구독 유저 | 🔒 잠금 |

- 좌측 하단 사이드바에서 토글 가능
- 선택은 `localStorage('gs-mode')`에 저장
- `useMode()` 훅으로 어디서든 접근
- 모드 분기 예시: `ExportPage.jsx`, `Sidebar.jsx`, `HomePage.jsx`

---

## 📋 현재 스캐폴딩 범위

✅ **완료된 것**
- Vite + React 19 + react-router-dom 7 환경 구성
- 포트 5180 고정 + strictPort
- 다크 테마 CSS 변수
- 사이드바 네비게이션 (7화면)
- 모드 토글 (개발자/구독형) 전역 동작
- 홈 화면 (프로젝트 카드 목업 데이터)
- 내보내기 화면 (모드별 잠금 동작)
- IndexedDB 래퍼 (4개 스토어 준비)
- `.env.example` / `.gitignore`

🚧 **구현 필요 (Phase 2 — 클로드에게 이어서 맡길 것)**
- 앵커 설정 화면 (3모드 입력)
- 포즈 편집 화면 (MediaPipe 연동 + 리그 8종 + 관절 편집)
- 3D 스테이지 화면 (Three.js 3D 뷰 + 다중 인물 + 스켈레톤 v2)
- 8면 시트 화면 (자동/수동)
- 갤러리 화면
- AI API 실제 연동 (Gemini, Flux, Grok, Kling)
- 프로젝트 저장/로드 (IndexedDB → 화면 연결)

---

## 📦 클로드 세션에 이어서 맡길 때 쓸 템플릿

새 클로드 대화 열고 아래를 복붙하세요:

```
이 프로젝트의 다음 작업을 이어서 해줘.

프로젝트 경로: C:\AI\graffiti-studio
기술 명세서: C:\AI\Graffiti_Studio_기술명세서_v2.md
UI 목업: C:\AI\Graffiti_Studio_UI_mockup.html (탭 ③)
API 키: C:\AI\hbdkey.txt (코드에는 절대 하드코딩 금지, .env 사용)

이미 스캐폴드된 것: Vite + React 19 + react-router-dom,
다크 테마, 사이드바, 모드 토글(개발자/구독형),
홈/내보내기 화면 기본 구현.

작업 요청: [여기에 구체적인 요청 — 예: "포즈 편집 화면에
MediaPipe Pose + 리그 템플릿 8종 + 관절 편집 기능 구현해줘.
UI 목업의 포즈 편집 섹션 그대로 따라가면 돼."]

주의사항:
- Gemini 이미지 API는 실제로 `gemini-3.1-flash-image-preview`를
  `@google/genai` SDK의 `generateContent` + `response_modalities`로 호출.
  ImageGenerationModel.from_pretrained 아님.
- 목업/명세서에서 제안된 파라미터 중 일부는 허구일 수 있으니
  실제 공식 문서로 검증 후 구현해줘.
- 개발자/구독형 모드 분기는 이미 useMode() 훅으로 마련돼 있음.
  외부 전송 기능은 isIntegrated 체크 필수.
```

---

## 🔗 관련 문서

- **Git 가이드 (초보자용)**: `C:\AI\GIT_가이드_초보자용.md`
- **기술 명세서**: `C:\AI\Graffiti_Studio_기술명세서_v2.md`
- **UI 목업 (인터랙티브)**: `C:\AI\Graffiti_Studio_UI_mockup.html`

---

## 🎯 다음 우선순위 (Phase 2)

1. **포즈 편집 P0** — MediaPipe 연동, 리그 8종 데이터 구조, 관절 편집, PNG+JSON 저장
2. **3D 스테이지 P0** — Three.js 3D 공간, 다중 인물, 스켈레톤 v2 렌더
3. **8면 시트 P1** — 자동 생성(Gemini 8회 호출), 수동 등록(드래그앤드롭)
4. **AI 어댑터 P1** — Gemini/Flux/Grok 호출 라우팅
5. **연동 API P2** — novel-workstation/hbd-app 전송 프로토콜 확정

---

**문의/에러 발생 시**: 아크(Claude 세션)에 파일 경로와 에러 메시지 붙여서 물어보세요.
