# 사진 → 우리 그림체 캐릭터 실험 (2026-09-10)

FLUX.2 klein 4B edit(mflux, q8, 로컬 M5 Pro)로 공개 초상 사진(Wikimedia Commons, 미국 정부 공식 초상 = 퍼블릭 도메인) 6장을 캐릭터로 바꿔 봤다.
실행: `cd ~/Projects/checkmate/A2A/src/comic && .venv/bin/python look-gen3.py` (A2A comic 모듈의 venv에 mflux가 있다. 스크립트 안의 경로는 잡 tmp라 옮겨 쓰려면 T를 바꿀 것.)

*   sheet1: A = 치비 프롬프트만, B = 모모 그림을 둘째 참조로. → 전원 같은 얼굴. 신원 소실.
*   sheet2: C = 스타일 약한 캐리커처(얼굴 타이트 크롭), D = C → 모모 스타일 2단계, E = 치비 8스텝. → C만 사람이 산다. 안경을 전원에게 씌움(프롬프트의 eyewear 단어 탓).
*   sheet3: C2 = 안경 언급 뺀 캐리커처, F/F2 = "머리가 키의 절반" 중간 비율(시드 2개). → C2 전원 알아봄. F는 시드에 따라 안경·흰머리가 사라지고, 피부색이 밝아진다.
*   look-gen4.py: Qwen-Image-Edit-2511(q4, `mflux-community/qwen-image-edit-2511-mflux-q4`, 29GB)로 같은 사진에 C2·F·G(모모 참조). 2026-09-10 저녁 회선이 1~2MB/s라 다운로드에 수 시간.
    첫 실행 때 가중치가 없으면 mflux가 이어받는다. `cd ~/Projects/checkmate/A2A/src/comic && .venv/bin/python <이 폴더>/look-gen4.py 20` (인자 = 스텝 수).
*   sheet4 (Qwen 512px, 20스텝, 장당 ~2분): F(머리 반 비율)가 처음으로 개인+그림체를 같이 잡음. 오바마 피부색 유지. G(모모 참조)는 Qwen도 전원 모모 → 참조 이미지로 그림체 지정은 폐기.
*   sheet5 (Qwen 1024px, 장당 ~11분, best/ 에 원본): 캐리커처·F 모두 선이 깔끔해지고 오바마·샌더스는 누가 봐도 그 사람. 이 해상도가 이 모델의 제 실력.
*   sheet6 (2026-09-11, SVG 얼굴 축): 생성 대신 캐릭터 코드에 축을 더함 — 얼굴형 4·눈 4·눈썹 4·코 3·입 3·귀 2(모두 Look의 선택 칸). `?lab=character&sheet=faces`를
    `node scripts/shot.mjs "http://localhost:5199/?lab=character&sheet=faces" out.png 5000 1200 2250`로 찍은 것. 사람 여섯은 손으로 고른 값(src/dev/FaceSheet.tsx PEOPLE).
*   sheet7 (2026-09-11): 머리 15·체형 3·표정 확인까지 넣은 전체 시트. sheet8: 같은 사진 5장을 `POST /api/character/look`(qwen3.8:27b, 10~15초/장)에 넣어
    모델이 고른 열세 칸(model-picks/*.json)으로 그린 것 — 손으로 고른 값과 거의 같다(오바마는 체형만, 샌더스는 곱슬→short·눈썹 none).

레포에는 README·스크립트·model-picks·sheet7/8 축소본(.small.png)만 넣는다. 원본 시트(총 14MB)와 best/ 는 로컬에만 둔다.
