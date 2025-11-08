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
let myUid = null;
const MAX_HISTORY = 50;

// Order system variables
let globalOrderCounter = 0;
let currentOrderSelection = {}; // Store selected items temporarily

async function initDB() {
    const SQL = await initSqlJs({ locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}` });
    db = new SQL.Database();
    db.run(`CREATE TABLE IF NOT EXISTS contacts (uid TEXT PRIMARY KEY, username TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS messages (uid TEXT PRIMARY KEY, history TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS money (id TEXT PRIMARY KEY, value INTEGER, contact_uid TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, customer_uid TEXT, assets TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS inventory (id TEXT PRIMARY KEY, data TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS order_tracking (order_id INTEGER PRIMARY KEY, customer_uid TEXT, seller_uid TEXT, items TEXT, total_price REAL, status TEXT, message_id TEXT);`);
    db.run(`CREATE TABLE IF NOT EXISTS order_counter (counter INTEGER);`);
    
    // Initialize order counter if not exists
    const counterRes = db.exec(`SELECT counter FROM order_counter`);
    if (!counterRes.length || !counterRes[0].values.length) {
        db.run(`INSERT INTO order_counter VALUES (0);`);
    } else {
        globalOrderCounter = counterRes[0].values[0][0];
    }
}

function generateULID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function loadContactsFromDB() {
    const res = db.exec(`SELECT uid, username FROM contacts`);
    if (res.length && res[0].values.length) {
        res[0].values.forEach(([uid, username]) => {
            if (!contacts.find(c => c.uid === uid)) {
                const contact = { uid, username };
                contacts.push(contact);
                displayContact(contact);
            }
        });
    }
}

function loadDefaultChats() {
    const defaultChats = [
        { uid: "orders", username: "📦 Orders" },
        { uid: "inventory", username: "📊 Inventory" }
    ];
    
    defaultChats.forEach(chat => {
        if (!contacts.find(c => c.uid === chat.uid)) {
            contacts.push(chat);
            displayContact(chat);
        }
    });
}

function displayContact(contact) {
    const div = document.createElement("div");
    div.classList.add("contact");
    div.textContent = contact.username;
    div.addEventListener("click", () => openChat(contact));
    document.getElementById("contacts").appendChild(div);
}

function saveContactToDB(uid, username) {
    const stmt = db.prepare(`INSERT OR IGNORE INTO contacts VALUES (?, ?);`);
    stmt.run([uid, username]);
    stmt.free();
}

function addMessageToDB(uid, messageObj) {
    let stmt = db.prepare(`SELECT history FROM messages WHERE uid=?`);
    stmt.bind([uid]);
    let res = [];
    while (stmt.step()) {
        res.push(stmt.getAsObject());
    }
    stmt.free();
    
    let arr = [];
    if(res.length) arr = JSON.parse(res[0].history);
    if(arr.length >= MAX_HISTORY) arr.shift();
    arr.push(messageObj);
    
    let existsStmt = db.prepare(`SELECT 1 FROM messages WHERE uid=?`);
    existsStmt.bind([uid]);
    let exists = existsStmt.step();
    existsStmt.free();
    
    if(exists) {
        let updateStmt = db.prepare(`UPDATE messages SET history=? WHERE uid=?`);
        updateStmt.bind([JSON.stringify(arr), uid]);
        updateStmt.step();
        updateStmt.free();
    } else {
        let insertStmt = db.prepare(`INSERT INTO messages VALUES (?, ?)`);
        insertStmt.bind([uid, JSON.stringify(arr)]);
        insertStmt.step();
        insertStmt.free();
    }
}

function getHistoryFromDB(uid) {
    let stmt = db.prepare(`SELECT history FROM messages WHERE uid=?`);
    stmt.bind([uid]);
    let history = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        history = JSON.parse(row.history);
    }
    stmt.free();
    return history;
}

function getMoneyWithContact(contactUid) {
    if (!contactUid) return 0;
    let stmt = db.prepare(`SELECT SUM(value) as total FROM money WHERE contact_uid=?`);
    stmt.bind([contactUid]);
    let total = 0;
    while (stmt.step()) {
        const row = stmt.getAsObject();
        total = row.total !== null ? row.total : 0;
    }
    stmt.free();
    return total;
}

function displayMoney() {
    const total = currentContact ? getMoneyWithContact(currentContact.uid) : 0;
    const moneyDisplay = document.getElementById("moneyDisplay");
    
    if(total > 0) {
        moneyDisplay.textContent = `+${total}`;
        moneyDisplay.className = "positive";
    } else if(total < 0) {
        moneyDisplay.textContent = `${total}`;
        moneyDisplay.className = "negative";
    } else {
        moneyDisplay.textContent = `0`;
        moneyDisplay.className = "neutral";
    }
}

function saveTransaction(transactionId, amount, contactUid) {
    const stmt = db.prepare(`INSERT INTO money VALUES (?, ?, ?);`);
    stmt.run([transactionId, amount, contactUid]);
    stmt.free();
}

window.addEventListener("DOMContentLoaded", async () => {
    await initDB();
    loadContactsFromDB();
    loadDefaultChats();
    checkAndResetOrderCounterMonthly();

    const token = localStorage.getItem("token");
    socket = io("/", { auth: { token } });

    socket.on("connect", () => {
        console.log("Connected:", socket.id);
        myUid = localStorage.getItem("uid");
        if (!myUid) {
            console.error("Warning: myUid not found in localStorage");
        }
    });
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

    socket.on("money", (data) => {
        alert(`Money transaction from ${data.fromUsername}: Amount ${data.amount}, Description: ${data.description}`);
    });

    socket.on("transaction-request", (data) => {
        showTransactionRequest(data);
    });

    socket.on("transaction-confirmed", (data) => {
        const { transactionId, amount, type, senderUid } = data;
        saveTransaction(transactionId, amount, senderUid);
        displayMoney();
        removePendingCard(transactionId);
        showSavedCard(type, amount, "Confirmed");
    });

    socket.on("transaction-cancelled", (data) => {
        const { transactionId, type, amount, status } = data;
        let resolvedType = type || null;
        let resolvedAmount = typeof amount === "number" ? amount : null;

        const handleCard = (card) => {
            if (!card) return;
            if (!resolvedType && card.dataset.type) {
                resolvedType = card.dataset.type;
            }
            if (resolvedAmount === null && card.dataset.amount !== undefined) {
                const parsedAmount = Number(card.dataset.amount);
                if (!Number.isNaN(parsedAmount)) {
                    resolvedAmount = parsedAmount;
                }
            }
            card.remove();
        };

        const pendingCard = document.getElementById(`transaction-${transactionId}`);
        handleCard(pendingCard);
        const requestCard = document.getElementById(`request-${transactionId}`);
        handleCard(requestCard);

        if (resolvedType && resolvedAmount !== null && !Number.isNaN(Number(resolvedAmount))) {
            showSavedCard(resolvedType, Number(resolvedAmount), status || "Cancelled");
        }
    });

    socket.on("orders", (data) => {
        handleIncomingOrder(data);
    });

    socket.on("order-completed", (data) => {
        updateOrderCardStatus(data);
    });

    socket.on("fetch-inventory", (data) => {
        handleFetchInventoryRequest(data);
    });

    socket.on("inventory-data", (data) => {
        buildOrderInventoryUI(data.inventory);
    });

    document.getElementById("sendBtn").addEventListener("click", sendMessage);
    document.getElementById("messageInput").addEventListener("keypress", (e) => {
        if (e.key === "Enter") sendMessage();
    });
    document.getElementById("searchBtn").addEventListener("click", searchUser);
    document.getElementById("callBtn").addEventListener("click", handleCallBtn);
    document.getElementById("toggleAVBtn").addEventListener("click", toggleAV);
    document.getElementById("orderBtn").addEventListener("click", openOrderModal);
});

// --- Chat / UI functions ---
function addContact(uid, username) {
    if (contacts.find(c => c.uid === uid)) return;
    const contact = { uid, username };
    contacts.push(contact);
    saveContactToDB(uid, username);
    displayContact(contact);
}

function openChat(contact) {
    currentContact = contact;
    document.getElementById("chatTitle").textContent = contact.username;
    document.getElementById("moneyBar").style.display = "block"; // Show money bar by default
    document.getElementById("inputArea").style.display = "flex"; // Show input area by default
    document.getElementById("orderBtn").style.display = "none"; // Hide order button by default
    showChatView();
    
    // Check if this is a special table view
    if (contact.uid === "orders") {
        displayOrdersTable();
        return;
    } else if (contact.uid === "inventory") {
        displayInventoryTable();
        return;
    }
    
    // Show order button for regular chats
    document.getElementById("orderBtn").style.display = "block";
    
    displayMoney();

    const chatDiv = document.getElementById("chat");
    chatDiv.innerHTML = "";
    const history = getHistoryFromDB(contact.uid);
    history.forEach(msg => {
        const type = msg.sent ? "sent" : "received";
        const text = msg.sent || msg.received;
        addMessage(type, text);
    });
    
    // Display order cards for this contact
    displayOrderCardsForContact(contact.uid);
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

    // Check for transaction commands
    const transactionMatch = msg.match(/^@(owe|pay|claim)\s+(\d+)$/i);
    if (transactionMatch) {
        const type = transactionMatch[1].toLowerCase();
        const amount = parseInt(transactionMatch[2]);
        sendTransaction(type, amount);
        input.value = "";
        return;
    }

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

// --- Transaction functions ---
function sendTransaction(type, amount) {
    if (!currentContact) return;
    
    const transactionId = generateULID();
    
    // Determine the value for each type
    let senderValue = 0;
    let typeText = type.charAt(0).toUpperCase() + type.slice(1);
    
    if (type === 'owe') {
        senderValue = amount; // I owe you
        typeText = `Owe ${amount}`;
    } else if (type === 'pay') {
        senderValue = -amount; // I pay you
        typeText = `Pay ${amount}`;
    } else if (type === 'claim') {
        senderValue = amount; // I claim from you
        typeText = `Claim ${amount}`;
    }
    
    // Show pending card on sender side
    showPendingCard(transactionId, type, amount);
    
    // Send transaction request to receiver
    socket.emit("transaction-request", {
        transactionId,
        type,
        amount,
        receiverUid: currentContact.uid,
        senderValue
    });
}

function showPendingCard(transactionId, type, amount) {
    const chat = document.getElementById("chat");
    const card = document.createElement("div");
    card.className = "transaction-card pending";
    card.id = `transaction-${transactionId}`;
    card.dataset.type = type;
    card.dataset.amount = amount;

    const typeText = type.charAt(0).toUpperCase() + type.slice(1);
    card.innerHTML = `
        <div class="transaction-content">
            <div class="transaction-info">
                <strong>${typeText}</strong> - ${amount}
                <span class="waiting-text">Waiting for acknowledgment...</span>
            </div>
            <button class="btn-cancel" onclick="cancelTransaction('${transactionId}')">Cancel</button>
        </div>
    `;
    chat.appendChild(card);
    chat.scrollTop = chat.scrollHeight;
}

function removePendingCard(transactionId) {
    const card = document.getElementById(`transaction-${transactionId}`);
    if (card) card.remove();
}

function showTransactionRequest(data) {
    const { transactionId, type, amount, senderUid, senderUsername } = data;

    const chat = document.getElementById("chat");
    const card = document.createElement("div");
    card.className = "transaction-card request";
    card.id = `request-${transactionId}`;
    card.dataset.type = type;
    card.dataset.amount = amount;

    let requestText = "";
    if (type === 'owe') {
        requestText = `${senderUsername} owes you`;
    } else if (type === 'pay') {
        requestText = `${senderUsername} pays you`;
    } else if (type === 'claim') {
        requestText = `${senderUsername} claims from you`;
    }

    card.innerHTML = `
        <div class="transaction-content">
            <div class="transaction-info">
                <strong>${requestText}</strong>
                <span class="amount-text">${amount}</span>
            </div>
            <div style="display: flex; gap: 6px;">
                <button class="btn-ack" onclick="confirmTransaction('${transactionId}', '${type}', ${amount}, '${senderUid}')">Acknowledge</button>
                <button class="btn-cancel" onclick="declineTransaction('${transactionId}')">Decline</button>
            </div>
        </div>
    `;
    chat.appendChild(card);
    chat.scrollTop = chat.scrollHeight;
}

function confirmTransaction(transactionId, type, amount, senderUid) {
    const card = document.getElementById(`request-${transactionId}`);
    if (!card) return;
    
    let myValue = 0;
    
    // Determine the value for receiver based on sender's transaction type
    if (type === 'owe') {
        myValue = -amount; // Sender owes me, so I owe them back (negative)
    } else if (type === 'pay') {
        myValue = amount; // Sender pays me
    } else if (type === 'claim') {
        myValue = -amount; // Sender claims from me
    }
    
    // Save to my database
    saveTransaction(transactionId, myValue, senderUid);
    displayMoney();
    
    // Convert to saved card (remove old card, show saved version)
    card.remove();
    showSavedCard(type, amount, "Acknowledged");
    
    // Notify sender
    socket.emit("transaction-confirmed", {
        transactionId,
        type,
        amount,
        to: senderUid
    });
}

function declineTransaction(transactionId) {
    const card = document.getElementById(`request-${transactionId}`);
    if (!card) return;
    const { type, amount } = card.dataset;
    const amountValue = Number(amount);
    card.remove();
    const targetUid = currentContact ? currentContact.uid : null;
    if (targetUid) {
        socket.emit("transaction-cancelled", {
            transactionId,
            to: targetUid,
            type,
            amount: Number.isNaN(amountValue) ? undefined : amountValue,
            status: "Declined"
        });
    }
    if (type && !Number.isNaN(amountValue)) {
        showSavedCard(type, amountValue, "Declined");
    }
}

function cancelTransaction(transactionId) {
    const card = document.getElementById(`transaction-${transactionId}`);
    if (!card) return;
    const { type, amount } = card.dataset;
    const amountValue = Number(amount);
    const targetUid = currentContact ? currentContact.uid : null;
    card.remove();
    socket.emit("transaction-cancelled", { 
        transactionId,
        to: targetUid,
        type,
        amount: Number.isNaN(amountValue) ? undefined : amountValue,
        status: "Cancelled"
    });
    if (type && !Number.isNaN(amountValue)) {
        showSavedCard(type, amountValue, "Cancelled");
    }
}

function showSavedCard(type, amount, status = "Completed") {
    const chat = document.getElementById("chat");
    const card = document.createElement("div");
    const transactionId = generateULID();
    card.className = "transaction-card saved";
    card.id = `saved-${transactionId}`;

    const typeText = type.charAt(0).toUpperCase() + type.slice(1);
    card.innerHTML = `
        <div class="transaction-content">
            <div class="transaction-info">
                <strong>${typeText}</strong> - ${amount}
                <span class="saved-text">${status}</span>
            </div>
        </div>
    `;
    chat.appendChild(card);
    chat.scrollTop = chat.scrollHeight;
}

// --- Table Views for Orders and Inventory ---
function displayOrdersTable() {
    const chatDiv = document.getElementById("chat");
    chatDiv.innerHTML = "";
    
    // Hide money bar and input area for table views
    document.getElementById("moneyBar").style.display = "none";
    document.getElementById("inputArea").style.display = "none";
    
    // Create table container
    const tableContainer = document.createElement("div");
    tableContainer.className = "table-container";
    
    // Fetch orders from DB
    const res = db.exec(`SELECT id, customer_uid, assets FROM orders`);
    const orders = res.length && res[0].values ? res[0].values : [];
    
    // Create add button
    const addBtn = document.createElement("button");
    addBtn.className = "btn-add-row";
    addBtn.textContent = "+ Add Order";
    addBtn.addEventListener("click", addOrderRow);
    tableContainer.appendChild(addBtn);
    
    // Create table
    const table = document.createElement("table");
    table.className = "data-table";
    table.innerHTML = `
        <thead>
            <tr>
                <th>Order ID</th>
                <th>Customer ULID</th>
                <th>Assets</th>
                <th>Action</th>
            </tr>
        </thead>
        <tbody id="ordersBody"></tbody>
    `;
    tableContainer.appendChild(table);
    
    // Populate table
    const tbody = table.querySelector("tbody");
    orders.forEach(([id, customer_uid, assets]) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${id}</td>
            <td>${customer_uid}</td>
            <td>${assets}</td>
            <td><button class="btn-delete" onclick="deleteOrder('${id}')">Delete</button></td>
        `;
        tbody.appendChild(row);
    });
    
    chatDiv.appendChild(tableContainer);
    chatDiv.scrollTop = 0;
}

function addOrderRow() {
    const customerId = prompt("Enter Customer ULID:");
    if (!customerId) return;
    const assetsStr = prompt("Enter Asset IDs (comma-separated):");
    if (assetsStr === null) return;
    
    const orderId = generateULID();
    const stmt = db.prepare(`INSERT INTO orders VALUES (?, ?, ?);`);
    stmt.run([orderId, customerId, assetsStr]);
    stmt.free();
    
    displayOrdersTable();
}

function deleteOrder(orderId) {
    if (confirm("Delete this order?")) {
        const stmt = db.prepare(`DELETE FROM orders WHERE id=?`);
        stmt.bind([orderId]);
        stmt.step();
        stmt.free();
        displayOrdersTable();
    }
}

// Temporary storage for building inventory
let inventoryBuilder = {};

function displayInventoryTable() {
    const chatDiv = document.getElementById("chat");
    chatDiv.innerHTML = "";
    
    // Hide money bar and input area for table views
    document.getElementById("moneyBar").style.display = "none";
    document.getElementById("inputArea").style.display = "none";
    
    // Reset builder
    inventoryBuilder = {};
    
    // Create main container
    const container = document.createElement("div");
    container.className = "inventory-builder";
    
    // Title
    const title = document.createElement("h3");
    title.textContent = "📊 Build Inventory";
    container.appendChild(title);
    
    // Add Section Form
    const sectionForm = document.createElement("div");
    sectionForm.className = "section-form";
    sectionForm.innerHTML = `
        <div class="form-group">
            <label>Section Name:</label>
            <input type="text" id="sectionInput" placeholder="e.g., Electronics, Clothing">
            <button class="btn-add" onclick="addSection()">+ Add Section</button>
        </div>
    `;
    container.appendChild(sectionForm);
    
    // Sections display area
    const sectionsContainer = document.createElement("div");
    sectionsContainer.id = "sectionsContainer";
    sectionsContainer.className = "sections-container";
    container.appendChild(sectionsContainer);
    
    // JSON Preview
    const previewDiv = document.createElement("div");
    previewDiv.className = "json-preview";
    const previewTitle = document.createElement("strong");
    previewTitle.textContent = "JSON Preview:";
    previewDiv.appendChild(previewTitle);
    const previewCode = document.createElement("pre");
    previewCode.id = "jsonPreview";
    previewCode.textContent = JSON.stringify(inventoryBuilder, null, 2);
    previewDiv.appendChild(previewCode);
    container.appendChild(previewDiv);
    
    // Save and Cancel buttons
    const buttonGroup = document.createElement("div");
    buttonGroup.className = "button-group";
    
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn-save";
    saveBtn.textContent = "💾 Save Inventory";
    saveBtn.onclick = saveInventoryData;
    buttonGroup.appendChild(saveBtn);
    
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn-cancel-form";
    cancelBtn.textContent = "❌ Cancel";
    cancelBtn.onclick = () => displayInventoryTable();
    buttonGroup.appendChild(cancelBtn);
    
    container.appendChild(buttonGroup);
    
    // View saved inventories
    const savedDiv = document.createElement("div");
    savedDiv.className = "saved-inventories";
    const savedTitle = document.createElement("h4");
    savedTitle.textContent = "Saved Inventories:";
    savedDiv.appendChild(savedTitle);
    
    const res = db.exec(`SELECT id, data FROM inventory`);
    const items = res.length && res[0].values ? res[0].values : [];
    
    if (items.length === 0) {
        const emptyMsg = document.createElement("p");
        emptyMsg.className = "empty-msg";
        emptyMsg.textContent = "No saved inventories yet";
        savedDiv.appendChild(emptyMsg);
    } else {
        items.forEach(([id, data]) => {
            const itemDiv = document.createElement("div");
            itemDiv.className = "saved-item";
            const displayData = data.length > 80 ? data.substring(0, 80) + "..." : data;
            itemDiv.innerHTML = `
                <div class="item-content">
                    <code>${displayData}</code>
                </div>
                <button class="btn-delete" onclick="deleteInventoryItem('${id}')">Delete</button>
            `;
            savedDiv.appendChild(itemDiv);
        });
    }
    
    container.appendChild(savedDiv);
    chatDiv.appendChild(container);
    chatDiv.scrollTop = 0;
}

function addSection() {
    const sectionInput = document.getElementById("sectionInput");
    const sectionName = sectionInput.value.trim();
    
    if (!sectionName) {
        alert("Please enter a section name");
        return;
    }
    
    if (inventoryBuilder[sectionName]) {
        alert("Section already exists!");
        return;
    }
    
    inventoryBuilder[sectionName] = {};
    sectionInput.value = "";
    updateInventoryDisplay();
}

function addItem(sectionName) {
    const itemName = prompt("Enter item name:");
    if (!itemName) return;
    
    const priceStr = prompt("Enter price:");
    if (!priceStr) return;
    
    const price = parseFloat(priceStr);
    if (isNaN(price)) {
        alert("Invalid price!");
        return;
    }
    
    if (inventoryBuilder[sectionName][itemName]) {
        alert("Item already exists in this section!");
        return;
    }
    
    inventoryBuilder[sectionName][itemName] = price;
    updateInventoryDisplay();
}

function removeItem(sectionName, itemName) {
    delete inventoryBuilder[sectionName][itemName];
    updateInventoryDisplay();
}

function removeSection(sectionName) {
    delete inventoryBuilder[sectionName];
    updateInventoryDisplay();
}

function updateInventoryDisplay() {
    const sectionsContainer = document.getElementById("sectionsContainer");
    sectionsContainer.innerHTML = "";
    
    Object.keys(inventoryBuilder).forEach(sectionName => {
        const sectionDiv = document.createElement("div");
        sectionDiv.className = "section-item";
        
        const sectionHeader = document.createElement("div");
        sectionHeader.className = "section-header";
        sectionHeader.innerHTML = `
            <strong>📁 ${sectionName}</strong>
            <button class="btn-remove-section" onclick="removeSection('${sectionName}')">Remove Section</button>
        `;
        sectionDiv.appendChild(sectionHeader);
        
        const itemsDiv = document.createElement("div");
        itemsDiv.className = "items-list";
        
        Object.keys(inventoryBuilder[sectionName]).forEach(itemName => {
            const price = inventoryBuilder[sectionName][itemName];
            const itemDiv = document.createElement("div");
            itemDiv.className = "item-row";
            itemDiv.innerHTML = `
                <span>📦 ${itemName}: $${price}</span>
                <button class="btn-remove-item" onclick="removeItem('${sectionName}', '${itemName}')">Cancel</button>
            `;
            itemsDiv.appendChild(itemDiv);
        });
        
        const addItemBtn = document.createElement("button");
        addItemBtn.className = "btn-add-item";
        addItemBtn.textContent = "+ Add Item";
        addItemBtn.onclick = () => addItem(sectionName);
        itemsDiv.appendChild(addItemBtn);
        
        sectionDiv.appendChild(itemsDiv);
        sectionsContainer.appendChild(sectionDiv);
    });
    
    // Update preview
    const previewCode = document.getElementById("jsonPreview");
    if (previewCode) {
        previewCode.textContent = JSON.stringify(inventoryBuilder, null, 2);
    }
}

function saveInventoryData() {
    if (Object.keys(inventoryBuilder).length === 0) {
        alert("Please add at least one section!");
        return;
    }
    
    const inventoryId = generateULID();
    const jsonData = JSON.stringify(inventoryBuilder);
    
    const stmt = db.prepare(`INSERT INTO inventory VALUES (?, ?);`);
    stmt.run([inventoryId, jsonData]);
    stmt.free();
    
    alert("Inventory saved successfully!");
    displayInventoryTable();
}

function deleteInventoryItem(itemId) {
    if (confirm("Delete this inventory?")) {
        const stmt = db.prepare(`DELETE FROM inventory WHERE id=?`);
        stmt.bind([itemId]);
        stmt.step();
        stmt.free();
        displayInventoryTable();
    }
}

// ============= ORDER SYSTEM FUNCTIONS =============

function openOrderModal() {
    if (!currentContact) return;
    
    // Fetch seller's inventory using business socket
    socket.emit("fetch-inventory", { sellerUid: currentContact.uid });
}

function buildOrderInventoryUI(inventoryData) {
    const container = document.getElementById("orderInventoryContainer");
    container.innerHTML = "";
    currentOrderSelection = {};
    
    if (!inventoryData || Object.keys(inventoryData).length === 0) {
        container.innerHTML = "<p>No inventory available</p>";
        document.getElementById("orderModal").style.display = "flex";
        return;
    }
    
    Object.keys(inventoryData).forEach(section => {
        const sectionDiv = document.createElement("div");
        sectionDiv.className = "order-section";
        
        const sectionHeader = document.createElement("div");
        sectionHeader.className = "order-section-header";
        sectionHeader.innerHTML = `
            <strong>📁 ${section}</strong>
            <span>▼</span>
        `;
        sectionHeader.style.cursor = "pointer";
        
        const itemsDiv = document.createElement("div");
        itemsDiv.className = "order-items";
        itemsDiv.style.display = "none";
        
        Object.keys(inventoryData[section]).forEach(item => {
            const price = inventoryData[section][item];
            const itemRow = document.createElement("div");
            itemRow.className = "order-item-row";
            itemRow.innerHTML = `
                <label>
                    <input type="checkbox" data-section="${section}" data-item="${item}" data-price="${price}" onchange="updateOrderTotal()">
                    <span>${item}: $${price}</span>
                </label>
            `;
            itemsDiv.appendChild(itemRow);
        });
        
        sectionHeader.addEventListener("click", () => {
            const isOpen = itemsDiv.style.display !== "none";
            itemsDiv.style.display = isOpen ? "none" : "block";
            sectionHeader.querySelector("span").style.transform = isOpen ? "rotate(0deg)" : "rotate(180deg)";
        });
        
        sectionDiv.appendChild(sectionHeader);
        sectionDiv.appendChild(itemsDiv);
        container.appendChild(sectionDiv);
    });
    
    document.getElementById("orderModal").style.display = "flex";
}

function updateOrderTotal() {
    let total = 0;
    currentOrderSelection = {};
    
    document.querySelectorAll("#orderInventoryContainer input[type='checkbox']:checked").forEach(checkbox => {
        const section = checkbox.getAttribute("data-section");
        const item = checkbox.getAttribute("data-item");
        const price = parseFloat(checkbox.getAttribute("data-price"));
        
        if (!currentOrderSelection[section]) {
            currentOrderSelection[section] = {};
        }
        currentOrderSelection[section][item] = price;
        total += price;
    });
    
    document.getElementById("orderTotal").textContent = total.toFixed(2);
}

function closeOrderModal() {
    document.getElementById("orderModal").style.display = "none";
}

function submitOrder() {
    if (Object.keys(currentOrderSelection).length === 0) {
        alert("Please select at least one item");
        return;
    }
    
    // Generate order ID
    globalOrderCounter++;
    const updateStmt = db.prepare(`UPDATE order_counter SET counter = ?`);
    updateStmt.bind([globalOrderCounter]);
    updateStmt.step();
    updateStmt.free();
    
    const orderId = globalOrderCounter;
    const total = parseFloat(document.getElementById("orderTotal").textContent);
    const itemsJson = JSON.stringify(currentOrderSelection);
    
    // Save order to database
    const stmt = db.prepare(`INSERT INTO order_tracking VALUES (?, ?, ?, ?, ?, ?, ?)`);
    stmt.run([orderId, myUid, currentContact.uid, itemsJson, total, "pending", generateULID()]);
    stmt.free();
    
    // Display order card in chat for user A
    displayOrderCardInChat(orderId, currentOrderSelection, total, "pending");
    
    // Send order to user B via socket
    socket.emit("orders", {
        to: currentContact.uid,
        orderId,
        customerUid: myUid,
        customerUsername: localStorage.getItem("username"),
        items: currentOrderSelection,
        totalPrice: total
    });
    
    closeOrderModal();
    alert(`Order #${orderId} placed successfully!`);
}

function displayOrderCardInChat(orderId, items, total, status) {
    const chat = document.getElementById("chat");
    const card = document.createElement("div");
    card.className = `order-card order-${orderId}`;
    card.id = `order-card-${orderId}`;
    
    let itemsHtml = "";
    Object.keys(items).forEach(section => {
        itemsHtml += `<div><strong>${section}:</strong> ${Object.keys(items[section]).join(", ")}</div>`;
    });
    
    card.innerHTML = `
        <div class="order-card-header">
            <strong>📦 Order #${orderId}</strong>
            <span class="order-status">${status.toUpperCase()}</span>
        </div>
        <div class="order-card-body">
            ${itemsHtml}
            <div class="order-card-total"><strong>Total: $${total.toFixed(2)}</strong></div>
        </div>
    `;
    
    chat.appendChild(card);
    chat.scrollTop = chat.scrollHeight;
}

function displayOrderCardsForContact(contactUid) {
    // Display sent orders (where current user is customer)
    let stmt = db.prepare(`SELECT order_id, items, total_price, status FROM order_tracking WHERE customer_uid=? AND seller_uid=?`);
    stmt.bind([myUid, contactUid]);
    let rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    
    const res = rows.length > 0 ? rows : [];
    
    if (res.length) {
        res.forEach((row) => {
            const { order_id: orderId, items: itemsJson, total_price: total, status } = row;
            const items = JSON.parse(itemsJson);
            displayOrderCardInChat(orderId, items, total, status);
        });
    }
}

function handleIncomingOrder(data) {
    const { orderId, customerUid, customerUsername, items, totalPrice } = data;
    
    // Save order to database for seller
    const itemsJson = JSON.stringify(items);
    const stmt = db.prepare(`INSERT INTO order_tracking VALUES (?, ?, ?, ?, ?, ?, ?)`);
    stmt.run([orderId, customerUid, myUid, itemsJson, totalPrice, "pending", generateULID()]);
    stmt.free();
    
    alert(`New order #${orderId} from ${customerUsername}`);
    
    // If user is currently viewing orders table, refresh it
    if (currentContact && currentContact.uid === "orders") {
        displayOrdersTable();
    }
}

function updateOrderCardStatus(data) {
    const { orderId, status } = data;
    
    // Update database
    let stmt = db.prepare(`UPDATE order_tracking SET status=? WHERE order_id=?`);
    stmt.bind([status, orderId]);
    stmt.step();
    stmt.free();
    
    // Update card in chat
    const card = document.getElementById(`order-card-${orderId}`);
    if (card) {
        const statusSpan = card.querySelector(".order-status");
        if (statusSpan) {
            statusSpan.textContent = status.toUpperCase();
        }
        card.classList.remove("order-pending");
        card.classList.add(`order-${status}`);
    }
}

function completeOrder(orderId) {
    if (!confirm(`Mark order #${orderId} as completed?`)) return;
    
    // Find the customer
    let stmt = db.prepare(`SELECT customer_uid FROM order_tracking WHERE order_id=?`);
    stmt.bind([orderId]);
    let customerUid = null;
    while (stmt.step()) {
        const row = stmt.getAsObject();
        customerUid = row.customer_uid;
    }
    stmt.free();
    
    if (!customerUid) return;
    
    // Update status in database
    let updateStmt = db.prepare(`UPDATE order_tracking SET status=? WHERE order_id=?`);
    updateStmt.bind(["completed", orderId]);
    updateStmt.step();
    updateStmt.free();
    
    // Notify customer
    socket.emit("order-completed", {
        to: customerUid,
        orderId,
        status: "completed"
    });
    
    // Refresh orders table
    displayOrdersTable();
}

function checkAndResetOrderCounterMonthly() {
    const today = new Date();
    const dayOfMonth = today.getDate();
    const lastResetKey = "lastOrderCounterReset";
    const lastReset = localStorage.getItem(lastResetKey);
    
    // Reset on the 1st of each month
    if (dayOfMonth === 1 && lastReset !== "1") {
        globalOrderCounter = 0;
        let stmt = db.prepare(`UPDATE order_counter SET counter = 0`);
        stmt.step();
        stmt.free();
        localStorage.setItem(lastResetKey, "1");
        console.log("Order counter reset for new month");
    } else if (dayOfMonth !== 1) {
        localStorage.setItem(lastResetKey, "0");
    }
}

function displayOrdersTable() {
    const chatDiv = document.getElementById("chat");
    chatDiv.innerHTML = "";
    
    // Hide money bar and input area for table views
    document.getElementById("moneyBar").style.display = "none";
    document.getElementById("inputArea").style.display = "none";
    
    // Create main container
    const container = document.createElement("div");
    container.className = "orders-table-container";
    
    // Title WITHOUT reset button
    const titleDiv = document.createElement("div");
    titleDiv.className = "orders-header";
    titleDiv.innerHTML = `
        <h3>📦 Incoming Orders (Counter: ${globalOrderCounter})</h3>
    `;
    container.appendChild(titleDiv);
    
    // Get all orders where current user is seller
    let stmt = db.prepare(`SELECT order_id, customer_uid, items, total_price, status FROM order_tracking WHERE seller_uid=? ORDER BY order_id DESC`);
    stmt.bind([myUid]);
    let rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    const res = rows;
    
    if (!res.length) {
        const emptyMsg = document.createElement("p");
        emptyMsg.className = "empty-msg";
        emptyMsg.textContent = "No orders yet";
        container.appendChild(emptyMsg);
    } else {
        const ordersDiv = document.createElement("div");
        ordersDiv.className = "orders-list";
        
        res.forEach((row) => {
            const { order_id: orderId, customer_uid: customerUid, items: itemsJson, total_price: total, status } = row;
            const items = JSON.parse(itemsJson);
            const customerName = contacts.find(c => c.uid === customerUid)?.username || customerUid;
            
            const orderCard = document.createElement("div");
            orderCard.className = `order-card-seller order-${status}`;
            orderCard.id = `seller-order-${orderId}`;
            
            let itemsHtml = "";
            Object.keys(items).forEach(section => {
                itemsHtml += `<div><strong>${section}:</strong> ${Object.keys(items[section]).map(item => `${item} ($${items[section][item]})`).join(", ")}</div>`;
            });
            
            orderCard.innerHTML = `
                <div class="order-card-seller-header">
                    <div>
                        <strong>Order #${orderId}</strong>
                        <span class="order-seller-status">${status.toUpperCase()}</span>
                    </div>
                    <div class="customer-name">From: <strong>${customerName}</strong></div>
                </div>
                <div class="order-card-seller-body">
                    ${itemsHtml}
                    <div class="order-seller-total"><strong>Total: $${total.toFixed(2)}</strong></div>
                </div>
                ${status === "pending" ? `<button class="btn-complete-order" onclick="completeOrder(${orderId})">✓ Completed</button>` : ""}
            `;
            
            ordersDiv.appendChild(orderCard);
        });
        
        container.appendChild(ordersDiv);
    }
    
    chatDiv.appendChild(container);
    chatDiv.scrollTop = 0;
}

function handleFetchInventoryRequest(data) {
    // Seller receives this request and sends back their inventory
    const { from } = data;
    
    // Get latest saved inventory
    const res = db.exec(`SELECT data FROM inventory ORDER BY id DESC LIMIT 1`);
    let inventory = {};
    
    if (res.length && res[0].values.length) {
        inventory = JSON.parse(res[0].values[0][0]);
    }
    
    // Send inventory back to customer
    socket.emit("inventory-data", {
        to: from,
        inventory
    });
}