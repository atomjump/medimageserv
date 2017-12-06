/* 

	This function will prepare a settings snippet for display as soon as the settings tab is entered

*/

var fs = require('fs');
const Entities = require('html-entities').AllHtmlEntities;
 
const entities = new Entities();
 

var verbose = false;

//Globals
var mainConfigFile = __dirname + '/../../config.json';
var mainMedImagePath = "../../photos/";
var logFile = "../../logs/output.log";
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
		var cmd = "tail -100 $HOME/.pm2/logs/medimage-error.log";
		
		exec(cmd, {
			maxBuffer: 2000 * 1024 //quick fix
		}, (err, stdout, stderr) => {
			  if (err) {
				// node couldn't execute the command
				console.log("There was a problem running the addon. Error:" + err);
				callback(err, "");
	
			  } else {
				  console.log("Current Logs:" + stdout);
			  	  
			  	  //Convert newlines into HTML breaks
			  	  stdout = stdout.replace(/(?:\r\n|\r|\n)/g, '<br />');
				  callback(null, stdout);
			 
			  }
		});		//End of the exec
	} else {
		//On Windows logs are now at C:\medimage\logs\output.log. 
		fs.readFile(logFile, function read(err, data) {
			if (err) {
				cb("Sorry, cannot read log file! " + err, null);
			} else {
				cb(null, data.substr(0, 10000));		//Limit to 10000 chars
			};
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
			   
			   			   
				   if(conf.allowPhotosLeaving == true) {
						var allowChanges = "<i class='fa fa-lock fa-fw'></i>";
				   } else {
						var allowChanges = "<i class='fa fa-unlock fa-fw'></i>";
							
				   }
				   
				   var logOutput = entities.encodeNonUTF(log);
			  
				   console.log("returnParams:?LOG=" + encodeURIComponent(logOutput) + "&ALLOWCHANGES=" + allowChanges);
			   });
			   
			}
});
