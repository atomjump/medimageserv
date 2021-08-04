/* 

	This function will prepare a settings snippet for display as soon as the settings tab is entered

*/

var fs = require('fs');


const entities = require('html-entities').AllHtmlEntities;

/*
Old way of using the entities interface for ver 1.3.1, which is the supported interface
for the old Windows Server < 1.8.4:
const Entities = require('html-entities').AllHtmlEntities;
 
const entities = new Entities();
*/ 

var verbose = false;

//Globals
var mainConfigFile = __dirname + '/../../config.json';
var mainMedImagePath = "../../photos/";
var logFile = __dirname + "/../../logs/output.log";
var exec = require('child_process').exec;



function getPlatform() {
	var platform = process.platform;
	if(verbose == true) console.log(process.platform);
	var isWin = /^win/.test(platform);
	if(verbose == true) console.log("IsWin=" + isWin);
	if(isWin) {
		if(process.arch == 'x64') {
			return "win64";
		} else {
			return "win32";
		}
	} else {
		if(platform == "darwin") {
			return "mac";
		} else {
			return "unix";
		}
	
	}


}


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



function readLog(logFile, platform, callback) {
	
	if((platform == "mac")||(platform == "unix")) {
		var cmd = "tail -40 $HOME/.pm2/logs/medimage-server-out-0.log";
		
		exec(cmd, {
			maxBuffer: 2000 * 1024 //quick fix
		}, (err, stdout, stderr) => {
			  if (err) {
				// node couldn't execute the command
				console.log("There was a problem running the addon. Error:" + err);
				callback(err, "");
	
			  } else {
				  console.log("Output Logs:" + stdout);
				  var fullLog = "OUTPUT LOGS:\n\n" + stdout;
				  
				  var cmd = "tail -40 $HOME/.pm2/logs/medimage-server-error-0.log";
				  
				  //Now add the error log to that
				  exec(cmd, {
						maxBuffer: 2000 * 1024 //quick fix
					}, (err, stdout, stderr) => {
						  if (err) {
							// node couldn't execute the command
							console.log("There was a problem running the addon. Error:" + err);
							callback(err, "");
				  		  } else {
			  	  
			  	 				fullLog = fullLog + "\n\nERROR LOGS:\n\n" + stdout;
				  		    	callback(null, fullLog);
				  		}
				  	});
			 
			  }
		});		//End of the exec
	} else {
		//On Windows logs are now at C:\medimage\logs\output.log. 
		
		var visibleLen = 10000;    //Limit to 10000 chars, at the end of the file
		
		fs.stat(logFile, function postStat(err, stats) {
		  if(err) {
		  	callback("Sorry, cannot find the log file! " + err, null);	
		  } else {
		  	  //Try to open the file
			  fs.open(logFile, 'r', function postOpen(err, fd) {
				if(err) {
					callback("Sorry, cannot open the log file! " + err, null);
				} else {
		  			
		  			if(visibleLen > stats.size) visibleLen = stats.size;
		  			const b = new Buffer(visibleLen);
		  			
		  			//Now try to read from the end
					fs.read(fd, b, 0, visibleLen, stats.size - visibleLen, function postRead(err, bytesRead, buffer) {
				  
						if(err) {
							callback("Sorry, cannot read the log file! " + err, null);
						} else {
							callback(null, buffer.toString());
						}
					});	//End of read
				}
			  });	//end of open log file
		   }	//End of not finding log file
		});
		
	}
	
	
}




function readConfig(confFile, cb) {
	//Reads and updates config with a newdir in the output photos - this will overwrite all other entries there
	//Returns cb(err) where err = null, or a string with the error

	getMasterConfig(confFile, function(err, masterConfigFile) {
		if(err) {
			//Leave with the configFile
		} else {
			confFile = masterConfigFile;		//Override with the global option
		}
		console.log("Using config file:" + confFile);


		//Write to a json file with the current drive.  This can be removed later manually by user, or added to
		fs.readFile(confFile, function read(err, data) {
			if (err) {
					cb(null, "Sorry, cannot read config file! " + err);
			} else {
				var content = JSON.parse(data);

				cb(content, null);
			};
		});
	});

}





var readConfigFile = mainConfigFile;

 
//Read the config
readConfig(readConfigFile, function(conf, err) {

		   if(err) {
			 //There was a problem loading the config
			 console.log("Error reading config file:" + err);
			 process.exit(0);
				 
		   } else {
						   			   			   
			   var platform = getPlatform();
			   readLog(logFile, platform, function(err, log) { 
			   
			   			   
				   if(conf.lockDown == true) {
						var allowChanges = "<i class='fa fa-lock fa-fw'></i>";
						var logOutput = "<p>Sorry, please contact your system admin to see these. You will need to change your configuration.</p>";
				   } else {
						var allowChanges = "<i class='fa fa-unlock fa-fw'></i>";
						
						var logOutput = entities.encodeNonUTF(log);
				   		//Convert newlines into HTML breaks
			  	   		logOutput = logOutput.replace(/\&\#10\;/g, '<br/>');
							
				   }
				   
				
			  
				   console.log("returnParams:?LOG=" + encodeURIComponent(logOutput) + "&ALLOWCHANGES=" + allowChanges);
			   });
			   
			}
});
