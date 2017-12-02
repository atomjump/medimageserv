/* 

	This function will prepare a settings snippet for display as soon as the settings tab is entered

*/

var fs = require('fs');

var verbose = false;

//Globals
var mainConfigFile = __dirname + '/../../config.json';
var mainMedImagePath = "../../photos/";
var exec = require('child_process').exec;


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
						   			   			   
			   var oldFolder = "";
			   if(conf.backupTo) {
				   if((conf.backupTo[0]) && (conf.allowPhotosLeaving == false)) {		//The allowPhotosLeaving should be a client, not a proxy - hide the folder on a proxy
						oldFolder = conf.backupTo[0];
				   }
			   }
			   
			   if(conf.allowPhotosLeaving == true) {
			   		var allowChanges = "Locked";
			   } else {
			   		var allowChanges = "Unlocked";
			   }
			  
			   console.log("returnParams:?OLDFOLDERVAL=" + oldFolder + "&ALLOWCHANGES=" + allowChanges);
			   
			}
});
