/*
 * POST
 */

module.exports = function(TEMP,io) {
  var lib = require('../lib.js')(TEMP);
  var routes = {};
  
  routes.text = function(req, res) {
    var async = require('async');
    var pageId = req.params.id;
    var data;
    //console.log(req.body);

    //check page exsits
    lib.initPage( { pageId : pageId, redisClient : req.redisClient , redisLock : req.redisLock }  );
    
    async.waterfall([
      function(callback) {
        data = req.body.text  ;        
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
      res.json( {'ret':false, msg : 'Failed to post.' } );
    });
  };
  
  //post file(upload)
  routes.file = function(req, res, next) {
    res.charset = 'utf8';
    req.setEncoding('utf8');
    //console.log(req.files);
    var pageId = req.params.id;

    //check page exists
    lib.initPage( { pageId : pageId, redisClient : req.redisClient, redisLock : req.redisLock   }  );

    if (Array.isArray(req.files.file)) {
      req.files.file.forEach(function(file) {
        lib.fileUpload(io, req, res,  pageId, file.name, file.path, file.size);
      });
    } else
    {
      var file = req.files.file;
      lib.fileUpload(io, req, res, pageId, file.name, file.path, file.size);
    }
  };

  return routes;
};






