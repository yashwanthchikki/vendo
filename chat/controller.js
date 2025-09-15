function handlesocket(socket, io) {
    socket.on('message', (data) => {
        const { to, text } = data; // 'to' is recipient's user id

        // Find recipient socket by user id
        const sockets = Array.from(io.sockets.sockets.values());
        const recipientSocket = sockets.find(s => s.user && s.user.uid === to);

        if (recipientSocket) {
            // Send message to recipient
            recipientSocket.emit('message', {
                from: socket.user.uid,  // sender's user id
                fromUsername: socket.user.username,
                text
            });
        } else {
            console.log("Recipient not connected:", to);
        }

        // Optional: acknowledge sender
        socket.emit('message', {
            from: socket.user.uid,
            text: text + " too"
        });
    });
}
module.exports=handlesocket