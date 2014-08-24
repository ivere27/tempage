//2013-2014 yONg.

//load default settings.
var TEMP = require('./config.js');

//Exception Handler.
process.on('uncaughtException', function (err) {
  console.log('Caught exception : ' + err);
});


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
  , server = http.createServer(app);

if (TEMP.secure) {
  var https = require('https')
    , servers = https.createServer(TEMP.sslOptions, app)
    , io = require('socket.io').listen(servers);
} else {
  var io = require('socket.io').listen(server);
}

var restGet = require('./routes/restGet')(TEMP, io)
  , restPost = require('./routes/restPost')(TEMP, io)
  , restDel = require('./routes/restDel')(TEMP, io)
  , lib = require('./lib.js')(TEMP);  //Tempage library

//redis
var redis = require("redis")
   ,RedisStore = require('socket.io/lib/stores/redis');
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
app.use(express.limit(TEMP.uploadLimit));                   //maximum file size
app.use(express.favicon());
app.use(express.logger('dev'));

app.use(express.json());
app.use(express.urlencoded());
app.use(express.multipart({uploadDir: TEMP.uploadDir }));   //default upload directory

app.use(express.methodOverride());
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public')));

io.set('log level', 1); //do not display heart beat.
io.set('store', new RedisStore({
  redisPub : redis.createClient()
, redisSub : redis.createClient()
, redisClient : redis.createClient()
}));

// development only
if ('development' == app.get('env')) {
  app.use(express.errorHandler());
}  

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

app.del('/:id', restDel.id);
app.del('/:id/file', restDel.deleteFileAll);
app.del('/:id/file/:file', restDel.deleteFile);
app.del('/:id/text', restDel.text);


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
} else {
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
  
   
  //소켓 접속시.
  io.sockets.on('connection', function(socket) {
  
    //접속시, join으로 room에 접속.
    socket.on('join', function(room) {
      if (room == '') { //room이 없을경우 랜덤 방.
        room = lib.getRandomPageId();
      }
  
      //처음 join시 메모리에 db 생성.
      var pageId = room;
      lib.initPage( { pageId : pageId, redisClient : redisClient, redisLock : redisLock  }  );     
      
      
      socket.get('room', function(err, oldRoom) {
        if (err) { throw err; }      
        socket.set('room', room, function (err) {
          if (err) { throw err;}
          if(oldRoom) {
            socket.leave(oldRoom);
          }
          socket.join(room);
          
          socket.get('username', function(err, username) {
            if(!username) {
              username = socket.id;
            }
            
            var chat = {};
            chat.user = '/userConnected';
            chat.message = username;          
  
            //client callback
            socket.emit('pageJoined', JSON.stringify({userId : username }) );
            
            //broadcast except me
            //socket.emit('chatMessage', JSON.stringify(chat) );            
            socket.broadcast.to(room).emit('chatMessage', JSON.stringify(chat) );          
            
  
          });
          
  
        });
      });
    });
    
    //현재 userInfo 전송.
    socket.on('userInfo', function(content) {
      socket.get('room', function(err, room) {
        if (err) { throw err; }         
        if (room)
        {
          var pageId = room;
          var clients = io.sockets.clients(room);  //해당 룸의 정보.
          
          var data = {};
          data.pageId = pageId;
          data.userCount = clients.length;
          data.users = [];
          for(var client in clients) {
            data.users.push( clients[client].id );
          }
          socket.emit('userInfo', JSON.stringify(data) );            
        } else { //room정보가 없는경우.에러.
          
        }
      });
    });    
    
    
    //현재 pageInfo. 전송. pageId / 최초 시간등.
    socket.on('pageInfo', function(content) {
      socket.get('room', function(err, room) {
        if (err) { throw err; }         
        if (room)
        {
          var pageId = room;
          
         
          var clients = io.sockets.clients(room);  //해당 룸의 정보.
          
          var data = {};
          data.pageId = pageId;
          data.userId = socket.id;
          data.userCount = clients.length;
          data.users = [];
          
          for(var client in clients) {
            data.users.push( clients[client].id );
          }
          
          redisClient.mget([pageId + '.info', pageId + '.text', room + '.fileList'], function(err, value) {
            if (err) { throw err; }
            
            if (value[0] == null) {
              
            } else {
              var pageInfo = JSON.parse(value[0]);
              data.createdTime = pageInfo.createdTime ;
              data.expiresTime = pageInfo.expiresTime ;
            }   
            
            if (value[1] == null) {
              data.text = '' ;
            } else {
              data.text = value[1] ;
            }          
            
            if (value[2] == null) {
              data.fileList = null;            
            } else {
              data.fileList = JSON.parse(value[2]);
            }          
            
            socket.emit('pageInfo', JSON.stringify(data) );          
          });
  
        } else { //room정보가 없는경우.에러.
          
        }
      });
      
    });
    
  
    //채팅
    socket.on('chatMessage', function(content) {    
      socket.get('username', function(err, username) {
        if (!username) {
          username = socket.id;
        }
        
        socket.get('room', function(err, room) {
          if (err) { throw err; }
  
          var chat = {};
          chat.user = username;
          chat.message = content;
  
          if (room == null) {
            chat.user = 'tempage';
            chat.message = 'join in a page.';          
            socket.emit('chatMessage', JSON.stringify(chat) );
          } else
          {          
            socket.emit('chatMessage', JSON.stringify(chat) );
            socket.broadcast.to(room).emit('chatMessage', JSON.stringify(chat) ); //socket.id                
          }
  
        });
      });
    }); //clientMessage
    
    //clearPage
    socket.on('clearPage', function(content) {
      var obj = JSON.parse(content);
      
      redisClient.get(obj.pageId + '.info', function(err,value) {
        if (err) { throw err ; }
        var pageInfo = JSON.parse(value);
        pageInfo.expiresTime = 0;
        redisClient.set(obj.pageId + '.info', JSON.stringify(pageInfo));
      });
    });
    
    //socket 접속 끊을때, ex 다른 페이지 이동. 접속 끊켰을때, 자동으로 호출됨. room에서도 자동으로 나감
    socket.on('disconnect', function() {
      
      socket.get('room', function(err, room) {
        if (room) {
          var pageId = room;
          socket.leave(pageId);
      
          socket.get('username', function(err, username) {
            if(!username) {
            username = socket.id;
            }
      
            socket.broadcast.to(pageId).emit('chatMessage', JSON.stringify( { user:'/userDisconnected', message: username}) );
          });      
        }
      });
    }); //disconnect
    
    
    //text
    socket.on('textMessage', function(content) {
      if (content.length > TEMP.maxPageTextLength) {
        content = content.substring(0, TEMP.maxPageTextLength);
      }
      
      socket.get('room', function(err, room) {
        if (err) { throw err; }
        
        if (room == null) {
          //room 미기재시, 채트로 에러 전송.
          var chat = {};
 
          chat.user = 'tempage';
          chat.message = 'join in a page.';          
          socket.emit('chatMessage', JSON.stringify(chat) );  
          
        } else {
          var pageId = room;
          redisClient.set(pageId + '.text', content);
          socket.broadcast.to(pageId).emit('textMessage', content);         
        }
        
      });
    });
    
    /*
    **  view Share.  
    */
    socket.on('viewShareOpen', function(content) {      
      socket.get('room', function(err, room) {
        if (err) { throw err; }
          var pageId = room;
          socket.broadcast.to(pageId).emit('viewShareOpen', content);         
        
      });
    });
    socket.on('viewShareClosed', function(content) {      
      socket.get('room', function(err, room) {
        if (err) { throw err; }
          var pageId = room;
          socket.broadcast.to(pageId).emit('viewShareClosed', content);         
        
      });
    });
  });

} //end of cluster

  
  


  
