/* 

	This function will prepare a settings snippet for display as soon as the settings tab is entered

*/

var fs = require('fs');

var verbose = false;

//Globals
var resizeConfigFile = __dirname + '/../../config.json';
var mainMedImagePath = "../../photos/";


function readConfig(confFile, cb) {
	//Reads and updates config with a newdir in the output photos - this will overwrite all other entries there
	//Returns cb(err) where err = null, or a string with the error


	//Write to a json file with the current drive.  This can be removed later manually by user, or added to
	fs.readFile(confFile, function read(err, data) {
		if (err) {
				cb(null, "Sorry, cannot read config file! " + err);
		} else {
			var content = JSON.parse(data);

			cb(content, null);
		};
	});

}



readConfigFile = resizeConfigFile;
 
//Read the config
readConfig(readConfigFile, function(conf, err) {

		   if(err) {
			 //There was a problem loading the config
			 console.log("Error reading config file:" + err);
			 process.exit(0);
				 
		   } else {
						   			   			   
			   var oldFolder = "";
			   if((conf.backupTo[0]) && (conf.allowPhotosLeaving == false)) {		//The allowPhotosLeaving should be a client, not a proxy - hide the folder on a proxy
			   	 	oldFolder = conf.backupTo[0];
			   }
			  
			   console.log("returnParams:?OLDFOLDERVAL=" + oldFolder);
			   
			}
});
