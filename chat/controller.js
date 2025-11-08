// message.js
const userSockets = new Map(); // key: uid, value: array of sockets

function handlesocket(socket, io) {
    if (!socket.user) {
        console.log("Socket has no user assigned!");
        socket.disconnect();
        return;
    }

    // Add socket to user's list
    const uidKey = String(socket.user.uid);
    if (!userSockets.has(uidKey)) {
        userSockets.set(uidKey, []);
    }
    userSockets.get(uidKey).push(socket);

    socket.on('message', (data) => {
        try {
            const { to, text } = data;
            if (!to || !text) {
                console.log("Invalid message data");
                return;
            }

            // Send to all sockets for recipient
            const recipientSockets = userSockets.get(String(to)) || [];
            if (recipientSockets.length > 0) {
                recipientSockets.forEach(s => {
                    s.emit('message', {
                        from: socket.user.uid,
                        fromUsername: socket.user.username,
                        text
                    });
                });
            } else {
                console.log("Recipient not connected:", to);
            }
        } catch (err) {
            console.error("Error handling message:", err);
        }
    });

    socket.on('webrtc-signal', (data) => {
        try {
            const { to, signal } = data;
            if (!to || !signal) return;
            const recipientSockets = userSockets.get(String(to)) || [];
            recipientSockets.forEach(s => s.emit('webrtc-signal', {
                from: socket.user.uid,
                signal
            }));
        } catch (err) {
            console.error("Error handling webrtc-signal:", err);
        }
    });

    socket.on('money', (data) => {
        try {
            const { to, amount, description } = data;
            if (!to || !amount) return;
            const recipientSockets = userSockets.get(String(to)) || [];
            if (recipientSockets.length > 0) {
                recipientSockets.forEach(s => {
                    s.emit('money', {
                        from: socket.user.uid,
                        fromUsername: socket.user.username,
                        amount,
                        description
                    });
                });
            } else {
                console.log("Recipient not connected:", to);
            }
        } catch (err) {
            console.error("Error handling money:", err);
        }
    });

    socket.on('orders', (data) => {
        try {
            const { to, orderId, customerUid, customerUsername, items, totalPrice } = data;
            if (!to || !orderId || !items) return;
            const recipientSockets = userSockets.get(String(to)) || [];
            if (recipientSockets.length > 0) {
                recipientSockets.forEach(s => {
                    s.emit('orders', {
                        orderId,
                        customerUid,
                        customerUsername,
                        items,
                        totalPrice
                    });
                });
            } else {
                console.log("Recipient not connected:", to);
            }
        } catch (err) {
            console.error("Error handling orders:", err);
        }
    });

    socket.on('fetch-inventory', (data) => {
        try {
            const { sellerUid } = data;
            if (!sellerUid) return;
            const sellerSockets = userSockets.get(sellerUid) || [];
            if (sellerSockets.length > 0) {
                sellerSockets.forEach(s => {
                    s.emit('fetch-inventory', {
                        from: socket.user.uid
                    });
                });
            } else {
                console.log("Seller not connected:", sellerUid);
            }
        } catch (err) {
            console.error("Error handling fetch-inventory:", err);
        }
    });

    socket.on('inventory-data', (data) => {
        try {
            const { to, inventory } = data;
            if (!to || !inventory) return;
            const recipientSockets = userSockets.get(String(to)) || [];
            if (recipientSockets.length > 0) {
                recipientSockets.forEach(s => {
                    s.emit('inventory-data', {
                        inventory
                    });
                });
            } else {
                console.log("Recipient not connected:", to);
            }
        } catch (err) {
            console.error("Error handling inventory-data:", err);
        }
    });

    socket.on('order-completed', (data) => {
        try {
            const { to, orderId, status } = data;
            if (!to || !orderId) return;
            const recipientSockets = userSockets.get(String(to)) || [];
            if (recipientSockets.length > 0) {
                recipientSockets.forEach(s => {
                    s.emit('order-completed', {
                        orderId,
                        status
                    });
                });
            } else {
                console.log("Recipient not connected:", to);
            }
        } catch (err) {
            console.error("Error handling order-completed:", err);
        }
    });

    socket.on('transaction-request', (data) => {
        try {
            console.log('server received transaction-request', data, 'from', socket.user.uid);
            const { transactionId, type, amount, receiverUid, senderValue } = data;
            if (!transactionId || !receiverUid) return;
            const receiverSockets = userSockets.get(String(receiverUid)) || [];
            if (receiverSockets.length > 0) {
                receiverSockets.forEach(s => {
                    s.emit('transaction-request', {
                        transactionId,
                        type,
                        amount,
                        senderUid: socket.user.uid,
                        senderUsername: socket.user.username,
                        senderValue
                    });
                });
            } else {
                console.log("Receiver not connected:", receiverUid);
            }
        } catch (err) {
            console.error("Error handling transaction-request:", err);
        }
    });

    socket.on('transaction-confirmed', (data) => {
        try {
            console.log('server received transaction-confirmed', data, 'from', socket.user.uid);
            const { transactionId, type, amount, to } = data;
            if (!transactionId || !to) return;
            const targetSockets = userSockets.get(String(to)) || [];
            if (targetSockets.length > 0) {
                targetSockets.forEach(s => {
                    s.emit('transaction-confirmed', {
                        transactionId,
                        type,
                        amount,
                        senderUid: socket.user.uid
                    });
                });
            }
        } catch (err) {
            console.error("Error handling transaction-confirmed:", err);
        }
    });

    socket.on('transaction-cancelled', (data) => {
        try {
            console.log('server received transaction-cancelled', data, 'from', socket.user.uid);
            const { transactionId, to, type, amount, status } = data;
            if (!transactionId || !to) return;
            const targetSockets = userSockets.get(String(to)) || [];
            targetSockets.forEach(s => {
                s.emit('transaction-cancelled', {
                    transactionId,
                    type,
                    amount,
                    status
                });
            });
            console.log("Transaction cancelled:", transactionId);
        } catch (err) {
            console.error("Error handling transaction-cancelled:", err);
        }
    });

    socket.on('disconnect', () => {
        try {
            const uidKey = String(socket.user.uid);
            const sockets = userSockets.get(uidKey) || [];
            const remaining = sockets.filter(s => s !== socket);
            if (remaining.length === 0) {
                // Clean up empty entry
                userSockets.delete(uidKey);
            } else {
                userSockets.set(uidKey, remaining);
            }
        } catch (err) {
            console.error("Error handling disconnect:", err);
        }
    });
}

module.exports = {handlesocket};
