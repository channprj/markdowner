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
- **HTML/PDF 내보내기**: 용지, 여백, 글꼴, 색상, 머리말·꼬리말, 코드 블록 스타일을 설정하면서 현재 문서나 워크스페이스를 미리 보고 내보낼 수 있습니다.
- **에이전트 친화적인 CLI 연동**: `mdner` 명령을 설치하고 `EDITOR` / `VISUAL`에 연결해 터미널 도구가 Markdowner를 바로 열 수 있습니다.
- **업데이트와 릴리스 연동**: GitHub Releases를 기준으로 업데이트를 확인하고, 관리자가 로컬에서 universal macOS DMG를 빌드해 배포할 수 있습니다.

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

## AI 기능

**Settings → AI Feature**에서 OpenRouter 키를 연결한 뒤 PRD 개선, 요약, 번역, 사용자 프롬프트에 사용할 모델을 선택합니다. 소스 에디터나 WYSIWYG에서 텍스트를 선택하고 `Cmd+Shift+K`를 누르면 인라인 프롬프트를 실행할 수 있습니다.

- WYSIWYG에서 문단 시작이나 공백 뒤에 `@@`를 입력하면 로컬 에이전트 창이 열립니다. `@` 하나는 일반 텍스트로 입력됩니다. 명령 팔레트의 **Run local agent**로도 열 수 있습니다.
- WYSIWYG 팝오버는 작성 중인 내용의 위나 아래에 표시합니다. 공간이 부족하면 팝오버 내부를 스크롤하며, 선택 영역이 화면 대부분을 차지하면 커서가 있는 쪽을 보이게 유지합니다.
- 모든 AI 기능은 **GLM 5.3 Flash**(`z-ai/glm-5.3-flash`)를 기본으로 사용합니다. **Models & Task Defaults → Primary model**에서 공통 모델을 바꾸고, 각 기능은 **Use primary model**을 유지하거나 별도 모델을 선택할 수 있습니다. PRD 인터뷰는 PRD 기본 모델을, 인라인 수정은 사용자 프롬프트 기본 모델을 사용합니다. 설정은 앱을 다시 열어도 유지합니다. 업데이트 시 기존 Solar 공통 기본값은 GLM 5.3 Flash로 전환하며, 다른 공통 모델과 기능별로 따로 선택한 모델은 보존합니다.
- 추천 목록에 GLM 5.3 / Flash, Claude Fable 5.1 / Opus 5 / Sonnet 5, GPT-6 Astra / GPT-5.6 Sol, Gemini 3.8 Flash, DeepSeek V4 Pro 0813, Grok 4.6을 포함합니다. OpenRouter 전체 목록을 검색하거나 **Refresh models**로 새 모델을 불러올 수 있습니다. 구조화된 출력을 지원하는 모델만 사용할 수 있으며, 제공자와 ZDR 설정에 따라 사용 가능 여부가 달라집니다.
- 인라인 수정은 선택 영역에서 편집할 텍스트만 전송합니다. 링크·코드·Markdown 구분자·앞뒤 공백은 앱에서 보관했다가 응답에 다시 조립하고, 전체 문서를 검증합니다. 요청한 텍스트가 누락된 응답은 적용하지 않습니다. 요약은 중복된 문서 구조 없이 원문을 한 번만 전송합니다.
- 인라인 프롬프트의 제목을 드래그해 위치를 옮길 수 있습니다. 제목에 키보드 포커스를 둔 뒤 방향키로 이동할 수도 있습니다. **Hide AI prompt**를 누르면 프롬프트와 실행 상태를 유지한 채 작은 상태 표시줄로 접힙니다. **Show AI prompt**로 다시 열 수 있고, 접은 상태에서도 요청을 취소할 수 있습니다. 실행 중 `Esc`를 눌러도 프롬프트가 접힙니다.
- 긴 요청은 모델의 입력·출력 한도에 맞춰 나눠 처리합니다. 컨텍스트 초과나 출력 잘림이 발생하면 해당 부분을 더 작게 나눠 재시도합니다. 긴 PRD 인터뷰는 문서와 이전 답변을 압축한 맥락으로 다음 질문을 생성합니다. 여러 번 호출하면 시간과 비용이 늘 수 있으며, 지나치게 긴 지시문이나 나눌 수 없는 보호 블록은 여전히 모델 한도를 넘을 수 있습니다.
- Activity와 Review에서 현재 단계, 처리한 부분 수, 수신한 글자 수를 확인하고 취소할 수 있습니다. AI 패널 탭을 전환해도 진행 중인 작업을 유지합니다.
- **Settings → AI Feature → System Prompts**에서 PRD 개선·요약·번역·사용자 프롬프트·PRD 인터뷰의 기본 동작을 각각 수정하거나 초기화할 수 있습니다. 변경은 다음 요청부터 반영하며, 출력 형식과 Markdown 보호 규칙은 유지합니다.
- 인라인 결과는 요청 당시 원문이 그대로일 때만 적용합니다. 서식을 정확히 표현할 수 없거나 원문이 바뀌면 Review로 이동하며, 적용한 수정은 한 번의 실행 취소로 되돌릴 수 있습니다.

클라우드 사용에 동의하면 문서 내용이 OpenRouter와 선택한 모델 제공자에게 전송됩니다. 키는 macOS Keychain에 보관하고 기존 ZDR 설정을 유지합니다. 일반 테스트는 모의 서버를 사용합니다. 실제 계정으로 합성 문서 검증을 실행하려면 [영문 README의 명령](./README.md#ai-tools)을 사용하세요. API 사용 요금이 발생합니다.

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
pnpm release:build                 # 로컬 릴리스 DMG 테스트·빌드·검증
pnpm release:publish               # GitHub CLI로 빌드된 DMG 배포
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

GitHub Actions 릴리스 자동화는 비활성화되어 있습니다. 릴리스는 로컬 Mac에서
빌드한 뒤 GitHub CLI로 명시적으로 배포합니다. 처음 배포하기 전에 한 번
인증합니다.

```bash
gh auth login
```

`main` 브랜치에서 릴리스 버전을 올리고 푸시합니다.

```bash
pnpm bump refresh --push
```

이 명령은 `VERSION` 값을 `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `Cargo.lock`에 동기화하고, 해당 버전 파일을 커밋한 뒤 `main`으로 푸시합니다.

같은 `main` 체크아웃이 깨끗하고 원격과 동기화된 상태에서 빌드와 배포를
차례로 실행합니다.

```bash
pnpm release:build
pnpm release:publish
```

로컬 릴리스 흐름은 다음 순서로 동작합니다.

1. 버전 메타데이터를 확인하고 JavaScript와 Rust 테스트 실행
2. ad-hoc signing이 적용된 universal macOS DMG 빌드 및 `hdiutil` 검증
3. 깨끗한 `main`과 `origin/main`의 완전한 동기화 확인
4. 같은 버전의 태그나 GitHub Release가 이미 있으면 중단
5. 자동 생성 릴리스 노트와 함께 태그·GitHub Release를 만들고 DMG 업로드

`release:publish`는 빌드하거나 소스 변경을 커밋·푸시하지 않습니다.
`release:build`가 성공한 뒤에만 실행합니다. 릴리스 노트는 GitHub가 이전
태그와 새 태그를 비교해 자동으로 생성합니다.

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

Markdowner는 현재 macOS 데스크톱 Markdown 에디터로 사용할 수 있습니다. 핵심 글쓰기 기능, 탐색, 설정, HTML/PDF 내보내기, 로컬 빌드, 릴리스 경로가 갖춰져 있습니다.

아직 예정된 작업:

- Developer ID 서명과 notarization
- Windows 빌드, 테스트, 릴리스 검증
- 더 풍부한 이미지 자산 관리 흐름
- 자동화된 데스크톱 E2E, 스크린샷 회귀 테스트, 접근성 검증

## 기여

이슈와 Pull Request를 환영합니다. 코드 변경은 범위를 작게 유지하고, 변경 사항을 검증하는 테스트를 실행한 뒤 PR 설명에 사용한 검증 명령을 함께 적어 주세요.

## 라이선스

MIT 라이선스입니다. 자세한 내용은 [LICENSE](./LICENSE)를 확인하세요.
