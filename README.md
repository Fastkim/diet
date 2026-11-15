# 하루의 무게 · HARU

매일 체중을 기록하고, 연도별 차트·기록 달력·통계를 확인하는 GitHub Pages용 개인 기록장입니다. 외부 라이브러리와 서버 없이 동작합니다.

## 개인정보 저장 방식

- 기록과 목표 체중은 비밀번호로 암호화한 뒤 현재 브라우저의 `localStorage`에만 저장합니다. 기록을 서버나 GitHub에 전송하지 않습니다.
- AES-GCM 256비트와 PBKDF2-SHA-256 310,000회를 사용합니다. 비밀번호는 10자 이상이며, 비밀번호 자체는 저장하지 않습니다.
- 다른 사람이 페이지 링크를 열어도 내 기록이 전달되지 않습니다. 해당 방문자는 자신의 브라우저에서 빈 기록장을 시작합니다.
- 다른 탭이나 앱으로 전환해도 기록장은 열린 상태를 유지합니다. 5분 동안 사용하지 않으면 자동으로 잠기며, 상단의 **잠그기**로 직접 잠글 수도 있습니다. 페이지를 새로 열거나 새로고침하면 비밀번호를 다시 입력해야 합니다. 잠금 해제 중인 화면은 같은 기기를 사용하는 사람이 볼 수 있으므로 공용 기기에서는 사용을 피하세요.
- 기기·브라우저 간 자동 동기화는 없습니다. 이동할 때는 **암호화 백업**을 내려받고 다른 기기의 페이지에서 복원하세요. 백업을 만들 때의 비밀번호가 필요합니다.
- 비밀번호를 잊으면 복구할 수 없습니다. 브라우저 데이터 삭제·시크릿 모드 종료 시 기록이 사라질 수 있으므로 정기적으로 백업하세요. 주소나 도메인이 바뀌어도 기존 브라우저 저장소에 접근하지 못할 수 있습니다.
- 백업도 개인 파일입니다. `data`, `backups`, `exports` 폴더와 백업 파일은 저장소에 올리지 마세요. 공개 저장소에 올라간 파일은 페이지 화면에서 숨겨도 공개됩니다.

GitHub Pages의 프로젝트 주소들은 `https://사용자명.github.io`라는 **동일한 출처(origin)** 를 공유할 수 있습니다. 같은 출처의 다른 프로젝트 스크립트는 브라우저 저장소에 접근할 수 있으므로, 신뢰할 수 없는 페이지와 함께 호스팅하지 마세요. 별도 계정의 Pages 또는 이 앱만 사용하는 전용 도메인으로 출처를 분리하는 방법을 권장합니다. 암호화는 잠긴 기록을 보호하지만, 페이지 코드나 기기 자체가 변조된 경우까지 보호하지는 못합니다.

## 로컬 실행

Node.js 20 이상이 필요합니다. 설치할 의존성은 없습니다.

```powershell
npm run dev
```

`http://127.0.0.1:4173`을 엽니다. 종료하려면 터미널에서 `Ctrl+C`를 누릅니다. 다른 포트를 쓰려면 PowerShell에서 `$env:PORT = '4174'`를 지정한 뒤 실행하세요.

Web Crypto를 지원하는 최신 브라우저와 HTTPS 또는 localhost 환경이 필요합니다. `index.html`을 직접 여는 `file://` 방식은 지원하지 않습니다.

검증:

```powershell
npm test
```

## GitHub Pages 배포

1. 이 프로젝트의 저장소는 [Fastkim/diet](https://github.com/Fastkim/diet)입니다.
2. 새 환경에서 이 폴더를 처음 연결할 때는 아래 명령을 사용합니다. 이미 연결된 환경에서는 변경 사항을 커밋하고 `git push`만 실행하면 됩니다.

   ```powershell
   git init
   git add .
   git commit -m "Create private weight diary"
   git branch -M main
   git remote add origin https://github.com/Fastkim/diet.git
   git push -u origin main
   ```

3. 저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 선택합니다.
4. **Actions → Publish GitHub Pages → Run workflow**를 실행합니다. 이후 `main`에 올린 변경은 자동으로 배포됩니다.
5. 배포가 끝나면 **Settings → Pages**의 주소를 엽니다. 저장소 하위 경로에서도 동작하도록 상대 경로를 사용합니다.

워크플로는 `index.html`, `css/`, `js/`, `assets/`와 `.nojekyll`만 페이지 배포물에 포함합니다. 백업을 이 공개 폴더 안에 넣지 마세요. Pages 배포가 완료되면 `https://fastkim.github.io/diet/`에서 이용할 수 있습니다.

[GitHub 공식 배포 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)와 [Pages 공개 범위 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)를 참고할 수 있습니다. 저장소가 비공개여도 Pages 사이트는 플랜과 설정에 따라 공개될 수 있습니다. 이 앱은 사이트 공개 여부와 별개로 개인 기록을 브라우저에 보관합니다.

## 기록에 관하여

통계는 입력한 체중의 변화를 보여주며 의료적 판단이나 감량 목표를 제안하지 않습니다. 목표 체중은 선택 사항입니다.
