/* 

	This function will prepare a settings snippet for display as soon as the settings tab is entered

*/

var fs = require('fs');
var upath = require("upath");

var verbose = false;

//Globals
var mainConfigFile = __dirname + '/../../config.json';
var mainMedImagePath = "../../photos/";
var targetAddonsFolder = "./addons/";
var exec = require('child_process').exec;
var glob = require('glob-fs')({ gitignore: true });

var unallowedFilenameStrings = [
	".json",
	".md",
	".txt"
];


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



function fileWalk(startDir, cb)   //This was originally copied from the MedImage server.
{
   //Read and return the first file in dir, and the count of which file it is. Only the cnt = 0 is used
   //Note: startDir cannot be absolute, but should be relative
   var items = [];
   

	if(verbose == true) console.log("Searching:" + startDir);
	var uStartDir = upath.normalize(startDir) + "*";  //readdir requires a unix style path
	//Note: on Windows an absolute path won't work - it needs to be relative to the script
	console.log("Searching in unix terms:" + uStartDir);
	
	glob.readdir(uStartDir, function(err, items) {
		 
		 var resp = [];
		 for(var cnt = 0; cnt< items.length; cnt++) {
			
			console.log("Found:" + items[cnt]);	
			
			var banned = false;
			//Now confirm it doesn't have any of the banned strings

			for(var scnt = 0; scnt < unallowedFilenameStrings.length; scnt++) {
				if(items[cnt].indexOf(unallowedFilenameStrings[scnt]) >= 0) {
					banned = true;
				}
			}
			 
			if(banned == false) { 
			
				//Append to the list of user options to select
				resp.push({
					"addon": items[cnt]									
				});		
				
					
				
			 }  //end of banned
		}
		cb(resp);
		
	});
			        



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
						   			   			   
			   
			   
			   if(conf.allowPhotosLeaving == true) {
			   		var allowChanges = "Locked";
			   } else {
			   		var allowChanges = "Unlocked";
			   }
			   
			   fileWalk(targetAddonsFolder, function(addonArray) {
			   
			   	  var currentAddons = "<table>";
			   	  for(var cnt=0; cnt< addonArray.length; cnt++) {
			   	  	  currentAddons += "<tr><td>" + addonArray[cnt].addon + "</td></tr>";
			   	  
			   	  }	
			   	  currentAddons += "</table>";
			   	  
			   	  console.log("returnParams:?ALLOWCHANGES=" + allowChanges + "&CURRENTADDONS=" + encodeURIComponent(currentAddons));
			   });
			  
			   
			   
			}
});
