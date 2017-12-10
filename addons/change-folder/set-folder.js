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
var queryString = require('querystring');
var exec = require('child_process').exec;


var verbose = false;

var currentDisks = [];
var configFile = __dirname + '/../../config.json';
var pm2Parent = 'medimage-server';		//Include a string if this is run on linux that represents the MedImage server to restart


	



function getMasterConfig(defaultConfig, callback) {
	exec("npm get medimage:configFile", {
			maxBuffer: 2000 * 1024 //quick fix
		}, (err, stdout, stderr) => {
		  if (err) {
			// node couldn't execute the command
			console.log("There was a problem running the addon. Error:" + err);
			callback(err, "");
	
		  } else {
			  console.log("Stdout from command:" + stdout);
			  if((stdout != "")&&(!stdout.startsWith("undefined"))) {
			  	 callback(null, stdout.trim());
			  
			  } else {
			  	 callback("Global not set", null);
			  
			  }		
		  }
	});		//End of the exec
}



function noTrailSlash(str)
{
	if(str.slice(-1) == "/") {
		return str.slice(0,-1);	//Chop off last char
	} else {
		return str;
	}

}

function restartParentServer(cb)
{
	//Restart the parent MedImage service
	var platform = process.platform;
	var isWin = /^win/.test(platform);
	if(isWin) {
		var run = 'net stop MedImage';
		if(verbose == true) console.log("Running:" + run);
		exec(run, function(error, stdout, stderr){
			if(error) {
				console.log("Error stopping MedImage:" + error);
				cb();
			
			} else {
				console.log(stdout);
			
				var run = 'net start MedImage';
				exec(run, function(error, stdout, stderr){
					if(error) {
						console.log("Error starting MedImage:" + error);
						cb();
					} else {
						console.log(stdout);
						cb();
					}
				});
			}
		});
	} else {
	   //Probably linux
	   if((pm2Parent) && (pm2Parent != '')) {
		   var run = 'pm2 restart ' + pm2Parent;
			if(verbose == true) console.log("Running:" + run);
			exec(run, function(error, stdout, stderr){
				console.log(stdout);
				cb();
				
			});
		}
	}

}



function updateConfig(newdir, cb) {
	//Reads and updates config with a newdir in the output photos - this will overwrite all other entries there
	//Returns cb(err) where err = null, or a string with the error


	getMasterConfig(configFile, function(err, masterConfigFile) {
		if(err) {
			//Leave with the configFile
		} else {
			configFile = masterConfigFile;		//Override with the global option
		}
		console.log("Using config file:" + configFile);

		//Write to a json file with the current drive.  This can be removed later manually by user, or added to
		fs.readFile(configFile, function read(err, data) {
			if (err) {
					cb("Sorry, cannot read config file! " + err);
			} else {
				var content = JSON.parse(data);


				if(content.lockDown == false) {	//For security purposes, only allow this change through the interface if we are a client machine

					content.backupTo = [ newdir ];

					//Write the file nicely formatted again
					fs.writeFile(configFile, JSON.stringify(content, null, 6), function(err) {
						if(err) {
							cb(err);
						} else {
  
  

							console.log("The config file was saved!");

							//Ensure the parent server reloads it's config
							console.log("reloadConfig:true");
							cb(null);
						}
					});
				} else {
			
					cb("Sorry, this server is not configured to accept changes. Please check your config.json file.");
				}
			


			};
		});
	});

}



if(process.argv[2]) {

  var opts = queryString.parse(decodeURIComponent(process.argv[2]));
  var photoDir = upath.normalize(decodeURIComponent(opts.newFolder));
  
  //Remove any trailing slashes
  photoDir = noTrailSlash(photoDir);
  
  //path.posix.normalize(p)
  updateConfig(photoDir, function(err) {
      if(err) {
      	 console.log("Error:" + err);
      	 console.log("returnParams:?MESSAGE=Error+setting+folder");
      	
      } else {
      	 console.log("Set successfully.");
      	 console.log("returnParams:?MESSAGE=Success");
      }
    
  })
  
} else {
  console.log("Usage: node install.js imagedir");
  
}


