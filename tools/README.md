# tools

이 폴더에는 글자 모양을 검사하는 Node 스크립트가 있습니다. 모든 스크립트는 저장소 루트에서 실행합니다. 모든 결과는 `tools/out/`에 저장됩니다. `tools/out/`는 Git에 포함되지 않습니다.

## 준비

1. `src/dev/sample-project.json` 파일을 준비합니다. 이 파일은 사용자 데이터를 포함하며 Git에 포함되지 않습니다.
2. 파일이 없으면 앱을 연 브라우저의 DevTools 콘솔에서 `tools/project/export-project.js`를 실행합니다.
3. 내려받은 `sample-project.json`을 `src/dev/`에 둡니다.

`tools/reference/`의 스크립트와 `tools/verify/render-review.mjs`는 Noto Sans KR 파일도 필요합니다. 경로는 `Noto_Sans_KR.local/static/NotoSansKR-Regular.ttf`입니다. 앱은 이 폰트를 사용하지 않습니다. 이 폰트는 공간 관계의 참고 자료입니다.

## 폴더 구조

| 폴더 | 역할 |
|---|---|
| `verify/` | 변경 전후의 결과를 비교하고 검사합니다. |
| `inspect/` | 글자 하나의 내부 값을 출력합니다. |
| `reference/` | Noto Sans KR와 비교합니다. |
| `project/` | 프로젝트를 내보내고 속도를 측정합니다. |
| `sample/` | 샘플 프로젝트의 필기를 만듭니다. |
| `lib/` | 스크립트가 공유하는 코드입니다. |

## verify

| 스크립트 | 용도 |
|---|---|
| `golden.mjs` | 고정된 글자 표본을 합성하고 모든 윤곽을 `golden.json`에 저장합니다. 해시를 출력합니다. |
| `golden-diff.mjs` | 두 `golden` 결과의 차이를 출력합니다. |
| `validate-layout.mjs` | 글자를 합성하고 NaN, 넘침, 획 충돌, 역할 누락, 순서 오류를 검사합니다. |
| `render-review.mjs` | `validate-layout.mjs`의 결과를 SVG 시트로 그립니다. |
| `snap.mjs` | `tools/out/`의 SVG를 PNG로 변환합니다. |

비교 순서는 다음과 같습니다.

1. 변경 전에 결과를 저장합니다.

```bash
node tools/verify/golden.mjs --out=golden-before.json
```

2. 코드를 변경합니다.
3. 변경 후에 결과를 저장합니다.

```bash
node tools/verify/golden.mjs --out=golden-after.json
```

4. 두 결과를 비교합니다.

```bash
node tools/verify/golden-diff.mjs golden-before.json golden-after.json
```

글자 시트의 순서는 다음과 같습니다.

1. HEAD의 결과를 검사합니다.

```bash
node tools/verify/validate-layout.mjs --revision=HEAD
```

2. 작업 트리의 결과를 검사합니다.

```bash
node tools/verify/validate-layout.mjs
```

3. 시트를 그립니다.

```bash
node tools/verify/render-review.mjs
```

4. SVG를 PNG로 변환합니다.

```bash
node tools/verify/snap.mjs review.svg 1680
```

`validate-layout.mjs`는 다음 옵션을 사용합니다.

| 옵션 | 의미 |
|---|---|
| `--all` | 11,172자를 모두 검사합니다. 기본값은 102자입니다. |
| `--revision=<rev>` | `src/`의 파일을 Git의 해당 revision에서 읽습니다. |
| `--out=<name>` | 결과 파일 이름입니다. 기본값은 `layout-audit`이고, `--revision`이 있으면 `head-audit`입니다. |

NOTE: 기본 102자는 지정 글자 20자와 초성 19종 × 받침 4종의 84자입니다. 두 목록은 중복을 제외합니다. 지정 글자 목록은 `lib/glyphs.mjs`에 있습니다.

NOTE: `renderMs`는 윤곽 생성 시간입니다. `composeMs`는 충돌 검사를 포함한 시간입니다. 검사 범위가 다른 두 결과의 시간은 비교하지 않습니다.

## inspect

```bash
node tools/inspect/diagnose.mjs 계괌꽈
node tools/inspect/guides.mjs 넘호줬
```

- `diagnose.mjs`는 글자별로 역할의 원본 선택과 배치된 박스를 출력합니다.
- `guides.mjs`는 글자가 있는 셀의 저장된 가이드와 쓴 자모의 박스를 출력합니다.

## reference

```bash
node tools/reference/compare-noto.mjs 가각 --cols=3 --out=sheet.svg
node tools/reference/noto-reference.mjs
```

- `compare-noto.mjs`는 Noto Sans KR(회색)와 현재 결과(검정)를 나란히 그립니다. `--stats`를 붙이면 11,172자를 모두 검사하고 이상 사례의 시트를 만듭니다.
- `noto-reference.mjs`는 Noto Sans KR의 공간 비율을 `noto-space-reference.json`에 저장합니다. 윤곽 개수가 불확실한 글자는 제외합니다.

CAUTION: Noto Sans KR의 비율을 최적화 지표로 사용하지 마십시오. 이 값은 참고 자료입니다.

## project

```bash
node tools/project/profile.mjs 600
node tools/project/prof-top.mjs <cpuprofile 폴더>
```

- `export-project.js`는 브라우저 콘솔에서 실행합니다. IndexedDB의 프로젝트 기록을 모아 `sample-project.json`으로 내려받습니다. 파일은 `{ meta, sessions, drawings }` 형식입니다.
- `profile.mjs`는 음절 합성 시간과 학습 프로필의 크기를 측정합니다. 첫 번째 인자는 샘플 간격입니다. `sheet.svg`도 만듭니다.
- `prof-top.mjs`는 `.cpuprofile` 파일에서 self time이 큰 함수 25개를 출력합니다.

## sample

샘플 프로젝트의 획을 규칙으로 계산합니다. 규칙과 확인 방법은 `docs/decision/0004-sample-project-handwriting.md`에 있습니다.

| 파일 | 내용 |
|---|---|
| `handwriting.mjs` | 자모와 글자의 뼈대, 음절의 배치, 간격, 펜의 변화입니다. 스타일 값(`STYLES`)도 이 파일에 있습니다. 스크립트가 아닙니다. |
| `generate.mjs` | 획을 만들고 앱의 저장 경로로 프로젝트를 만듭니다. 쓴 글씨의 시트도 만듭니다. |
| `compose-sheet.mjs` | 전체 형식의 프로젝트 파일로 글자를 합성하고 시트를 만듭니다. |
| `home-film.mjs` | 홈의 애니메이션이 그리는 데이터를 만듭니다: 쓴 칸의 획과 문맥형, 그 칸만으로 조합한 음절과 자리, 그 칸만으로 조합할 수 있는 음절의 수와 그중 54개의 자모, 마지막 문장의 글리프. |

홈의 예시 손글씨(`src/features/samples/example.json`)를 다시 만듭니다.

```bash
node tools/sample/generate.mjs --style=example --out=tools/out/sample-example.json --strokes=src/features/samples/example.json --keep-latin=src/features/samples/example.json
```

개발용 샘플(`src/dev/sample-project.json`)을 다시 만듭니다.

```bash
node tools/sample/generate.mjs --style=tidy
```

홈의 애니메이션 데이터(`src/features/samples/home-film.json`)를 다시 만듭니다. 예시 손글씨나 조합 규칙이 바뀌면 실행합니다.

```bash
node tools/sample/home-film.mjs
```

합성한 글리프를 확인합니다.

```bash
node tools/sample/compose-sheet.mjs --project=tools/out/sample-example.json --name=sample-example-composed
```

| 옵션 | 의미 |
|---|---|
| `--style=<name>` | `handwriting.mjs`의 스타일 이름입니다. 기본값은 `tidy`입니다. |
| `--seed=<n>` | 난수 시드입니다. 기본값은 7입니다. 같은 시드는 같은 파일을 만듭니다. |
| `--out=<file>` | 전체 형식(`{ meta, sessions, drawings }`)의 결과 파일입니다. 기본값은 `src/dev/sample-project.json`입니다. |
| `--strokes=<file>` | 획만 있는 결과 파일입니다. 홈의 예시 손글씨가 이 형식을 읽습니다. |
| `--keep-latin=<file>` | 영문, 숫자와 기호의 획을 이 파일에서 가져옵니다. 한글 문장만 다시 만듭니다. |

- `generate.mjs`는 시트를 `tools/out/sample-<style>-hangul-1.svg`, `-hangul-2.svg`, `-hangul-3.svg`, `-latin.svg`에 저장합니다. 초성은 파랑, 중성은 자주, 종성은 초록입니다.
- `generate.mjs`는 완성 표본의 수, 빠진 필수 문맥형, 자모 사이의 최소 거리를 출력합니다.

CAUTION: `--out`의 기본값은 개발용 샘플을 덮어씁니다. 다른 스타일을 만들 때는 `--out`을 지정하십시오.

## lib

| 파일 | 내용 |
|---|---|
| `vite.mjs` | `startVite()`는 Vite 서버를 시작합니다. `revision`을 지정하면 `src/`를 해당 Git revision에서 읽습니다. |
| `project.mjs` | `loadProject()`는 샘플 프로젝트를 읽어 `drawings`와 `writingSessions`가 있는 프로젝트 객체로 돌려줍니다. 파일이 없으면 메시지를 출력하고 종료합니다. |
| `out.mjs` | `tools/out/`의 파일을 읽고 씁니다. |
| `glyphs.mjs` | 지정 글자 목록, 84자 조합, NaN 검사입니다. |
| `noto.mjs` | Noto Sans KR를 읽고 윤곽을 1000 단위로 변환합니다. |
| `svg.mjs` | 윤곽 명령을 SVG 경로 문자열로 변환합니다. |

## 새 스크립트 추가

1. 역할에 맞는 폴더에 파일을 만듭니다.
2. `lib/`의 함수를 사용합니다. Vite 서버, 프로젝트 읽기, 결과 쓰기를 직접 구현하지 마십시오.
3. 파일의 첫 줄에 실행 방법을 주석으로 씁니다.
4. 이 문서의 해당 표에 한 줄을 추가합니다.

## archive

`tools/archive/`는 개인 작업자가 로컬에 두는 보관 폴더입니다. 이 폴더는 Git에 없습니다. 이 폴더가 있으면 일회성 실험 스크립트와 이전 README가 들어 있습니다. 스크립트는 이전 폴더 구조를 전제로 하므로 그대로 실행되지 않을 수 있습니다.
