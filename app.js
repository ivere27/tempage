//2013-2014 yONg.

//load default settings.
var TEMP = require('./config.js');

//Exception Handler.
/*process.on('uncaughtException', function (err) {
  console.log('Caught exception : ' + err);
});*/


//starts of logic.
var cluster = require('cluster');
var numCPUs = require('os').cpus().length;
var fs = require('fs')
  , async = require('async');

if (TEMP.secure) {
  TEMP.sslOptions = {
    ca: fs.readFileSync("../server.ca-bundle"),
    key: fs.readFileSync("../server.key"),
    cert: fs.readFileSync("../server.crt")
  };
}

//load express.
var express = require('express')
  , app = express()
  , http = require('http')
  , path = require('path')
  , bodyParser = require('body-parser')
  , favicon = require('serve-favicon')
  , multer  = require('multer')
  , server = http.createServer(app);

if (TEMP.secure) {
  var https = require('https')
    , servers = https.createServer(TEMP.sslOptions, app)
    , io = require('socket.io')(servers);
} else {
  var io = require('socket.io')(server);
}

var restGet = require('./routes/restGet')(TEMP, io)
  , restPost = require('./routes/restPost')(TEMP, io)
  , restDel = require('./routes/restDel')(TEMP, io)
  , lib = require('./lib.js')(TEMP);  //Tempage library

//redis
var redis = require("redis")
   ,RedisStore = require('socket.io-redis');
var redisClient = TEMP.redisClient = redis.createClient()  
var redisLock = TEMP.redisLock = require("redis-lock")(redisClient);

redisClient.on("error", function(err) {
  console.log("Redis Error : " + err);
});
//end of redis

//mongodb
var mongo = require('mongodb');
var Grid = require('gridfs-stream');
var db = new mongo.Db(TEMP.mongoDbName, new mongo.Server(TEMP.mongoServerIP ,TEMP.mongoServerPort), {safe: true});
db.open(function (err) {
  if (err) return handleError(err);  
});
var gfs = Grid(db, mongo);
//end of mongodb

// all environments
app.set('port', TEMP.port);
app.set('ports', TEMP.ports);
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');
//app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(function(req, res, next) {
  console.log('%s %s', req.method, req.url);
  next();
});
app.use(bodyParser.json(TEMP.uploadLimit));                  //maximum file size
app.use(bodyParser.urlencoded({ extended: false }));
app.use(multer({uploadDir: TEMP.uploadDir }));               //default upload directory
app.use(express.static(path.join(__dirname, 'public')));

io.adapter(RedisStore({ host: 'localhost', port: 6379 }));

//route setting
express.request.uploadDir = express.response.uploadDir = TEMP.uploadDir;
express.request.redisClient = express.response.redisClient = redisClient;
express.request.redis = express.response.redis = redis;
express.request.redisLock = express.response.redisLock = redisLock;
express.request.fs = express.response.fs = fs;
express.request.gfs = express.response.gfs = gfs;

//route
app.get('/', restGet.index);                  //redirect to a random page
app.get('/about', restGet.about);             //about page
app.get('/test', restGet.test);               //only for test purpose
app.get('/config', restGet.config);               //get server config

app.get('/:id', restGet.id);                  //redirect to default skin
app.get('/:id/page', restGet.pageInfo);       //get the page info
app.get('/:id/text', restGet.text);           //get the text of a page
app.get('/:id/file', restGet.fileInfo);       //get files info
app.get('/:id/file/:file', restGet.getFile);  //get a file(download)
app.get('/:id/view/:file', restGet.fileView); //get to view a file
app.get('/:id/view/:file/:document', restGet.fileViewDocument);


app.post('/:id/text', restPost.text);
app.post('/:id/file', restPost.file);

app.delete('/:id', restDel.id);
app.delete('/:id/file', restDel.deleteFileAll);
app.delete('/:id/file/:file', restDel.deleteFile);
app.delete('/:id/text', restDel.text);


// CLUSTER
if (cluster.isMaster) {
  for (var i = 0; i< numCPUs; i++)
    cluster.fork();
  
  cluster.on('exit', function(worker) {
    console.log('Worker '+ worker.pid +' died.');

    var newWorker = cluster.fork();
    console.log('New worker '+newWorker.pid+'');
  });  
  
  //every deletePageInterval, check pages to delete
  setInterval( function() {
    //search every info.
    redisClient.keys('*.info', function(err, keys) {
      keys.map(function(key) {
        
        redisClient.get(key, function(err, value) {
          var obj = JSON.parse(value);
          var pageId = obj.pageId;
          //시간체크.
          if (  Date.now()  > obj.expiresTime  )
          {  
            redisLock( pageId , function(done) {
              
              var obj = {
                io : io,
                gfs : gfs,
                redisClient : redisClient,
                redisLock : redisLock,
                pageId : pageId
              };                   
              
              lib.deletePage(obj, function(err, results) {
                io.sockets.in(pageId).emit("pageDeleted", '');
                console.log(pageId + " is expired. deleted.");      
                done();              
              });
            });          
          }
        });
        
      });
    });
  }, TEMP.deletePageInterval );
} else { //slave
  //start http(s) server
  server.listen(app.get('port'), function() {
    console.log('Express server listening on port ' + app.get('port'));
  });
  if (TEMP.secure) {
    servers.listen(app.get('ports'), function() {
      console.log('Express https server listening on port ' + app.get('ports'));
    });  
  }

  //페이지 및 파일 초기화.
  var clearPage = function(pageId) {  
    var obj = {
      io : io,
      gfs : gfs,
      redisClient : redisClient,
      redisLock : redisLock,
      pageId : pageId
    };     
    
    async.waterfall([
      function(callback) {
        lib.deletePage(obj, function(err, results) {
          callback();
        });
      },
      function(callback) {
        lib.initPage( { pageId : pageId, redisClient : redisClient, redisLock : redisLock  }  ); 
        
        callback();
      }  
    ]);
  }
  

  //each socket.id is only belong to one room.
  TEMP.socketRoom = {};

  //소켓 접속시.
  io.on('connection', function(socket) {

    // socket.on('echo', function() {
    //   socket.emit('log','echo');
    // });
    
    // socket.on('wr', function(room) {
    //   console.log(io.sockets.adapter.rooms[room]);
    // });


//     //접속시, join으로 room에 접속.
//     socket.on('join', function(room) {
//       //FIXME room length check!!
//       if (room == '') { //room이 없을경우 랜덤 방.
//         room = lib.getRandomPageId();
//       }
  
//       //처음 join시 메모리에 db 생성.
//       var pageId = room;
//       lib.initPage( { pageId : pageId, redisClient : redisClient, redisLock : redisLock  }  );     

//       //already in a room.
//       if (TEMP.socketRoom.hasOwnProperty(socket.id)) {
//         socket.leave(TEMP.socketRoom[socket.id]);
//         delete TEMP.socketRoom[socket.id];
//       }

//       socket.join(room);
//       TEMP.socketRoom[socket.id] = room;

//       var username = socket.id;
//       var chat = {};
//       chat.user = '/userConnected';
//       chat.message = username;

//       //client callback
//       //socket.emit('pageJoined', {userId : username});

//       //broadcast except me
//       //socket.broadcast.to(room).emit('chatMessage', chat);

//       console.log('join');
//       console.log(cluster.worker.id);
//       console.log(socket.id);
//       console.log(TEMP.socketRoom);
//       console.log(io.sockets.adapter.rooms);
//       console.log(io.sockets.adapter.sids);



//       //socket.k = room;

//       /*socket.on('room', function(err, oldRoom) {
//         if (err) { throw err; }      
//         socket.set('room', room, function (err) {
//           if (err) { throw err;}
//           //if(oldRoom) {
//           //  socket.leave(oldRoom);
//           //}
//           socket.join(room);
          
//           socket.get('username', function(err, username) {
//             if(!username) {
//               username = socket.id;
//             }p
            
//             var chat = {};
//             chat.user = '/userConnected';
//             chat.message = username;          
  
//             //client callback
//             socket.emit('pageJoined', JSON.stringify({userId : username }) );
            
//             //broadcast except me
//             //socket.emit('chatMessage', JSON.stringify(chat) );            
//             socket.broadcast.to(room).emit('chatMessage', JSON.stringify(chat) );          
//           });
          
  
//         });
//       });*/


//     });
    
//     //현재 userInfo 전송.
//     socket.on('userInfo', function(obj) {
//       if (obj)
//       {
//         var pageId = TEMP.socketRoom[socket.id];
//         var clients = io.sockets.adapter.rooms[pageId];  //해당 룸의 정보.

//         var data = {};
//         data.pageId = pageId;
//         data.userCount = Object.keys(clients).length;
//         data.users = Object.keys(clients);

//         socket.emit('userInfo', data );
//       } else { //room정보가 없는경우.에러.
//       }
//     });
    
    
//     //현재 pageInfo. 전송. pageId / 최초 시간등.
//     socket.on('pageInfo', function() {
//       var room = TEMP.socketRoom[socket.id];
//       if (room)
//       {
//         var pageId = room;
//         var clients = io.sockets.adapter.rooms[room];  //clients of the room.

//         var data = {};
//         data.pageId = pageId;
//         data.userId = socket.id;
//         data.userCount = Object.keys(clients).length;
//         data.users = Object.keys(clients);

//         redisClient.mget([pageId + '.info', pageId + '.text', room + '.fileList'], function(err, value) {
//           if (err) { throw err; }

//           if (value[0] == null) {
//           } else {
//             var pageInfo = JSON.parse(value[0]);
//             data.createdTime = pageInfo.createdTime ;
//             data.expiresTime = pageInfo.expiresTime ;
//           }

//           if (value[1] == null) {
//             data.text = '' ;
//           } else {
//             data.text = value[1] ;
//           }

//           if (value[2] == null) {
//             data.fileList = null;
//           } else {
//             data.fileList = JSON.parse(value[2]);
//           }

//           socket.emit('pageInfo', data);
//         });

//       } else { //room정보가 없는경우.에러.
//       }
//     });

  
//     //채팅
//     socket.on('chatMessage', function(content) {
//       var username = socket.id;
//       var room = content.pageId;
//       var sid = Object.keys(io.sockets.adapter.sids[socket.id]);

//       var chat = {};
//       chat.user = username;
//       chat.message = content.chatMessage;

//       var exists = false;
//       for (var i in sid) {
//         if (sid[i] == room) {
//           exists = true;
//           socket.emit('chatMessage', chat);
//           socket.broadcast.to(room).emit('chatMessage', chat); //socket.id
//         }
//       }

//       if (!exists) {
//         chat.user = 'tempage';
//         chat.message = 'join in a page.';
//         socket.emit('chatMessage', chat);
//       } 

//     }); //clientMessage
    
//     //clearPage
//     socket.on('clearPage', function(content) {
//       var obj = JSON.parse(content);
      
//       redisClient.get(obj.pageId + '.info', function(err,value) {
//         if (err) { throw err ; }
//         var pageInfo = JSON.parse(value);
//         pageInfo.expiresTime = 0;
//         redisClient.set(obj.pageId + '.info', JSON.stringify(pageInfo));
//       });
//     });
    
//     //socket 접속 끊을때, ex 다른 페이지 이동. 접속 끊켰을때, 자동으로 호출됨. room에서도 자동으로 나감
//     socket.on('disconnect', function(content) {


//       // //check if socket.id is in  a room.
//       // if (TEMP.socketRoom.hasOwnProperty(socket.id)) {
//       //   var pageId = TEMP.socketRoom[socket.id];
//       //   socket.leave(pageId);
//       //   delete TEMP.socketRoom[socket.id];

//       //   var username = socket.id;
//       //   //socket.broadcast.to(pageId).emit('chatMessage', { user : '/userDisconnected', message : username});
//       // }


//       console.log('disconnect');
//       console.log(cluster.worker.id);
//       console.log(socket.id);
//       console.log(TEMP.socketRoom);
//       console.log(io.sockets.adapter.rooms);
//       console.log(io.sockets.adapter.sids);
// /*      socket.get('room', function(err, room) {
//         if (room) {
//           var pageId = room;
//           socket.leave(pageId);
      
//           socket.get('username', function(err, username) {
//             if(!username) {
//               username = socket.id;
//             }
      
//             socket.broadcast.to(pageId).emit('chatMessage', { user : '/userDisconnected', message : username});
//           });      
//         }
//       });*/
//     }); //disconnect
    
    
//     //text
//     socket.on('textMessage', function(content) {
//       if (content.length > TEMP.maxPageTextLength) {
//         content = content.substring(0, TEMP.maxPageTextLength);
//       }
      
//       socket.on('room', function(err, room) {
//         if (err) { throw err; }
        
//         if (room == null) {
//           //room 미기재시, 채트로 에러 전송.
//           var chat = {};
 
//           chat.user = 'tempage';
//           chat.message = 'join in a page.';          
//           socket.emit('chatMessage', JSON.stringify(chat) );  
          
//         } else {
//           var pageId = room;
//           redisClient.set(pageId + '.text', content);
//           socket.broadcast.to(pageId).emit('textMessage', content);         
//         }
        
//       });
//     });
    
//     /*
//     **  view Share.  
//     */
//     socket.on('viewShareOpen', function(content) {      
//       socket.on('room', function(err, room) {
//         if (err) { throw err; }
//           var pageId = room;
//           socket.broadcast.to(pageId).emit('viewShareOpen', content);         
        
//       });
//     });
//     socket.on('viewShareClosed', function(content) {      
//       socket.on('room', function(err, room) {
//         if (err) { throw err; }
//           var pageId = room;
//           socket.broadcast.to(pageId).emit('viewShareClosed', content);         
        
//       });
//     });
    
  });

} //end of cluster

  
  


  
