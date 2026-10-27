# PROGRESS

## 2026-10-27 (KST) · 1일 차 밤 ④: 실감 개선, 서울시청 좌표 확인

### 민우 피드백 「마인크래프트 월드 느낌」에 대한 변경 (D9)
- 사진을 영상 끝까지 건물·주변에 남김. 사진이 못 본 면에는 층고에 맞춘 창 격자를 그리고, 벽색은 사진에서 가져옴.
- 저녁 장면: 사진을 따뜻하게 어둡게 하고, 못 본 면의 창 일부에 불이 켜짐.
- 땅·하늘 색을 실제 쪽으로 조정함(밝은 흰 바닥 → 회색 포장).
- 모델이 쓴 긴 자막(최대 64자)이 9:16 화면 좌우를 넘던 문제: 조금 줄이고, 그래도 넘으면 두 줄로 나눔.

### HX8G+8W(서울)에서 서울시청을 본다면 (운영 API, 지도 타일 기준)
- HX8G+8W = 37.56581, 126.97731, 서울광장 남서쪽.
- 북동쪽 약 40°를 보면:
  - 약 70 m 앞에 옛 시청사(서울도서관)가 있음. 타일 높이는 본체 18~20 m, 탑 부분 30~34 m.
  - 약 140 m 뒤에 신청사가 있음. 타일 높이 44 m.
  - 실제 높이는 확인 필요.
- 타일에는 같은 건물의 부분(building part)이 겹친 윤곽으로 들어옴(18·20·30 m 등). 지금은 모두 땅에서부터 세우므로, 탑 부분이 건물 전체 높이로 서는 문제가 있음. 타일의 `render_min_height`·`hide_3d` 값은 이 환경에서 타일 서버가 막혀 확인 필요.
- 신청사의 물결 모양 유리 외벽은 「윤곽 × 높이」 모형과 맞지 않음. 앞의 옛 청사가 이 방식에 더 잘 맞음.
- 실제 사진이 필요함. 이 세션에서 다음 호스트가 네트워크 정책에 막힘:
  - 거절(403): `commons.wikimedia.org`, `graph.mapillary.com`, `tiles.openfreemap.org`, `overpass.private.coffee`.
  - 연결이 끊김: `overpass-api.de`.
  - 운영(Vercel)에서는 지도 조회가 됨.

### 다음
- 실제 사진 프리셋을 받는 두 경로:
  - 민우가 그 자리에서 앱으로 찍고 「Save preset」으로 저장.
  - Mapillary(메타의 거리 사진)를 쓰려면 토큰과 허용 도메인 설정이 필요함.
- 건물 부분(min height) 처리.

## 2026-10-27 (KST) · 1일 차 밤 ③: 운영에서 전 과정 확인

### 실제로 돌린 값 (PR #3 머지 뒤 https://whatif-camera.vercel.app)
- Muse Spark Open 실호출 성공:
  - 사진 없이 4.3 s. 제목 「Evening Garden Above the City」.
  - 사진 포함 7.5 s. 사진의 창문 격자를 보고 window boxes를 켬(프롬프트 규칙대로).
- 건물 조회:
  - 서울시청 2.1 s(41동), 강남역 1.8 s(42동), 반경 120 m. 출처는 둘 다 지도 타일.
  - 9~17 s였던 것이 2 s 안팎으로 줄었음.
- 운영 앱에서 합성 데모 전 과정(390×844 헤드리스):
  - 「Build 3D」부터 결과까지 7.5 s. 그중 Muse Spark 디자인이 6.8 s.
  - 계획 제목 「Soft Corner Glow Garden」, 프리셋 저장 OK.
- 그 프리셋으로 데모 영상(1080×1920, 30 fps)을 프레임 단위로 렌더링함(브라우저 실시간 녹화는 이 환경에서 5 fps 정도라 끊김).

### 고친 것
- 저장된 선택으로 연 장면에서 「Using the building you tapped」가 뜨던 문구 → 「saved with this capture」.

## 2026-10-27 (KST) · 1일 차 밤 ②: 운영 실측 결과와 수정

### 실제로 돌린 값 (https://whatif-camera.vercel.app, PR #2 머지 뒤)
- `/api/status`: `basetenApiKeyConfigured: true` (민우가 Vercel에 키 넣고 재배포).
- 건물 조회(반경 150 m)가 세 곳 모두 성공했고, 출처는 모두 OpenFreeMap 벡터 타일이었음. Overpass 두 서버는 응답하지 않음.

  | 장소 | 건물 수 | 소요 | 타일 높이가 기본값 5 m인 비율 |
  | --- | --- | --- | --- |
  | 서울시청 | 92동 | 16.8 s | 49% |
  | 강남역 | 69동 | 8.9 s | 20% |
  | 망원동 골목 | 59동 | 8.6 s | 90% |

  기본값 비율이 높을수록 OSM에 높이·층수 정보가 없다는 뜻이라, 주택가는 거의 비어 있음.
- 실제 타일에서 `building` 층과 `render_height` 해석이 맞게 동작함(합성 타일로만 시험했던 부분).
- Muse Spark Open 첫 실호출 2번(사진 없이 5.4 s, 사진 포함 7.5 s): 둘 다 「응답에 JSON 없음」으로 502.
  - 원인 추정: 이 모델은 항상 추론하고, 추론 토큰이 `max_tokens`(1,200)를 다 써 버림.
  - Baseten이 `reasoning_effort`를 받는지는 확인 필요.

### 고친 것
- Muse Spark 호출:
  - `max_tokens` 6,000, `reasoning_effort: "low"`(400이면 빼고 다시 요청).
  - 답이 없으면 오류에 finish_reason·답 길이·추론 길이를 적음.
  - 추론 텍스트에 JSON이 있으면 그것을 씀.
- 건물 조회:
  - 타일을 Overpass와 동시에 요청함. Overpass 대기는 6초, 타일이 오면 1.5초만 더 기다림. 최악 약 6초 예상(확인 필요).
- 타일 높이 5 m(OpenMapTiles 기본값)는 「모름」으로 처리. 그 밖의 타일 높이는 사실 패널에 「Height on the map」으로 사진 추정과 나란히 보여 줌.

## 2026-10-27 (KST) · 1일 차 밤: 배포본 실측, 건물 조회 예비 경로

### 한 일
- PR #1 머지(민우 요청, Vercel 임포트용). 배포 주소 https://whatif-camera.vercel.app, 이 작업 환경에서 접속 확인.
- 배포본 `/api/status`: `basetenApiKeyConfigured: false`, `modelApiKeyConfigured: false`(Vercel에 키 아직 없음).
- 배포본으로 서울 시청·강남역·망원동 건물 조회 6번이 전부 실패. overpass-api.de가 「서버 용량 초과, 대기열 가득 참」(502) 또는 28초 무응답(DECISIONS D1).
- 조회를 예비 경로로 바꿈: overpass-api.de → overpass.private.coffee → OpenFreeMap 벡터 타일. 타일 해석기(`src/data/mvt.ts`)를 새로 씀.
- 이 작업 환경에서 개발 서버를 `NODE_USE_ENV_PROXY=1`로 띄워야 서버 쪽 fetch가 프록시를 탐(Node 22.22).

### 실제로 돌린 값
- `npm test` 10파일 64시험 통과, lint·build·check:api 통과.
- 이 환경의 개발 서버로 서울 시청 조회: overpass-api.de 8초 시간 초과, private.coffee와 tiles.openfreemap.org는 허용 도메인 아님(403). 전체 실패까지 8.5초, 오류 문구에 세 출처가 다 나옴.

### 막힌 일
- `overpass.private.coffee`, `tiles.openfreemap.org`가 이 환경 허용 도메인에 없어 실제 응답 확인 못 함(민우에게 추가 요청).
- 실제 OpenFreeMap 타일의 층 이름·속성(`building`, `render_height`)은 OpenMapTiles 규격대로 짰고 합성 타일로만 시험함. 실제 타일로 확인 필요.

### 다음 일
- 도메인이 열리면 서울 3곳을 다시 조회해 출처별 응답·건물 수·`building:levels` 비율 기록.
- 민우: Vercel에 `BASETEN_API_KEY` 넣고 재배포 → Muse Spark 실호출 확인.

## 2026-10-27 (KST) · 1일 차: 시험 제작 (Claude Code)

> 민우 결정: 「응 시작해줘」. 데모는 사진+좌표가 주어진 환경(프리셋)에서, 실제로도 작동해야 함. 10/30 점검 때 anchor-orbit-risk와 비교해 갈지 결정.

### 한 일
- 새 레포에 Vite + TypeScript + three.js 웹앱, Vercel 함수(`/api/status`, `/api/footprints`, `/api/design`)를 새로 씀.
- 지도(OSM 윤곽) + 사진(점 4~5개)으로 카메라 위치·방향을 맞추고 높이·층수를 계산(DECISIONS D2).
- 사진 투영 → 흰 모형 + 층선 + 치수선 → 옥상 정원·덩굴 자라기 → 실제 일몰 방향의 저녁 → 사진 시점으로 돌아와 전/후 비교, 9:16 녹화(MP4/WebM).
- Muse Spark Open 디자인 경로(메뉴 선택, 숫자 제거, 실패 시 로컬 계획)와 로컬 계획.
- 실시간 촬영(카메라·GPS·나침반·중력), 사진 업로드(EXIF), 프리셋 저장·재생, SYNTHETIC 장면(정답 비교 패널).
- 센서 없이도: 건물 세로 모서리 소실점으로 기울기, 나침반 없으면 360° 후보.

### 실제로 돌린 값
- `npm test` 9파일 56시험 통과, `npm run lint`·`tsc --noEmit`·`npm run build`·`npm run check:api` 통과(키 없음: status 200, 나머지 400).
- 합성 장면(SYNTHETIC, GPS 9.2 m·나침반 11° 틀리게 줌): 높이 18.54 m(정답 18.6), 카메라 위치 오차 0.08 m, 방향 오차 0.02°, 층수 6(정답 6).
- 헤드리스 크로미엄(390×844):
  - 합성 데모 전 과정(고르기 → 점 → 3D → 결과)과 프리셋 저장 → `?preset=…&autoplay=1` 재생.
  - 녹화: MP4 2.1 MB, 약 29 s(SwiftShader).
  - 가짜 카메라 + GPS + 방향 이벤트로 실시간 촬영 경로(움직임 권한 있음/없음 둘 다).
  - 업로드 경로: 센서 없음, 높이 18.5 m, pitch 13.0°(정답 14°).
  - 키가 없어 `/api/design`은 503 → 로컬 계획으로 전환됨(정상).

### 막힌 일
- 이 작업 환경은 `overpass-api.de` 접속이 프록시에서 막힘(403). 실제 OSM 윤곽은 아직 한 번도 못 가져옴(테스트는 SYNTHETIC 고정 데이터). Vercel이나 허용 도메인 추가 뒤 확인 필요.
- Baseten 키 없음 → Muse Spark Open 실호출 0회.
- 실제 휴대폰: 아직 안 해 봄. iOS `webkitCompassHeading`이 폰을 세웠을 때 카메라 방향과 같은지 확인 필요(코드는 같다고 보고, 등록이 오차를 고침).
- 한국 동네의 OSM 건물 윤곽 범위: 확인 필요.

### 다음 일
- 민우: Vercel 연결(HTTPS) → 휴대폰으로 실제 건물 3곳(빽빽한 골목 1곳 포함) 촬영 → 프리셋 저장.
- 층수를 아는 건물로 추정 층수·높이 비교표(EVAL)를 만들고 데모 영상에 「추정 → 실제」 넣기.
- 민우가 확인한 뒤에만: Baseten 키로 디자인 실호출, Meta 크레딧 확인 뒤 SAM 3.1로 점 자동 표시와 사람·번호판 흐리기.
- 10/30 점검: ① 건물 찾기 ② 첫 프레임 겹침 ③ 10초 영상 저장, 세 가지가 실제 건물에서 되는지.
