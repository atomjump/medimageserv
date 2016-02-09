#!/usr/bin/env node
/*(function () {
  "use strict";

  var port = process.argv[2] || 5566
    , app = require('../');

  function run() {
    var server;

    function onListening() {
      var addr = server.address();

      console.log("Listening on http://%s:%d", addr.address, addr.port);
    }

    server = app.listen(port, onListening);



  }

  if (require.main === module) {
    run();
  }
}());*/


var path = require("path");
require("date-format-lite");
var express =   require("express");
var multer  =   require('multer');
var app         =   express();
var storage =   multer.diskStorage({
  destination: function (req, file, callback) {
    callback(null, path.normalize('C:/temp/uploads'));
  },
  filename: function (req, file, callback) {
	console.log("in here");
	var outFile = file.originalname.replace('.jpg','');
	var myoutFile = outFile.replace(' ','-');
	console.log(myoutFile);
	var now = new Date();          // Date {Wed Jul 10 2013 16:47:36 GMT+0300 (EEST)}
    var mydt = now.format("iso");
    mydt = mydt.replace(':','-');
    console.log(mydt);
    var ex = myoutFile + '-' + mydt + '.jpg';
    console.log(ex);
    callback(null, ex);
  }
});

console.log("Storage=" + storage);
 //.any(); //single('userPhoto')
var upload = multer({ storage : storage}).single('file'); //.any() ??

var myUpload = multer({ storage : storage}).single('myFile');

app.get('/',function(req,res){
	  console.log('Dir:' + __dirname);
	  //var mydir = __dirname.replace("\\","\\\\") + "\\..\\public\\index.html";
	  var mydir = __dirname + "/../public/index.html";
      var normpath = path.normalize(mydir);
	  console.log(normpath);
      res.sendFile( normpath);
});

app.post('/api/myphoto', function(req,res){

    myUpload(req,res,function(err) {
        if(err) {
            return res.end("Error uploading file:" + err);
       }
        res.end("File is uploaded");
    });
});

app.post('/api/photo', function(req,res){

    upload(req,res,function(err) {
        if(err) {
            return res.end("Error uploading file:" + err);
       }
        res.end("File is uploaded");
    });
});

app.listen(5566,function(){
    console.log("Working on port 5566");
});
