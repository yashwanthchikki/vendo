// message.js
const userSockets = new Map(); // key: uid, value: array of sockets

function handlesocket(socket, io) {
    if (!socket.user) {
        console.log("Socket has no user assigned!");
        return;
    }

    // Add socket to user's list
    if (!userSockets.has(socket.user.uid)) {
        userSockets.set(socket.user.uid, []);
    }
    userSockets.get(socket.user.uid).push(socket);

    socket.on('message', (data) => {
        const { to, text } = data;

        // Send to all sockets for recipient
        const recipientSockets = userSockets.get(to) || [];
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

        
    });

    socket.on('disconnect', () => {
        const sockets = userSockets.get(socket.user.uid) || [];
        userSockets.set(socket.user.uid, sockets.filter(s => s !== socket));
    });
}

module.exports = {handlesocket};
