# Markdowner

[English README](README.md)

Markdowner는 `Tauri v2`, `React`, `Vite`, `Tiptap` 기반으로 구성된 Rust 중심 Markdown 데스크톱 에디터입니다. 현재 저장소에는 macOS에서 실제로 실행 가능한 데스크톱 셸, 공유 Rust 문서 코어, 그리고 향후 Windows 빌드를 위한 첫 번째 크로스플랫폼 기반이 포함되어 있습니다.

## 현재 상태

- `pnpm tauri dev` 로 macOS 로컬 개발 실행이 가능합니다
- `pnpm tauri build --debug` 로 macOS 로컬 debug 빌드가 가능합니다
- 앱 셸에는 파일 열기, 폴더 열기, 저장, 명령 팔레트, 빠른 열기, 모드 전환, 테마 전환, 드래그 앤 드롭 열기, `markdowner-core` 와 연결되는 Rust command bridge 가 포함되어 있습니다
- 사이드 패널에 문서 목차가 구현되어 있으며 헤딩 클릭으로 줄 점프가 가능합니다
- 안정성은 원자적 쓰기, 외부 변경 감지, ErrorBoundary fallback까지 적용되어 있습니다
- Windows 는 아직 후속 작업 범위이지만, 아키텍처는 같은 Tauri 앱 셸을 기준으로 맞춰져 있습니다

## 개발 진행상황 스냅샷

2026-05-05 기준 Markdowner는 macOS 개발자 프리뷰에 가까운 상태입니다. 핵심 데스크톱 루프는 사용할 수 있습니다. Markdown 파일 또는 워크스페이스를 열고, WYSIWYG/Source/Split View 사이를 전환하며 편집하고, 안전하게 저장하고, 최근 파일을 다시 열고, 테마를 바꾸고, 외부 변경 충돌을 처리할 수 있습니다. 현재 v1 제품 목표 대비 완성도는 대략 60-65% 수준으로 보는 것이 맞습니다. 셸, 코어 파일 모델, 설정 영속화, 일반적인 Markdown 왕복 저장 경로는 자리 잡았고, 고급 작성 기능, export, 검색, 배포 품질, Windows 검증은 아직 남아 있습니다.

완료 또는 안정권에 있는 항목:

- Tauri v2 데스크톱 셸과 React 19, Vite 7, TypeScript, Tiptap, CodeMirror, React Markdown, shadcn 스타일 UI 구성
- `markdowner-core`, `src-tauri` Tauri bridge, 기존 `markdowner-macos` reference crate 로 나뉜 Rust workspace
- 파일 생명주기: 새 문서, 파일 열기, 워크스페이스 열기, 저장, 다른 이름으로 저장, 최근 문서, CLI 경로 열기, single-instance 라우팅, 드래그 앤 드롭 파일/폴더 열기, native menu command event
- 안전성 모델: 원자적 쓰기, 읽기 전용 파일 보호, 외부 디스크 변경 감지, 비교/다시 로드/로컬 유지 흐름, dirty close confirmation, 세션 복원
- 탐색과 셸 UX: Activity Bar, 리사이즈/접힘 가능한 사이드바, 워크스페이스 트리, 파일명 필터, Quick Open, Command Palette, Outline 패널, 문서 통계, Status Bar metadata
- Markdown coverage: heading, paragraph, quote, bullet, checklist, image, table, fenced code block, link, emphasis, inline code, raw-preserved unsupported block
- 설정 영속화: autosave, editor font, word wrap, startup mode, focus/typewriter toggle, asset folder, system theme following, PDF paper size, diagnostics flag
- 사용자 CSS 테마 import 검증과 Markdown content surface 로의 frontend scoping

부분 완료 항목:

- Focus mode, Typewriter mode, diagnostics logging, asset folder, PDF paper size 는 설정으로 저장되지만 실제 런타임 동작은 아직 완성되지 않았습니다
- 코드 하이라이팅은 Rust core 모델에 알려진 code fence 기준으로 존재하지만, frontend preview/WYSIWYG 하이라이팅 정책은 제품 수준 polish가 더 필요합니다
- macOS bundle 생성은 켜져 있지만, production signing, notarization, release metadata, 배포 workflow는 미완료입니다
- Rust core와 React shell 테스트는 의미 있게 존재하지만, 전체 데스크톱 E2E, screenshot regression, 자동 접근성 gate는 아직 없습니다

미구현 항목:

- 본문 Find & Replace
- Slash command menu
- KaTeX 수식 및 Mermaid diagram rendering
- HTML/PDF/Print export
- Workspace full-text search
- 이미지 paste/drop asset 복사 및 상대경로 삽입
- overwrite 전 자동 백업
- Window size/position restore
- Windows build/test/release 검증

## 기능 요약

- Tiptap 기반 WYSIWYG 편집 화면
- CodeMirror 6 기반 Source 모드
- React Markdown + GFM 기반 Preview 모드
- 데스크톱 셸을 통한 파일 열기/저장
- 명령 팔레트(`⌘⇧P`) 및 빠른 열기(`⌘P`)로 파일·커맨드 탐색
- 워크스페이스 폴더 열기와 파일 트리 탐색
- 문서 통계 다이얼로그와 아웃라인 패널
- 이미지, 표, 체크리스트, fenced code block 지원
- 기본 라이트/다크 테마 및 사용자 CSS 테마 import
- 설정 다이얼로그에서 오토세이브, 글꼴, 줄 바꿈, 시작 모드, 시스템 테마 연동, asset, PDF, diagnostics preference 편집 가능
- Markdown 저장 형식과 문서 의미 모델은 Rust `markdowner-core` 가 담당

## 저장소 구성

- `crates/markdowner-core`: Markdown 파싱/직렬화, 문서 모델, 테마, 워크스페이스 상태, 런타임 로직
- `crates/markdowner-macos`: 경계 검증과 회귀 테스트를 위한 기존 macOS shell/reference crate
- `src`: React/Vite 프런트엔드 셸
- `src-tauri`: Tauri 데스크톱 셸, Rust command bridge, 앱 설정
- `docs/architecture/core-platform-boundary.md`: 코어/플랫폼 분리에 대한 아키텍처 문서

## macOS 개발환경 설정

현재 저장소는 macOS에서 아래 도구체인으로 로컬 검증되었습니다.

- `Node.js v22.20.0`
- `pnpm v10.33.0`
- `cargo 1.94.0`
- `rustc 1.94.0`
- `xcode-select` 로 확인 가능한 Xcode Command Line Tools

최소 준비 항목:

1. 최신 Rust 툴체인 설치
2. Node.js 와 pnpm 설치
3. Xcode Command Line Tools 설치

확인 명령 예시:

```bash
node -v
pnpm -v
cargo -V
rustc -V
xcode-select -p
xcrun --version
```

## 의존성 설치

```bash
pnpm install
```

환경에 따라 `pnpm install` 중 ignored build scripts 경고가 뜨면, 필요한 build script 를 승인한 뒤 다시 설치하세요.

```bash
pnpm approve-builds
pnpm install
```

## macOS 로컬 개발 실행

개발 모드로 데스크톱 앱을 실행하려면:

```bash
pnpm tauri dev
```

이 명령은 다음을 수행합니다.

- `http://localhost:1420` 에 Vite dev server 실행
- Tauri Rust 셸 컴파일
- 로컬 debug 데스크톱 실행 파일 실행

이 저장소에서 실제로 검증한 결과, 시작 시 먼저 `pnpm dev` 가 실행되고 이어서 `target/debug/markdowner-desktop` 이 실행됩니다.

`pnpm tauri dev` 가 바로 실패하면, 기본적으로 Vite dev server 가 `1420` 포트를 사용하므로 해당 포트가 이미 사용 중인지 먼저 확인하세요.

## macOS 로컬 빌드

### Rust 워크스페이스 빌드

```bash
cargo build
```

새 환경에서는 첫 Rust 빌드 시 crates.io 에서 crate 의존성을 내려받기 때문에, 이후 빌드보다 시간이 더 오래 걸릴 수 있습니다.

### 프런트엔드 번들 빌드

```bash
pnpm build
```

### 로컬 Tauri debug 앱 빌드

```bash
pnpm tauri build --debug
```

검증된 산출물 경로:

```bash
target/debug/markdowner-desktop
```

## 현재 앱 검증 방법

프런트엔드와 Rust 테스트 스위트:

```bash
pnpm test
cargo test
```

자주 쓰는 핵심 검증 명령:

```bash
cargo test -p markdowner-core
pnpm build
pnpm tauri build --debug
```

## 참고 사항과 현재 제한사항

- Tauri 데스크톱 셸은 macOS 로컬에서 동작하고 번들 생성은 활성화되어 있습니다 (`src-tauri/tauri.conf.json`의 `"bundle.active"` 는 `true`). 다만 프로덕션 배포를 위한 서명/공증 흐름은 후속 작업입니다.
- 프런트엔드 프로덕션 번들은 현재 Vite chunk size warning 이 발생할 정도로 크기가 큽니다.
- Windows 지원은 다음 단계의 목표이며, 아직 완료된 로컬 개발 워크플로는 아닙니다.
- `crates/markdowner-macos` 는 Tauri 셸이 주 앱 진입점이 되는 동안 참고 구현과 회귀 기준으로 남겨둔 상태입니다.

## 라이선스

MIT 라이선스입니다. 자세한 내용은 `LICENSE` 를 확인하세요.
