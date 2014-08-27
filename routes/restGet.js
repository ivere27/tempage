
/*
 * GET
 */

module.exports = function(TEMP, io) {
  var lib = require('../lib.js')(TEMP);
  var routes = {};

  //test
  routes.test = function(req, res) {
    console.log(req);
    res.writeHead(200);
    res.json("Hello :) ");
  };

  //config
  routes.config = function(req, res) {
    res.json({
      maxPageTextLength : TEMP.maxPageTextLength,
      expiresTime : TEMP.expiresTime,
      uploadLimit : TEMP.uploadLimit,
      secure : TEMP.secure
    });
  };

  //view / export
  routes.fileView = function(req, res) {
    var obj = {
      pageId : req.params.id,
      fileName : req.params.file,
      redisClient : req.redisClient,
      redisLock : req.redisLock,
      gfs : req.gfs,
      req : req,
      res : res,
      libreOfficePath : TEMP.libreOfficePath,
      outDir : TEMP.docOutPath + '/' + req.params.id + '/view/' + req.params.file,
      targetFilePath : req.protocol + '://' + req.headers.host + '/' + req.params.id + '/file/' + req.params.file,
      convertType : ''
      };

    //file type
    var documentExt = req.params.file;
    documentExt = documentExt.substr(documentExt.lastIndexOf('.') + 1);

    lib.fileExists(obj, function(exists) {
      if (!exists) {
        res.writeHead(404, {'Content-Type': 'text/html'});
        res.end("404 Not Found");
      } else {
        var bExport = false;
        if ( (documentExt == 'ppt') || (documentExt == 'pptx') || (documentExt == 'doc') || (documentExt == 'docx') || (documentExt == 'xls')  || (documentExt == 'xlsx') || (documentExt == 'pdf')  ) {
          
          if ((documentExt == 'ppt') || (documentExt == 'pptx') )
            obj.convertType = "html:\"impress_html_Export\"";
          if ((documentExt == 'doc') || (documentExt == 'docx')  )
            obj.convertType = "html:\"HTML (StarWriter)\"";
          if ((documentExt == 'xls') || (documentExt == 'xlsx') )
            obj.convertType = "html:\"HTML (StarCalc)\"";      
          if ( (documentExt == 'pdf') )          
            obj.convertType = "html:\"draw_html_Export\"";      
          
          bExport = true;
        }

        if (bExport) {
          var fs = require('fs');
          var documentName = req.params.file;
          documentName = documentName.substr(0,documentName.lastIndexOf('.') ) + '.html';
          var exportPath = '/' + req.params.id + '/view/' + req.params.file + '/' + documentName;
          var exportFile = TEMP.docOutPath + '/' + req.params.id + '/view/' +  req.params.file + '/' + documentName;
          fs.exists(exportFile, function(exists)  {
            if (exists) {
              res.redirect(exportPath);
            } else {
              lib.DocExports(obj, function(error, stdout, stderr) {
                  console.log('stdout: ' + stdout);
                  console.log('stderr: ' + stderr);
                  if (error !== null) {
                    console.log('exec error: ' + error);
                  }
                  res.redirect(exportPath);
                });
            }
          });
        } else {
          //check file type
          var CodeMirrorMode = lib.CodeMirrorModeDetect(documentExt);

          if (CodeMirrorMode == '') {
            res.redirect('/' + req.params.id + '/file/' + req.params.file) ;
          } else {
            res.render('viewCodeMirror', {
              pageId : obj.pageId,
              source : obj.targetFilePath,
              CodeMirrorMode : CodeMirrorMode,
              protocol : req.protocol
            });
          }
          
        }
      }
    });
  };  
  
  //view
  routes.fileViewDocument = function(req, res) {
    var fs = require('fs');
    var targetFilePath = TEMP.docOutPath + '/' + req.params.id + '/view/' + req.params.file + '/' + req.params.document;
    fs.exists(targetFilePath, function(exists) {
      if(exists) {
        res.sendfile(TEMP.docOutPath + '/' + req.params.id + '/view/' + req.params.file + '/' + req.params.document);    
      } else {
        res.writeHead(404, {'Content-Type': 'text/html'});
        res.end("404 Not Found");
      }
    });
  };

  //about
  routes.about = function(req, res) {
    res.writeHead(200);
    res.json("Hello :) "); 
  };

  //redirect to a random page
  routes.index = function(req, res) {
    var pageId = lib.getRandomPageId(); // '' or STRONG
    res.redirect('/' + pageId);
  };

  //rendar page.
  routes.id = function(req, res) {
    var pageId = req.params.id;
    if (pageId.length <= 5) {
      pageId = lib.getRandomPageId('');
      res.redirect('/' + pageId);
    } else {
      if (TEMP.secure && !req.secure) {
        res.redirect('https://' + req.headers.host + '/' + pageId);
      } else {
          res.render('index',
          { pageId : pageId,
            host : req.headers.host,
            protocol : req.protocol
          });
      }
    }
  };

  //get pageInfo
  routes.pageInfo = function(req, res) {
    var pageId = req.params.id;
    req.redisClient.get(pageId + '.info', function(err, value) {
      var data = {};
      data.text = value;
      res.writeHead(200);
      res.end( value );
    });
  };

  //get text
  routes.text = function(req, res) {
    var pageId = req.params.id;
    req.redisClient.get(pageId + '.text', function(err, value) {
      res.writeHead(200);
      res.end(value);
    });
  };


  //fileInfo
  routes.fileInfo = function(req, res){
    var pageId = req.params.id;
    lib.fileInfo(req, res, pageId);
  };
  
  //getFile
  routes.getFile = function(req, res){

    var obj = {
      pageId : req.params.id,
      fileName : req.params.file,
      gfs : req.gfs,
      req : req,
      res : res
      };
    
    lib.fileDownload(obj, function(err, results) {
      if (err) {
        //res.json( {'ret':false, msg : err.message } );
        res.writeHead(404, {'Content-Type': 'text/html'});
        res.end("404 Not Found");
      } else {
      }
    });
  };

  return routes;
};




