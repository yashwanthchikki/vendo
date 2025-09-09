function handlesocket(socket,io){
    socket.on('message',(data)=>{
        socket.emit('message',data + " too")
    })

}

module.exports={handlesocket}