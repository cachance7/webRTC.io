//SERVER -- now using socket.io
var winston = require('winston')
    , io    = require('socket.io')
    , util  = require('util')
    , uuid  = require('node-uuid');

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

io.Socket.prototype.getRooms = function(){
    // This is an object
    return io.sockets.manager.roomClients[this.id];
};

/*
 * Consumer of this library must provide implementation for
 * 'addHandlers' before calling the 'listen' function.
 */
module.exports.listen = function(port, options) {//{{{
    io = io.listen(port);
    io.set('log level', 1);

//{{{Room
function Room(id, host, type){
    if(!(this instanceof Room)){
        return new Room(id, host, type);
    }

    this.id   = id   || uuid.v1();
    this.host = host || "";
    this.type = type || "conference";
}

Room.prototype.join = function(socket, credentials){
    if(!authenticate(socket, credentials)){
        throw new Error('not authorized to join this room');
    } else {
        socket.join(this.id);

        /*
         * Different behavior depending on mode
         *   conference:
         *     all connections will know about one another
         *
         *   onewaymirror:
         *     host knows about guests, guests know only about the host
         */
        this.notifyPeerConnected(socket);
    }

    function authenticate(creds){
        return true;
    }

    function room_magic(data){
        return 'onewaymirror';
    }

};

Room.prototype.leave = function(socket){
    switch(this.type){
        case "conference":
            socket.broadcast.to(this.id).emit('remove_peer_connected', { socketId: socket.id });
            break;

        case "onewaymirror":
            if(this.host !== socket.id){
                // stream consumer is leaving
                io.sockets.socket(this.host).emit('remove_peer_connected', { socketId: socket.id, isHost: false });
            } else {
                // room host is leaving
                socket.broadcast.to(this.id).emit('remove_peer_connected', {socketId: socket.id, isHost: true});
            }
            break;

        default:
            break;
    }
    socket.leave(this.id);
};

Room.prototype.getClientIds = function(socket){
    switch(this.type){
        case "conference":
            // Everyone may know about everyone else
            return io.sockets.clients(this.id).map(function(soc) { return soc.id });
            break;
        case "onewaymirror":
            /// Host gets to know about everyone else
            if(this.host === socket.id){
                return io.sockets.clients(this.id).map(function(soc) { return soc.id });
            } else {
                // Guests only get to know about the host
                return this.host ? [ this.host ] : [];
            }
            break;
        default:
            break;
    }
};

Room.prototype.notifyPeerConnected = function(socket){
    switch(this.type){
        case "conference":
            // let everyone else know you're here
            socket.broadcast.to(this.id).emit('new_peer_connected', { socketId: socket.id });
            break;

        case "onewaymirror":
            // Host contacts everyone
            if(this.host === socket.id){
                socket.broadcast.to(this.id).emit('new_peer_connected', { socketId: socket.id });
            } else { // Guests only contact the host (if available)
                if(this.host) {
                    io.sockets.socket(this.host).emit('new_peer_connected', { socketId: socket.id });
                }
            }
            break;

        default:
            break;
    }
};
//}}}
    this.options = {};
    var self = this;

    io.sockets.on('connection', function(socket) {
        iolog('new socket connection: ' + socket.id);

        socket.on('initialize', function(args) {
            args = args || {};

            //{{{ TODO START: Set up personal room if operating in 'onewaymirror' mode
                var room = new Room(args.room);
                rooms[room.id] = room;
                iolog(socket.id + ' is host of room ' + room.id);

                // Let client know the room it's hosting
                socket.emit('ready', {room: room.id});
            //}}} END TODO
        });

            //{{{ Socket Event Handlers

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
                iolog('join_room: ' + socket.id + ' trying to join ' + data.room);
                fn = fn || function(){};

                try {
                    var room = rooms[data.room];
                    if(!room){
                        iolog('room ' + data.room + ' not found');
                        if(data.forceCreate) {
                            iolog('forcing room creation on join');
                            room = new Room(args.room);
                            rooms[room.id] = room;
                        } else {
                            var err = 'cannot join nonexistent room';
                            iolog(err);
                            fn(err);
                            return;
                        }
                    }
                    // Make this list BEFORE the client joins (room type is considered)
                    var connectionsId = room.getClientIds(socket);

                    room.join(socket, data.credentials);

                    // send new peer a list of all prior peers
                    // (In onewaywindow mode this only contains the host id)
                    iolog(socket.id + ' joined room ' + room.id + ' successfully');

                    module.exports.onjoinroom(socket.id, room.id);
                    fn(null, { connections: connectionsId, you: socket.id });
                } catch (ex) {
                    iolog(ex);
                    fn(ex);
                }

            });//}}}
            socket.on('leave_room', function(data, fn) {//{{{
                iolog('leave_room');

                fn = fn || function(){};

                if(!data || !data.room){
                    var err = 'leave_room requires a room id';
                    iolog(err);
                    fn(err);
                    return;
                }

                var room = rooms[data.room];

                if(!room){
                    var err = 'room "' + data.room + '" does not exist; cannot leave';
                    iolog(err);
                    fn(err);
                    return;
                }

                try{
                    room.leave(socket);
                    iolog(socket.id + ' left room ' + room.id + ' successfully');

                    module.exports.onleaveroom(socket.id, room.id);
                    fn(null, {});
                } catch (err) {
                    iolog(err);
                    fn(err);
                }

            });//}}}
            //}}}
            //{{{ WebRTC Handlers
            socket.on('send_ice_candidate', function(data) {//{{{
                //Receive ICE candidates and send to the correct socket
                var soc = io.sockets.socket(data.socketId);
                iolog('send_ice_candidate from ' + socket.id + ' to ' + soc.id);

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
                var soc = io.sockets.socket(data.socketId);
                iolog('send_ice_candidate from ' + socket.id + ' to ' + soc.id);

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
                var soc = io.sockets.socket( data.socketId);
                iolog('send_ice_candidate from ' + socket.id + ' to ' + soc.id);

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

        socket.on('disconnect', function() {//{{{
            iolog('disconnect for ' + socket.id);

            var socRooms = socket.getRooms();
            // remove from rooms and send remove_peer_connected as needed
            for (var nsp in socRooms) {
                var roomId = nsp.substr(1);

                if(!roomId)
                    continue;

                iolog(socket.id + ' leaving room ' + roomId);
                try{
                    rooms[roomId].leave(socket);
                    iolog(socket.id + ' left room ' + roomId);
                } catch(ex) {
                    iolog('error leaving room: ' + ex);
                }
            }

        });//}}}
    });
};//}}}

module.exports.getClient = function(id) {//{{{
  return io.sockets.socket(id);
};//}}}
