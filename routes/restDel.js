/*
 * DEL 
 */


module.exports = function(TEMP, io) {
  var lib = require('../lib.js')(TEMP);
  var routes = {};
  
  routes.id = function(req, res){
    var pageId = req.params.id;

    var obj = {
      io : io,
      gfs : req.gfs,
      redisClient : req.redisClient,
      redisLock : req.redisLock,
      pageId : pageId
    };    

    lib.deletePage(obj, function(err, results) {
      if (err) {
        res.json( {'ret':false, msg : err.message } );
      } else {  
        //같은 룸에 페이지 삭제 알림.        
        io.sockets.in(pageId).emit("pageDeleted", '')
        res.json( {'ret':true } );
      }      
    });
  };  
  
  
  routes.text = function(req, res){
    var async = require('async');      
    var pageId = req.params.id;  
    var data = "";
    
    async.waterfall([
      function(callback) {
        io.sockets.in(pageId).emit("textMessage", data );
        callback();
        
      }, function(callback) {
        req.redisClient.set(pageId + '.text', data );
        callback();
      }, function(callback) {
        res.json({'ret':true});
        callback();
      }
    ], function(err, results) {
      res.json( {'ret':false, msg : 'Failed to clear.' } );
    });       
    
  };  
  
  routes.deleteFileAll = function(req, res) {
    var pageId = req.params.id;    

    var obj = {
      io : io,
      gfs : req.gfs,
      redisClient : req.redisClient,
      redisLock : req.redisLock,
      pageId : pageId
    };

    lib.DBfileDeleteAll(obj, function(err, results) {
      if (err) {
        res.json( {'ret':false, msg : err.message } );
      } else {  
        io.sockets.in(pageId).emit("fileDeletedAll", JSON.stringify({ pageId : pageId } ) )
        res.json( {'ret':true } );
      }      
    });
  }
  
  routes.deleteFile = function(req, res) {
    var pageId = req.params.id;
    var fileName = req.params.file; 
    
    var obj = {
      io : io,
      gfs : req.gfs,
      redisClient : req.redisClient,
      redisLock : req.redisLock,
      pageId : pageId,
      fileName : fileName
    };    
    
    lib.DBfileDelete(obj, function(err, results) {
      if (err) {
        res.json( {'ret':false, msg : err.message } );
      } else {  
        io.sockets.in(pageId).emit("fileDeleted", JSON.stringify({ fileName : fileName }) )
        res.json( {'ret':true } );
      }
    }); 
    
  }  
  
  
  return routes;
};
