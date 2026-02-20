const API_URL = "https://rimuwordle.duckdns.org"; 

let currentWord = "";
let guesses = [];
let currentGuess = "";
let gameOver = false;
const ROWS = 6; const COLS = 5;

// --- 1. DISCORD HANDSHAKE ---
let discordSdk;
let discordUser = null;

// --- LOCAL STORAGE DATA (FIXED FOR DISCORD) ---
let userStats = { played: 0, wins: 0, currentStreak: 0, maxStreak: 0, distribution: [0,0,0,0,0,0] };

// Wrap in try/catch to prevent Discord Sandbox from crashing the game
try {
    let savedStats = localStorage.getItem('wordleStats');
    if (savedStats) userStats = JSON.parse(savedStats);
} catch (e) {
    console.warn("localStorage is blocked. Stats will not save between sessions.");
}

document.addEventListener("DOMContentLoaded", async () => {
    // Hide the broken avatar image initially
    document.getElementById("user-avatar").style.display = "none";
    
    setupModals();
    loadGameState(); 
    
    await setupDiscordSdk();
    loadLeaderboard();
});

async function setupDiscordSdk() {
    if (typeof window.discordSdk !== 'undefined') {
        try {
            discordSdk = new window.discordSdk.DiscordSDK("1441383624107884616");
            await discordSdk.ready();
            console.log("Discord SDK is ready");

            let code;
            try {
                // 1. Try to authenticate silently (works for returning players)
                const result = await discordSdk.commands.authorize({
                    client_id: "1441383624107884616",
                    response_type: "code",
                    state: "",
                    prompt: "none",
                    scope: ["identify"]
                });
                code = result.code;
            } catch (silentError) {
                // 2. If silent fails, force the Discord authorization popup!
                const popupResult = await discordSdk.commands.authorize({
                    client_id: "1441383624107884616",
                    response_type: "code",
                    state: "",
                    prompt: "consent",
                    scope: ["identify"]
                });
                code = popupResult.code;
            }

            // 3. Trade the code for a token on your VM
            const response = await fetch(`${API_URL}/api/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });
            
            const { access_token } = await response.json();

            // 4. Authenticate the user into the Activity
            const auth = await discordSdk.commands.authenticate({ access_token });
            
            discordUser = auth.user;
            updateUserProfile(discordUser);
            
        } catch (e) {
            console.error("Discord SDK setup failed:", e);
            document.getElementById("user-name-display").innerText = "Auth Error";
            // This will pop up a red message on your screen telling us exactly what went wrong!
            showToast("Auth Error: " + (e.message || "Check Dev Portal Redirects")); 
        }
    } else {
        console.warn("Discord SDK not detected. Running in browser mode.");
    }
}

function updateUserProfile(user) {
    document.getElementById("user-name-display").innerText = user.username;
    
    const avatarImg = document.getElementById("user-avatar");
    const initialSpan = document.getElementById("user-initial");
    
    if (user.avatar) {
        avatarImg.src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
        avatarImg.style.display = "block";
        initialSpan.style.display = "none";
    } else {
        initialSpan.innerText = user.username.charAt(0).toUpperCase();
    }
}

function initGame(forceNew = false) {
    if (forceNew || !currentWord) {
        currentWord = TARGET_WORDS[Math.floor(Math.random() * TARGET_WORDS.length)].toUpperCase();
        guesses = [];
        currentGuess = "";
        gameOver = false;
        saveGameState();
    }
    
    document.getElementById("play-again-btn").style.display = "none";
    document.getElementById("stats-modal").classList.add("hidden");

    const board = document.getElementById("game-board");
    board.innerHTML = ""; 
    for (let i = 0; i < ROWS; i++) {
        let row = document.createElement("div"); row.className = "row";
        for (let j = 0; j < COLS; j++) {
            let tile = document.createElement("div"); tile.className = "tile"; tile.id = `tile-${i}-${j}`;
            row.appendChild(tile);
        }
        board.appendChild(row);
    }
    createKeyboard();

    for (let i = 0; i < guesses.length; i++) {
        let result = checkWord(guesses[i], currentWord);
        restoreTilesVisually(result, i, guesses[i]);
    }
    updateSidebar();
}

// --- 2. SCORE SUBMISSION ---
async function submitScore(numGuesses) {
    try {
        let username = discordUser ? discordUser.username : "Player";

        await fetch(`${API_URL}/submit-score`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, guesses: numGuesses })
        });
        loadLeaderboard(); 
    } catch (e) {
        console.error("Score submission failed.", e);
    }
}

// --- GAME LOGIC ---
async function handleEnter() {
    if (gameOver) return;
    if (currentGuess.length !== COLS) { shakeRow(); showToast("Not enough letters"); return; }
    if (!ALL_WORDS.includes(currentGuess.toLowerCase())) { shakeRow(); showToast("Not in word list"); return; }

    const hardModeError = checkHardMode(currentGuess);
    if (hardModeError) { shakeRow(); showToast(hardModeError); return; }

    const result = checkWord(currentGuess, currentWord);
    guesses.push(currentGuess);
    saveGameState();
    
    await revealTiles(result, guesses.length - 1);

    if (currentGuess === currentWord) {
        gameOver = true; saveGameState();
        winAnimation(guesses.length - 1);
        updateStats(true);
        submitScore(guesses.length); 
        setTimeout(() => showStats(true), 2000);
    } else if (guesses.length === ROWS) {
        gameOver = true; saveGameState();
        updateStats(false);
        setTimeout(() => { showToast(currentWord); showStats(false); }, 1000);
    }
    currentGuess = "";
}

function updateStats(won) {
    userStats.played++;
    if (won) {
        userStats.wins++;
        userStats.currentStreak++;
        userStats.maxStreak = Math.max(userStats.currentStreak, userStats.maxStreak);
        userStats.distribution[guesses.length - 1]++;
    } else {
        userStats.currentStreak = 0;
    }
    
    try {
        localStorage.setItem('wordleStats', JSON.stringify(userStats));
    } catch (e) {}
    
    updateSidebar();
}

function showStats(won) {
    document.getElementById("stats-modal").classList.remove("hidden");
    document.getElementById("stat-played").innerText = userStats.played;
    document.getElementById("stat-win").innerText = Math.round((userStats.wins / userStats.played) * 100) || 0;
    document.getElementById("stat-streak").innerText = userStats.currentStreak;
    document.getElementById("stat-max").innerText = userStats.maxStreak;

    const distContainer = document.getElementById("guess-distribution");
    distContainer.innerHTML = "";
    let maxDist = Math.max(...userStats.distribution, 1); 

    userStats.distribution.forEach((val, i) => {
        let width = Math.max(7, (val / maxDist) * 100); 
        let isHighlighted = won && i === (guesses.length - 1);
        
        distContainer.innerHTML += `
            <div class="dist-row">
                <div class="dist-num">${i + 1}</div>
                <div class="dist-bar ${isHighlighted ? 'highlight' : ''}" style="width: ${width}%">${val}</div>
            </div>
        `;
    });

    if (gameOver) {
        let btn = document.getElementById("play-again-btn");
        btn.style.display = "inline-block";
        btn.onclick = () => initGame(true); 
    }
}

// --- ANIMATIONS & TOASTS ---
function showToast(msg) {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 500); }, 2000);
}

function winAnimation(rowIndex) {
    let row = document.getElementById("game-board").children[rowIndex];
    for (let i = 0; i < 5; i++) {
        setTimeout(() => row.children[i].classList.add("bounce"), i * 100);
    }
}

function revealTiles(result, rowIndex) {
    return new Promise((resolve) => {
        let row = document.getElementById("game-board").children[rowIndex];
        for (let i = 0; i < 5; i++) {
            setTimeout(() => {
                row.children[i].classList.add(result[i]);
                updateKeyColor(guesses[rowIndex][i], result[i]);
                if (i === 4) resolve();
            }, i * 200);
        }
    });
}

function restoreTilesVisually(result, rowIndex, word) {
    let row = document.getElementById("game-board").children[rowIndex];
    for (let i = 0; i < 5; i++) {
        row.children[i].innerText = word[i];
        row.children[i].classList.add(result[i]);
        updateKeyColor(word[i], result[i]);
    }
}

function updateKeyColor(letter, colorClass) {
    let keyBtn = document.querySelector(`button[data-key='${letter}']`);
    if (keyBtn) {
        let isGreen = keyBtn.classList.contains("correct");
        if (colorClass === 'correct') keyBtn.className = "key correct";
        else if (colorClass === 'present' && !isGreen) keyBtn.className = "key present";
        else if (colorClass === 'absent' && !isGreen && !keyBtn.classList.contains("present")) keyBtn.className = "key absent";
    }
}

// --- STANDARD KEYBOARD/INPUT LOGIC ---
function createKeyboard() {  
    const keys = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
    const container = document.getElementById("keyboard-container");
    container.innerHTML = "";
    keys.forEach((rowStr, index) => {
        let rowDiv = document.createElement("div"); rowDiv.className = "key-row";
        if (index === 2) addKeyBtn(rowDiv, "ENTER", "wide", handleEnter);
        for (let char of rowStr) addKeyBtn(rowDiv, char, "", () => handleInput(char));
        if (index === 2) addKeyBtn(rowDiv, "⌫", "wide", handleBackspace);
        container.appendChild(rowDiv);
    });
}

function addKeyBtn(parent, text, className, action) {
    let btn = document.createElement("button"); btn.innerText = text; btn.className = `key ${className}`;
    btn.setAttribute("data-key", text); btn.onclick = (e) => { e.target.blur(); action(); };
    parent.appendChild(btn);
}

document.addEventListener("keydown", (e) => {
    if (document.getElementById("onscreen-input-toggle").checked) return; 
    
    if (!document.getElementById("settings-modal").classList.contains("hidden") ||
        !document.getElementById("stats-modal").classList.contains("hidden")) {
        return;
    }

    if (gameOver) return;
    
    const key = e.key.toUpperCase();
    if (key === "ENTER") handleEnter(); 
    else if (key === "BACKSPACE") handleBackspace(); 
    else if (/^[A-Z]$/.test(key)) handleInput(key);
});

function handleInput(letter) { if (currentGuess.length < COLS && !gameOver) { currentGuess += letter; updateGrid(); } }
function handleBackspace() { if (currentGuess.length > 0 && !gameOver) { currentGuess = currentGuess.slice(0, -1); updateGrid(); } }

function updateGrid() {
    let row = document.getElementById("game-board").children[guesses.length];
    for (let i = 0; i < COLS; i++) {
        row.children[i].innerText = currentGuess[i] || "";
        if (currentGuess[i]) row.children[i].classList.add("filled"); else row.children[i].classList.remove("filled");
    }
}

function shakeRow() {
    let row = document.getElementById("game-board").children[guesses.length];
    row.classList.add("shake"); setTimeout(() => row.classList.remove("shake"), 500);
}

function checkWord(guess, target) {
    let result = Array(5).fill("absent"); let targetArr = target.split(""); let guessArr = guess.split("");
    for (let i = 0; i < 5; i++) { if (guessArr[i] === targetArr[i]) { result[i] = "correct"; targetArr[i] = null; guessArr[i] = null; } }
    for (let i = 0; i < 5; i++) {
        if (guessArr[i] !== null) {
            let index = targetArr.indexOf(guessArr[i]);
            if (index !== -1) { result[i] = "present"; targetArr[index] = null; }
        }
    }
    return result;
}

// --- UI SETUP ---
function setupModals() {
    document.getElementById("stats-btn").onclick = () => showStats(false); 
    document.getElementById("close-stats-btn").onclick = () => document.getElementById("stats-modal").classList.add("hidden");
    
    document.getElementById("settings-btn").onclick = () => document.getElementById("settings-modal").classList.remove("hidden");
    document.getElementById("close-settings-btn").onclick = () => document.getElementById("settings-modal").classList.add("hidden");

    const contrastToggle = document.getElementById("high-contrast-toggle");
    contrastToggle.addEventListener("change", (e) => {
        if (e.target.checked) {
            document.body.classList.add("high-contrast");
        } else {
            document.body.classList.remove("high-contrast");
        }
    });

    const hardModeToggle = document.getElementById("hard-mode-toggle");
    hardModeToggle.addEventListener("click", (e) => {
        if (hardModeToggle.checked && guesses.length > 0) {
            e.preventDefault(); 
            showToast("Hard mode can only be enabled at the start of a round");
        }
    });
}

function updateSidebar() {
    document.getElementById("sidebar-streak").innerText = `🔥 ${userStats.currentStreak} Day Streak`;
}

async function loadLeaderboard() {
    try {
        let response = await fetch(`${API_URL}/leaderboard`);
        let data = await response.json();
        
        let list = document.getElementById("score-list");
        if (!list) return; 
        
        list.innerHTML = ""; 
        
        const colors = ["#5865F2", "#EB459E", "#FEE75C", "#57F287", "#ED4245"];
        
        data.slice(0, 8).forEach((entry, index) => {
            let color = colors[index % colors.length];
            let firstLetter = entry.username.charAt(0).toUpperCase();
            
            let div = document.createElement("div");
            div.className = "player-row";
            div.innerHTML = `
                <div class="avatar-small" style="background-color: ${color};">${firstLetter}</div>
                <div class="player-stats">
                    <span class="username">${entry.username}</span>
                </div>`;
            list.appendChild(div);
        });
    } catch (e) { 
        let list = document.getElementById("score-list");
        if (list) list.innerHTML = "<div style='color:#818384; font-size:12px;'>Offline Mode</div>"; 
    }
}

// --- SAVE/LOAD & HARD MODE ---
function saveGameState() {
    try {
        const state = { currentWord, guesses, gameOver };
        localStorage.setItem('wordleState', JSON.stringify(state));
    } catch (e) {}
}

function loadGameState() {
    try {
        const saved = JSON.parse(localStorage.getItem('wordleState'));
        if (saved && saved.currentWord) {
            currentWord = saved.currentWord;
            guesses = saved.guesses;
            gameOver = saved.gameOver;
            initGame(); 
            return;
        }
    } catch (e) {}
    initGame(true); 
}

function checkHardMode(guess) {
    if (!document.getElementById("hard-mode-toggle").checked || guesses.length === 0) return null;
    
    const lastGuess = guesses[guesses.length - 1];
    const lastResult = checkWord(lastGuess, currentWord);
    
    for (let i = 0; i < 5; i++) {
        if (lastResult[i] === 'correct' && guess[i] !== lastGuess[i]) {
            return `${i + 1}th letter must be ${lastGuess[i]}`;
        }
    }
    return null;
}
