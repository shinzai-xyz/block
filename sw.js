const CACHE_NAME = 'block-checker-v3';
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './image/icon.png'
];

// インストール処理：指定したファイルをキャッシュ
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
        .then((cache) => {
            console.log('Opened cache');
            return cache.addAll(urlsToCache);
        })
        .then(() => self.skipWaiting()) // すぐに新しいService Workerを待機状態からアクティブにする
    );
});

// アクティベート処理：古いバージョンのキャッシュを削除
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('古いキャッシュを削除しました:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
        .then(() => self.clients.claim()) // 新しいService Workerにすぐコントロールを移す
    );
});

// フェッチ処理：オンライン優先（Network First）戦略
self.addEventListener('fetch', (event) => {
    // APIへのリクエストはキャッシュしない（常に通信させる）
    if (event.request.url.includes('api.bsky.app') || event.request.url.includes('plc.directory')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
        .then((response) => {
            // ネットワーク通信が成功した場合
            // レスポンスが正常であれば、最新のデータをキャッシュに保存（更新）する
            if (response && response.status === 200 && response.type === 'basic') {
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
            }
            return response;
        })
        .catch(() => {
            // ネットワーク通信が失敗した場合（オフライン時など）
            // 保存しておいたキャッシュを返す
            return caches.match(event.request);
        })
    );
});
