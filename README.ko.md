# Markdowner

[English README](README.md)

Markdowner는 편집 동작을 이식 가능한 코어 크레이트에 두고, 플랫폼별 통합은 셸 크레이트로 분리한 Rust 기반 Markdown 에디터 워크스페이스입니다. 현재 저장소에는 에디터 코어와 macOS 셸 레이어가 포함되어 있으며, 앱 동작은 Rust 테스트와 스모크 테스트로 검증합니다.

## 기능 요약

- 기본 Markdown 콘텐츠를 위한 WYSIWYG 중심 편집
- WYSIWYG, Source, Preview 모드 전환
- Typora 스타일의 인라인 리빌 편집
- 워크스페이스 폴더 열기와 파일 트리 탐색
- 이미지, 표, 체크리스트 지원
- fenced code block 문법 하이라이팅
- 기본 라이트/다크 테마
- 세션 상태를 복원하는 사용자 CSS 테마 가져오기

## 워크스페이스 구성

- `crates/markdowner-core`: 이식 가능한 문서 모델, Markdown 파싱/직렬화, 테마 처리, 워크스페이스 상태, 런타임 계약
- `crates/markdowner-macos`: 파일 대화상자, 윈도우, 메뉴를 담당하는 macOS 셸 통합
- `docs/architecture/core-platform-boundary.md`: 코어/플랫폼 분리를 설명하는 아키텍처 문서

## 빌드

Markdowner는 Cargo 워크스페이스입니다. edition 2024를 지원하는 최신 Rust 툴체인과 Cargo를 사용하세요.

```bash
cargo build
```

## 실행 및 검증

현재 저장소에는 패키징된 데스크톱 앱 번들이나 `cargo run` 대상이 아직 정의되어 있지 않습니다. 현재 동작을 가장 정확하게 확인하는 방법은 아래 검증 경로를 실행하는 것입니다.

워크스페이스 전체 테스트를 실행하려면:

```bash
cargo test
```

에디터 개발 중 특히 유용한 핵심 검증 경로는 다음과 같습니다.

```bash
cargo test -p markdowner-core
cargo test -p markdowner-macos automated_ui_smoke -- --nocapture
```

macOS 스모크 테스트는 앱 실행, 문서 열기, 폴더 탐색, 모드 전환, 테마 변경, 그리고 셸/런타임 경계에서의 편집 흐름을 다룹니다.

## 개발 메모

- 코어/플랫폼 경계는 향후 다른 셸 크레이트를 추가하더라도 에디터 로직을 `markdowner-core` 밖으로 옮기지 않도록 설계되어 있습니다.
- 현재 저장소는 패키징된 최종 사용자용 앱이라기보다, 계속 확장 중인 에디터 기반에 가깝습니다.

## 라이선스

MIT 라이선스입니다. 자세한 내용은 `LICENSE` 를 확인하세요.
