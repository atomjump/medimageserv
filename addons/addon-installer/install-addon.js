/*

Unzips, and then runs each of the commands in a 


*/




var url = require("url");
var path = require("path");
var AdmZip = require('adm-zip');
var path = require("path");
var upath = require("upath");
var queryString = require('querystring');
var http = require('http');
var https = require('https');
var fs = require('fs');
var fsExtra = require('fs-extra');
var async = require('async');
var exec = require('child_process').exec;



var httpsFlag = false;				//whether we are serving up https (= true) or http (= false)
var serverOptions = {};				//default https server options (see nodejs https module)
var verbose = false;


var configFile = __dirname + '/../../config.json';
var targetAddonsFolder = __dirname + "/../";
var descriptorFile = "medimage-installer.json";



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

function havePermission(configFile, cb) {
	//Checks config to see if we have permissions
	//Returns true or false


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


				if(content.allowPhotosLeaving == false) {	//For security purposes, only allow this change through the interface if we are a client machine

					cb(null, true);
					
				} else {
			
					cb(null, false);
				}
			


			};
		});
	});

}


function noTrailSlash(str)
{
	if(str.slice(-1) == "/") {
		return str.slice(0,-1);	//Chop off last char
	} else {
		return str;
	}

}

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

//With thanks from http://rajiev.com/download-an-extract-a-zip-file-with-node-js/
function downloadAndUnzip(filename, url, cb) {
	var tmpFilePath = targetAddonsFolder + filename;
	
	if(url.startsWith("https")) {
		//https
		https.get(url, function(response) {
			response.on('data', function (data) {
				fs.appendFileSync(tmpFilePath, data);
			});
		
			//TODO: handle error case
		
			response.on('end', function() {
				 var zip = new AdmZip(tmpFilePath);
				 var zipEntries = zip.getEntries(); // an array of ZipEntry records 
 				  
 				 if(zipEntries[0].isDirectory == true) {
 				 	var dirName = zipEntries[0].entryName;	//e.g. "medimage-addon-p4m-0.0.1/"
 				 
 				 } else {
 				 	var dirName = null;
 				 }				 
				 
				  try {
				 	zip.extractAllTo(targetAddonsFolder, true);	//Overwrite is the 'true'
				 } catch(err) {
				 		console.log("returnParams:?FINISHED=false&MSG=There was a problem unzipping the file. Err:" + err);
						process.exit(1);				 
				 }	
				 fs.unlink(tmpFilePath, cb(null, dirName));		//Remove the zip file itself
			})
		});
	
	
	} else {
		//http
		http.get(url, function(response) {
			response.on('data', function (data) {
				fs.appendFileSync(tmpFilePath, data);
			});
		
			//TODO: handle error case
		
			response.on('end', function() {
				 var zip = new AdmZip(tmpFilePath);
				 var zipEntries = zip.getEntries(); // an array of ZipEntry records 
 				  
 				 if(zipEntries[0].isDirectory == true) {
 				 	var dirName = zipEntries[0].entryName;	//e.g. "medimage-addon-p4m-0.0.1/"
 				 
 				 } else {
 				 	var dirName = null;
 				 }
 			 
 			 	 try {
				 	zip.extractAllTo(targetAddonsFolder, true);	//Overwrite is the 'true'
				 } catch(err) {
				 		console.log("returnParams:?FINISHED=false&MSG=There was a problem unzipping the file. Err:" + err);
						process.exit(1);				 
				 }				 
				 fs.unlink(tmpFilePath, cb(null, dirName));		//Remove the zip file itself
			})
		});
	}
}


function execCommands(commandArray, cb) 
{
		//Asyncronously call each item, but in sequential order. This means the process could
		//be doing something processor intensive without holding up the main server, but still allow
		//each add-on to potentially process sequentially. 
		
		
		async.eachOfSeries(commandArray,
					// 2nd param is the function that each item is passed to
					function(runBlock, cnt, callback){
				
						console.log("Running command: " + commandArray[cnt]);
						exec(commandArray[cnt], {
								maxBuffer: 2000 * 1024 //max buffer size
							}, (err, stdout, stderr) => {
								 if (err) {
									// node couldn't execute the command
									var msg = "There was a problem running the command " + commandArray[cnt] + ". Error:" + err;
									console.log(msg);
									callback(msg);
							
								 } else {
					  
									  console.log("Stdout from command:" + stdout);
									  callback(null);
								 }
						 });	//End of exec
					
					  },	//End of async eachOf single item
					  function(err){
						// All tasks are done now
						console.log("All tasks finished");
						if(err) {
						   console.log('ERROR:' + err);
						   cb(err);
						 } else {
						   console.log('Completed all commands successfully!');
						   cb(null);
						 }
					   }
		); //End of async eachOf all items


}



function openAndRunDescriptor(directory)
{

	//Change into the directory of the add-on
	process.chdir(directory);
	
	var desc = directory + "/" + descriptorFile;
	console.log("Checking installer file " + desc);
	
	if(fs.existsSync(desc) == true) {
		const data = fsExtra.readJsonSync(desc);
		if(data) {
			//Yes there is an installer script to run
			if(data.installCommands) {
				
				//Determine our current platform
				var platform = getPlatform();
				async.waterfall([
					function(callback) {
						console.log("Checking all platform commands");
						if(data.installCommands.all) {
							//Run through these commands always - all platforms	
							execCommands(data.installCommands.all, function(err) {
								callback(err);
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Win32 commands");
						if((data.installCommands.win32) && (platform == "win32")) {
							//Run through these commands always - all platforms	
							execCommands(data.installCommands.win32, function(err) {
								callback(err);
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Win64 commands");
						if((data.installCommands.win64) && (platform == "win64")) {
							//Run through these commands always - all platforms	
							execCommands(data.installCommands.win64, function(err) {
								callback(err);
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Unix commands");
						if((data.installCommands.unix) && (platform == "unix")) {
							//Run through these commands always - all platforms	
							execCommands(data.installCommands.unix, function(err) {
								callback(err);
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Mac commands");
						if((data.installCommands.mac) && (platform == "mac")) {
							//Run through these commands always - all platforms	
							execCommands(data.installCommands.mac, function(err) {
								callback(err);
							});
						} else {
							callback(null, 'done');
						}
					}
				], 
				function (err, result) {
					// result now equals 'done'
					if(err) {
						console.log("The installation was not complete.");
						console.log("returnParams:?FINISHED=false");
						process.exit(1);
					} else {
						console.log("The installation was completed successfully!");
						console.log("returnParams:?FINISHED=true");
						process.exit(0);
					}
				});
						
			}
		} else {
			console.log("Warning: no valid JSON data found");
			console.log("returnParams:?FINISHED=false");
			process.exit(1);
		}
	} else {
		console.log("Warning: no installer script was found");
		console.log("returnParams:?FINISHED=false");
		process.exit(1);
	}
	

}
		

function renameFolder(filename, dirname) {
	//Input will be 'wound-0.7.3.zip'
	//We want to convert '../wound-0.7.3' folder to '../wound' folder
	//Trim up to 1st digit, or dot '.'. Then trim '-' chars at the end.
	
	var dirIn = targetAddonsFolder + filename.replace(/.zip/i, "");
	if(dirname) {
		dirIn = targetAddonsFolder + noTrailSlash(dirname);
	}
	
	//Read in the json descriptor to get an output folder name of the addon
	var desc = dirIn + "/" + descriptorFile;
	console.log("Checking for file:" + desc);
	var dirOut = "";
	if(fs.existsSync(desc) == true) {
		const data = fsExtra.readJsonSync(desc);
		if(data) {
			dirOut = targetAddonsFolder + data.name;
		}
	}
	
	if(dirOut == "") {
		console.log("Using filename to determine directory...");
		//We will need to determine out own version based on the filename
	
		var dirOut = filename.replace(/[0-9\.]+/g, "");
		dirOut = dirOut.replace(/zip/i, "");
		dirOut = targetAddonsFolder + dirOut.replace(/-$/, '');
	}

	
	console.log("Dir in=" + dirIn + "\nDir out" + dirOut);
	//fsExtra.move(dirIn, dirOut);
	fsExtra.move(dirIn, dirOut, { overwrite: true }, function(err) {
	  if (err) {
	  	return console.log("returnParams:?FINISHED=false&MSG=Could not rename the folder. Err:" + err);
	  } else {
	  	console.log('Success renaming!');
	  	openAndRunDescriptor(dirOut);
	  	return;
	  }
	})
}

function uninstall(addonName)
{
	var dirOut = targetAddonsFolder + addonName;	//Absolute path to folder to delete
	
	//Change into the directory of the add-on
	process.chdir(dirOut);

	
	//Read in the json descriptor to get
	var desc = dirOut + "/" + descriptorFile;
	console.log("Checking for file:" + desc);
	
	
	
	if(fs.existsSync(desc) == true) {
		const data = fsExtra.readJsonSync(desc);
		if(data) {
			//Yes there is an uninstaller script to run
			if(data.uninstallCommands) {
			
				//Determine our current platform
			
				var platform = getPlatform();
				async.waterfall([
					function(callback) {
						console.log("Checking all platform commands");
						if(data.uninstallCommands.all) {
							//Run through these commands always - all platforms	
							execCommands(data.uninstallCommands.all, function(err) {
								callback(err);
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Win32 commands");
						if((data.uninstallCommands.win32) && (platform == "win32")) {
							//Run through these commands always - all platforms	
							execCommands(data.uninstallCommands.win32, function(err) {
								callback(err);
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Win64 commands");
						if((data.uninstallCommands.win64) && (platform == "win64")) {
							//Run through these commands always - all platforms	
							execCommands(data.uninstallCommands.win64, function(err) {
								callback(err);
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Unix commands");
						if((data.uninstallCommands.unix) && (platform == "unix")) {
							//Run through these commands always - all platforms	
							execCommands(data.uninstallCommands.unix, function(err) {
								callback(err);
							});
						} else {
							callback(null);
						}
					},
					function(callback) {
						console.log("Checking Mac commands");
						if((data.uninstallCommands.mac) && (platform == "mac")) {
							//Run through these commands always - all platforms	
							execCommands(data.uninstallCommands.mac, function(err) {
								callback(err, 'done');
							});
						} else {
							callback(null);
						}
					}
				], 
				function (err, success) {
					// result now equals 'done'
					if(err) {
						console.log("The uninstallation was not complete.");
						console.log("returnParams:?FINISHED=false&MSG=The uninstallation was not complete. Error:" + err);
						process.exit(1);
					} else {
					
						//Change back out of our folder
						process.chdir(targetAddonsFolder);
					
						//Now clear out the folder
						console.log("Removing folder:" + dirOut);
						fsExtra.removeSync(dirOut);
					
						console.log("The uninstallation was completed successfully!");
						console.log("returnParams:?FINISHED=true&MSG=The uninstallation was completed successfully!");
						process.exit(0);
					}
				});
			
			}
		} else {
			console.log("Warning: no valid JSON data found");
			console.log("returnParams:?FINISHED=false&MSG=Warning: no valid JSON datafound");
			process.exit(1);
		}
	} else {
		console.log("Warning: no valid JSON data found");
		console.log("returnParams:?FINISHED=false&MSG=Warning: no valid JSON data found");
		process.exit(1);
	}

		


}





havePermission(configFile, function(err, ret) {

	if(err) {
		console.log("returnParams:?FINISHED=false&MSG=Sorry you do not have permissions to install add-ons. Please contact your administrator.");
	
	} else {

		if(ret == true) {
			//Yes we have permission to install
			if(process.argv[2]) {

			  var opts = queryString.parse(decodeURIComponent(process.argv[2]));

			  if(opts.zipfileURL) {
				  //If passing in a zip file url to install
				  var zipfileURL = opts.zipfileURL;
  
  
  
				  var parsed = url.parse(zipfileURL);
				  var filename = path.basename(parsed.pathname);
  
				  console.log("Filename: " + filename + " URL: " + zipfileURL);
				  //Get the filename of the path to the URL
  
				  downloadAndUnzip(filename, zipfileURL, function(err, dirname) {
					  console.log("Files unzipped");
	  
					  renameFolder(filename, dirname);
  
				  });
			  } 
		  
			  if(opts.uninstall) {
				  uninstall(opts.uninstall);		  
			  }
			  
			  if((!opts.uninstall)&&(!opts.zipfileURL)) {
			  	  console.log("You should enter a 'zipfileURL' or 'uninstall' param.");
			  
			  }
  

  
			} else {
			  console.log("Usage: node install-addon.js zipfileURL%3Dhttp://url.To.Zip/file/name.zip (with urlencoded URL)");
  
			}
		} else {
			//No permission, sorry
			console.log("returnParams:?FINISHED=false&MSG=Sorry, you don't have permission to install add-ons. Please check your config.json. " + ret);
		}
	}
});
