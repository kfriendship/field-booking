# 화성 축구장 빈 시간

날짜와 시간대를 고르면 그 시간 내내 비어 있는 화성시 축구장을 실시간으로 찾아주는 페이지.

```
docs/            GitHub Pages로 배포되는 화면 (index.html, stadiums.json)
worker/          예약 사이트를 대신 조회하는 Cloudflare Worker
lib/yeyak.js     조회 공통 로직 (워커·로컬 서버·스크립트가 같이 씀)
server.mjs       로컬 개발용 서버 (워커 없이 테스트)
scripts/         구장 목록 갱신 스크립트
```

## 로컬에서 실행

```bash
npm run dev        # http://localhost:3000
```

## 배포

### 1. Worker (Cloudflare)

1. Cloudflare 계정을 만들고 터미널에서 로그인합니다: `npx wrangler login`
2. `worker/wrangler.toml`의 `ALLOWED_ORIGINS`를 `https://<깃허브아이디>.github.io`로 바꿉니다.
3. 배포합니다: `npm run deploy:worker`
4. 출력되는 주소(`https://yeyak-finder.<서브도메인>.workers.dev`)를 복사합니다.
5. **차단 여부 확인**: 브라우저 콘솔이나 curl로 한 번 호출해봅니다.
   ```bash
   curl -H "Origin: http://localhost" "https://yeyak-finder.<서브도메인>.workers.dev/api/check?date=2026-10-24&ids=241"
   ```
   시간대 JSON이 나오면 성공입니다. 에러가 나면 예약 사이트가 Cloudflare IP를 막는 것이라 이 방식은 쓸 수 없습니다.

### 2. 페이지 (GitHub Pages)

1. `docs/index.html`의 `<meta name="api-base">` 값을 위 Worker 주소로 바꿉니다.
2. GitHub에 push하고, 저장소 Settings → Pages에서 Branch `main`, 폴더 `/docs`를 선택합니다.
3. `https://<깃허브아이디>.github.io/<저장소이름>/`에서 확인합니다.

### (선택) Worker 자동 배포

`worker/`나 `lib/`를 수정해서 push하면 `.github/workflows/deploy-worker.yml`이 Worker를 다시 배포합니다.
Cloudflare에서 "Edit Cloudflare Workers" 템플릿으로 API 토큰을 만들어 저장소 Secrets에 `CLOUDFLARE_API_TOKEN`으로 넣으면 됩니다.

## 구장 목록 갱신

구장이 추가되거나 바뀌었을 때만 실행해서 커밋합니다.

```bash
npm run stadiums   # docs/stadiums.json 다시 생성
```

## 판정 기준

예약 사이트 `stadiumReserveUseList.do` 응답의 `applyStatusCd`를 사용합니다.
값이 없으면 예약 가능, `AP`이면 예약됨, `CLOSE`이면 운영하지 않는 시간입니다.
예약자 이름 등 다른 필드는 Worker에서 버리고 내보내지 않습니다.

## 주의

- 예약 사이트는 매크로 탐지를 사용합니다. 요청은 동시 3개, 0.3초 간격으로 제한되어 있으니 크게 올리지 마세요.
- 조회만 합니다. 예약은 구장 이름을 눌러 예약 사이트에서 직접 진행하세요.
