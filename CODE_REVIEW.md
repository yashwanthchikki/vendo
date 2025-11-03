# 🔍 Complete Code Review - Order System & Backend

## Critical Issues Found

### 🔴 **1. SQL INJECTION VULNERABILITIES** (HIGH SEVERITY)
The code uses string interpolation in SQL queries instead of parameterized queries. This is a major security risk.

**Vulnerable locations in `main.js`:**
- Line 92: `SELECT history FROM messages WHERE uid='${uid}'`
- Line 99: `UPDATE messages SET history='${JSON.stringify(arr)}' WHERE uid='${uid}'`
- Line 106: `SELECT history FROM messages WHERE uid='${uid}'`
- Line 113: `SELECT SUM(value) FROM money WHERE contact_uid='${contactUid}'`
- Line 641: `DELETE FROM orders WHERE id='${orderId}'`
- Line 869: `DELETE FROM inventory WHERE id='${itemId}'`
- Line 1024: `SELECT order_id, items, total_price, status FROM order_tracking WHERE customer_uid='${myUid}' AND seller_uid='${contactUid}'`
- Line 1055: `UPDATE order_tracking SET status='${status}' WHERE order_id=${orderId}`
- Line 1079: `UPDATE order_tracking SET status='completed' WHERE order_id=${orderId}`
- Line 1123: `SELECT order_id, customer_uid, items, total_price, status FROM order_tracking WHERE seller_uid='${myUid}' ORDER BY order_id DESC`

**Example of safe code:**
```javascript
// ❌ UNSAFE
db.run(`DELETE FROM orders WHERE id='${orderId}'`);

// ✅ SAFE
const stmt = db.prepare(`DELETE FROM orders WHERE id=?`);
stmt.run([orderId]);
stmt.free();
```

**Impact**: Attackers could manipulate SQL queries through user input, read/modify/delete arbitrary data.

---

### 🔴 **2. HARDCODED SECRET KEY** (HIGH SEVERITY)
In `Middleware/authentication.js` and `Middleware/socketauth.js`, the JWT secret is hardcoded:
```javascript
const SECRET_KEY = "itachi";
```

**Should be:**
```javascript
const SECRET_KEY = process.env.JWT_SECRET || "fallback-secret";
```

This should be stored in `.env` file and never committed to version control.

---

### 🟠 **3. VERSION MISMATCH** (MEDIUM SEVERITY)
In `package.json`:
```json
"socket.io": "^4.8.1"
```

In `public/main.html` (line 73):
```html
<script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
```

**These don't match!** The backend is 4.8.1 but frontend loads 4.7.2. 

**Fix:**
```html
<script src="https://cdn.socket.io/4.8.1/socket.io.min.js"></script>
```

---

### 🟠 **4. MEMORY LEAK IN userSockets MAP** (MEDIUM SEVERITY)
In `chat/controller.js` (lines 2-14), the `userSockets` map accumulates connections and sockets may not be properly cleaned on disconnect.

**Current code (lines 168-171):**
```javascript
socket.on('disconnect', () => {
    const sockets = userSockets.get(socket.user.uid) || [];
    userSockets.set(socket.user.uid, sockets.filter(s => s !== socket));
});
```

**Issue**: If user has no remaining sockets, the empty array still stays in the map. 

**Better fix:**
```javascript
socket.on('disconnect', () => {
    const sockets = userSockets.get(socket.user.uid) || [];
    const remaining = sockets.filter(s => s !== socket);
    if (remaining.length === 0) {
        userSockets.delete(socket.user.uid);  // Remove empty entries
    } else {
        userSockets.set(socket.user.uid, remaining);
    }
});
```

---

### 🟠 **5. MISSING ERROR HANDLING** (MEDIUM SEVERITY)
Socket event handlers in `chat/controller.js` don't have error handling:

```javascript
socket.on('orders', (data) => {
    const { to, orderId, customerUid, customerUsername, items, totalPrice } = data;
    // ❌ NO VALIDATION! What if `to` is missing?
    const recipientSockets = userSockets.get(to) || [];
    // ...
});
```

**Better approach:**
```javascript
socket.on('orders', (data) => {
    try {
        const { to, orderId, customerUid, customerUsername, items, totalPrice } = data;
        
        if (!to || !orderId) {
            console.error("Invalid order data:", data);
            return socket.emit('error', { message: 'Invalid order data' });
        }
        
        const recipientSockets = userSockets.get(to) || [];
        if (recipientSockets.length === 0) {
            return socket.emit('error', { message: 'Recipient not connected' });
        }
        
        recipientSockets.forEach(s => {
            s.emit('orders', { orderId, customerUid, customerUsername, items, totalPrice });
        });
    } catch (err) {
        console.error("Error handling order:", err);
        socket.emit('error', { message: 'Failed to process order' });
    }
});
```

---

### 🟡 **6. POTENTIAL XSS VULNERABILITIES** (LOW-MEDIUM SEVERITY)
In `main.js`, HTML is inserted without escaping user input:

Line 1004:
```javascript
itemsHtml += `<div><strong>${section}:</strong> ${Object.keys(items[section]).join(", ")}</div>`;
```

If a user creates an inventory section with a name like `<script>alert('XSS')</script>`, it would execute.

**Fix**: Use `textContent` instead of `innerHTML` where possible, or escape HTML:
```javascript
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

itemsHtml += `<div><strong>${escapeHtml(section)}:</strong> ${Object.keys(items[section]).map(escapeHtml).join(", ")}</div>`;
```

---

### 🟡 **7. ORDER ID REUSE RISK** (MEDIUM SEVERITY)
In `main.js`, the `resetOrderCounter()` function (lines 1092-1099) allows resetting the counter:

```javascript
function resetOrderCounter() {
    if (!confirm("Reset order counter to 0? This will restart numbering from 1.")) return;
    globalOrderCounter = 0;
    db.run(`UPDATE order_counter SET counter = 0`);
    alert("Order counter reset to 0");
    displayOrdersTable();
}
```

**Problem**: After reset, new order IDs will conflict with old ones (order #5 could exist twice).

**Solution**: Either:
1. Don't allow reset, OR
2. Reset AND delete all old orders, OR
3. Use ULIDs instead of numeric IDs

---

### 🟡 **8. NO INVENTORY VALIDATION** (LOW-MEDIUM SEVERITY)
When a customer places an order, the inventory is fetched once but never validated again. In `submitOrder()` (line 960):

```javascript
function submitOrder() {
    if (Object.keys(currentOrderSelection).length === 0) {
        alert("Please select at least one item");
        return;
    }
    // ❌ No check if inventory still exists or prices haven't changed!
    socket.emit("orders", { ... });
}
```

**Issue**: 
- Seller could delete inventory before order arrives
- Seller could change prices after customer selects items

**Solution**: Validate inventory on seller side when order is received:
```javascript
socket.on('orders', (data) => {
    try {
        // Validate that items still exist at same prices
        const res = db.exec(`SELECT data FROM inventory LIMIT 1`);
        if (!res.length) {
            return socket.emit('error', { message: 'Inventory no longer available' });
        }
        const inventory = JSON.parse(res[0].values[0][0]);
        // Check if all items still exist
        // ... validation logic
    } catch (err) {
        console.error("Error validating order:", err);
    }
});
```

---

### 🟡 **9. MISSING AUTHENTICATION CHECK** (MEDIUM SEVERITY)
In `chat/controller.js`, there's an early exit but no proper error logging:

```javascript
function handlesocket(socket, io) {
    if (!socket.user) {
        console.log("Socket has no user assigned!");
        return;  // Socket is disconnected but user doesn't know
    }
    // ...
}
```

**Better approach:**
```javascript
if (!socket.user) {
    console.error("Authentication failed - socket has no user");
    socket.disconnect(true);  // Forcefully disconnect
    return;
}
```

---

### 🟡 **10. RACE CONDITION ON ORDER COUNTER** (LOW-MEDIUM SEVERITY)
In `main.js`, the order counter increment is not atomic:

```javascript
function submitOrder() {
    // ...
    globalOrderCounter++;  // Read-modify-write - not atomic!
    db.run(`UPDATE order_counter SET counter = ${globalOrderCounter}`);
    const orderId = globalOrderCounter;
    // ...
}
```

If two users trigger this simultaneously:
1. Both read counter = 5
2. Both increment to 6
3. Both save 6
4. Result: Order #6 is created twice

**Fix** (backend solution - BETTER):
```javascript
db.run(`UPDATE order_counter SET counter = counter + 1 RETURNING counter`, [], function(err) {
    const newCounter = this.lastID;  // Gets the updated value atomically
});
```

Or use a transaction in SQL.js.

---

## 🟢 Things Done Correctly

✅ **Socket.IO event routing** - Properly routes messages between users  
✅ **JWT token handling** - Correctly validates tokens in socket auth  
✅ **Database schema** - Proper tables for orders, inventory, counter  
✅ **UI/UX for order system** - Clean modal, good visual feedback  
✅ **Status tracking** - Orders properly track pending/completed status  
✅ **Inventory builder** - User-friendly section/item management  
✅ **Order persistence** - Orders survive page refreshes  
✅ **Real-time updates** - Socket communication works well  

---

## Summary of Fixes Needed

| Priority | Issue | Fix Complexity | Impact |
|----------|-------|-----------------|--------|
| 🔴 CRITICAL | SQL Injection | Medium | Security breach possible |
| 🔴 CRITICAL | Hardcoded Secret Key | Low | Credentials exposed |
| 🟠 HIGH | Socket.IO version mismatch | Low | Compatibility issues |
| 🟠 HIGH | Memory leak | Low | Performance degradation |
| 🟠 HIGH | No error handling | Medium | Silent failures |
| 🟡 MEDIUM | Order ID reuse | Medium | Data conflicts |
| 🟡 MEDIUM | Missing validation | Medium | Business logic gaps |
| 🟡 MEDIUM | XSS vulnerabilities | Low | Security |

---

## Recommended Action Plan

1. **Immediate** (Today):
   - Fix SQL injection vulnerabilities
   - Move hardcoded secret to `.env`
   - Fix socket.io version mismatch

2. **Soon** (This week):
   - Add error handling to socket handlers
   - Fix memory leak in userSockets map
   - Add HTML escaping

3. **Later** (When time allows):
   - Implement inventory validation
   - Add transaction support for order counter
   - Prevent order ID reuse