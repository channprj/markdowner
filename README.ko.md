# Markdowner

<p align="center">
  <img src="./assets/images/og.png" alt="Markdowner - 당신과 코딩 에이전트를 위한 Markdown 에디터" width="100%">
</p>

<p align="center">
  <a href="https://github.com/channprj/markdowner/releases/latest"><img alt="최신 버전" src="https://img.shields.io/github/v/release/channprj/markdowner?label=%EC%B5%9C%EC%8B%A0%20%EB%B2%84%EC%A0%84"></a>
  <a href="https://github.com/channprj/markdowner/releases"><img alt="누적 다운로드" src="https://img.shields.io/github/downloads/channprj/markdowner/total?label=%EB%88%84%EC%A0%81%20%EB%8B%A4%EC%9A%B4%EB%A1%9C%EB%93%9C"></a>
  <a href="./LICENSE"><img alt="라이선스: MIT" src="https://img.shields.io/badge/license-MIT-2ea44f"></a>
  <img alt="플랫폼" src="https://img.shields.io/badge/platform-macOS-111111">
</p>

<p align="center">
  <a href="https://markdowner.chann.dev">웹사이트</a>
  ·
  <a href="https://github.com/channprj/markdowner/releases/latest">다운로드</a>
  ·
  <a href="./README.md">English README</a>
</p>

Markdowner는 macOS용 로컬 파일 중심 Markdown 에디터입니다. 깔끔한 글쓰기 화면은 필요하지만, `.md` 파일이라는 단순하고 투명한 형식은 포기하고 싶지 않은 사람을 위해 만들고 있습니다. WYSIWYG 편집, 소스 편집, 워크스페이스 탐색, 그리고 Markdown을 기준 형식으로 유지하는 Rust 문서 코어를 함께 제공합니다.

또한 Markdowner는 코딩 에이전트나 커맨드라인 도구가 사람에게 편집을 맡겨야 할 때 열 수 있는 에디터로도 잘 동작하도록 설계되어 있습니다. 버퍼를 다듬거나, 노트를 검토하거나, 커밋 메시지를 마무리하는 흐름에 자연스럽게 붙일 수 있습니다.

## 주요 기능

- **Markdown 중심 편집**: WYSIWYG, 소스 에디터, Split View가 모두 독자 포맷이 아닌 Markdown 파일을 기준으로 동작합니다.
- **로컬 데스크톱 앱**: macOS 네이티브 앱에서 파일과 폴더를 열고, 탭을 관리하고, 안전하게 저장하고, 세션을 복원할 수 있습니다.
- **워크스페이스 탐색**: 파일 트리, Quick Open, 명령 팔레트, 아웃라인 패널, 워크스페이스 검색, 문서 통계, 최근 문서를 제공합니다.
- **글쓰기 보조 기능**: 찾기/바꾸기, 미니맵, 줄 바꿈 설정, 줄 바꿈 가이드, Focus Mode, Typewriter Mode, 표 편집, 코드 블록, 체크리스트, 이미지와 링크를 지원합니다.
- **안전한 파일 저장**: 원자적 저장, 저장하지 않은 문서 종료 확인, 읽기 전용 파일 처리, 외부 변경 감지와 다시 불러오기/로컬 유지 흐름을 갖추고 있습니다.
- **편집 환경 커스터마이징**: 기본 라이트/다크 테마, 시스템 테마 연동, CSS 테마 가져오기, 에디터 글꼴 설정, 표 밀도, 코드 블록 테마 설정을 지원합니다.
- **에이전트 친화적인 CLI 연동**: `mdner` 명령을 설치하고 `EDITOR` / `VISUAL`에 연결해 터미널 도구가 Markdowner를 바로 열 수 있습니다.
- **업데이트와 릴리스 연동**: GitHub Releases를 기준으로 업데이트를 확인하고, 공개 릴리스 워크플로에서 universal macOS DMG를 빌드합니다.

## 설치

Markdowner는 현재 macOS용으로 배포됩니다.

최신 DMG는 아래에서 받을 수 있습니다.

```text
https://github.com/channprj/markdowner/releases/latest
```

터미널에서 최신 릴리스를 설치할 수도 있습니다.

```bash
curl -fsSL https://raw.githubusercontent.com/channprj/markdowner/main/install.sh | bash
```

설치한 뒤 바로 실행하려면:

```bash
curl -fsSL https://raw.githubusercontent.com/channprj/markdowner/main/install.sh | MARKDOWNER_OPEN=1 bash
```

설치 스크립트는 사용 중인 Mac에 맞는 최신 `.dmg` 파일을 내려받고, DMG를 마운트한 뒤 `Markdowner.app`을 `/Applications`로 복사합니다. 설치된 앱 번들에서는 quarantine 속성도 제거합니다.

> Markdowner는 현재 무료 배포를 위해 ad-hoc signing을 사용합니다. Developer ID 서명과 notarization은 아직 준비 중이므로, 다운로드한 앱을 처음 실행할 때 macOS 시스템 설정에서 수동으로 허용해야 할 수 있습니다.

## 빠른 시작

1. Markdowner를 실행합니다.
2. `Cmd+O`로 Markdown 파일을 열거나, `Cmd+Shift+O`로 폴더를 엽니다.
3. `Opt+1`은 WYSIWYG, `Opt+2`는 Editor, `Opt+3`은 Split View로 전환합니다.
4. `Cmd+P`로 Quick Open을 열고, `Cmd+Shift+P`로 명령 팔레트를 엽니다.
5. `Cmd+S`로 저장합니다.

자주 쓰는 단축키:

| 동작 | 단축키 |
| --- | --- |
| Quick Open | `Cmd+P` |
| 명령 팔레트 | `Cmd+Shift+P` |
| 현재 파일에서 찾기 | `Cmd+F` |
| 워크스페이스에서 검색 | `Cmd+Shift+F` |
| 사이드바 토글 | `Cmd+Shift+B` |
| 아웃라인 토글 | `Cmd+Shift+D` |
| Focus Mode 토글 | `Cmd+Shift+J` |
| Typewriter Mode 토글 | `Cmd+Shift+Y` |
| 줄 바꿈 토글 | `Option+Z` |

## CLI 연동

Markdowner는 데스크톱 앱에서 파일이나 폴더를 열 수 있는 작은 `mdner` 실행 명령을 설치할 수 있습니다.

```bash
mdner README.md
mdner path/to/project
```

앱에서 **Settings**를 열면 CLI 관련 섹션에서 다음 작업을 할 수 있습니다.

- `/usr/local/bin/mdner` 설치 또는 제거
- `EDITOR="mdner"`와 `VISUAL="mdner"`를 설정하는 관리형 셸 스니펫 추가
- 현재 셸 `PATH`에서 `mdner` 명령을 찾을 수 있는지 확인

이 설정은 커밋 메시지, 프롬프트, 노트, 리뷰 버퍼 등을 편집하기 위해 `$EDITOR`를 여는 도구와 함께 쓰기 좋습니다.

## 개발

Markdowner는 Tauri v2, React 19, Vite, TypeScript, Tiptap, CodeMirror 6, Tailwind CSS, Rust 워크스페이스로 구성되어 있습니다.

권장 로컬 도구체인:

- Node.js 22 이상
- pnpm 10 이상
- Rust stable
- macOS의 Xcode Command Line Tools

의존성 설치:

```bash
pnpm install
```

개발 모드로 데스크톱 앱 실행:

```bash
pnpm tauri dev
```

Vite 개발 서버는 `http://127.0.0.1:14238`에 고정되어 있으며 `strictPort`를 사용합니다. 다른 로컬 앱의 개발 서버에 조용히 붙지 않도록 하기 위한 설정입니다.

## 빌드

자주 쓰는 명령:

```bash
pnpm build                         # 타입 검사와 프런트엔드 빌드
pnpm build debug                   # Tauri 디버그 빌드
pnpm build dmg                     # ad-hoc signing이 적용된 릴리스 DMG 빌드
pnpm build universal dmg           # Apple Silicon + Intel universal DMG 빌드
pnpm build install                 # 빌드 후 /Applications에 설치
pnpm build install open            # 설치 후 설치된 앱 실행
pnpm build:install:open            # install + open package.json 스크립트 별칭
pnpm build:mac:dmg                 # 릴리스 DMG package.json 스크립트 별칭
pnpm build:mac:universal:dmg       # universal DMG package.json 스크립트 별칭
```

설치 경로를 바꾸려면:

```bash
MARKDOWNER_INSTALL_PATH=~/Applications pnpm build install
pnpm build install -- --path ~/Applications
pnpm build install -- --no-build
pnpm build install -- --open
```

## 테스트

주요 검증 명령:

```bash
pnpm test
cargo test
```

필요할 때 자주 쓰는 집중 검증:

```bash
pnpm exec vitest run
bash scripts/build-and-install.test.sh
cargo test -p markdowner-core
pnpm exec tsc --noEmit
```

## 릴리스

Markdowner는 저장소 루트의 `VERSION` 파일을 사용하며, 날짜 기반 버전 형식은 다음과 같습니다.

```text
MAJOR.YYMMDD.PATCH
```

로컬에서 날짜/패치 버전을 갱신하려면:

```bash
pnpm bump refresh
```

`main` 브랜치에서 릴리스 버전을 올리고 푸시하려면:

```bash
pnpm bump refresh --push
```

이 명령은 `VERSION` 값을 `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `Cargo.lock`에 동기화하고, 해당 버전 파일을 커밋한 뒤 `main`으로 푸시합니다.

GitHub Actions 릴리스 워크플로는 다음 순서로 동작합니다.

1. `VERSION` 읽기
2. Node와 Rust 도구체인 설치
3. 버전 메타데이터 동기화
4. universal macOS DMG 빌드
5. `gh release create --generate-notes`로 GitHub Release 생성
6. 생성된 DMG 파일 업로드

릴리스 노트는 GitHub가 이전 태그와 새 태그를 비교해 자동으로 생성합니다.

## 저장소 구조

```text
crates/markdowner-core/      Rust 문서 모델, Markdown 왕복 변환 로직, 설정, 워크스페이스 런타임
crates/markdowner-macos/     이전 macOS 참고 구현과 회귀 검증 경계
src/                         React/Vite 데스크톱 프런트엔드
src-tauri/                   Tauri 셸, Rust 명령 브리지, 업데이트 확인, macOS 연동
scripts/                     빌드, 설치, 버전 동기화, 릴리스 보조 스크립트
docs/                        아키텍처와 Markdown 지원 범위 문서
```

## 현재 상태

Markdowner는 현재 macOS 데스크톱 Markdown 에디터로 사용할 수 있습니다. 핵심 글쓰기 기능, 탐색, 설정, 로컬 빌드, 릴리스 경로가 갖춰져 있습니다.

아직 예정된 작업:

- Developer ID 서명과 notarization
- Windows 빌드, 테스트, 릴리스 검증
- HTML/PDF/인쇄 내보내기
- 더 풍부한 이미지 자산 관리 흐름
- 자동화된 데스크톱 E2E, 스크린샷 회귀 테스트, 접근성 검증

## 기여

이슈와 Pull Request를 환영합니다. 코드 변경은 범위를 작게 유지하고, 변경 사항을 검증하는 테스트를 실행한 뒤 PR 설명에 사용한 검증 명령을 함께 적어 주세요.

## 라이선스

MIT 라이선스입니다. 자세한 내용은 [LICENSE](./LICENSE)를 확인하세요.
