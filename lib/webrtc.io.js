//SERVER -- now using socket.io
var winston = require('winston')
//    , io    = require('socket.io')
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

//{{{Room
function Room(config){
    if(!(this instanceof Room)){
        return new Room(config);
    }
    config = config || {};

    // If provided, this is tokenId
    this.id         = config.id   || uuid.v1();

    this.hostId     = config.host || "";
    this.host       = "";
    this.type       = config.type || "conference";
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
         *   broadcast:
         *     host knows about guests, guests know only about the host
         */
        this.notifyPeerConnected(socket);
    }

    function authenticate(creds){
        return true;
    }

    function room_magic(data){
        return 'broadcast';
    }

};

Room.prototype.leave = function(socket){
    switch(this.type){
        case "conference":
            socket.broadcast.to(this.id).emit('remove_peer_connected', { socketId: socket.id });
            break;

        case "broadcast":
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
        case "broadcast":
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

        case "broadcast":
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

/*
 * Consumer of this library must provide implementation for
 * 'addHandlers' before calling the 'listen' function.
 */
module.exports.listen = function(socketio){ //server, options) {//{{{
    io = socketio; //io.listen(server);

    //io.Socket.prototype.getRooms = function(){
    //    // This is an object
    //    return io.sockets.manager.roomClients[this.id];
    //};

    io.set('log level', 1);

    this.options = {};
    var self = this;

    //{{{ Socket Event Handlers
    io.sockets.on('connection', function(socket) {
        iolog('new socket connection: ' + socket.id);

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
            // data:
            // {
            //   clientId,
            //   tokenId,
            //   room,
            //   isHost
            //
            // }
            iolog('join_room: ' + socket.id + ' trying to join ' + data.room);
            fn = fn || function(){};

            try {
                var room = rooms[data.room];
                if(!room){
                    iolog('room ' + data.room + ' not found');
                    //if(data.forceCreate) {
                    //    iolog('forcing room creation on join');
                    //    room = new Room({id: data.room});
                    //    rooms[room.id] = room;
                    //} else {
                    var err = 'cannot join nonexistent room';
                    iolog(err);
                    fn(err);
                    return;
                    //}
                }
                if(data.clientId === room.hostId){
                    // Host has joined the room
                    room.host = socket.id;
                }

                iolog('join_room clientId: ' + data.clientId);
                socket.set('clientId', data.clientId, function(){
                    // Make this list BEFORE the client joins (room type is considered)
                    var connectionsId = room.getClientIds(socket);

                    room.join(socket, data.credentials);

                    // send new peer a list of all prior peers
                    // (In broadcast mode this only contains the host id)
                    iolog(socket.id + ' joined room ' + room.id + ' successfully');

                    module.exports.onjoinroom(data.clientId, room.id);
                    fn(null, { connections: connectionsId, you: socket.id });
                });

            } catch (ex) {
                iolog('join_room failed: ' + ex.message);
                fn(ex);
            }

        });//}}}
        socket.on('leave_room', function(data, fn) {//{{{
            iolog('leave_room');
            // This will cause client to leave a single room

            fn = fn || function(){};

            if(!data || !data.room){
                var err = 'leave_room requires a room id';
                iolog(err);
                fn(err);
                return;
            }
            leaveRoom(data.room, socket, fn);
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

        socket.on('disconnect', function() {//{{{
            iolog('disconnect for ' + socket.id);
            // This will cause client to leave all rooms

            var socRooms = io.sockets.manager.roomClients[socket.id];//socket.getRooms();
            // remove from rooms and send remove_peer_connected as needed
            for (var nsp in socRooms) {
                var roomId = nsp.substr(1); //Namespaces begin with '/'

                if(!roomId)
                    continue;

                leaveRoom(roomId, socket); // async but whatev, client is gone
            }

        });//}}}
    });//}}}
};//}}}

module.exports.leaveRoom = leaveRoom = function(roomId, socket, fn){
    var room = rooms[roomId];
    if(!fn){
        fn = function(){};
    }

    if(!room){
        var err = 'room "' + roomId + '" does not exist; cannot leave';
        iolog(err);
        fn(err);
        return;
    }

    try{
        room.leave(socket);
        iolog(socket.id + ' left room ' + roomId + ' successfully');
        socket.get('clientId', function(err, clientId){
            iolog('clientId: ' + clientId + ' leaving');
            module.exports.onleaveroom(clientId, roomId);
            fn(null, {});
        });
    } catch (err) {
        iolog(err.message);
        fn(err);
    }

}

module.exports.addOrUpdateRoom = function(roomConfig){
    iolog('room ' + roomConfig.id + ' updated');
    rooms[roomConfig.id] = new Room(roomConfig);
};

module.exports.getClient = function(id) {//{{{
  return io.sockets.socket(id);
};//}}}
