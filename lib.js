

module.exports = function(TEMP) {
  var lib = {};
  
  //return random pageId
  lib.getRandomPageId = function(keyType) {
   crypto = require('crypto')
    , shasum = crypto.createHash('sha1');
    
    //random pageId.
    var randomPageId;
    if (keyType == 'STRONG') {
      shasum.update( Math.random().toString() + Date.now().toString()  );
      randomPageId = shasum.digest('hex');
    } else {
      randomPageId = Math.floor(Math.random() * 1000000000) + 1;
    }
    return randomPageId;
  }

  //fileInfo
  lib.fileInfo = function(req, res, pageId) {
    req.redisClient.get(pageId + '.fileList', function(err, value) {
      res.writeHead(200);
      res.end(value);  
    });
  }

  //fileExists
  lib.fileExists = function(obj, cb) {
    var async = require('async');  
    var isExists = false;

    obj.redisClient.get(obj.pageId + '.fileList', function(err, value) {
      if (err) { throw err; }

      try {
        //if ( value == null) { throw new Error("No file"); }
        var fileList = JSON.parse(value);

        //기존에 있는 경우 체크.
        for(var i = 0; i<fileList.files.length; ++i) {
          if (fileList.files[i].name == obj.fileName ) {
              isExists = true;
            }
        }
      } catch(e) {
        
      }
      
      cb(isExists);
    });
    

  }
   
  //mongoDb 
  //delete files
  lib.DBfileDelete = function(obj , cb ) {
    var async = require('async');  

  //  var obj = {
  //    io : io,
  //    gfs : req.gfs,
  //    redisClient : req.redisClient,
  //    redisLock : req.redisLock,
  //    pageId : pageId,
  //    fileName : fileName
  //  };      

    var options = {
        metadata: { pageId: obj.pageId }
        ,filename : obj.fileName
    };

    async.waterfall([
      function(callback) {
        //파일 삭제.
        obj.gfs.remove(options, function (err) {
          if (err) throw err;
          
          callback();
        });  
      },
      function(callback) {

          //update info to redis 
          obj.redisLock(obj.pageId, function(done) {
            obj.redisClient.get(obj.pageId + '.fileList', function(err, value) {
              if (err) { throw err; }

              try {
                //if ( value == null) { throw new Error("No file"); }

                var fileList = JSON.parse(value);
                
                var file = {};
                file.name = obj.fileName;

                //delete if exists
                for(var i = 0; i<fileList.files.length; ++i) {
                  if (fileList.files[i].name == file.name)
                  {
                    fileList.size = fileList.size - fileList.files[i].size;
                    fileList.count = fileList.count -1;
                    fileList.files.splice(i,1);
                  }
                }

                obj.redisClient.set(obj.pageId + '.fileList', JSON.stringify(fileList) );

                callback();
                
              } catch(e) {
                callback(e,"");
              }
            });

            done();
          });

      }
    ], function(err, results) {
      cb(err, results);
    });  
  
  }
  
  lib.DBfileDeleteAll = function(obj, cb) {
    var async = require('async');  
  //  var obj = {
  //    io : io,
  //    gfs : req.gfs,
  //    redisClient : req.redisClient,
  //    redisLock : req.redisLock,
  //    pageId : pageId
  //  };

    async.waterfall([
      function(callback) {
        callback();
      },
      function(callback) {
        //update info to redis
        obj.redisClient.get(obj.pageId + '.fileList', function(err, value) {
          if (err) { throw err; }
          
          if ( value == null) { 
            callback( new Error("No file") , ''); 
          } else {
            var fileList = JSON.parse(value);
            
            //delete if exists
            fileList.files.forEach(function(file, index) { //fileList.files[i].name
              var options = {
                  metadata: { pageId: obj.pageId }
                  ,filename : file.name
              };                          
   
              //delete files
              obj.gfs.remove(options, function (err) {
                if (err) throw err;
                //console.log(options);
              });
              
            });

            fileList.size = 0;
            fileList.count = 0;
            fileList.files = [];

            obj.redisClient.set(obj.pageId + '.fileList', JSON.stringify(fileList) );
            callback();
          }

        });
      }
    ], function(err, results) {
      cb(err, results);
    });
  }

  //file upload. gridfs-stream
  lib.fileUpload = function(io, req, res, pageId, fileName, filePath, fileSize) {
    lib.DBfileUpload(io,req.gfs, req.redisClient, req.redisLock, pageId, fileName, filePath, fileSize , function(err, results) {
      if (err) {
        res.json( {'ret':false, msg : err.message } );
      } else {
        res.json( {'ret':true } );
      }    
    });
  }
    
    
  //store file to DB
  lib.DBfileUpload = function(io, gfs, redisClient, redisLock, pageId, fileName, filePath, fileSize, cb) {
    var fs = require('fs');
    var async = require('async');  

    //check page exists
    lib.initPage({ pageId : pageId
                  , redisClient : redisClient  
                  , redisLock : redisLock
                 });     
    
    //delete if exists
    var options = {
        metadata: { pageId: pageId }
        ,filename : fileName
    };
    
    async.waterfall([
      function(callback) {
        //delete exported files.
        fs.exists( TEMP.docOutPath + '/' + pageId + '/view/' + fileName, function(exists) {
          if (exists) {
            require('./libraries/fs.removeRecursive').removeRecursive( TEMP.docOutPath + '/' + pageId + '/view/' + fileName , function(err, status) {
                if (err != null)
                  console.log(err);

                callback();
              });
          } else {
            callback();
          }
        });
      },
      function(callback) {
        //delete file.
        gfs.remove(options, function (err) {
          if (err) throw err;
        });  
        
        callback();      
      },
      function(callback) {
        // upload to gridfs by stream
        var writestream = gfs.createWriteStream(options);
        fs.createReadStream(filePath).pipe(writestream);

        callback();
      },
      function(callback) {
        //delete fs file if done.
        fs.unlink(filePath, function (err) {
          if (err) throw err;
          callback();
        });

      },
      function(callback) {
          //update info to redis
          redisLock(pageId, function(done) {
            redisClient.get(pageId + '.fileList', function(err, value) {
              if (err) { throw err }

              var file = {};
              file.time = Date.now();
              file.name = fileName;
              file.size = fileSize;
//            console.log(file);

              var fileList = JSON.parse(value);

              //delete if exists
              for(var i = 0; i<fileList.files.length; ++i) {
                if (fileList.files[i].name == file.name)
                {
                  fileList.size = fileList.size - fileList.files[i].size;
                  fileList.count = fileList.count -1;
                  fileList.files.splice(i,1);
                }
              }

              fileList.count = fileList.count +1;
              fileList.size = fileList.size + file.size;
              fileList.files.push(file);

              redisClient.set(pageId + '.fileList', JSON.stringify(fileList) );

              //emit to the room
              io.sockets.in(pageId).emit('fileSaved',  JSON.stringify( file) );
            });

            done();
          });

        callback();
      }
    ], function(err, results) {
      cb(err, results);
    });
  }
    
  //file download. gridfs-stream
  lib.fileDownload = function(obj, cb) {
    var fs = require('fs');
    
    var options = {
        metadata: { pageId: obj.pageId }
        ,filename : obj.fileName
    };
    
    //streaming from gridfs
    var readstream = obj.gfs.createReadStream(options);
    
    //error handling, e.g. file does not exist
    readstream.on('error', function (err) {
      //console.log('An error occurred!', err);
      //throw err;
      cb(err, '');
    });
  
    
    var fileExt = obj.fileName;
    fileExt = fileExt.substr(fileExt.lastIndexOf('.') +1 );
    if ( (fileExt == 'html') || (fileExt == 'htm') )
      obj.res.set('Content-Type', 'text/html');
    
    //obj.res.writeHead('Content-Type', 'application/octet-stream' );  
    readstream.pipe(obj.res);
  }
  
  
  //Delete the page and files.
  lib.deletePage = function(obj, cb) {
    var async = require('async');  
    var fs = require('fs');

  //  var obj = {
  //    io : io,
  //    gfs : gfs,
  //    redisClient : redisClient,
  //    redisLock : redisLock,
  //    pageId : pageId
  //  };       

    async.waterfall([
      function(callback) {
        fs.exists( TEMP.docOutPath + '/' + obj.pageId, function(exists) {
          if (exists) {
            require('./libraries/fs.removeRecursive').removeRecursive( TEMP.docOutPath + '/' + obj.pageId , function(err, status) {
                if (err != null)
                  console.log(err);
        
                callback();
              });
          } else {
            callback();
          }
        });

      },
      function(callback) {

        lib.DBfileDeleteAll(obj, function(err, results) {
          if (err) {
            //res.json( {'ret':false, msg : err.message } );
          } else {
            obj.io.sockets.in(obj.pageId).emit("fileDeletedAll", JSON.stringify({ pageId : obj.pageId }) )
            //res.json( {'ret':true } );
          }

          callback();
        });
      }, 
      function(callback) {
        obj.redisClient.del(obj.pageId + '.fileList');
        callback();
      },
      function(callback) {
        obj.redisClient.del(obj.pageId + '.text');
        callback();
      },
      function(callback) {
        obj.redisClient.del(obj.pageId + '.info');
        callback();
      }
    ], function(err, results) {
      cb(err, results);    
    });  
    
  }; 

  //init page. redis
  lib.initPage = function(obj) {
    var pageId = obj.pageId;
    var async = require('async');
    //obj.
    TEMP.redisLock(pageId, function(done) {

      async.parallel([
          function(callback) {
            obj.redisClient.get(pageId + '.info', function(err, value) {
              if (value == null) {
                var data = {};
                data.pageId = pageId;
                data.createdTime = Date.now();
                data.expiresTime = Date.now() + TEMP.expiresTime ;
                obj.redisClient.set(pageId + '.info', JSON.stringify(data) );
              }

              callback();
            });
          },
          function(callback) {
            obj.redisClient.get(pageId + '.text', function(err, value) {
              if (value == null) {
                var data = '';
                obj.redisClient.set(pageId + '.text', data );
              }

              callback();
            });
          },
          function(callback) {
            obj.redisClient.get(pageId + '.fileList', function(err, value) {
              if (value == null) {
                var data = {};
                data.count = 0;
                data.size = 0;
                data.files = [];
                obj.redisClient.set(pageId + '.fileList', JSON.stringify(data) );
              }

              callback();
            });
          }, function(callback) {
            done();
          }

        ], function(err) {
          //already exsits.
          //console.log("Can not create " + pageId);
          done();
        });
      });
  };

  //Export 
  lib.DocExports = function(obj, cb) {
    var exec = require('child_process').exec,
        child;

    var cmd = obj.libreOfficePath + " --headless --convert-to " + obj.convertType + " \"" + obj.targetFilePath + "\"  --outdir \"" + obj.outDir+"\"";
    //console.log(cmd);
    child = exec(cmd, function (error, stdout, stderr) {
        cb(error, stdout, stderr);
    });    
    
  };
  
  //Mode Detect by file ext
  lib.CodeMirrorModeDetect = function(ext) {
    var mode = '';

    CodeMirrorModeInfo = [
      {ext:"h",     name: 'C', mime: 'text/x-csrc', mode: 'clike'},
      {ext:"c",     name: 'C', mime: 'text/x-csrc', mode: 'clike'},
      {ext:"cpp",   name: 'C++', mime: 'text/x-c++src', mode: 'clike'},
      {ext:"java",  name: 'Java', mime: 'text/x-java', mode: 'clike'},
      {ext:"cs",    name: 'C#', mime: 'text/x-csharp', mode: 'clike'},
      {ext:"css",   name: 'CSS', mime: 'text/css', mode: 'css'},
      {ext:"go",    name: 'Go', mime: 'text/x-go', mode: 'go'},
      {ext:"aspx",  name: 'ASP.NET', mime: 'application/x-aspx', mode: 'htmlembedded'},
      {ext:"jsp",   name: 'JavaServer Pages', mime: 'application/x-jsp', mode: 'htmlembedded'},
      {ext:"jade",  name: 'Jade', mime: 'text/x-jade', mode: 'jade'},
      {ext:"js",    name: 'JavaScript', mime: 'text/javascript', mode: 'javascript'},
      {ext:"json", name: 'JSON', mime: 'application/x-json', mode: 'javascript'},
      {ext:"pas", name: 'Pascal', mime: 'text/x-pascal', mode: 'pascal'},
      {ext:"perl", name: 'Perl', mime: 'text/x-perl', mode: 'perl'},
      {ext:"php", name: 'PHP', mime: 'text/x-php', mode: 'php'},
      {ext:"txt", name: 'Plain Text', mime: 'text/plain', mode: 'null'},
      {ext:"py", name: 'Python', mime: 'text/x-python', mode: 'python'},
      {ext:"rb", name: 'Ruby', mime: 'text/x-ruby', mode: 'ruby'},
      {ext:"rust", name: 'Rust', mime: 'text/x-rustsrc', mode: 'rust'},
      {ext:"sh", name: 'Shell', mime: 'text/x-sh', mode: 'shell'},
      {ext:"html", name: 'Smarty', mime: 'text/x-smarty', mode: 'smarty'},
      {ext:"htm", name: 'Smarty', mime: 'text/x-smarty', mode: 'smarty'},      
      {ext:"sql", name: 'SQL', mime: 'text/x-sql', mode: 'sql'},
      {ext:"vb", name: 'VB.NET', mime: 'text/x-vb', mode: 'vb'},
      {ext:"vbscript", name: 'VBScript', mime: 'text/vbscript', mode: 'vbscript'},
      {ext:"xml", name: 'XML', mime: 'application/xml', mode: 'xml'}
    ];

    for(var k in CodeMirrorModeInfo) {
      if ( CodeMirrorModeInfo[k].ext == ext) {
        mode = CodeMirrorModeInfo[k].mode;
      }
    }

    return mode;
  };

  return lib;
};

