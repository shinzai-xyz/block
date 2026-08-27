// ==========================================
// メッセージ・表示用 定数定義
// ==========================================
const MESSAGES = {
    UI: {
        BTN_LOADING: "取得中...",
        BTN_DEFAULT: "リストを取得"
    },
    INFO: {
        SEARCHING_USER: "ユーザーを検索中...",
        LOCATING_PDS: "データサーバーを特定中...",
        FETCHING_BLOCKS: "ブロックデータを取得中...",
        FETCHING_PROFILES: "ユーザー情報を取得中...",
        NO_BLOCKS: "ブロックしているアカウントはありません。",
        BLOCKS_FOUND: (count) => `${count} 件のブロックが見つかりました。`
    },
    ERROR: {
        EMPTY_INPUT: "入力してください。",
        USER_NOT_FOUND: "ユーザーが見つかりません。",
        PLC_FAILED: "ディレクトリとの通信に失敗しました。",
        PDS_NOT_FOUND: "データサーバーの特定に失敗しました。",
        DATA_FETCH_FAILED: "データの取得に失敗しました。",
        PROFILE_FETCH_FAILED: "プロフィール取得エラー",
        SYSTEM_ERROR: (msg) => `エラー: ${msg}`
    }
};

// ==========================================
// イベントリスナー
// ==========================================
document.getElementById('searchBtn').addEventListener('click', checkBlocks);
document.getElementById('handleInput').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        checkBlocks();
    }
});

// ==========================================
// メイン処理
// ==========================================
async function getProfiles(dids) {
    const chunkSize = 25;
    let profiles = {};
    for (let i = 0; i < dids.length; i += chunkSize) {
        const chunk = dids.slice(i, i + chunkSize);
        const params = new URLSearchParams();
        chunk.forEach(did => params.append('actors', did));

        try {
            const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?${params.toString()}`);
            if (res.ok) {
                const data = await res.json();
                if (data.profiles) {
                    data.profiles.forEach(p => {
                        profiles[p.did] = p;
                    });
                }
            }
        } catch (e) {
            console.error(MESSAGES.ERROR.PROFILE_FETCH_FAILED, e);
        }
    }
    return profiles;
}

async function checkBlocks() {
    const handleInput = document.getElementById('handleInput').value.trim();
    const resultList = document.getElementById('resultList');
    const searchBtn = document.getElementById('searchBtn');
    const btnText = document.getElementById('btnText');

    const handle = handleInput.replace(/^@/, '');

    if (!handle) {
        setStatus(MESSAGES.ERROR.EMPTY_INPUT, "error");
        return;
    }

    // 初期化
    resultList.innerHTML = "";
    searchBtn.disabled = true;
    btnText.innerText = MESSAGES.UI.BTN_LOADING;
    setLoading(true);
    setStatus(MESSAGES.INFO.SEARCHING_USER, "info");

    try {
        // 1. ハンドル名からDIDを取得
        const resolveUrl = `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`;
        const resolveRes = await fetch(resolveUrl);
        if (!resolveRes.ok) throw new Error(MESSAGES.ERROR.USER_NOT_FOUND);
        const { did } = await resolveRes.json();

        // 2. DIDからPDSを特定
        setStatus(MESSAGES.INFO.LOCATING_PDS, "info");
        let pdsEndpoint = "";
        if (did.startsWith("did:plc:")) {
            const plcRes = await fetch(`https://plc.directory/${did}`);
            if (!plcRes.ok) throw new Error(MESSAGES.ERROR.PLC_FAILED);
            const plcData = await plcRes.json();
            const pdsService = plcData.service?.find(s => s.type === "AtprotoPersonalDataServer");
            if (pdsService && pdsService.serviceEndpoint) pdsEndpoint = pdsService.serviceEndpoint;
        } else if (did.startsWith("did:web:")) {
            pdsEndpoint = `https://${did.replace('did:web:', '')}`;
        }

        if (!pdsEndpoint) throw new Error(MESSAGES.ERROR.PDS_NOT_FOUND);

        // 3. PDSからブロックリストを取得（全件取得対応）
        setStatus(MESSAGES.INFO.FETCHING_BLOCKS, "info");
        let blocks = [];
        let cursor = "";
        
        while (true) {
            let repoUrl = `${pdsEndpoint}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=app.bsky.graph.block&limit=100`;
            if (cursor) {
                repoUrl += `&cursor=${encodeURIComponent(cursor)}`;
            }

            const repoRes = await fetch(repoUrl);
            if (!repoRes.ok) throw new Error(MESSAGES.ERROR.DATA_FETCH_FAILED);
            const repoData = await repoRes.json();

            const fetchedRecords = repoData.records || [];
            blocks = blocks.concat(fetchedRecords);

            if (!repoData.cursor || fetchedRecords.length === 0) {
                break;
            }
            cursor = repoData.cursor;
        }

        if (blocks.length === 0) {
            setLoading(false);
            setStatus(MESSAGES.INFO.NO_BLOCKS, "success");
            return;
        }

        setStatus(MESSAGES.INFO.FETCHING_PROFILES, "info");

        // プロフィール情報の取得
        const dids = blocks.map(record => record.value.subject);
        const profiles = await getProfiles(dids);

        // 削除・凍結済みを除外
        const activeBlocks = blocks.filter(record => {
            const blockedDid = record.value.subject;
            const profile = profiles[blockedDid];
            return profile && !profile.labels?.some(l => l.val === '!suspended'); 
        });

        setLoading(false);

        if (activeBlocks.length === 0) {
            setStatus(MESSAGES.INFO.NO_BLOCKS, "success");
            return;
        }

        setStatus(MESSAGES.INFO.BLOCKS_FOUND(activeBlocks.length), "success");

        // 4. 結果の描画（極力シンプルに）
        activeBlocks.forEach((record) => {
            const blockedDid = record.value.subject;
            const profile = profiles[blockedDid]; 

            const blockHandle = profile.handle || blockedDid;
            const displayName = profile.displayName || blockHandle;
            const avatarUrl = profile.avatar || null;

            const li = document.createElement('li');
            li.className = "p-3 border-b border-gray-200 flex items-center justify-between gap-3 bg-white";

            const leftContent = document.createElement('a');
            leftContent.href = `https://bsky.app/profile/${blockedDid}`;
            leftContent.target = "_blank";
            leftContent.rel = "noopener noreferrer";
            leftContent.className = "flex items-center gap-3 overflow-hidden flex-grow text-gray-900 hover:text-blue-600";

            // アバター
            const avatar = document.createElement('div');
            avatar.className = "w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0 overflow-hidden border border-gray-200";

            if (avatarUrl) {
                avatar.innerHTML = `<img src="${avatarUrl}" alt="" class="w-full h-full object-cover">`;
            } else {
                avatar.innerHTML = `<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>`;
            }

            // テキスト
            const textContent = document.createElement('div');
            textContent.className = "min-w-0";

            const nameEl = document.createElement('div');
            nameEl.className = "font-bold text-sm truncate";
            nameEl.innerText = displayName;

            const handleEl = document.createElement('div');
            handleEl.className = "text-gray-500 text-xs truncate";
            handleEl.innerText = `@${profile.handle}`;

            textContent.appendChild(nameEl);
            textContent.appendChild(handleEl);
            leftContent.appendChild(avatar);
            leftContent.appendChild(textContent);

            // 右側
            const rightContent = document.createElement('div');
            rightContent.className = "text-gray-400 shrink-0";
            rightContent.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>`;

            li.appendChild(leftContent);
            li.appendChild(rightContent);
            resultList.appendChild(li);
        });

    } catch (error) {
        setLoading(false);
        setStatus(MESSAGES.ERROR.SYSTEM_ERROR(error.message), "error");
    } finally {
        searchBtn.disabled = false;
        btnText.innerText = MESSAGES.UI.BTN_DEFAULT;
        setLoading(false);
    }
}

function setStatus(text, type) {
    const container = document.getElementById('statusContainer');
    const message = document.getElementById('statusMessage');
    const icon = container.querySelector('.status-icon');

    container.className = "mb-4";

    let colorClass = "";
    let iconSvg = "";

    switch(type) {
        case "error": 
            colorClass = "bg-red-50 border-red-200 text-red-700";
            iconSvg = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
            break;
        case "success": 
            colorClass = "bg-green-50 border-green-200 text-green-700";
            iconSvg = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
            break;
        case "info": 
            colorClass = "bg-blue-50 border-blue-200 text-blue-700";
            iconSvg = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
            break;
    }

    container.firstElementChild.className = `p-3 border text-sm flex items-center gap-2 ${colorClass}`;
    icon.innerHTML = iconSvg;
    message.innerText = text;
}

function setLoading(isLoading) {
    const spinner = document.getElementById('loadingSpinner');
    if (isLoading) {
        spinner.classList.remove('hidden');
    } else {
        spinner.classList.add('hidden');
    }
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((err) => {
            console.log('ServiceWorker registration failed', err);
        });
    });
}
