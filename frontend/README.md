# theworld 프런트

세계·하루·마주침·대화의 시뮬레이션은 전부 여기(`src/sim/`)서 돈다 (ADR-0006 결정 5). 서버 `backend/`(Spring, 8080)는 저장본 동기화·진짜 사람 에이전트·LLM 어댑터만 맡고, 없어도 앱은 오프라인으로 뜬다 (상단 회색 점 "혼자 생각 중"). 무대·캐릭터·탈것(`src/stage/`, ADR-0014)은 three.js 코드 로우폴리로 그린다 — 동적으로 불러오고, WebGL이 없으면 2D SVG로 떨어진다. `?stage=css`로 2D를 강제해 견줄 수 있다.

**실행 순서** — (1) 선택: Ollama와 모델(`ollama pull qwen3.5:9b`). (2) 서버: `cd backend && export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home && ./gradlew bootRun` → `http://localhost:8080`. (3) 프런트: `cd frontend && npm install && npm run dev` → `http://localhost:5173` (Vite가 `/api`를 `BACKEND_URL`, 기본 `http://localhost:8080`으로 프록시). 인증은 토큰·비밀번호 없이 고정 아이디 하나(`yoongwan`·`hojun`·`guest1~3`, 서버 시드): 저장된 사용자(`theworld.user.v1`)가 없고 서버가 살아 있으면 로그인 화면(`src/screens/LoginScreen.tsx`, "누구로 들어갈까?")이 먼저 뜨고, 고르면 `POST /api/auth/login`으로 확인받아 저장한 뒤 모든 `/api/**` 요청에 `X-User-Id`를 붙인다(`src/sim/api.ts`). 아이디 하나 = 서버 문서 한 벌이라 같은 기기에 다른 아이디로 들어오면 로컬 저장본(world·memory·book·places·seen·onboarded·sync)을 비우고 그 아이디의 문서를 받은 뒤 스토어를 만든다(`src/sim/sync.ts`). "오프라인으로 시작"이나 서버가 죽어 있으면 사용자 없이 로컬만으로 뜬다. 검사는 `npx tsc -b && npm test && npm run build` (`npm test`는 `scripts/sim-*.test.mjs` 17종 — fetch·localStorage 가짜로 서버 없이 돈다). 개발 패널(`?dev=1`)의 `api` 줄에서 backend 상태·`user`(와 "바꾸기" — 로그아웃·로컬 비움·새로 뜸)·문서 버전·remote 에이전트 수를 본다. 둘을 한 번에 띄우려면 `.claude/launch.json`의 `theworld-backend`·`theworld-dev`. 계약은 `docs/CONTRACT.md`, 설계는 `docs/adr/0012-spring-backend.md`.

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
