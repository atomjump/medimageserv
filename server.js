var multiparty = require('multiparty');
var http = require('http');
var util = require('util');

var myfield;

http.createServer(function(req, res) {
  
  
  if (req.url === '/api/photo' && req.method === 'POST') {
    // parse a file upload
    var form = new multiparty.Form();



    form.parse(req, function(err, fields, files) {
      res.writeHead(200, {'content-type': 'text/plain'});
      res.write('received upload:\n\n');
      res.end(util.inspect({fields: fields, files: files}));
      
      if(fields) {
        if(fields.title) {
           myfield = fields.title[0];
           
        }
      }
      console.log('second:' + myfield);
      //todo move file now
    
    });
    
    form.on('file', function(name, file) {
    
        console.log(name);
        console.log(file.path);
        console.log("first:" + myfield);
    });

    return;
  }

  // show a file upload form
  res.writeHead(200, {'content-type': 'text/html'});
  res.end(
    '<form action="/api/photo" enctype="multipart/form-data" method="post">'+
    '<input type="text" name="title"><br>'+
    '<input type="file" name="file1" multiple="multiple"><br>'+
    '<input type="submit" value="Upload">'+
    '</form>'
  );
}).listen(5566);