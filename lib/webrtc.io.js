//SERVER -- now using socket.io

//var WebSocketServer = require('ws').Server


// {{{ DEBUG
var iolog = function(message) {
    console.info(message);
};

for (var i = 0; i < process.argv.length; i++) {
  var arg = process.argv[i];
  if (arg === "-debug") {
    iolog = function(msg) {
      console.log(msg);
    };
    console.log('Debug mode on!');
  }
}
// }}}

// Used for callback publish and subscribe
//if (typeof rtc === "undefined") {
//  var rtc = {};
//}

var io = require('socket.io');
//module.exports.io = io;
//module.exports.addHandlers = null; // function to be!
module.exports.listen = function(port) {
    io = io.listen(port);

    io.sockets.on('connection', function(socket) {
        iolog('connect');

        iolog('new socket got id: ' + socket.id);

        socket.on('disconnect', function() {
            iolog('disconnect');

            // remove from rooms and send remove_peer_connected to all sockets in room
            for (var room in io.sockets.manager.roomClients[socket.id]) {
                socket.broadcast.to(room).emit('remove_peer_connected', {socketId: socket.id});
                socket.leave(room);
            }

            // call the disconnect callback
            //rtc.fire('disconnect', rtc);

        });

        socket.on('join_room', function(data) {
            iolog('join_room');

            // Make this list BEFORE the client joins
            var connectionsId = io.sockets.clients(data.room).map(function(soc) { return soc.id });

            socket.join(data.room);
            socket.broadcast.to(data.room).emit('new_peer_connected', { socketId: socket.id });

            // send new peer a list of all prior peers
            socket.emit('get_peers', { connections: connectionsId, you: socket.id });
        });

        socket.on('leave_room', function(data) {
            iolog('leave_room');

            socket.broadcast.to(data.room).emit('remove_peer_connected', { socketId: socket.id });
            socket.leave(data.room);
        });

        //Receive ICE candidates and send to the correct socket
        socket.on('send_ice_candidate', function(data) {
            iolog('send_ice_candidate');
            var soc = io.sockets.socket(data.socketId);

            if (soc) {
                soc.emit("receive_ice_candidate",
                    {
                    label: data.label,
                    candidate: data.candidate,
                    socketId: socket.id
                    }
                );
                //, function(error) {
                //    if (error) {
                //        console.log(error);
                //    }
                //});

                // call the 'recieve ICE candidate' callback
                //rtc.fire('receive ice candidate', rtc);
            }
        });

        //Receive offer and send to correct socket
        socket.on('send_offer', function(data) {
            iolog('send_offer');
            var soc = io.sockets.socket(data.socketId);

            if (soc) {
                soc.emit("receive_offer",
                    {
                    sdp: data.sdp,
                    socketId: socket.id
                    }
                );

                //, function(error) {
                //    if (error) {
                //        console.log(error);
                //    }
                //});
            }
            // call the 'send offer' callback
            //rtc.fire('send offer', rtc);
        });

        //Receive answer and send to correct socket
        socket.on('send_answer', function(data) {
            iolog('send_answer');
            var soc = io.sockets.socket( data.socketId);

            if (soc) {
                soc.emit("receive_answer",
                    {
                    sdp: data.sdp,
                    socketId: socket.id
                    }
                );

                //, function(error) {
                //    if (error) {
                //        console.log(error);
                //    }
                //});
                //rtc.fire('send answer', rtc);
            }
        });
        module.exports.addHandlers(socket);

        socket.emit('connect');
    });
};

// generate a 4 digit hex code randomly
//function S4() {
//  return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
//}
//
//// make a REALLY COMPLICATED AND RANDOM id, kudos to dennis
//function id() {
//  return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
//}

module.exports.getSocket = function(id) {
  return io.sockets.socket(id);

  //var connections = rtc.sockets;
  //if (!connections) {
  //  // TODO: Or error, or customize
  //  return;
  //}

  //for (var i = 0; i < connections.length; i++) {
  //  var socket = connections[i];
  //  if (id === socket.id) {
  //    return socket;
  //  }
  //}
};
