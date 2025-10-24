let socket;
let contacts = [];
let currentContact = null;

// WebRTC variables
let localStream = null;
let pc = null;
let isAudioOnly = true;
let currentCallFrom = null;
let callState = 'idle'; 
let isCaller = false;

// SQL.js DB
let db;
const MAX_HISTORY = 50;

async function initDB() {
    const SQL = await initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` });
    db = new SQL.Database();
    db.run(`CREATE TABLE IF NOT EXISTS contacts (uid TEXT PRIMARY KEY, username TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (uid TEXT PRIMARY KEY, history TEXT);`);
}

function loadContactsFromDB() {
    const res = db.exec(`SELECT uid, username FROM contacts`);
    if (res.length && res[0].values.length) {
        res[0].values.forEach(([uid, username]) => {
            if (!contacts.find(c => c.uid === uid)) {
                const contact = { uid, username };
                contacts.push(contact);
                const div = document.createElement("div");
                div.classList.add("contact");
                div.textContent = username;
                div.addEventListener("click", () => openChat(contact));
                document.getElementById("contacts").appendChild(div);
            }
        });
    }
}

function saveContactToDB(uid, username) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO contacts VALUES (?, ?);`);
    stmt.run([uid, username]);
    stmt.free();
}

function addMessageToDB(uid, messageObj) {
    const res = db.exec(`SELECT history FROM messages WHERE uid='${uid}'`);
    let arr = [];
    if(res.length && res[0].values.length) arr = JSON.parse(res[0].values[0][0]);
    if(arr.length >= MAX_HISTORY) arr.shift();
    arr.push(messageObj);
    const exists = db.exec(`SELECT 1 FROM messages WHERE uid='${uid}'`);
    if(exists.length) {
        db.run(`UPDATE messages SET history='${JSON.stringify(arr)}' WHERE uid='${uid}'`);
    } else {
        db.run(`INSERT INTO messages VALUES (?, ?)`, [uid, JSON.stringify(arr)]);
    }
}

function getHistoryFromDB(uid) {
    const res = db.exec(`SELECT history FROM messages WHERE uid='${uid}'`);
    if(res.length && res[0].values.length) return JSON.parse(res[0].values[0][0]);
    return [];
}

window.addEventListener("DOMContentLoaded", async () => {
    await initDB();
    loadContactsFromDB();

    const token = localStorage.getItem("token");
    socket = io("/", { auth: { token } });

    socket.on("connect", () => console.log("Connected:", socket.id));
    socket.on("disconnect", () => console.log("Disconnected"));

    socket.on("message", (msg) => {
        if (currentContact && msg.from === currentContact.uid) {
            addMessage("received", msg.text);
        }
        addMessageToDB(msg.from, { received: msg.text });
        if (!currentContact || msg.from !== currentContact.uid) {
            alert(`New message from ${msg.fromUsername}: ${msg.text}`);
        }
    });

    socket.on("webrtc-signal", async ({ from, signal }) => {
        if (signal.type === 'offer') {
            if (!isCaller) { 
                currentCallFrom = from;
                window.incomingOffer = signal;
                callState = 'ringing';
                updateCallButton();
            }
        } else if (signal.type === 'answer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
            callState = 'in-call';
            updateCallButton();
        } else if (signal.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
    });

    document.getElementById("sendBtn").addEventListener("click", sendMessage);
    document.getElementById("messageInput").addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMessage();
    });
    document.getElementById("searchBtn").addEventListener("click", searchUser);
    document.getElementById("callBtn").addEventListener("click", handleCallBtn);
    document.getElementById("toggleAVBtn").addEventListener("click", toggleAV);
});

// --- Chat / UI functions ---
function addContact(uid, username) {
    if (contacts.find(c => c.uid === uid)) return;
    const contact = { uid, username };
    contacts.push(contact);
    saveContactToDB(uid, username);

    const div = document.createElement("div");
    div.classList.add("contact");
    div.textContent = username;
    div.addEventListener("click", () => openChat(contact));
    document.getElementById("contacts").appendChild(div);
}

function openChat(contact) {
    currentContact = contact;
    document.getElementById("chatTitle").textContent = contact.username;
    showChatView();

    const chatDiv = document.getElementById("chat");
    chatDiv.innerHTML = "";
    const history = getHistoryFromDB(contact.uid);
    history.forEach(msg => {
        const type = msg.sent ? "sent" : "received";
        const text = msg.sent || msg.received;
        addMessage(type, text);
    });
}

function addMessage(type, text) {
    const chat = document.getElementById("chat");
    const div = document.createElement("div");
    div.classList.add("message", type);
    div.textContent = text;
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
}

async function searchUser() {
    const username = document.getElementById("searchInput").value.trim();
    if (!username) return;
    try {
        const res = await fetch(`/getcontact?username=${username}`);
        if (!res.ok) throw new Error("User not found");
        const data = await res.json();
        addContact(data.uid, data.username);
    } catch (err) {
        alert("User not found");
    }
}

function sendMessage() {
    if (!currentContact) return alert("Select a contact first");
    const input = document.getElementById("messageInput");
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit("message", { to: currentContact.uid, text: msg });
    addMessage("sent", msg);
    addMessageToDB(currentContact.uid, { sent: msg });
    input.value = "";
}

// --- Call functions ---
function toggleAV() {
    isAudioOnly = !isAudioOnly;
    document.getElementById('toggleAVBtn').textContent = isAudioOnly ? 'Audio Only' : 'Audio + Video';
}

function updateCallButton() {
    const callBtn = document.getElementById('callBtn');
    const callStatus = document.getElementById('callStatus');
    if (callState === 'idle') {
        callBtn.textContent='Call';
        callBtn.style.backgroundColor='#4cafef';
        callStatus.textContent='Idle';
    } else if (callState==='ringing') {
        callBtn.textContent='Answer';
        callBtn.style.backgroundColor='#4cafef';
        callStatus.textContent='Ringing';
    } else if (callState==='in-call') {
        callBtn.textContent='End Call';
        callBtn.style.backgroundColor='#f44336';
        callStatus.textContent='In Call';
    }
}

async function startCall(targetUid) {
    isCaller = true;
    localStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:!isAudioOnly });
    pc = new RTCPeerConnection({ iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:global.relay.metered.ca:80', username: 'openai', credential: 'openai' }
  ] });
    localStream.getTracks().forEach(track=>pc.addTrack(track, localStream));
    pc.onicecandidate = e => { if(e.candidate) socket.emit('webrtc-signal',{to:targetUid,signal:{candidate:e.candidate}}); }
    pc.ontrack = e => { showRemoteStream(e.streams[0]); }

    const offer = await pc.createOffer(); 
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-signal',{to:targetUid,signal:offer});
    callState = 'in-call'; updateCallButton();
}

async function answerCall(callerUid) {
    if(!window.incomingOffer) return alert("No incoming call");
    localStream = await navigator.mediaDevices.getUserMedia({ audio:true, video:!isAudioOnly });
    pc = new RTCPeerConnection({ iceServers:[{urls:'stun:stun.l.google.com:19302'}] });
    localStream.getTracks().forEach(track=>pc.addTrack(track, localStream));
    pc.onicecandidate = e => { if(e.candidate) socket.emit('webrtc-signal',{to:callerUid,signal:{candidate:e.candidate}}); }
    pc.ontrack = e => { showRemoteStream(e.streams[0]); }

    await pc.setRemoteDescription(new RTCSessionDescription(window.incomingOffer));
    const answer = await pc.createAnswer(); 
    await pc.setLocalDescription(answer);
    socket.emit('webrtc-signal',{to:callerUid,signal:answer});
    callState='in-call'; updateCallButton();
    currentCallFrom=null; window.incomingOffer=null;
}

function endCall() {
    if(pc) pc.close(); pc=null;
    if(localStream) localStream.getTracks().forEach(t=>t.stop()); localStream=null;

    const callContainer = document.getElementById('callContainer');
    callContainer.style.display = 'none';
    document.getElementById('remoteVideo').srcObject = null;

    callState='idle'; isCaller=false; updateCallButton();
}

function handleCallBtn() {
    if(callState==='idle' && currentContact) startCall(currentContact.uid);
    else if(callState==='ringing' && currentCallFrom) answerCall(currentCallFrom);
    else if(callState==='in-call') endCall();
}

function showRemoteStream(stream) {
    const callContainer = document.getElementById('callContainer');
    const remoteVideo = document.getElementById('remoteVideo');
    remoteVideo.srcObject = stream;
    callContainer.style.display = 'flex';
}

function showChatView() {
    if (window.innerWidth <= 768) {
        document.getElementById("sidebar").style.display = "none";
        document.getElementById("chatPane").style.display = "flex";
    }
}

function goBack() {
    if (window.innerWidth <= 768) {
        document.getElementById("sidebar").style.display = "flex";
        document.getElementById("chatPane").style.display = "none";
    }
}
