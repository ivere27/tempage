//default settings.
var TEMP = {};

TEMP.maxPageTextLength = 8192;                                            //up to 8192 bytes
TEMP.deletePageInterval = 5000;
TEMP.port = process.env.PORT || 80;
TEMP.ports = process.env.SSL_PORT || 443;
TEMP.secure = process.env.TEMPAGE_SECURE || true;
TEMP.mongoDbName = 'tempage';
TEMP.expiresTime = 1000*60*60; //60 minutes
TEMP.uploadDir = __dirname + '/tmp';
TEMP.uploadLimit = '10mb';
TEMP.mongoServerIP = '127.0.0.1';
TEMP.mongoServerPort = 27017;
TEMP.libreOfficePath = process.env.LIBREOFFICE || "/usr/bin/libreoffice"; //"\"C:\\Program Files\\LibreOffice 4\\program\\soffice.exe\"";
TEMP.hwp5htmlPath = process.env.HWP5HTML || "/usr/local/bin/hwp5html";    // don't use due to the license so far.
TEMP.docOutPath = __dirname + '/tmp';

//internal variables
TEMP.redisClient = null;
TEMP.redisLock = null;
TEMP.sslOptions = null;

module.exports = TEMP;