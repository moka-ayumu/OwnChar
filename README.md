# OwnChar

브라우저에서 문장을 손으로 쓰면 자모를 나눠 모으고, 현대 한글 11,172자와 영문·숫자·기호를 조합해 OTF 폰트로 만드는 로컬 도구입니다.

## 개발

```bash
pnpm install
pnpm dev
```

## 검사

```bash
pnpm typecheck
pnpm lint
pnpm test        # 단위 테스트 (Vitest)
pnpm test:e2e    # 브라우저 테스트 (Playwright)
```

## 구조

```
src/
  font/         획 → 윤곽 → 자모 배치 → 글리프. 순수 로직
    stroke/       손떨림 보정, 획 윤곽
    geometry/     경로 연산, 도형, 충돌 검사, CFF 윤곽
    layout/       음절 배치, 간격·비율 프로필, 원본 선택
    glyphs/       단독 자모, 숫자·기호, 크기 보정
    guides.ts     쓰기 칸의 고정 가이드 자모
  collection/   무엇을 쓰게 할지: 프롬프트, 연습 문장, 저장되는 기록
  generation/   필기에서 배우고 폰트를 만든다: 학습, 폰트 빌더, 워커
  project/      프로젝트 상태와 IndexedDB 저장
  features/     화면별 컴포넌트 (writing, editor)
  routes/       라우트 정의
tests/
  unit/         순수 로직
  e2e/          실제 브라우저가 필요한 흐름
```

의존 방향은 `font` ← `collection` ← `generation` ← `project` ← `features` ← `routes` 입니다.
조합 알고리즘에서 더 단순화할 수 있는 부분은 [docs/algorithm-review.md](docs/algorithm-review.md)에 정리했습니다.

기술 스택: Vite, React, TypeScript, TanStack Router, TanStack Store, Tailwind CSS, shadcn/ui, perfect-freehand, clipper2, opentype.js.
