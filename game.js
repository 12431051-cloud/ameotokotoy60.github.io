/* 雨男 - シンプルな避けゲー（60秒）
   操作: 左右矢印 / マウス移動 / タッチで操作
*/
(function(){
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const timerEl = document.getElementById('timer');
  const message = document.getElementById('message');
  const startBtn = document.getElementById('startBtn');
  const restartBtn = document.getElementById('restartBtn');
  const msgTitle = document.getElementById('message-title');
  const msgSub = document.getElementById('message-sub');

  // カスタムアセット（assets フォルダに画像を置くことで差し替え可能）
  const assets = {
    player: { path: 'assets/player.png', img: null },
    // 単一の drop.png と複数パターンをサポート
    drop: { path: 'assets/drop.png', img: null },
    dropVariants: [], // Image objects for drop-1..N
    bg: { path: 'assets/bg.png', img: null }
  };
  const DROP_VARIANT_COUNT = 6; // 試しに最大6パターンまで読み込む
  // ドロップ全体のスケール（1 = 元サイズ）。大きくしたければ値を上げてください。
  // 要望によりさらに大きく：3.0
  const DROP_SCALE = 3.0;
  // デバッグ: 当たり判定を画面に表示するか
  // 本番用は false にして非表示にしています。
  const SHOW_HITBOX = false;
  // プレイヤーの当たり判定を表示サイズより小さくする係数 (1.0 = 同じ, 0.8 = 80%)
  const PLAYER_HIT_SCALE = 0.85;
  // 難易度強化係数（>1でスポーン率を増やす）。ユーザー要望によりspawnRateを厳しくする際に調整。
  const DIFFICULTY_FACTOR = 1.6;
  let imagesLoaded = false;
  function loadAssets(){
    let toLoad = 0;
    for(const k in assets){
      const a = assets[k];
      if(!a.path) continue;
      // skip dropVariants here; we'll load variants separately
      if(k === 'dropVariants') continue;
      toLoad++;
      const img = new Image();
      img.src = a.path;
      img.onload = ()=>{ a.img = img; toLoad--; if(toLoad<=0) imagesLoaded = true; };
      img.onerror = ()=>{ a.img = null; toLoad--; if(toLoad<=0) imagesLoaded = true; };
    }
    // load drop variants (drop-1.png ... drop-N.png)
    for(let i=1;i<=DROP_VARIANT_COUNT;i++){
      toLoad++;
      const p = `assets/drop-${i}.png`;
      const img = new Image();
      img.src = p;
      img.onload = ()=>{ assets.dropVariants.push(img); toLoad--; if(toLoad<=0) imagesLoaded = true; };
      img.onerror = ()=>{ toLoad--; if(toLoad<=0) imagesLoaded = true; };
    }
    if(toLoad === 0) imagesLoaded = true;
  }
  loadAssets();

  let width = Math.min(window.innerWidth * 0.9, 900);
  let height = Math.min(window.innerHeight * 0.8, 700);
  canvas.width = width;
  canvas.height = height;

  window.addEventListener('resize', ()=>{
    width = Math.min(window.innerWidth * 0.9, 900);
    height = Math.min(window.innerHeight * 0.8, 700);
    canvas.width = width; canvas.height = height;
  });

  const GAME_TIME = 60; // seconds

  // プレイヤー（ユーザー要求: 表示の縦サイズを約400pxにするため大きく設定）
  // 現在の描画ロジックでは表示高さ = player.h * 2 になるため、player.h を 200 に設定しています。
  // 幅は目安として 300 にしていますが、画像アスペクトに合わせて自動で縮尺されます。
  // 表示高さを約150pxにするため、player.h を 75 に設定（表示高さ = player.h * 2 = 約150px）
  // 幅は現在 300 のまま維持していますが、必要なら幅も調整できます。
  const player = {w:300, h:50, x:0, y:0, speed:420, vx:0};
  function resetPlayer(){
    player.x = width/2 - player.w/2;
    player.y = height - player.h - 18;
    player.vx = 0;
  }
  resetPlayer();

  // プレイヤー描画（表示）矩形を計算する。
  // 画像がある場合はアスペクト比を保った上で描画サイズを決定し、そのサイズを当たり判定にも使う。
  function computePlayerDisplayBox(){
    const a = assets.player && assets.player.img ? assets.player.img : null;
    const targetW = player.w;
    const targetH = player.h * 2;
    if(a){
      const iw = a.width || targetW;
      const ih = a.height || targetH;
      const scale = Math.min(targetW / iw, targetH / ih);
      const drawW = iw * scale;
      const drawH = ih * scale;
      const drawX = player.x + (player.w - drawW) / 2;
      const drawY = (player.y + player.h) - drawH;
      player.displayX = drawX;
      player.displayY = drawY;
      player.displayW = drawW;
      player.displayH = drawH;
      // 当たり判定用矩形を表示矩形より少し小さくする
      const hitW = drawW * PLAYER_HIT_SCALE;
      const hitH = drawH * PLAYER_HIT_SCALE;
      player.hitW = hitW;
      player.hitH = hitH;
      player.hitX = drawX + (drawW - hitW) / 2;
      player.hitY = drawY + (drawH - hitH) / 2;
    } else {
      player.displayX = player.x;
      player.displayY = player.y;
      player.displayW = player.w;
      player.displayH = player.h;
      player.hitW = player.w * PLAYER_HIT_SCALE;
      player.hitH = player.h * PLAYER_HIT_SCALE;
      player.hitX = player.x + (player.w - player.hitW) / 2;
      player.hitY = player.y + (player.h - player.hitH) / 2;
    }
  }

  // 雨要素
  let drops = [];
  // タイトル画面用の雨
  let titleDrops = [];
  let titleAccum = 0;
  const titleSpawnRate = 2.2; // スタート画面の降らせ具合（drops/sec）
  let showTitle = false;
  function spawnDrop(x, speed){
    // ランダムなドロップ画像を選択（存在すれば）
    let img = null;
    if(assets.dropVariants && assets.dropVariants.length > 0){
      img = assets.dropVariants[Math.floor(Math.random() * assets.dropVariants.length)];
    } else if(assets.drop && assets.drop.img){
      img = assets.drop.img;
    }
    // 基本半径とバラツキを設定し、全体スケールを乗算して視覚的に大きくする
    const baseR = 6 + Math.random() * 6; // 元の半径レンジ
    const r = baseR * DROP_SCALE;
    drops.push({x:x, y:-10, r: r, speed:speed, color:'rgba(55, 125, 255,0.9)', img: img});
  }

  function spawnTitleDrop(x, speed){
    let img = null;
    if(assets.dropVariants && assets.dropVariants.length > 0){
      img = assets.dropVariants[Math.floor(Math.random() * assets.dropVariants.length)];
    } else if(assets.drop && assets.drop.img){
      img = assets.drop.img;
    }
    const baseR = 6 + Math.random() * 6;
    const r = baseR * DROP_SCALE;
    titleDrops.push({x:x, y:-10, r: r, speed:speed, color:'rgba(55, 125, 255,0.9)', img: img});
  }

  // 難易度パラメータ
  const baseSpawnRate = 0.9; // drops/sec at start
  const maxSpawnRate = 6.0; // max drops/sec
  const baseSpeed = 140; // px/sec
  const maxSpeed = 520; // px/sec
  // 難易度調整: DROP_SCALE が大きいほど水滴は大きくなるため
  // スポーン頻度を下げ、速度もやや下げて難易度を補正する
  const MIN_SPAWN_RATE = 0.15; // 秒あたりの最小スポーンレート

  // ゲーム状態
  let lastTime = 0;
  let accumulated = 0;
  let elapsed = 0;
  let running = false;
  let gameOver = false;

  // 入力
  const keys = {};
  window.addEventListener('keydown', (e)=>{ keys[e.key]=true; });
  window.addEventListener('keyup', (e)=>{ keys[e.key]=false; });
  canvas.addEventListener('mousemove', (e)=>{
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    player.x = mx - player.w/2;
    // display 矩形に基づいてはみ出しを補正
    computePlayerDisplayBox();
    if(player.displayX < 0) player.x -= player.displayX;
    if(player.displayX + player.displayW > width) player.x -= (player.displayX + player.displayW - width);
  });
  // タッチ
  canvas.addEventListener('touchmove',(e)=>{
    const rect = canvas.getBoundingClientRect();
    const t = e.touches[0];
    const mx = t.clientX - rect.left;
    player.x = mx - player.w/2;
    computePlayerDisplayBox();
    if(player.displayX < 0) player.x -= player.displayX;
    if(player.displayX + player.displayW > width) player.x -= (player.displayX + player.displayW - width);
    e.preventDefault();
  },{passive:false});

  function update(dt){
    if(!running) return;
    // プレイヤーの表示矩形を更新（画像のアスペクト比で描画される場合でも
    // 実際に描画される幅/高さを collision 判定で使うためここで算出する）
    computePlayerDisplayBox();
    elapsed += dt;
    if(elapsed >= GAME_TIME){
      running = false;
      win();
      return;
    }

  // 難易度の進行(線形)
  const t = elapsed / GAME_TIME; // 0..1
  // 基本のスポーン率・速度
  let spawnRate = baseSpawnRate + (maxSpawnRate - baseSpawnRate) * t; // per sec
  let dropSpeed = baseSpeed + (maxSpeed - baseSpeed) * t;
  // DROP_SCALE によって難易度を補正（大きいとスポーンを少なく、速度もやや遅く）
  spawnRate = spawnRate / Math.max(DROP_SCALE, 0.1);
  // ユーザー指定: spawnRate を厳しくして難易度を上げる
  spawnRate = spawnRate * DIFFICULTY_FACTOR;
  // 上限/下限でクランプ
  spawnRate = Math.max(spawnRate, MIN_SPAWN_RATE);
  spawnRate = Math.min(spawnRate, maxSpawnRate);
  dropSpeed = dropSpeed / Math.sqrt(Math.max(DROP_SCALE, 0.1));

    // スポーン処理: 毎秒 spawnRate 個
    accumulated += dt * spawnRate;
    while(accumulated > 1){
      accumulated -= 1;
      const x = Math.random() * (width - 8) + 4;
      spawnDrop(x, dropSpeed * (0.85 + Math.random()*0.5));
    }

    // プレイヤー左右移動（キーボード）
    let move = 0;
    if(keys['ArrowLeft'] || keys['a']) move -= 1;
    if(keys['ArrowRight'] || keys['d']) move += 1;
    if(move !== 0){
      player.x += move * player.speed * dt;
      // display 矩形に基づいた補正を行う
      computePlayerDisplayBox();
      if(player.displayX < 0){
        player.x -= player.displayX; // shift right
      }
      if(player.displayX + player.displayW > width){
        player.x -= (player.displayX + player.displayW - width); // shift left
      }
    }

    // ドロップ更新
    for(let i = drops.length-1; i >= 0; i--){
      const d = drops[i];
      d.y += d.speed * dt;
      if(d.y - d.r > height){ drops.splice(i,1); continue; }
      // 衝突判定 AABB 近似（表示矩形を使用）
  // 衝突判定は hitbox を優先（存在しない場合は display を使う）
  const px = player.hitX !== undefined ? player.hitX : (player.displayX !== undefined ? player.displayX : player.x);
  const py = player.hitY !== undefined ? player.hitY : (player.displayY !== undefined ? player.displayY : player.y);
  const pw = player.hitW !== undefined ? player.hitW : (player.displayW !== undefined ? player.displayW : player.w);
  const ph = player.hitH !== undefined ? player.hitH : (player.displayH !== undefined ? player.displayH : player.h);
      if(d.y + d.r >= py && d.y - d.r <= py + ph){
        if(d.x >= px && d.x <= px + pw){
          // 当たり
          running = false;
          gameOver = true;
          showGameOver();
          return;
        }
      }
    }

    // UI更新
    timerEl.textContent = Math.ceil(GAME_TIME - elapsed);
  }

  function draw(){
    // 背景
    ctx.clearRect(0,0,width,height);

    // スタート画面の白背景＋タイトル用の雨を描画する場合
    if(showTitle){
      // 白背景
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0,0,width,height);
      // タイトル用ドロップを描画
      for(const d of titleDrops){
        if(d.img){
          const img = d.img;
          const targetW = d.r * 2;
          const targetH = d.r * 2;
          const iw = img.width || targetW;
          const ih = img.height || targetH;
          const scale = Math.min(targetW / iw, targetH / ih);
          const drawW = iw * scale;
          const drawH = ih * scale;
          const drawX = d.x - drawW / 2;
          const drawY = d.y - drawH / 2;
          ctx.drawImage(img, drawX, drawY, drawW, drawH);
        } else {
          ctx.beginPath();
          ctx.fillStyle = d.color;
          ctx.ellipse(d.x, d.y, d.r/1.2, d.r, 0, 0, Math.PI*2);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(200,230,255,0.35)';
        ctx.beginPath();
        ctx.moveTo(d.x - d.r*0.25, d.y - d.r*1.6);
        ctx.lineTo(d.x + d.r*0.25, d.y + d.r*0.6);
        ctx.stroke();
      }
      // スタート画面ではここまで（プレイヤー等は描かない）
      return;
    }

    // 背景画像: assets/bg.png があれば canvas を cover (アスペクト比を保って中央クロップ) で描画
    if(assets.bg && assets.bg.img){
      const img = assets.bg.img;
      const iw = img.width || width;
      const ih = img.height || height;
      // cover するスケール (小さい方に合わせるのではなく切り取りながら全面にフィットさせる)
      const scale = Math.max(width / iw, height / ih);
      const sw = Math.max(1, Math.round(width / scale));
      const sh = Math.max(1, Math.round(height / scale));
      const sx = Math.max(0, Math.round((iw - sw) / 2));
      const sy = Math.max(0, Math.round((ih - sh) / 2));
      try{
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
      }catch(e){
        // まれにサイズが未定義な場合は安全にフォールバック
        ctx.drawImage(img, 0, 0, width, height);
      }
    } else {
      // 雲（簡易）
      const grad = ctx.createLinearGradient(0,0,0,height);
      grad.addColorStop(0,'rgba(255,255,255,0.06)');
      grad.addColorStop(1,'rgba(255,255,255,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0,0,width,height);
    }

    // ドロップ
    for(const d of drops){
      if(d.img){
        const img = d.img;
        const targetW = d.r * 2;
        const targetH = d.r * 2;
        const iw = img.width || targetW;
        const ih = img.height || targetH;
        const scale = Math.min(targetW / iw, targetH / ih);
        const drawW = iw * scale;
        const drawH = ih * scale;
        const drawX = d.x - drawW / 2;
        const drawY = d.y - drawH / 2;
        ctx.drawImage(img, drawX, drawY, drawW, drawH);
      } else {
        ctx.beginPath();
        ctx.fillStyle = d.color;
        ctx.ellipse(d.x, d.y, d.r/1.2, d.r, 0, 0, Math.PI*2);
        ctx.fill();
      }
      // 軌跡
      ctx.strokeStyle = 'rgba(200,230,255,0.35)';
      ctx.beginPath();
      ctx.moveTo(d.x - d.r*0.25, d.y - d.r*1.6);
      ctx.lineTo(d.x + d.r*0.25, d.y + d.r*0.6);
      ctx.stroke();
    }

    // デバッグ表示: ドロップの当たり判定（円）を表示
    if(SHOW_HITBOX){
      ctx.save();
      ctx.strokeStyle = 'rgba(255,0,0,0.9)';
      ctx.lineWidth = 1.5;
      for(const d of drops){
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI*2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // プレイヤー（傘を模した長方形）
    // display 矩形は update() 内で computePlayerDisplayBox() により設定されているが、
    // draw() 単独で呼ばれる場合に備えてここでも計算してから描画する。
    computePlayerDisplayBox();
    if(assets.player.img){
      // 既に computePlayerDisplayBox() が player.display* を設定している
      ctx.drawImage(assets.player.img, player.displayX, player.displayY, player.displayW, player.displayH);
    } else {
      // 論理的なプレイヤー矩形を表示・当たり判定に使う
      ctx.fillStyle = '#ffecb3';
      ctx.fillRect(player.displayX || player.x, player.displayY || player.y, player.displayW || player.w, player.displayH || player.h);
      // 傘のアーチ（表示矩形の上辺に合わせて描画）
      ctx.beginPath();
      ctx.fillStyle = '#ffd166';
      const arcX = (player.displayX || player.x) + (player.displayW || player.w)/2;
      const arcY = player.displayY || player.y;
      const arcW = (player.displayW || player.w)/1.3;
      const arcH = (player.displayH || player.h)*2;
      ctx.ellipse(arcX, arcY, arcW, arcH, 0, Math.PI, 2*Math.PI);
      ctx.fill();
    }

    // デバッグ表示: プレイヤーの当たり判定矩形を表示
    if(SHOW_HITBOX){
      ctx.save();
      ctx.strokeStyle = 'rgba(0,255,0,0.95)';
      ctx.lineWidth = 2;
      // プレイヤーのヒットボックスを描画
      ctx.strokeRect(player.hitX, player.hitY, player.hitW, player.hitH);
      // ヒットボックス中央下に小さなマーカー
      ctx.fillStyle = 'rgba(0,255,0,0.9)';
      ctx.fillRect(player.hitX + player.hitW/2 - 2, player.hitY + player.hitH - 2, 4, 4);
      ctx.restore();
    }

    // 時間バー（下部）
    const barW = width * 0.6;
    const bw = barW * (1 - elapsed / GAME_TIME);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect((width-barW)/2, 8, barW, 8);
    ctx.fillStyle = '#fffb81';
    ctx.fillRect((width-barW)/2, 8, bw, 8);
  }

  function loop(ts){
    if(!lastTime) lastTime = ts;
    const dt = Math.min((ts - lastTime) / 1000, 0.05);
    lastTime = ts;
    // ゲーム更新（プレイ中）
    update(dt);
    // タイトル画面用の更新（プレイ前）
    if(showTitle){
      titleAccum += dt * titleSpawnRate;
      while(titleAccum > 1){
        titleAccum -= 1;
        const x = Math.random() * (width - 8) + 4;
        spawnTitleDrop(x, 140 * (0.9 + Math.random()*0.6));
      }
      for(let i = titleDrops.length-1; i >= 0; i--){
        const d = titleDrops[i];
        d.y += d.speed * dt;
        if(d.y - d.r > height) titleDrops.splice(i,1);
      }
    }
    draw();
    // ループは常時回す（タイトル画面のアニメーションのため）
    requestAnimationFrame(loop);
  }

  function startGame(){
    // 初期化
    drops = [];
    elapsed = 0; accumulated = 0; lastTime = 0; gameOver = false; running = true;
    resetPlayer();
    message.classList.add('hidden');
    restartBtn.classList.add('hidden');
    // ボタンの表示状態をリセット
    startBtn.classList.remove('hidden'); startBtn.style.display = 'inline-block';
    restartBtn.style.display = 'none';
    // タイトル画面アニメーションを停止
    showTitle = false;
    message.classList.remove('dark');
    timerEl.textContent = GAME_TIME;
    requestAnimationFrame(loop);
  }

  function showStart(){
    // タイトルはロゴで表示しているためテキストタイトルは非表示にする
    msgTitle.textContent = '';
    msgSub.textContent = '60秒間、降ってくる雨男トイを避け続けよう！';
    message.classList.remove('hidden');
    // スタート画面では「スタート」のみ表示
    startBtn.classList.remove('hidden'); startBtn.style.display = 'inline-block';
    restartBtn.classList.add('hidden'); restartBtn.style.display = 'none';
    // スタート画面ではオーバーレイは白（canvas 側で白背景を描画する）
    message.classList.remove('dark');
    showTitle = true;
  }

  function showGameOver(){
    msgTitle.textContent = 'ゲームオーバー';
    msgSub.textContent = `生き残った時間: ${Math.floor(elapsed)} 秒`;
    message.classList.remove('hidden');
    // ゲームオーバー時は「もう一度」のみ表示
    startBtn.classList.add('hidden'); startBtn.style.display = 'none';
    restartBtn.classList.remove('hidden'); restartBtn.style.display = 'inline-block';
    // ゲームオーバーでは暗めのオーバーレイにしておく
    message.classList.add('dark');
    showTitle = false;
  }

  function win(){
    msgTitle.textContent = 'クリア！';
    msgSub.textContent = `60秒間生き延びた！おめでとう！`;
    message.classList.remove('hidden');
    // クリア時も「もう一度」のみ表示
    startBtn.classList.add('hidden'); startBtn.style.display = 'none';
    restartBtn.classList.remove('hidden'); restartBtn.style.display = 'inline-block';
    message.classList.add('dark');
    showTitle = false;
  }

  startBtn.addEventListener('click', ()=>{ startGame(); });
  restartBtn.addEventListener('click', ()=>{ startGame(); });

  // 初期表示
  showStart();
  // 初回ロード時にも背景を一度描画しておく（bg がある場合に画面が空白になるのを防ぐ）
  draw();
  // アニメーションループ開始（タイトル画面の雨アニメーションのために常時ループを回す）
  requestAnimationFrame(loop);
})();
