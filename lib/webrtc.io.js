//SERVER -- now using socket.io
var winston = require('winston');

// {{{ DEBUG
var logger = new (winston.Logger)({
    transports: [
        //new (winston.transports.File)({filename: '/var/log/cake/' + name + '.server.log'}),
        new (winston.transports.Console)({
              level: 'debug',
              prettyPrint: true,
              colorize: true,
              silent: false,
              timestamp: false
        })
    ]
});

var iolog = function(message) {
    logger.info(message);
};

//for (var i = 0; i < process.argv.length; i++) {
//  var arg = process.argv[i];
//  if (arg === "-debug") {
//    iolog = function(msg) {
//      console.log(msg);
//    };
//    console.log('Debug mode on!');
//  }
//}
// }}}

MAX_PARTICIPANTS = 2; // for now
room_options = {};
rooms = {};

var io = require('socket.io');

/*
 * Consumer of this library must provide implementation for
 * 'addHandlers' before calling the 'listen' function.
 */
module.exports.listen = function(port, options) {//{{{
    io = io.listen(port);

    this.options = {};
    var self = this;

    io.sockets.on('connection', function(socket) {
        iolog('connect');

        iolog('new socket got id: ' + socket.id);

        //{{{Functions
        function joinRoom(data){//{{{
            // This call uses the information provided by the front-end to establish a room type
            var roomType = "onewaymirror";//room_magic(data);

            //{{{ Obs
            // Remove max connection check
            //var maxp = room_options[data.room] && room_options[data.room].max_participants || MAX_PARTICIPANTS;

            //// Check for room full
            //if(io.sockets.clients(data.room).length >= maxp){
            //    if(fn){
            //        fn('room is full');
            //        return;
            //    }
            //} else
            //}}}

            // Make this list BEFORE the client joins
            var connectionsId = io.sockets.clients(data.room).map(function(soc) { return soc.id });

            if(connectionsId.length == 0){

                /*
                 * this is the first connection
                 * --> all others observe it
                 * --> if it disconnects, disconnect all others
                 */
                rooms[data.room] = {};
                rooms[data.room].host = socket.id;
                rooms[data.room].roomType = roomType;
            }

            socket.join(data.room);

            /*
             * Different behavior depending on mode
             *   conference:
             *     all connections will know about one another
             *
             *   onewaymirror:
             *     first connection will know about all others in order to send stream
             */
            switch(roomType){
                case "conference":
                    // let everyone else know you're here
                    socket.broadcast.to(data.room).emit('new_peer_connected', { socketId: socket.id });
                    break;

                case "onewaymirror":
                    // only tell the host you're here (assuming you're also not the host)
                    if(rooms[data.room].host !== socket.id){
                        io.sockets.socket(rooms[data.room].host).emit('new_peer_connected', { socketId: socket.id });
                        connectionsId = [ rooms[data.room].host ];
                    }
                    break;

                default:
                    break;
            }
            module.exports.onjoinroom(socket.id, data.room);
            return connectionsId;
        }//}}}
        function leaveRoom(room){//{{{
            var roomdata = rooms[room];
            if(!roomdata){
                iolog('room "' + room + '" does not exist; cannot leave');
                return;
            }

            switch(roomdata.roomType){
                case "conference":
                    socket.broadcast.to(room).emit('remove_peer_connected', { socketId: socket.id });
                    break;

                case "onewaymirror":
                    if(rooms[room].host !== socket.id){
                        // stream consumer is leaving
                        io.sockets.socket(rooms[room].host).emit('remove_peer_connected', { socketId: socket.id, isHost: false });
                    } else {
                        // room host is leaving
                        socket.broadcast.to(room).emit('remove_peer_connected', {socketId: socket.id, isHost: true});
                    }
                    break;

                default:
                    break;
            }
            module.exports.onleaveroom(socket.id, data.room);
            socket.leave(room);
        }//}}}
        //}}}

        //{{{ Socket Event Handlers
        socket.on('disconnect', function() {//{{{
            iolog('disconnect for ' + socket.id);

            // remove from rooms and send remove_peer_connected as needed
            for (var room in io.sockets.manager.roomClients[socket.id]) {
                iolog(socket.id + ' leaving room ' + room);
                leaveRoom(room);
            }

            //{{{obs
            //call the disconnect callback
            //rtc.fire('disconnect', rtc);}}}

        });//}}}

        //{{{ Room Handlers
        socket.on('room_options', function(data, fn){//{{{
            if(!authenticate(data)){
                if(fn){
                    fn('you are not authorized to set options');
                }
            } else {
                room_options[data.room] = data.options; //options.max_participants
            }
        });//}}}
        socket.on('join_room', function(data, fn) {//{{{
            iolog('join_room: ' + data.room);

            if(!authenticate(data)){
                if(fn){
                    fn('you are not authorized to join this room');
                }
            } else {
                // Join the room and get the list of who's inside
                var connectionsId = joinRoom(data);

                // send new peer a list of all prior peers
                // (In onewaywindow mode this only contains the host id)
                if(fn){
                    fn(null, { connections: connectionsId, you: socket.id });
                }
            }

            function authenticate(credentials){
                return true;
            }

            function room_magic(data){
                return 'onewaymirror';
            }

        });//}}}
        socket.on('leave_room', function(data) {//{{{
            iolog('leave_room');

            if(!data || !data.room){
                iolog('leave_room requires a room id');
                return;
            }

            leaveRoom(data.room);
        });//}}}
        //}}}
        //{{{ WebRTC Handlers
        socket.on('send_ice_candidate', function(data) {//{{{
            //Receive ICE candidates and send to the correct socket
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
                //{{{obs
                //, function(error) {
                //    if (error) {
                //        console.log(error);
                //    }
                //});

                // call the 'recieve ICE candidate' callback
                //rtc.fire('receive ice candidate', rtc);}}}
            }
        });//}}}
        socket.on('send_offer', function(data) {//{{{
            //Receive offer and send to correct socket
            iolog('send_offer');
            var soc = io.sockets.socket(data.socketId);

            if (soc) {
                soc.emit("receive_offer",
                    {
                    sdp: data.sdp,
                    socketId: socket.id
                    }
                );

                //{{{obs
                //, function(error) {
                //    if (error) {
                //        console.log(error);
                //    }
                //});}}}
            }
            //{{{obs
            // call the 'send offer' callback
            //rtc.fire('send offer', rtc);}}}
        });//}}}
        socket.on('send_answer', function(data) {//{{{
            //Receive answer and send to correct socket
            iolog('send_answer');
            var soc = io.sockets.socket( data.socketId);

            if (soc) {
                soc.emit("receive_answer",
                    {
                    sdp: data.sdp,
                    socketId: socket.id
                    }
                );

                //{{{obs
                //, function(error) {
                //    if (error) {
                //        console.log(error);
                //    }
                //});
                //rtc.fire('send answer', rtc);}}}
            }
        });//}}}
        //}}}
        //}}}

        // This is an externally defined function that can provide
        //module.exports.addHandlers(socket);

        //socket.emit('connect');
    });
};//}}}

// generate a 4 digit hex code randomly//{{{
//function S4() {
//  return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
//}
//
//// make a REALLY COMPLICATED AND RANDOM id, kudos to dennis
//function id() {
//  return (S4() + S4() + "-" + S4() + "-" + S4() + "-" + S4() + "-" + S4() + S4() + S4());
//}//}}}

module.exports.getClient = function(id) {//{{{
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
};//}}}
