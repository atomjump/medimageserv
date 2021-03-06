/*
  Take input on the command-line a single parameter: Windows or Unix path, and convert into a linux path.
  Then write that path to ../config.json under backupTo: as an entry in the array.
  

*/

var multiparty = require('multiparty');
var http = require('http');
var util = require('util');
var path = require("path");
var upath = require("upath");
require("date-format-lite");
var mv = require('mv');
var fs = require('fs');
var exec = require('child_process').exec;
var drivelist = require('drivelist');
var uuid = require('node-uuid');
var fsExtra = require('fs-extra');
var request = require("request");
var needle = require('needle');



var currentDisks = [];
var configFile = '/../config.json';


function updateConfig(newdir, cb) {
	//Reads and updates config with a newdir in the output photos - this will overwrite all other entries there
	//Returns cb(err) where err = null, or a string with the error


	//Write to a json file with the current drive.  This can be removed later manually by user, or added to
	fs.readFile(__dirname + configFile, function read(err, data) {
		if (err) {
				cb("Sorry, cannot read config file! " + err);
		} else {
			var content = JSON.parse(data);

			content.backupTo = [ newdir ];

			//Write the file nicely formatted again
			fs.writeFile(__dirname + configFile, JSON.stringify(content, null, 6), function(err) {
				if(err) {
					cb(err);
				}
  
  

				console.log("The config file was saved!");

				
				cb(null);
			});

			


		};
	});

}



if(process.argv[2]) {
  
  //Potentially there can be spaces in this path, which would be input as a different argument.
  //Append them all into one single directory variable.
  var fullDir = process.argv[2];
  for(var argc = 3; argc < process.argv.length; argc++) {
  	if(process.argv[argc]) {
  		fullDir += " " + process.argv[argc];
  	}  
  }
  
  var photoDir = upath.normalize(fullDir);
  //path.posix.normalize(p)
  updateConfig(photoDir, function(err) {
      if(err) {
      	 console.log("Error:" + err);
      	 process.exit(1);
      	
      } else {
      	 console.log("Set successfully.");
      	 process.exit(0);
      }
    
  })
  
} else {
  console.log("Usage: node install.js imagedir");
  
}


